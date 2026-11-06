/**
 * High-level API over the ZYCELA protocol. Every method encodes one command
 * (see commands.ts) and sends it through a transport (the BLE session, which
 * serializes writes through the GATT queue).
 */
import * as cmd from './commands';
import type { BinaryValue, CarEventKey, ColorZone, LedStripKey, PowerMode, Slot, WiringKey } from './commands';
import type { KeyLearnResultFrame, ParsedFrame, StripsFrame } from './parser';
import type { SceneData } from './scenes';
import { sceneToCommands } from './scenes';

export interface ZycelaTransport {
  /** Sends an ASCII command (one write). */
  send(text: string): Promise<void>;
  /** Sends raw bytes (one write). */
  sendBytes(bytes: Uint8Array): Promise<void>;
  /** Subscribes to parsed incoming frames; returns an unsubscribe function. */
  onFrame(listener: (frame: ParsedFrame) => void): () => void;
}

export interface DriverOptions {
  /** Called with every command just before it is sent (used for optimistic updates). */
  onCommand?: (command: string) => void;
  /** Minimum interval between live colour writes while dragging. */
  colorThrottleMs?: number;
  /**
   * Pause between the commands of a scene. The mini-program never sends two
   * commands without a human-paced gap (and throttles colour to 200 ms), so
   * the module's UART side may not cope with a burst.
   */
  scenePacingMs?: number;
  /** Key learning: how long to wait for the factory-mode frames after [2101]. */
  factoryFramesTimeoutMs?: number;
  /** Key learning: minimum time between [2101] and [22XX]. */
  factorySettleMs?: number;
}

export type KeyLearnOutcome = 'learned' | 'failed' | 'unsupported' | 'timeout' | 'cancelled';

