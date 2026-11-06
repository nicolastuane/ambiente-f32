/**
 * AppController wires the BLE session, the protocol driver and the device
 * state together, and keeps the lab log and the toasts. The React layer only
 * subscribes to its stores; tests use it directly with the mock adapter.
 */
import type { BleAdapter, BleDeviceInfo } from '../ble/adapter';
import { BleSession, bleErrorMessage } from '../ble/session';
import type { ConnStatus, SessionOptions, SessionState } from '../ble/session';
import { FLASH_RESULT, KEY_LEARN_RESULT, SETTING_RESULT } from '../protocol/zycela/catalog';
import { bytesToHex } from '../protocol/zycela/commands';
import { describeCommand, describeFrame } from '../protocol/zycela/describe';
import { ZycelaDriver } from '../protocol/zycela/driver';
import type { DriverOptions, ZycelaTransport } from '../protocol/zycela/driver';
import { parseFrame } from '../protocol/zycela/parser';
import type { ParsedFrame } from '../protocol/zycela/parser';
import { applyCommand, applyFrame, initialDeviceState } from '../protocol/zycela/state';
import type { DeviceState } from '../protocol/zycela/state';
import { Emitter, createStore } from '../util/store';
import type { Store } from '../util/store';
import { buildLabExport } from './lab';
import type { LabExport, LogEntry } from './lab';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface ControllerOptions {
  autoReconnect?: boolean;
  /** Called each time a device reaches "ready" (to remember it). */
  onConnected?: (device: BleDeviceInfo) => void;
  /** Id/name of the last device, for reconnecting without the chooser. */
  lastDevice?: () => { id: string | null; name: string | null } | null;
  session?: SessionOptions;
  /** Driver timings (tests shorten them). */
  driver?: Omit<DriverOptions, 'onCommand'>;
  /** Auto-dismiss delay; 0 keeps toasts until dismissed (tests). */
  toastMs?: number;
}

const MAX_LOG = 800;

export class AppController {
  readonly session: BleSession;
  readonly driver: ZycelaDriver;
  readonly demo: boolean;
  readonly device: Store<DeviceState> = createStore(initialDeviceState());
  readonly log: Store<LogEntry[]> = createStore<LogEntry[]>([]);
  readonly toasts: Store<Toast[]> = createStore<Toast[]>([]);
  private readonly parsed = new Emitter<ParsedFrame>();
  private readonly unsubscribers: (() => void)[] = [];
  private readonly toastMs: number;
  private logSeq = 0;
  private toastSeq = 0;
  private disposed = false;

  constructor(
    readonly adapter: BleAdapter,
    private readonly options: ControllerOptions = {},
  ) {
    this.demo = adapter.kind === 'mock';
    this.toastMs = options.toastMs ?? 3800;
    this.session = new BleSession(adapter, { ...options.session, autoReconnect: options.autoReconnect ?? true });

    const transport: ZycelaTransport = {
      send: (text) => this.session.sendText(text),
      sendBytes: (bytes) => this.session.write(bytes),
      onFrame: (listener) => this.parsed.on(listener),
    };
    this.driver = new ZycelaDriver(transport, {
      ...options.driver,
      onCommand: (command) => this.device.update((state) => applyCommand(state, command)),
    });

    this.unsubscribers.push(
      this.session.frames.on((text) => this.handleFrame(text)),
      this.session.tx.on((event) =>
        this.addLog({
          t: event.at.toISOString(),
          kind: 'tx',
          char: event.char,
          hex: bytesToHex(event.bytes),
          text: event.text,
          withResponse: event.withResponse,
          meanings: [describeCommand(event.text)],
        }),
      ),
      this.session.rx.on((event) =>
        this.addLog({
          t: event.at.toISOString(),
          kind: 'rx',
          char: event.char,
          hex: bytesToHex(event.bytes),
          text: event.text,
          meanings: event.frames.map((frame) => describeFrame(parseFrame(frame))),
        }),
      ),
      this.session.log.on((event) => this.addLog({ t: event.at.toISOString(), kind: event.kind, note: event.note })),
    );

    let previous: ConnStatus = this.session.status;
    this.unsubscribers.push(
      this.session.state.subscribe(() => {
        const state = this.session.state.get();
        if (state.status !== previous) {
          const from = previous;
          previous = state.status;
          this.onStatusChange(from, state);
        }
      }),
    );
  }

  get connection(): SessionState {
    return this.session.state.get();
  }

  private onStatusChange(from: ConnStatus, state: SessionState): void {
    switch (state.status) {
      case 'ready':
        if (from !== 'reconnecting') {
          this.toast(`Conectado a ${state.device?.name ?? 'el módulo'}`, 'success');
          if (state.device) this.options.onConnected?.(state.device);
        } else if (state.drops <= 1) {
          // One "lost" and one "recovered" toast per unstable period, not one per flap.
          this.toast('Conexión recuperada', 'success');
        }
        break;
      case 'reconnecting':
        if (from === 'ready' && state.drops <= 1) this.toast('Se perdió la conexión. Reconectando…', 'warning');
        break;
      case 'error':
        if (state.error) this.toast(state.error, 'error');
        break;
      case 'disconnected':
        if (from === 'ready') this.toast('Desconectado', 'info');
        else if (state.error) this.toast(state.error, 'warning');
        break;
      default:
        break;
    }
  }

