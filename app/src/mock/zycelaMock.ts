/**
 * Simulated ZYCL-FWD module for demo mode and tests. It keeps its own state,
 * answers commands with frames built at the positions documented in
 * docs/protocolo-zycela.md and splits notifications in 20-byte chunks like a
 * link with the default MTU (23).
 */
import { Framer } from '../protocol/zycela/parser';
import { fromBytes, toBytes } from '../protocol/zycela/commands';

export interface MockState {
  power: number;
  controlMethod: number;
  b1: number;
  b2: number;
  b3: number;
  zoning: number;
  nightHalf: number;
  color: string; // rrggbb
  rgbMode: number;
  rgbSpeed: number;
  rgbCustom: number;
  rgbSeq: string; // 8 hex digits
  effect: number;
  variant: number;
  effectSpeed: number;
  direction: number;
  effectCustom: number;
  effectSeq: string;
  length: number;
  gap: number;
  sound: number;
  soundSource: number;
  welcome: number;
  welcomeMode: number;
  welcomeSync: number;
  welcomeColor: number;
  welcomeSyncAvailable: boolean;
  events: Record<'31' | '32' | '33' | '34' | '35' | '44', number>;
  doorColor: number;
  turnColor: number;
  blindColor: number;
  carBits: string;
  featureBits: string;
  stripParam: number;
  customerCode: number;
  leds: Record<'1C' | '0F' | '13' | '1D' | '52', number>;
  wiring: Record<'2C' | '2F' | '48' | '49' | '4A' | '4B' | '53' | '54', number>;
  factoryMode: boolean;
  debug: boolean;
}

export interface MockDeviceOptions {
  /** State frame variant: 4E (newer firmware) or 1F. */
  firmware?: '1F' | '4E';
  /** Third row strips: answer [2101] with 58 instead of 4F. */
  thirdRow?: boolean;
  /** Response latency in ms. */
  latencyMs?: number;
  /** Delay before the 17 frame after [22XX]. */
  learnDelayMs?: number;
  /** Notification chunk size (20 = MTU 23). 0 = whole frames. */
  chunkSize?: number;
}

export function defaultMockState(): MockState {
  return {
    power: 1,
    controlMethod: 0,
    b1: 8,
    b2: 7,
    b3: 5,
    zoning: 0,
    nightHalf: 1,
    color: 'ff6a00',
    rgbMode: 0,
    rgbSpeed: 5,
    rgbCustom: 0,
    rgbSeq: '0129ffff',
    effect: 3,
    variant: 1,
    effectSpeed: 3,
    direction: 0,
    effectCustom: 0,
    effectSeq: '5e4fffff',
    length: 3,
    gap: 2,
    sound: 6,
    soundSource: 0,
    welcome: 1,
    welcomeMode: 1,
    welcomeSync: 0,
    welcomeColor: 9,
    welcomeSyncAvailable: true,
    // Blind spot reported as ff: "not supported by this car" (BMW F-series code in the vendor table).
    events: { '31': 1, '32': 0, '33': 0, '34': 1, '35': 0, '44': 0xff },
    doorColor: 0,
    turnColor: 1,
    blindColor: 0,
    // The installation of the user's F32 (docs/mi-configuracion.md).
    carBits: '01000010',
    featureBits: '00000000',
    stripParam: 123,
    customerCode: 0,
    leds: { '1C': 50, '0F': 50, '13': 50, '1D': 50, '52': 0 },
    wiring: { '2C': 0, '2F': 0, '48': 1, '49': 1, '4A': 1, '4B': 1, '53': 0, '54': 0 },
    factoryMode: false,
    debug: false,
  };
}

const h2 = (n: number) => (n & 0xff).toString(16).padStart(2, '0');
const d4 = (n: number) => String(n).padStart(4, '0');
const d2 = (n: number) => String(n).padStart(2, '0');