export class TimeoutError extends Error {
  constructor(message = 'Timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class AbortedError extends Error {
  constructor(message = 'Cancelled') {
    super(message);
    this.name = 'AbortedError';
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class ZycelaDriver {
  private readonly throttleMs: number;
  private readonly scenePacingMs: number;
  private colorLastSent = 0;
  private colorPending: { zone: ColorZone; hex: string } | null = null;
  private colorTimer: ReturnType<typeof setTimeout> | null = null;
  /** The live colour write being sent, if any (at most one at a time). */
  private colorInFlight: Promise<void> | null = null;
  /** flushColor() asked for the pending colour to go out without waiting for the throttle. */
  private colorUrgent = false;

  constructor(
    private readonly transport: ZycelaTransport,
    private readonly options: DriverOptions = {},
  ) {
    this.throttleMs = options.colorThrottleMs ?? 120;
    this.scenePacingMs = options.scenePacingMs ?? 150;
  }

  /** Sends one command string (already encoded). */
  send(command: string): Promise<void> {
    this.options.onCommand?.(command);
    return this.transport.send(command);
  }

  /**
   * Raw send for the lab console: a string is sent as ASCII (one byte per
   * character), a Uint8Array as-is.
   */
  sendRaw(input: string | Uint8Array): Promise<void> {
    if (typeof input === 'string') {
      const bytes = cmd.toBytes(input);
      this.options.onCommand?.(input);
      return this.transport.sendBytes(bytes);
    }
    const text = cmd.fromBytes(input);
    if (/^\[[\x20-\x7e]*\]$/.test(text)) this.options.onCommand?.(text);
    return this.transport.sendBytes(input);
  }

  /** Resolves with the first frame matching `predicate`, or rejects on timeout/abort. */
  waitForFrame<T extends ParsedFrame>(
    predicate: (frame: ParsedFrame) => frame is T,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new AbortedError());
        return;
      }
      const cleanup = () => {
        clearTimeout(timer);
        off();
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(new AbortedError());
      };
      const off = this.transport.onFrame((frame) => {
        if (predicate(frame)) {
          cleanup();
          resolve(frame);
        }
      });
      const timer = setTimeout(() => {
        cleanup();
        reject(new TimeoutError());
      }, timeoutMs);
      signal?.addEventListener('abort', onAbort);
    });
  }

  // -------------------------------------------------------------------------
  // System

  requestState = () => this.send(cmd.requestState());
  restoreFactory = () => this.send(cmd.restoreFactory());
  enterFactoryMode = () => this.send(cmd.factoryMode(true));
  exitFactoryMode = () => this.send(cmd.factoryMode(false));
  startDebug = () => this.send(cmd.debugMode(true));
  stopDebug = () => this.send(cmd.debugMode(false));
  /** [4100]: "activate the car's original ambient menu". Dangerous. */
  activateOriginalMenu = () => this.send(cmd.activateOriginalMenu());

  // -------------------------------------------------------------------------
  // Power, control, brightness

  setPower = (mode: PowerMode) => this.send(cmd.power(mode));
  setControlMethod = (method: BinaryValue) => this.send(cmd.controlMethod(method));
  setBrightness = (slider: 1 | 2 | 3, level: number) => this.send(cmd.brightness(slider, level));
  setZoning = (type: BinaryValue) => this.send(cmd.zoning(type));
  setNightHalf = (on: boolean) => this.send(cmd.nightHalf(on));

  // -------------------------------------------------------------------------
  // Colour and RGB

  setColor(zone: ColorZone, hex: string): Promise<void> {
    this.cancelPendingColor();
    this.colorLastSent = Date.now();
    return this.send(cmd.color(zone, hex));
  }

  /**
   * Throttled colour write for the colour wheel: at most one write every
   * `colorThrottleMs`, and never more than one live colour write in flight,
   * so a slow link cannot build a backlog of stale colours. The last value is
   * always sent (trailing edge).
   */
  setColorLive(zone: ColorZone, hex: string): void {
    cmd.color(zone, hex); // validate now, throw synchronously on bad input
    this.colorPending = { zone, hex };
    this.pumpColor();
  }

  /** Sends the pending throttled colour now (after the write in flight, if any). */
  async flushColor(): Promise<void> {
    if (this.colorTimer !== null) {
      clearTimeout(this.colorTimer);
      this.colorTimer = null;
    }
    this.colorUrgent = this.colorPending !== null;
    this.pumpColor();
    while (this.colorInFlight) await this.colorInFlight;
  }

  private pumpColor(): void {
    if (this.colorInFlight || !this.colorPending) return;
    const wait = this.colorUrgent ? 0 : this.colorLastSent + this.throttleMs - Date.now();
    if (wait > 0) {
      if (this.colorTimer === null) {
        this.colorTimer = setTimeout(() => {
          this.colorTimer = null;
          this.pumpColor();
        }, wait);
      }
      return;
    }
    if (this.colorTimer !== null) {
      clearTimeout(this.colorTimer);
      this.colorTimer = null;
    }
    const { zone, hex } = this.colorPending;
    this.colorPending = null;
    this.colorUrgent = false;
    this.colorLastSent = Date.now();
    this.colorInFlight = this.send(cmd.color(zone, hex))
      .catch(() => undefined)
      .then(() => {
        this.colorInFlight = null;
        this.pumpColor();
      });
  }

  private cancelPendingColor(): void {
    if (this.colorTimer !== null) clearTimeout(this.colorTimer);
    this.colorTimer = null;
    this.colorPending = null;
    this.colorUrgent = false;
  }

  setRgbMode = (mode: number) => this.send(cmd.rgbMode(mode));
  setRgbSpeed = (speed: number) => this.send(cmd.rgbSpeed(speed));
  setRgbCustomEnabled = (on: boolean) => this.send(cmd.rgbCustomEnabled(on));
  setRgbCustomSequence = (slots: readonly Slot[]) => this.send(cmd.rgbCustomSequence(slots));

  // -------------------------------------------------------------------------
  // Dynamic effects

  setEffect = (id: number) => this.send(cmd.effect(id));
  setEffectVariant = (variant: number) => this.send(cmd.effectVariant(variant));
  setEffectSpeed = (speed: number) => this.send(cmd.effectSpeed(speed));
  setEffectDirection = (direction: BinaryValue) => this.send(cmd.effectDirection(direction));
  setEffectCustomEnabled = (on: boolean) => this.send(cmd.effectCustomEnabled(on));
  setEffectCustomSequence = (slots: readonly Slot[]) => this.send(cmd.effectCustomSequence(slots));
  setEffectCustomLength = (length: number) => this.send(cmd.effectCustomLength(length));
  setEffectCustomGap = (gap: number) => this.send(cmd.effectCustomGap(gap));

  // -------------------------------------------------------------------------
  // Music

  setSoundSensitivity = (level: number) => this.send(cmd.soundSensitivity(level));
  setSoundSource = (source: BinaryValue) => this.send(cmd.soundSource(source));

  // -------------------------------------------------------------------------
  // Welcome and car events

  setWelcomeEnabled = (on: boolean) => this.send(cmd.welcomeEnabled(on));
  setWelcomeMode = (mode: number) => this.send(cmd.welcomeMode(mode));
  setWelcomeColor = (index: number) => this.send(cmd.welcomeColor(index));
  syncWelcomeWithRgb = () => this.send(cmd.welcomeColor('sync'));
  setCarEvent = (key: CarEventKey, on: boolean) => this.send(cmd.carEvent(key, on));
  setDoorColor = (index: number) => this.send(cmd.doorColor(index));
  setTurnColor = (index: number) => this.send(cmd.turnColor(index));
  setBlindSpotColor = (index: number) => this.send(cmd.blindSpotColor(index));

  // -------------------------------------------------------------------------
  // Installation

  setDialCodes = (carBits: string | readonly number[], featureBits: string | readonly number[]) =>
    this.send(cmd.dialCodes(carBits, featureBits));
  setLedCount = (strip: LedStripKey, count: number) => this.send(cmd.ledCount(strip, count));
  setWiring = (key: WiringKey, value: BinaryValue) => this.send(cmd.wiring(key, value));
  setCustomerCode = (code: number) => this.send(cmd.customerCode(code));

  /**
   * Steering-wheel key learning. The mini-program only offers it inside its
   * factory page: [2101] when the page opens (the module answers 23, 25 and
   * 4F/58), and [22XX] later, when the user taps a function. Here: [2101],
   * wait for the 4F/58 frame (or a timeout) and at least `factorySettleMs`,
   * then [22XX], wait for the 17 frame (the user presses the button), then
   * [2100] whatever happened.
   */
  async learnKey(fn: number, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<KeyLearnOutcome> {
    const command = cmd.learnKey(fn); // validate before entering factory mode
    const isKeyResult = (f: ParsedFrame): f is KeyLearnResultFrame => f.kind === 'keyLearnResult';
    const isStrips = (f: ParsedFrame): f is StripsFrame => f.kind === 'strips';
    const { signal } = options;
    let outcome: KeyLearnOutcome;
    try {
      // Listen before sending [2101] so a fast answer is not missed.
      const factoryReady = this.waitForFrame(isStrips, this.options.factoryFramesTimeoutMs ?? 2000, signal);
      factoryReady.catch(() => undefined);
      const enteredAt = Date.now();
      await this.enterFactoryMode();
      try {
        await factoryReady;
      } catch (error) {
        if (!(error instanceof TimeoutError)) throw error; // no 4F/58: go on after the minimum delay
      }
      const settle = (this.options.factorySettleMs ?? 500) - (Date.now() - enteredAt);
      if (settle > 0) await delay(settle, signal);
      const wait = this.waitForFrame(isKeyResult, options.timeoutMs ?? 20000, signal);
      wait.catch(() => undefined); // avoid an unhandled rejection if the send below fails
      await this.send(command);
      const frame = await wait;
      outcome = frame.result === 0 ? 'learned' : frame.result === 2 ? 'unsupported' : 'failed';
    } catch (error) {
      if (error instanceof TimeoutError) outcome = 'timeout';
      else if (error instanceof AbortedError) outcome = 'cancelled';
      else {
        await this.exitFactoryMode().catch(() => undefined);
        throw error;
      }
    }
    await this.exitFactoryMode().catch(() => undefined);
    return outcome;
  }

  // -------------------------------------------------------------------------
  // Scenes

  /**
   * Sends the scene's commands in order with a pause between them, then asks
   * for the state ([0A01]) so the module's real state replaces the optimistic one.
   */
  async applyScene(data: SceneData): Promise<void> {
    const commands = sceneToCommands(data);
    for (let i = 0; i < commands.length; i++) {
      if (i > 0 && this.scenePacingMs > 0) await delay(this.scenePacingMs);
      await this.send(commands[i]);
    }
    if (commands.length) {
      if (this.scenePacingMs > 0) await delay(this.scenePacingMs);
      await this.requestState();
    }
  }

  dispose(): void {
    this.cancelPendingColor();
  }
}
