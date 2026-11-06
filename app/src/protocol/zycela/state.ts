/**
 * Device state model: merges parsed frames (authoritative) with optimistic
 * updates derived from the commands the app sends. A later frame always wins
 * for the fields it carries, which reconciles any optimistic guess.
 */
import type { CarEventKey, LedStripKey, Slot, WiringKey } from './commands';
import { CAR_EVENT_CODES, LED_STRIP_SPECS, WIRING_CODES } from './commands';
import type { FirmwareVariant } from './catalog';
import type { ParsedFrame } from './parser';

/** Value reported in frame 26 for a car event the car does not support. */
export const UNSUPPORTED = 0xff;

export interface VersionInfo {
  hardware: string;
  carModel: string;
  firmware: string;
  text: string;
  raw: string;
}

export interface FactoryInfo {
  carBits: string | null;
  featureBits: string | null;
  customerCode: number | null;
  leds: Record<LedStripKey, number | null>;
  wiring: Record<WiringKey, number | null>;
  /** true once a 58 frame (third row) has been received. */
  thirdRow: boolean;
  /** Which factory frames have arrived (23, 25, 4F, 58). */
  received: string[];
}

export interface DeviceState {
  firmware: FirmwareVariant | null;
  /** Not reported by the module: only known after the app sets it. */
  power: number | null;
  controlMethod: number | null;
  brightness: { b1: number | null; b2: number | null; b3: number | null };
  zoning: number | null;
  nightHalf: boolean | null;
  /** Current colour reported by the state frame ("#rrggbb"). */
  color: string | null;
  /** Last colour sent to zone 1 / zone 2 (not reported separately). */
  zoneColors: { 1: string | null; 2: string | null };
  rgbMode: number | null;
  rgbSpeed: number | null;
  rgbCustomEnabled: boolean | null;
  rgbSequence: Slot[] | null;
  effect: number | null;
  /** Not reported by the module. */
  effectVariant: number | null;
  effectSpeed: number | null;
  effectDirection: number | null;
  effectCustomEnabled: boolean | null;
  effectSequence: Slot[] | null;
  effectCustomLength: number | null;
  effectCustomGap: number | null;
  soundSensitivity: number | null;
  soundSource: number | null;
  welcomeEnabled: boolean | null;
  welcomeMode: number | null;
  welcomeColor: number | null;
  welcomeSync: boolean | null;
  /** Frame 26 character 21: the firmware offers "sync with RGB" for the welcome colour. */
  welcomeSyncAvailable: boolean | null;
  /** 0 off, 1 on, 255 (UNSUPPORTED) = the car does not support it. */
  events: Record<CarEventKey, number | null>;
  /** Not reported by the module. */
  doorColor: number | null;
  turnColor: number | null;
  blindSpotColor: number | null;
  version: VersionInfo | null;
  factory: FactoryInfo;
  /** Date.now() of the last frame received, null before the first one. */
  lastFrameAt: number | null;
}

export type DeviceAction =
  | { type: 'frame'; frame: ParsedFrame; at?: number }
  | { type: 'command'; cmd: string }
  | { type: 'reset' };

export function initialDeviceState(): DeviceState {
  return {
    firmware: null,
    power: null,
    controlMethod: null,
    brightness: { b1: null, b2: null, b3: null },
    zoning: null,
    nightHalf: null,
    color: null,
    zoneColors: { 1: null, 2: null },
    rgbMode: null,
    rgbSpeed: null,
    rgbCustomEnabled: null,
    rgbSequence: null,
    effect: null,
    effectVariant: null,
    effectSpeed: null,
    effectDirection: null,
    effectCustomEnabled: null,
    effectSequence: null,
    effectCustomLength: null,
    effectCustomGap: null,
    soundSensitivity: null,
    soundSource: null,
    welcomeEnabled: null,
    welcomeMode: null,
    welcomeColor: null,
    welcomeSync: null,
    welcomeSyncAvailable: null,
    events: { door: null, radar: null, speed: null, turn: null, ac: null, blindSpot: null },
    doorColor: null,
    turnColor: null,
    blindSpotColor: null,
    version: null,
    factory: {
      carBits: null,
      featureBits: null,
      customerCode: null,
      leds: { driver: null, passenger: null, frontDoors: null, rearDoors: null, stripParam: null, thirdRow: null },
      wiring: {
        driver: null,
        passenger: null,
        frontLeft: null,
        frontRight: null,
        rearLeft: null,
        rearRight: null,
        thirdLeft: null,
        thirdRight: null,
      },
      thirdRow: false,
      received: [],
    },
    lastFrameAt: null,
  };
}

/** Copies the defined values of `patch` over `base` (undefined = "not in this frame"). */
function defined<T extends object>(base: T, patch: { [K in keyof T]?: T[K] | undefined }): T {
  let changed = false;
  const next = { ...base };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value !== undefined && next[key] !== value) {
      next[key] = value as T[keyof T];
      changed = true;
    }
  }
  return changed ? next : base;
}

