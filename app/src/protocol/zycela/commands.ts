/**
 * ZYCELA (ZYCL-FWD) command encoders.
 *
 * Every encoder is pure and returns the exact ASCII command string written to
 * characteristic 0xFFE2, e.g. "[0A01]". Invalid input throws RangeError.
 * Source of truth: docs/protocolo-zycela.md (plus the vendor mini-program where
 * the two disagree; see the notes on wiring below).
 */

export type PowerMode = 0 | 1 | 2; // 0 off, 1 on, 2 follow the car lights
export type ColorZone = 0 | 1 | 2; // 0 whole car, 1 zone 1, 2 zone 2
export type BinaryValue = 0 | 1;
/** A custom-sequence slot: palette index 0-14, or null for an empty slot ("f"). */
export type Slot = number | null;

export const SEQUENCE_LENGTH = 8;
export const PALETTE_SIZE = 15;
export const RGB_MODE_MAX = 20;
export const EFFECT_MAX = 27;
export const WELCOME_SYNC_INDEX = 15;

export type CarEventKey = 'door' | 'radar' | 'speed' | 'turn' | 'ac' | 'blindSpot';
export const CAR_EVENT_KEYS: readonly CarEventKey[] = ['door', 'radar', 'speed', 'turn', 'ac', 'blindSpot'];
export const CAR_EVENT_CODES: Readonly<Record<CarEventKey, string>> = {
  door: '31',
  radar: '32',
  speed: '33',
  turn: '34',
  ac: '35',
  blindSpot: '44',
};

export type LedStripKey = 'driver' | 'passenger' | 'frontDoors' | 'rearDoors' | 'stripParam' | 'thirdRow';
export interface LedStripSpec {
  readonly code: string;
  readonly min: number;
  readonly max: number;
}
export const LED_STRIP_KEYS: readonly LedStripKey[] = [
  'driver',
  'passenger',
  'frontDoors',
  'rearDoors',
  'stripParam',
  'thirdRow',
];
export const LED_STRIP_SPECS: Readonly<Record<LedStripKey, LedStripSpec>> = {
  driver: { code: '1C', min: 30, max: 200 },
  passenger: { code: '0F', min: 30, max: 200 },
  frontDoors: { code: '13', min: 30, max: 200 },
  rearDoors: { code: '1D', min: 30, max: 200 },
  stripParam: { code: '40', min: 0, max: 200 },
  thirdRow: { code: '52', min: 0, max: 200 },
};

/**
 * Wiring / mounting direction commands.
 * The command codes follow the vendor mini-program (button types 1-8 mapped to
 * 2C, 2F, 48, 4A, 49, 4B, 53, 54 and the labels attached to each type):
 * 48 = front-left door, 49 = front-right door, 4A = rear-left door,
 * 4B = rear-right door. Values: 2C/2F use 0 = left, 1 = right; the door and
 * third-row codes use 1 = cable exits at the front, 0 = at the rear.
 */
export type WiringKey =
  | 'driver'
  | 'passenger'
  | 'frontLeft'
  | 'frontRight'
  | 'rearLeft'
  | 'rearRight'
  | 'thirdLeft'
  | 'thirdRight';
export const WIRING_KEYS: readonly WiringKey[] = [
  'driver',
  'passenger',
  'frontLeft',
  'frontRight',
  'rearLeft',
  'rearRight',
  'thirdLeft',
  'thirdRight',
];
export const WIRING_CODES: Readonly<Record<WiringKey, string>> = {
  driver: '2C',
  passenger: '2F',
  frontLeft: '48',
  frontRight: '49',
  rearLeft: '4A',
  rearRight: '4B',
  thirdLeft: '53',
  thirdRight: '54',
};

const ZONE_CODES: readonly string[] = ['06', '10', '09'];
const BRIGHTNESS_PREFIX: readonly string[] = ['0200', '0101', '0102'];

// ---------------------------------------------------------------------------
// Formatting helpers

