/**
 * Response parsing for the ZYCELA module (notifications on 0xFFE1).
 *
 * Positions are character indices in the frame text, index 0 = "[" and the
 * two-character code at indices 1-2, exactly as in docs/protocolo-zycela.md.
 * Nothing here throws: missing or malformed fields come back as undefined.
 */
import type { Slot } from './commands';
import { fromBytes } from './commands';

// ---------------------------------------------------------------------------
// Framer

/**
 * Accumulates notification chunks and emits complete "[...]" frames.
 * Handles frames split across notifications, several frames in one
 * notification, garbage between frames and unterminated frames.
 */
export class Framer {
  private buffer = '';

  constructor(private readonly maxBuffer = 256) {}

  push(chunk: Uint8Array | string): string[] {
    this.buffer += typeof chunk === 'string' ? chunk : fromBytes(chunk);
    const frames: string[] = [];
    for (;;) {
      const start = this.buffer.indexOf('[');
      if (start < 0) {
        this.buffer = '';
        break;
      }
      if (start > 0) this.buffer = this.buffer.slice(start);
      const end = this.buffer.indexOf(']', 1);
      const nextStart = this.buffer.indexOf('[', 1);
      if (nextStart > 0 && (end < 0 || nextStart < end)) {
        // The current frame never got its "]": drop it and resync.
        this.buffer = this.buffer.slice(nextStart);
        continue;
      }
      if (end < 0) {
        if (this.buffer.length > this.maxBuffer) this.buffer = '';
        break;
      }
      frames.push(this.buffer.slice(0, end + 1));
      this.buffer = this.buffer.slice(end + 1);
    }
    return frames;
  }

  reset(): void {
    this.buffer = '';
  }

  get pending(): string {
    return this.buffer;
  }
}

// ---------------------------------------------------------------------------
// Frame types

interface FrameBase {
  /** The complete frame text, e.g. "[2E01]". */
  readonly raw: string;
}

export interface StateFrame extends FrameBase {
  readonly kind: 'state';
  readonly code: '1F' | '4E';
  /** true for 4E (newer firmware: extended effect list, control field). */
  readonly extended: boolean;
  readonly rgbMode?: number;
  readonly effect?: number;
  readonly color?: string; // "#rrggbb"
  readonly brightness1?: number;
  readonly brightness2?: number;
  readonly brightness3?: number;
  readonly soundSensitivity?: number;
  readonly effectSpeed?: number;
  readonly effectDirection?: number;
  readonly rgbSpeed?: number;
  readonly controlMethod?: number; // 4E only
}

export interface SettingsFrame extends FrameBase {
  readonly kind: 'settings';
  readonly code: '26';
  readonly welcomeEnabled?: number;
  readonly door?: number;
  readonly radar?: number;
  readonly speed?: number;
  readonly turn?: number;
  readonly ac?: number;
  readonly nightHalf?: number;
  readonly zoning?: number;
  readonly welcomeMode?: number;
  /**
   * Character 21 == "1": the firmware can sync the welcome colour with RGB.
   * The mini-program only shows its "sync with RGB" button when this is set.
   */
  readonly welcomeSyncAvailable?: boolean;
  /** Character 22 == "f" (15): the welcome colour follows the RGB colour ([380f]). */
  readonly welcomeSync?: boolean;
  /** Character 22 when below 15: palette index of the welcome colour. */
  readonly welcomeColor?: number;
  readonly soundSource?: number;
  readonly blindSpot?: number;
}

export interface SequencesFrame extends FrameBase {
  readonly kind: 'sequences';
  readonly code: '27';
  readonly rgbSequence?: Slot[];
  readonly rgbCustomEnabled?: number;
  readonly effectSequence?: Slot[];
  readonly effectCustomEnabled?: number;
  readonly effectCustomLength?: number;
  readonly effectCustomGap?: number;
  readonly rgbSelectedSlot?: number;
  readonly rgbSpeed?: number;
  readonly effectSelectedSlot?: number;
}

export interface VersionFrame extends FrameBase {
  readonly kind: 'version';
  readonly code: '13';
  /** Decoded ASCII payload. */
  readonly text?: string;
  readonly hardware?: string;
  readonly carModel?: string;
  readonly firmware?: string;
}

export interface SettingResultFrame extends FrameBase {
  readonly kind: 'settingResult';
  readonly code: '2E';
  /** 0 not supported, 1 done, 2 failed. */
  readonly result?: number;
}

export interface KeyLearnResultFrame extends FrameBase {
  readonly kind: 'keyLearnResult';
  readonly code: '17';
  /** 0 learned, 1 failed, 2 not supported. */
  readonly result?: number;
}