const bool = (n: number | undefined): boolean | undefined => (n === undefined ? undefined : n === 1);

function addReceived(list: string[], code: string): string[] {
  return list.includes(code) ? list : [...list, code];
}

export function applyFrame(state: DeviceState, frame: ParsedFrame, at: number = Date.now()): DeviceState {
  const s = { ...state, lastFrameAt: at };
  switch (frame.kind) {
    case 'state':
      return defined(s, {
        firmware: frame.code,
        rgbMode: frame.rgbMode,
        effect: frame.effect,
        color: frame.color,
        soundSensitivity: frame.soundSensitivity,
        effectSpeed: frame.effectSpeed,
        effectDirection: frame.effectDirection,
        rgbSpeed: frame.rgbSpeed,
        controlMethod: frame.controlMethod,
        brightness: defined(s.brightness, { b1: frame.brightness1, b2: frame.brightness2, b3: frame.brightness3 }),
      });
    case 'settings': {
      const events = defined(s.events, {
        door: frame.door,
        radar: frame.radar,
        speed: frame.speed,
        turn: frame.turn,
        ac: frame.ac,
        blindSpot: frame.blindSpot,
      });
      return defined(s, {
        welcomeEnabled: bool(frame.welcomeEnabled),
        nightHalf: bool(frame.nightHalf),
        zoning: frame.zoning,
        welcomeMode: frame.welcomeMode,
        welcomeSync: frame.welcomeSync,
        // Only set when character 22 is a palette index (not "f" = synced).
        welcomeColor: frame.welcomeColor,
        welcomeSyncAvailable: frame.welcomeSyncAvailable,
        soundSource: frame.soundSource,
        events,
      });
    }
    case 'sequences':
      return defined(s, {
        rgbSequence: frame.rgbSequence,
        rgbCustomEnabled: bool(frame.rgbCustomEnabled),
        effectSequence: frame.effectSequence,
        effectCustomEnabled: bool(frame.effectCustomEnabled),
        effectCustomLength: frame.effectCustomLength,
        effectCustomGap: frame.effectCustomGap,
        rgbSpeed: frame.rgbSpeed,
      });
    case 'version':
      if (frame.text === undefined) return s;
      return {
        ...s,
        version: {
          hardware: frame.hardware ?? '',
          carModel: frame.carModel ?? '',
          firmware: frame.firmware ?? '',
          text: frame.text,
          raw: frame.raw,
        },
      };
    case 'dialCodes':
      return {
        ...s,
        factory: {
          ...defined(s.factory, { carBits: frame.carBits, featureBits: frame.featureBits }),
          received: addReceived(s.factory.received, frame.code),
        },
      };
    case 'factoryParams':
      return {
        ...s,
        factory: {
          ...defined(s.factory, { customerCode: frame.customerCode }),
          leds: defined(s.factory.leds, { stripParam: frame.stripParam }),
          received: addReceived(s.factory.received, frame.code),
        },
      };
    case 'strips':
      return {
        ...s,
        factory: {
          ...s.factory,
          leds: defined(s.factory.leds, frame.leds),
          wiring: defined(s.factory.wiring, frame.wiring),
          thirdRow: s.factory.thirdRow || frame.thirdRow,
          received: addReceived(s.factory.received, frame.code),
        },
      };
    default:
      // Result and unknown frames do not change the state.
      return s;
  }
}

// ---------------------------------------------------------------------------
// Optimistic updates

const EVENT_BY_CODE: Record<string, CarEventKey> = Object.fromEntries(
  Object.entries(CAR_EVENT_CODES).map(([key, code]) => [code, key as CarEventKey]),
);
const LED_BY_CODE: Record<string, LedStripKey> = Object.fromEntries(
  Object.entries(LED_STRIP_SPECS).map(([key, spec]) => [spec.code, key as LedStripKey]),
);
const WIRING_BY_CODE: Record<string, WiringKey> = Object.fromEntries(
  Object.entries(WIRING_CODES).map(([key, code]) => [code, key as WiringKey]),
);

function parseSlots(data: string): Slot[] | undefined {
  if (!/^[0-9a-fA-F]{8}$/.test(data)) return undefined;
  return data.split('').map((c) => {
    const n = parseInt(c, 16);
    return n < 15 ? n : null;
  });
}

/**
 * Applies the optimistic effect of a command the app just sent. Unknown or
 * malformed commands leave the state untouched.
 */