/** Builds "[CODE....]" of `length` characters with `fields` placed at their indices; the rest is "0". */
export function buildFrame(code: string, length: number, fields: Record<number, string>): string {
  const chars = new Array<string>(length).fill('0');
  chars[0] = '[';
  chars[1] = code[0];
  chars[2] = code[1];
  chars[length - 1] = ']';
  for (const [index, value] of Object.entries(fields)) {
    for (let i = 0; i < value.length; i++) chars[Number(index) + i] = value[i];
  }
  return chars.join('');
}

export function buildStateFrame(s: MockState, firmware: '1F' | '4E'): string {
  const fields: Record<number, string> = {
    3: h2(s.rgbMode),
    5: h2(s.effect),
    9: s.color,
    21: h2(s.b2),
    23: h2(s.b3),
    25: h2(s.sound),
    27: h2(s.effectSpeed),
    29: h2(s.direction),
    31: h2(s.b1),
    33: h2(s.rgbSpeed),
  };
  if (firmware === '4E') fields[35] = h2(s.controlMethod);
  return buildFrame(firmware, firmware === '4E' ? 38 : 36, fields);
}

export function buildSettingsFrame(s: MockState): string {
  return buildFrame('26', 30, {
    3: h2(s.welcome),
    5: h2(s.events['31']),
    7: h2(s.events['32']),
    9: h2(s.events['33']),
    11: h2(s.events['34']),
    13: h2(s.events['35']),
    15: h2(s.nightHalf),
    17: h2(s.zoning),
    19: h2(s.welcomeMode),
    // 21: the firmware offers "sync with RGB"; 22: palette index, or f = synced.
    21: s.welcomeSyncAvailable ? '1' : '0',
    22: (s.welcomeSync ? 15 : s.welcomeColor).toString(16),
    23: h2(s.soundSource),
    27: h2(s.events['44']),
  });
}

export function buildSequencesFrame(s: MockState): string {
  return buildFrame('27', 34, {
    3: s.rgbSeq,
    11: h2(s.rgbCustom),
    13: s.effectSeq,
    21: h2(s.effectCustom),
    23: h2(s.length),
    25: h2(s.gap),
    27: h2(0),
    29: h2(s.rgbSpeed),
    31: h2(0),
  });
}

export function buildVersionFrame(hardware: string, carModel: string, firmware: string): string {
  const text = hardware.padEnd(5).slice(0, 5) + carModel.padEnd(8).slice(0, 8) + firmware.padEnd(10).slice(0, 10);
  let hex = '';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(2, '0').toUpperCase();
  return `[13${hex}]`;
}

export function buildDialFrame(s: MockState): string {
  return `[23${s.carBits}${s.featureBits}]`;
}

export function buildFactoryParamsFrame(s: MockState): string {
  return buildFrame('25', 20, { 9: d4(s.stripParam), 15: d4(s.customerCode) });
}

export function buildStripsFrame(s: MockState, thirdRow: boolean): string {
  const fields: Record<number, string> = {
    9: d4(s.leds['1C']),
    13: d2(s.wiring['2C']),
    15: d4(s.leds['0F']),
    19: d2(s.wiring['2F']),
    21: d4(s.leds['13']),
    25: d2(s.wiring['48']), // type 3: front-left
    27: d4(s.leds['1D']),
    31: d2(s.wiring['4A']), // type 4: rear-left
    33: d2(s.wiring['49']), // type 5: front-right
    35: d2(s.wiring['4B']), // type 6: rear-right
  };
  if (!thirdRow) return buildFrame('4F', 38, fields);
  fields[37] = d4(s.leds['52']);
  fields[41] = d2(s.wiring['53']);
  fields[43] = d2(s.wiring['54']);
  return buildFrame('58', 46, fields);
}

const STATE_CODES = new Set(['04', '1E', '06', '10', '09', '01', '02', '03', '0B', '0C', '3E', '51', '07']);
const SETTINGS_CODES = new Set(['30', '31', '32', '33', '34', '35', '44', '1A', '14', '39', '38', '1B']);
const SEQUENCE_CODES = new Set(['2A', '2B', '3A', '3B', '3C', '3D', '3E']);