export interface FlashResultFrame extends FrameBase {
  readonly kind: 'flashResult';
  readonly code: '18';
  /** 0 not supported, 1 done, 2 failed. */
  readonly result?: number;
}

export interface DialCodesFrame extends FrameBase {
  readonly kind: 'dialCodes';
  readonly code: '23';
  readonly carBits?: string;
  readonly featureBits?: string;
}

export interface FactoryParamsFrame extends FrameBase {
  readonly kind: 'factoryParams';
  readonly code: '25';
  readonly stripParam?: number;
  readonly customerCode?: number;
}

export interface StripLeds {
  driver?: number;
  passenger?: number;
  frontDoors?: number;
  rearDoors?: number;
  thirdRow?: number;
}

export interface StripWiring {
  driver?: number;
  passenger?: number;
  frontLeft?: number;
  rearLeft?: number;
  frontRight?: number;
  rearRight?: number;
  thirdLeft?: number;
  thirdRight?: number;
}

export interface StripsFrame extends FrameBase {
  readonly kind: 'strips';
  readonly code: '4F' | '58';
  /** true for 58 (vans with a third row). */
  readonly thirdRow: boolean;
  readonly leds: StripLeds;
  readonly wiring: StripWiring;
}

export interface UnknownFrame extends FrameBase {
  readonly kind: 'unknown';
  readonly code: string;
}

export type ParsedFrame =
  | StateFrame
  | SettingsFrame
  | SequencesFrame
  | VersionFrame
  | SettingResultFrame
  | KeyLearnResultFrame
  | FlashResultFrame
  | DialCodesFrame
  | FactoryParamsFrame
  | StripsFrame
  | UnknownFrame;

// ---------------------------------------------------------------------------
// Field readers (never NaN, never throw)

/** hex(i) from the spec: two hex characters at index i, or undefined. */
export function hexAt(s: string, i: number): number | undefined {
  const t = s.substr(i, 2);
  return /^[0-9a-fA-F]{2}$/.test(t) ? parseInt(t, 16) : undefined;
}

/** One hex character at index i, or undefined. */
export function hexDigitAt(s: string, i: number): number | undefined {
  const t = s.substr(i, 1);
  return /^[0-9a-fA-F]$/.test(t) ? parseInt(t, 16) : undefined;
}

/** `n` when it lies in [min, max], otherwise undefined. */
function inRange(n: number | undefined, min: number, max: number): number | undefined {
  return n !== undefined && n >= min && n <= max ? n : undefined;
}

/** Highest RGB mode id ([04XX], 0-20) and RGB speed ([3EXX], 1-10). */
const MAX_RGB_MODE = 20;
const MAX_RGB_SPEED = 10;
/** Welcome colour digit meaning "synced with RGB" ([380f]). */
const WELCOME_SYNC_DIGIT = 15;

/** n decimal digits at index i, or undefined. */
export function decAt(s: string, i: number, n: number): number | undefined {
  const t = s.substr(i, n);
  return t.length === n && /^[0-9]+$/.test(t) ? parseInt(t, 10) : undefined;
}

function colorAt(s: string, i: number): string | undefined {
  const t = s.substr(i, 6);
  return /^[0-9a-fA-F]{6}$/.test(t) ? `#${t.toLowerCase()}` : undefined;
}

function bitsAt(s: string, i: number): string | undefined {
  const t = s.substr(i, 8);
  return /^[01]{8}$/.test(t) ? t : undefined;
}

function sequenceAt(s: string, i: number): Slot[] | undefined {
  const t = s.substr(i, 8);
  if (!/^[0-9a-fA-F]{8}$/.test(t)) return undefined;
  return t.split('').map((c) => {
    const n = parseInt(c, 16);
    return n < 15 ? n : null;
  });
}

function decodeHexAscii(payload: string): string | undefined {
  if (payload.length === 0 || payload.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(payload)) return undefined;
  let text = '';
  for (let i = 0; i < payload.length; i += 2) text += String.fromCharCode(parseInt(payload.substr(i, 2), 16));
  return text;
}

function clean(text: string): string {
  // Drop NUL padding and surrounding spaces.
  return text.replace(/\0/g, '').trim();
}

// ---------------------------------------------------------------------------

/** Two-character frame code ("1F", "2E"...), upper-cased, or "" if absent. */
export function frameCode(text: string): string {
  if (typeof text !== 'string' || text[0] !== '[') return '';
  return text.substr(1, 2).toUpperCase();
}