export function assertInt(name: string, value: number, min: number, max: number): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max} (got ${String(value)})`);
  }
}

/** Two lowercase hex digits, exactly like the mini-program's decToHex(). */
export function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/** Four zero-padded decimal digits. */
export function dec4(n: number): string {
  return String(n).padStart(4, '0');
}

function wrap(code: string, data = ''): string {
  return `[${code}${data}]`;
}

function flag(on: boolean): string {
  return on ? '01' : '00';
}

/** Accepts "#FF6A00", "ff6a00"... and returns 6 lowercase hex digits. */
export function normalizeHexColor(color: string): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(String(color).trim());
  if (!match) throw new RangeError(`Invalid colour "${color}" (expected RRGGBB)`);
  return match[1].toLowerCase();
}

/** 8 slots -> 8 single lowercase hex digits, "f" = empty. */
export function encodeSequence(slots: readonly Slot[]): string {
  if (!Array.isArray(slots) || slots.length !== SEQUENCE_LENGTH) {
    throw new RangeError(`A custom sequence needs exactly ${SEQUENCE_LENGTH} slots`);
  }
  return slots
    .map((slot) => {
      if (slot === null || slot === WELCOME_SYNC_INDEX) return 'f';
      assertInt('slot', slot, 0, PALETTE_SIZE - 1);
      return slot.toString(16);
    })
    .join('');
}

function bits8(name: string, bits: string | readonly number[]): string {
  const text = typeof bits === 'string' ? bits : bits.join('');
  if (!/^[01]{8}$/.test(text)) throw new RangeError(`${name} must be 8 characters of 0/1`);
  return text;
}

// ---------------------------------------------------------------------------
// System

export const requestState = (): string => '[0A01]';
export const restoreFactory = (): string => '[4200]';
export const factoryMode = (on: boolean): string => wrap('21', flag(on));
export const debugMode = (on: boolean): string => (on ? '[3702]' : '[3700]');
/** "Activate the car's original ambient menu" (flashing). Dangerous. */
export const activateOriginalMenu = (): string => '[4100]';

// ---------------------------------------------------------------------------
// Power, control and brightness

export function power(mode: PowerMode): string {
  assertInt('power mode', mode, 0, 2);
  return wrap('07', hex2(mode));
}

export function controlMethod(method: BinaryValue): string {
  assertInt('control method', method, 0, 1);
  return wrap('51', hex2(method));
}

export function brightness(slider: 1 | 2 | 3, level: number): string {
  assertInt('brightness slider', slider, 1, 3);
  assertInt('brightness level', level, 0, 9);
  return `[${BRIGHTNESS_PREFIX[slider - 1]}${hex2(level)}]`;
}

export function zoning(type: BinaryValue): string {
  assertInt('zoning', type, 0, 1);
  return wrap('14', hex2(type));
}

export function nightHalf(on: boolean): string {
  return wrap('1A', flag(on));
}

// ---------------------------------------------------------------------------
// Colour and RGB modes

export function color(zone: ColorZone, rgb: string): string {
  assertInt('colour zone', zone, 0, 2);
  return wrap(ZONE_CODES[zone], normalizeHexColor(rgb));
}

export function rgbMode(mode: number): string {
  assertInt('RGB mode', mode, 0, RGB_MODE_MAX);
  return wrap('04', hex2(mode));
}

export function rgbSpeed(speed: number): string {
  assertInt('RGB speed', speed, 1, 10);
  return wrap('3E', hex2(speed));
}

export function rgbCustomEnabled(on: boolean): string {
  return wrap('2B', flag(on));
}

export function rgbCustomSequence(slots: readonly Slot[]): string {
  return wrap('2A', encodeSequence(slots));
}

// ---------------------------------------------------------------------------
// Dynamic effects ("flowing" strips)

export function effect(id: number): string {
  assertInt('effect', id, 0, EFFECT_MAX);
  return wrap('1E', hex2(id));
}

export function effectVariant(variant: number): string {
  assertInt('effect variant', variant, 1, 6);
  return wrap('29', hex2(variant));
}

export function effectSpeed(speed: number): string {
  assertInt('effect speed', speed, 1, 5);
  return wrap('0B', hex2(speed));
}

export function effectDirection(direction: BinaryValue): string {
  assertInt('effect direction', direction, 0, 1);
  return wrap('0C', hex2(direction));
}

export function effectCustomEnabled(on: boolean): string {
  return wrap('3B', flag(on));
}

export function effectCustomSequence(slots: readonly Slot[]): string {
  return wrap('3A', encodeSequence(slots));
}

export function effectCustomLength(length: number): string {
  assertInt('custom length', length, 1, 9);
  return wrap('3C', hex2(length));
}

export function effectCustomGap(gap: number): string {
  assertInt('custom gap', gap, 1, 9);
  return wrap('3D', hex2(gap));
}

// ---------------------------------------------------------------------------
// Music

export function soundSensitivity(level: number): string {
  assertInt('sound sensitivity', level, 0, 9);
  return `[0300${hex2(level)}]`;
}

export function soundSource(source: BinaryValue): string {
  assertInt('sound source', source, 0, 1);
  return wrap('1B', hex2(source));
}

// ---------------------------------------------------------------------------
// Welcome and car events

export function welcomeEnabled(on: boolean): string {
  return wrap('30', flag(on));
}

export function welcomeMode(mode: number): string {
  assertInt('welcome mode', mode, 0, 5);
  return wrap('39', hex2(mode));
}

/** Palette index 0-14, or 'sync' to follow the RGB colour ("[380f]"). */
export function welcomeColor(index: number | 'sync'): string {
  if (index === 'sync') return wrap('38', hex2(WELCOME_SYNC_INDEX));
  assertInt('welcome colour', index, 0, PALETTE_SIZE - 1);
  return wrap('38', hex2(index));
}

export function carEvent(key: CarEventKey, on: boolean): string {
  const code = CAR_EVENT_CODES[key];
  if (!code) throw new RangeError(`Unknown car event "${String(key)}"`);
  return wrap(code, flag(on));
}

export function doorColor(index: number): string {
  assertInt('door colour', index, 0, 3);
  return wrap('46', hex2(index));
}

export function turnColor(index: number): string {
  assertInt('turn colour', index, 0, 3);
  return wrap('45', hex2(index));
}

export function blindSpotColor(index: number): string {
  assertInt('blind-spot colour', index, 0, 1);
  return wrap('47', hex2(index));
}

// ---------------------------------------------------------------------------
// Installation (factory mode)

/** "[20" + 8 car-code bits + 8 feature bits + "]" (literal 0/1 characters). */
export function dialCodes(carBits: string | readonly number[], featureBits: string | readonly number[]): string {
  return wrap('20', bits8('car code', carBits) + bits8('feature code', featureBits));
}

export function ledCount(strip: LedStripKey, count: number): string {
  const spec = LED_STRIP_SPECS[strip];
  if (!spec) throw new RangeError(`Unknown LED strip "${String(strip)}"`);
  assertInt(`LED count (${strip})`, count, spec.min, spec.max);
  return wrap(spec.code, dec4(count));
}

export function wiring(key: WiringKey, value: BinaryValue): string {
  const code = WIRING_CODES[key];
  if (!code) throw new RangeError(`Unknown wiring target "${String(key)}"`);
  assertInt('wiring value', value, 0, 1);
  return wrap(code, value.toString(16).padStart(2, '0').toUpperCase());
}

export function customerCode(code: number): string {
  assertInt('customer code', code, 0, 9999);
  return wrap('43', dec4(code));
}

/** Steering-wheel key learning: 1 wake, 2 effect main mode, 3 effect sub-mode, 4 mode/colour +, 5 mode/colour -. */
export function learnKey(fn: number): string {
  assertInt('key function', fn, 1, 5);
  return wrap('22', hex2(fn));
}

// ---------------------------------------------------------------------------
// Bytes

/** ASCII command -> bytes (one byte per character). */
export function toBytes(cmd: string): Uint8Array {
  const bytes = new Uint8Array(cmd.length);
  for (let i = 0; i < cmd.length; i++) {
    const code = cmd.charCodeAt(i);
    if (code > 0x7f) throw new RangeError(`Non-ASCII character at position ${i}`);
    bytes[i] = code;
  }
  return bytes;
}

/** Bytes -> text, one character per byte (like the mini-program's arrToCharacter). */
export function fromBytes(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return text;
}

/** Bytes -> "5B 30 41" (uppercase, space separated), the lab export format. */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

/** "5B 30 41" / "5b3041" / "5B:30:41" -> bytes. Throws RangeError on bad input. */
export function hexToBytes(text: string): Uint8Array {
  const clean = text.replace(/[\s,:;-]/g, '');
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new RangeError('Expected hexadecimal byte pairs');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