export class ZycelaMockDevice {
  state: MockState = defaultMockState();
  readonly firmware: '1F' | '4E';
  readonly thirdRow: boolean;
  /** Every command received, for tests. */
  readonly received: string[] = [];
  private readonly framer = new Framer();
  private readonly latencyMs: number;
  private readonly learnDelayMs: number;
  private readonly chunkSize: number;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private outbox: Promise<void> = Promise.resolve();

  constructor(
    private readonly emit: (bytes: Uint8Array) => void,
    options: MockDeviceOptions = {},
  ) {
    this.firmware = options.firmware ?? '4E';
    this.thirdRow = options.thirdRow ?? false;
    this.latencyMs = options.latencyMs ?? 60;
    this.learnDelayMs = options.learnDelayMs ?? 2000;
    this.chunkSize = options.chunkSize ?? 20;
  }

  /** Bytes written by the app to FFE2. */
  receive(bytes: Uint8Array): void {
    for (const frame of this.framer.push(fromBytes(bytes))) this.handle(frame);
  }

  /** Sends a frame on the module's own initiative, as a car event might (tests). */
  announce(frame: string): void {
    this.respond(frame);
  }

  /** Cancels pending responses (on disconnect). */
  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.framer.reset();
    this.outbox = Promise.resolve();
  }

  private later(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  /** Queues frames for notification, in order, split in chunks. */
  private respond(...frames: string[]): void {
    const chunks: string[] = [];
    for (const frame of frames) {
      if (this.chunkSize > 0) {
        for (let i = 0; i < frame.length; i += this.chunkSize) chunks.push(frame.slice(i, i + this.chunkSize));
      } else {
        chunks.push(frame);
      }
    }
    for (const chunk of chunks) {
      this.outbox = this.outbox.then(
        () =>
          new Promise<void>((resolve) =>
            this.later(Math.max(1, Math.round(this.latencyMs / 3)), () => {
              this.emit(toBytes(chunk));
              resolve();
            }),
          ),
      );
    }
  }

  private stateFrames(): string[] {
    return [
      buildStateFrame(this.state, this.firmware),
      buildVersionFrame('ZY-H2', 'DEMO-F32', 'V3.1-DEMO'),
      buildSettingsFrame(this.state),
      buildSequencesFrame(this.state),
    ];
  }

  private factoryFrames(): string[] {
    return [buildDialFrame(this.state), buildFactoryParamsFrame(this.state), buildStripsFrame(this.state, this.thirdRow)];
  }

  handle(command: string): void {
    this.received.push(command);
    const m = /^\[([0-9A-Fa-f]{2})([^\]]*)\]$/.exec(command);
    if (!m) return;
    const code = m[1].toUpperCase();
    const data = m[2];
    const h = /^[0-9a-fA-F]{2}$/.test(data) ? parseInt(data, 16) : NaN;
    const s = this.state;
    const reply: string[] = [];

    switch (code) {
      case '0A':
        this.later(this.latencyMs, () => this.respond(...this.stateFrames()));
        return;
      case '21':
        s.factoryMode = h === 1;
        if (s.factoryMode) this.later(this.latencyMs, () => this.respond(...this.factoryFrames()));
        return;
      case '22':
        // Like the mini-program assumes: key learning only works in factory
        // mode. Simulates the user pressing the steering-wheel button after ~2 s.
        if (!s.factoryMode) return;
        this.later(this.learnDelayMs, () => this.respond('[1700]'));
        return;
      case '42':
        this.state = { ...defaultMockState(), factoryMode: s.factoryMode };
        this.later(this.latencyMs, () => this.respond('[2E01]', ...this.stateFrames()));
        return;
      case '41':
        this.later(this.latencyMs, () => this.respond('[1800]'));
        return;
      case '37':
        s.debug = h === 2;
        return;
      case '07':
        if (h >= 0 && h <= 2) s.power = h;
        break;
      case '51':
        if (h === 0 || h === 1) s.controlMethod = h;
        break;
      case '02':
        if (data.startsWith('00')) s.b1 = parseInt(data.slice(2), 16);
        break;
      case '01':
        if (data.startsWith('01')) s.b2 = parseInt(data.slice(2), 16);
        if (data.startsWith('02')) s.b3 = parseInt(data.slice(2), 16);
        break;
      case '03':
        if (data.startsWith('00')) s.sound = parseInt(data.slice(2), 16);
        break;
      case '14':
        s.zoning = h;
        break;
      case '1A':
        s.nightHalf = h;
        break;
      case '06':
      case '10':
      case '09':
        if (/^[0-9a-fA-F]{6}$/.test(data)) s.color = data.toLowerCase();
        break;
      case '04':
        s.rgbMode = h;
        s.rgbCustom = 0;
        break;
      case '3E':
        s.rgbSpeed = h;
        break;
      case '2B':
        s.rgbCustom = h;
        break;
      case '2A':
        if (/^[0-9a-f]{8}$/i.test(data)) s.rgbSeq = data.toLowerCase();
        break;
      case '1E':
        s.effect = h;
        s.variant = 1;
        s.effectCustom = 0;
        break;
      case '29':
        s.variant = h;
        break;
      case '0B':
        s.effectSpeed = h;
        break;
      case '0C':
        s.direction = h;
        break;
      case '3B':
        s.effectCustom = h;
        break;
      case '3A':
        if (/^[0-9a-f]{8}$/i.test(data)) s.effectSeq = data.toLowerCase();
        break;
      case '3C':
        s.length = h;
        break;
      case '3D':
        s.gap = h;
        break;
      case '1B':
        s.soundSource = h;
        break;
      case '30':
        s.welcome = h;
        break;
      case '39':
        s.welcomeMode = h;
        break;
      case '38':
        if (h === 15) s.welcomeSync = 1;
        else {
          s.welcomeSync = 0;
          s.welcomeColor = h;
        }
        break;
      case '31':
      case '32':
      case '33':
      case '34':
      case '35':
      case '44':
        // An unsupported event stays unsupported.
        if (s.events[code] !== 0xff) s.events[code] = h;
        break;
      case '46':
        s.doorColor = h;
        break;
      case '45':
        s.turnColor = h;
        break;
      case '47':
        s.blindColor = h;
        break;
      case '20':
        if (/^[01]{16}$/.test(data)) {
          s.carBits = data.slice(0, 8);
          s.featureBits = data.slice(8);
          reply.push(buildDialFrame(s), '[2E01]');
        }
        break;
      case '1C':
      case '0F':
      case '13':
      case '1D':
      case '52':
        if (/^[0-9]{4}$/.test(data)) s.leds[code] = parseInt(data, 10);
        reply.push(buildStripsFrame(s, this.thirdRow));
        break;
      case '40':
        if (/^[0-9]{4}$/.test(data)) s.stripParam = parseInt(data, 10);
        reply.push(buildFactoryParamsFrame(s));
        break;
      case '43':
        if (/^[0-9]{4}$/.test(data)) s.customerCode = parseInt(data, 10);
        reply.push(buildFactoryParamsFrame(s));
        break;
      case '2C':
      case '2F':
      case '48':
      case '49':
      case '4A':
      case '4B':
      case '53':
      case '54':
        s.wiring[code] = h;
        reply.push(buildStripsFrame(s, this.thirdRow));
        break;
      default:
        return;
    }

    if (STATE_CODES.has(code)) reply.push(buildStateFrame(s, this.firmware));
    if (SETTINGS_CODES.has(code)) reply.push(buildSettingsFrame(s));
    if (SEQUENCE_CODES.has(code)) reply.push(buildSequencesFrame(s));
    if (reply.length) this.later(this.latencyMs, () => this.respond(...reply));
  }
}