export function parseFrame(text: string): ParsedFrame {
  const s = typeof text === 'string' ? text : '';
  const raw = s;
  const code = frameCode(s);
  switch (code) {
    case '1F':
    case '4E': {
      const extended = code === '4E';
      return {
        kind: 'state',
        code,
        raw,
        extended,
        // The mini-program reads RGB mode, colour and RGB speed only from 1F
        // frames; for 4E they are a guess, so out-of-range values are dropped.
        rgbMode: inRange(hexAt(s, 3), 0, MAX_RGB_MODE),
        effect: hexAt(s, 5),
        color: colorAt(s, 9),
        brightness2: hexAt(s, 21),
        brightness3: hexAt(s, 23),
        soundSensitivity: hexAt(s, 25),
        effectSpeed: hexAt(s, 27),
        effectDirection: hexAt(s, 29),
        brightness1: hexAt(s, 31),
        rgbSpeed: inRange(hexAt(s, 33), 0, MAX_RGB_SPEED),
        controlMethod: extended ? hexAt(s, 35) : undefined,
      };
    }
    case '26': {
      // As the mini-program's settings page reads them: character 21 only
      // shows/hides the sync button, character 22 is the selection
      // (palette index 0-14, or 15 = synced with RGB).
      const capableDigit = hexDigitAt(s, 21);
      const colorDigit = hexDigitAt(s, 22);
      return {
        kind: 'settings',
        code,
        raw,
        welcomeEnabled: hexAt(s, 3),
        door: hexAt(s, 5),
        radar: hexAt(s, 7),
        speed: hexAt(s, 9),
        turn: hexAt(s, 11),
        ac: hexAt(s, 13),
        nightHalf: hexAt(s, 15),
        zoning: hexAt(s, 17),
        welcomeMode: hexAt(s, 19),
        welcomeSyncAvailable: capableDigit === undefined ? undefined : capableDigit === 1,
        welcomeSync: colorDigit === undefined ? undefined : colorDigit === WELCOME_SYNC_DIGIT,
        welcomeColor: colorDigit !== undefined && colorDigit < WELCOME_SYNC_DIGIT ? colorDigit : undefined,
        soundSource: hexAt(s, 23),
        blindSpot: s.length > 28 ? hexAt(s, 27) : undefined,
      };
    }
    case '27':
      return {
        kind: 'sequences',
        code,
        raw,
        rgbSequence: sequenceAt(s, 3),
        rgbCustomEnabled: hexAt(s, 11),
        effectSequence: sequenceAt(s, 13),
        effectCustomEnabled: hexAt(s, 21),
        effectCustomLength: hexAt(s, 23),
        effectCustomGap: hexAt(s, 25),
        rgbSelectedSlot: hexAt(s, 27),
        rgbSpeed: hexAt(s, 29),
        effectSelectedSlot: hexAt(s, 31),
      };
    case '13': {
      const body = s.endsWith(']') ? s.substr(3, s.length - 4) : '';
      const decoded = decodeHexAscii(body);
      return {
        kind: 'version',
        code,
        raw,
        text: decoded,
        hardware: decoded === undefined ? undefined : clean(decoded.substr(0, 5)),
        carModel: decoded === undefined ? undefined : clean(decoded.substr(5, 8)),
        firmware: decoded === undefined ? undefined : clean(decoded.substr(13, 10)),
      };
    }
    case '2E':
      return { kind: 'settingResult', code, raw, result: hexAt(s, 3) };
    case '17':
      return { kind: 'keyLearnResult', code, raw, result: hexAt(s, 3) };
    case '18':
      return { kind: 'flashResult', code, raw, result: hexAt(s, 3) };
    case '23':
      return { kind: 'dialCodes', code, raw, carBits: bitsAt(s, 3), featureBits: bitsAt(s, 11) };
    case '25':
      return { kind: 'factoryParams', code, raw, stripParam: decAt(s, 9, 4), customerCode: decAt(s, 15, 4) };
    case '4F':
    case '58': {
      const thirdRow = code === '58';
      const leds: StripLeds = {
        driver: decAt(s, 9, 4),
        passenger: decAt(s, 15, 4),
        frontDoors: decAt(s, 21, 4),
        rearDoors: decAt(s, 27, 4),
      };
      // Wiring "types" 1-6 as numbered by the mini-program: 1 driver,
      // 2 passenger, 3 front-left, 4 rear-left, 5 front-right, 6 rear-right.
      const wiring: StripWiring = {
        driver: decAt(s, 13, 2),
        passenger: decAt(s, 19, 2),
        frontLeft: decAt(s, 25, 2),
        rearLeft: decAt(s, 31, 2),
        frontRight: decAt(s, 33, 2),
        rearRight: decAt(s, 35, 2),
      };
      if (thirdRow) {
        leds.thirdRow = decAt(s, 37, 4);
        wiring.thirdLeft = decAt(s, 41, 2);
        wiring.thirdRight = decAt(s, 43, 2);
      }
      return { kind: 'strips', code, raw, thirdRow, leds, wiring };
    }
    default:
      return { kind: 'unknown', code, raw };
  }
}