  private handleFrame(text: string): void {
    const frame = parseFrame(text);
    this.device.update((state) => applyFrame(state, frame));
    this.parsed.emit(frame);
    if (frame.kind === 'settingResult' && frame.result !== undefined) {
      const kind: ToastKind = frame.result === 1 ? 'success' : frame.result === 0 ? 'warning' : 'error';
      this.toast(SETTING_RESULT[frame.result] ?? `Resultado ${frame.result}`, kind);
    } else if (frame.kind === 'keyLearnResult' && frame.result !== undefined) {
      this.toast(KEY_LEARN_RESULT[frame.result] ?? `Aprendizaje: ${frame.result}`, frame.result === 0 ? 'success' : 'warning');
    } else if (frame.kind === 'flashResult' && frame.result !== undefined) {
      this.toast(FLASH_RESULT[frame.result] ?? `Resultado ${frame.result}`, frame.result === 1 ? 'success' : 'warning');
    }
  }

  /** Subscribes to parsed frames. */
  onFrame(listener: (frame: ParsedFrame) => void): () => void {
    return this.parsed.on(listener);
  }

  // -------------------------------------------------------------------------
  // Connection

  /** Opens the chooser. Must be called synchronously from a click handler. */
  connect(showAll = false): Promise<void> {
    this.device.set(initialDeviceState());
    return this.session.connect({ showAll });
  }

  /** Reconnects to the last device without the chooser, when the browser allows it. */
  async connectKnown(): Promise<boolean> {
    const last = this.options.lastDevice?.();
    if (!last || !this.adapter.getKnownDevices) return false;
    const known = await this.adapter.getKnownDevices();
    const match = known.find((d) => (last.id && d.id === last.id) || (!last.id && last.name && d.name === last.name));
    if (!match) return false;
    this.device.set(initialDeviceState());
    await this.session.connectTo(match);
    return true;
  }

  disconnect(): Promise<void> {
    this.driver.dispose();
    return this.session.disconnect();
  }

  setAutoReconnect(enabled: boolean): void {
    this.session.setAutoReconnect(enabled);
  }

  onVisible(): void {
    this.session.onVisible();
  }

  // -------------------------------------------------------------------------
  // Debug mode ([3702] / [3700]), shared by the experiment and the car tests

  private readonly debugOwners = new Set<string>();

  /** Turns the module's debug output on for `owner` ([3702] every time: the module may have restarted). */
  startDebugFor(owner: string): Promise<void> {
    this.debugOwners.add(owner);
    return this.driver.startDebug();
  }

  /** Releases `owner`; [3700] only once nobody else wants debug. Resolves true when [3700] was sent. */
  async stopDebugFor(owner: string): Promise<boolean> {
    this.debugOwners.delete(owner);
    if (this.debugOwners.size > 0) return false;
    await this.driver.stopDebug();
    return true;
  }

  /** Forgets `owner` without sending anything (its session ended while the link was down). */
  releaseDebug(owner: string): void {
    this.debugOwners.delete(owner);
  }

  /** Runs a driver action and reports failures as a toast. */
  run(action: (driver: ZycelaDriver) => Promise<unknown> | void): void {
    try {
      const result = action(this.driver);
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch((error: unknown) => this.reportError(error));
      }
    } catch (error) {
      this.reportError(error);
    }
  }

  /** Toasts a failed action; `context` "connect" adds the connection hints (WeChat…). */
  reportError(error: unknown, context: 'connect' | 'operation' = 'operation'): void {
    this.toast(bleErrorMessage(error, context), 'error');
  }

  // -------------------------------------------------------------------------
  // Toasts

  toast(text: string, kind: ToastKind = 'info'): void {
    if (this.disposed) return;
    const id = ++this.toastSeq;
    this.toasts.update((list) => [...list.slice(-3), { id, kind, text }]);
    if (this.toastMs > 0) setTimeout(() => this.dismissToast(id), this.toastMs);
  }

  dismissToast(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  // -------------------------------------------------------------------------
  // Lab log

  private addLog(entry: Omit<LogEntry, 'id'>): void {
    const full: LogEntry = { id: ++this.logSeq, ...entry };
    this.log.update((list) => (list.length >= MAX_LOG ? [...list.slice(list.length - MAX_LOG + 1), full] : [...list, full]));
  }

  addMarker(note: string): void {
    this.addLog({ t: new Date().toISOString(), kind: 'marker', note: note.trim() || 'Marca' });
  }

  clearLog(): void {
    this.log.set([]);
  }

  exportLab(): LabExport {
    const { device, gatt } = this.session.state.get();
    return buildLabExport(this.log.get(), device, gatt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.unsubscribers) off();
    this.driver.dispose();
    this.session.dispose();
  }
}