export function applyCommand(state: DeviceState, cmd: string): DeviceState {
  const m = /^\[([0-9A-Fa-f]{2})([^\]]*)\]$/.exec(cmd);
  if (!m) return state;
  const code = m[1].toUpperCase();
  const data = m[2];
  const h = /^[0-9a-fA-F]{2}$/.test(data) ? parseInt(data, 16) : undefined;
  const sub = data.length === 4 && /^[0-9a-fA-F]{4}$/.test(data) ? parseInt(data.substr(2, 2), 16) : undefined;

  if (code in EVENT_BY_CODE && h !== undefined) {
    return { ...state, events: { ...state.events, [EVENT_BY_CODE[code]]: h } };
  }
  if (code in WIRING_BY_CODE && h !== undefined) {
    return { ...state, factory: { ...state.factory, wiring: { ...state.factory.wiring, [WIRING_BY_CODE[code]]: h } } };
  }
  if (code in LED_BY_CODE && /^[0-9]{4}$/.test(data)) {
    const key = LED_BY_CODE[code];
    return { ...state, factory: { ...state.factory, leds: { ...state.factory.leds, [key]: parseInt(data, 10) } } };
  }

  switch (code) {
    case '07':
      return h === undefined ? state : { ...state, power: h };
    case '51':
      return h === undefined ? state : { ...state, controlMethod: h };
    case '02':
      return data.startsWith('00') && sub !== undefined ? { ...state, brightness: { ...state.brightness, b1: sub } } : state;
    case '01':
      if (sub === undefined) return state;
      if (data.startsWith('01')) return { ...state, brightness: { ...state.brightness, b2: sub } };
      if (data.startsWith('02')) return { ...state, brightness: { ...state.brightness, b3: sub } };
      return state;
    case '14':
      return h === undefined ? state : { ...state, zoning: h };
    case '1A':
      return h === undefined ? state : { ...state, nightHalf: h === 1 };
    case '06':
    case '10':
    case '09': {
      if (!/^[0-9a-fA-F]{6}$/.test(data)) return state;
      const c = `#${data.toLowerCase()}`;
      if (code === '06') return { ...state, color: c, zoneColors: { 1: c, 2: c } };
      if (code === '10') return { ...state, zoneColors: { ...state.zoneColors, 1: c } };
      return { ...state, zoneColors: { ...state.zoneColors, 2: c } };
    }
    case '04':
      // Like the mini-program: picking a mode turns the custom sequence off.
      return h === undefined ? state : { ...state, rgbMode: h, rgbCustomEnabled: false };
    case '3E':
      return h === undefined ? state : { ...state, rgbSpeed: h };
    case '2B':
      return h === undefined ? state : { ...state, rgbCustomEnabled: h === 1 };
    case '2A': {
      const slots = parseSlots(data);
      return slots ? { ...state, rgbSequence: slots } : state;
    }
    case '1E':
      // Like the mini-program: a new effect resets the variant to 1 and the custom sequence.
      return h === undefined ? state : { ...state, effect: h, effectVariant: 1, effectCustomEnabled: false };
    case '29':
      return h === undefined ? state : { ...state, effectVariant: h, effectCustomEnabled: false };
    case '0B':
      return h === undefined ? state : { ...state, effectSpeed: h };
    case '0C':
      return h === undefined ? state : { ...state, effectDirection: h };
    case '3B':
      return h === undefined ? state : { ...state, effectCustomEnabled: h === 1 };
    case '3A': {
      const slots = parseSlots(data);
      return slots ? { ...state, effectSequence: slots } : state;
    }
    case '3C':
      return h === undefined ? state : { ...state, effectCustomLength: h };
    case '3D':
      return h === undefined ? state : { ...state, effectCustomGap: h };
    case '03':
      return data.startsWith('00') && sub !== undefined ? { ...state, soundSensitivity: sub } : state;
    case '1B':
      return h === undefined ? state : { ...state, soundSource: h };
    case '30':
      return h === undefined ? state : { ...state, welcomeEnabled: h === 1 };
    case '39':
      return h === undefined ? state : { ...state, welcomeMode: h };
    case '38':
      if (h === undefined) return state;
      return h === 15 ? { ...state, welcomeSync: true } : { ...state, welcomeSync: false, welcomeColor: h };
    case '46':
      return h === undefined ? state : { ...state, doorColor: h };
    case '45':
      return h === undefined ? state : { ...state, turnColor: h };
    case '47':
      return h === undefined ? state : { ...state, blindSpotColor: h };
    case '20':
      if (!/^[01]{16}$/.test(data)) return state;
      return { ...state, factory: { ...state.factory, carBits: data.slice(0, 8), featureBits: data.slice(8) } };
    case '43':
      return /^[0-9]{4}$/.test(data) ? { ...state, factory: { ...state.factory, customerCode: parseInt(data, 10) } } : state;
    default:
      return state;
  }
}

export function deviceReducer(state: DeviceState, action: DeviceAction): DeviceState {
  switch (action.type) {
    case 'frame':
      return applyFrame(state, action.frame, action.at);
    case 'command':
      return applyCommand(state, action.cmd);
    case 'reset':
      return initialDeviceState();
    default:
      return state;
  }
}

/** Colour currently shown for a zone (0 = whole car). */
export function zoneColor(state: DeviceState, zone: 0 | 1 | 2): string | null {
  if (zone === 0) return state.color;
  return state.zoneColors[zone] ?? state.color;
}

export function isUnsupported(value: number | null | undefined): boolean {
  return value === UNSUPPORTED;
}
