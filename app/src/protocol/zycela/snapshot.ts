/**
 * Settings snapshots: the restorable subset of the module's state, read from
 * the frames it reports, and the commands that put it back.
 *
 * Pure module. Field positions are never read here: frames go through
 * parseFrame/applyFrame (parser.ts, state.ts) and commands through the
 * encoders in commands.ts, so there is one source of truth for each.
 */
import * as cmd from './commands';
import type { BinaryValue, CarEventKey, Slot, WiringKey } from './commands';
import { CAR_EVENT_KEYS, WIRING_KEYS } from './commands';
import {
  CAR_EVENTS,
  CONTROL_METHODS,
  DIRECTIONS,
  SOUND_SOURCES,
  WELCOME_MODES,
  WIRING,
  ZONINGS,
  effectName,
  paletteColor,
  rgbModeName,
} from './catalog';
import { parseFrame } from './parser';
import { UNSUPPORTED, applyFrame, initialDeviceState } from './state';
import type { DeviceState } from './state';

// ---------------------------------------------------------------------------
// Types

export type SnapshotLedKey = 'driver' | 'passenger' | 'frontDoors' | 'rearDoors' | 'thirdRow';
export const SNAPSHOT_LED_KEYS: readonly SnapshotLedKey[] = ['driver', 'passenger', 'frontDoors', 'rearDoors', 'thirdRow'];

export interface SnapshotFactory {
  carBits: string | null;
  featureBits: string | null;
  leds: Record<SnapshotLedKey, number | null>;
  wiring: Record<WiringKey, number | null>;
  stripParam: number | null;
  customerCode: number | null;
}

/** The restorable subset of DeviceState. null = unknown (not reported / not read). */
export interface SnapshotValues {
  rgbMode: number | null;
  color: string | null;
  rgbSpeed: number | null;
  rgbCustomEnabled: boolean | null;
  rgbSequence: Slot[] | null;
  effect: number | null;
  effectSpeed: number | null;
  effectDirection: number | null;
  effectCustomEnabled: boolean | null;
  effectSequence: Slot[] | null;
  effectCustomLength: number | null;
  effectCustomGap: number | null;
  brightness: { b1: number | null; b2: number | null; b3: number | null };
  zoning: number | null;
  nightHalf: boolean | null;
  controlMethod: number | null;
  soundSensitivity: number | null;
  soundSource: number | null;
  welcomeEnabled: boolean | null;
  welcomeMode: number | null;
  welcomeColor: number | null;
  welcomeSync: boolean | null;
  events: Record<CarEventKey, number | null>;
  factory: SnapshotFactory;
}

export type SnapshotSource = 'module' | 'builtin' | 'import';

export interface Snapshot {
  id: string;
  label: string;
  /** ISO-8601. */
  takenAt: string;
  source: SnapshotSource;
  firmware: string | null;
  /** Raw frame texts received, by code ("4E", "26"…), kept as evidence. */
  frames: Record<string, string>;
  values: SnapshotValues;
  /** Made by the app on its own (before the tests, before a restore): only pushes out other automatic copies. */
  auto?: boolean;
  /** Read from the demo module: never offered for the real module's installation. */
  demo?: boolean;
}

/** One restorable value, in the order restoreCommands sends them. */
export type SnapshotField =
  | 'rgbSequence'
  | 'rgbCustomEnabled'
  | 'effectSequence'
  | 'effectCustomEnabled'
  | 'effectCustomLength'
  | 'effectCustomGap'
  | 'zoning'
  | 'rgbMode'
  | 'color'
  | 'effect'
  | 'effectSpeed'
  | 'effectDirection'
  | 'rgbSpeed'
  | 'brightness.b1'
  | 'brightness.b2'
  | 'brightness.b3'
  | 'soundSensitivity'
  | 'controlMethod'
  | 'welcomeEnabled'
  | `events.${CarEventKey}`
  | 'nightHalf'
  | 'welcomeMode'
  | 'welcomeColor'
  | 'soundSource'
  | 'factory.dial'
  | `factory.leds.${SnapshotLedKey}`
  | `factory.wiring.${WiringKey}`
  | 'factory.stripParam'
  | 'factory.customerCode';

/**
 * Selects fields for `only`: a field ("events.turn"), a group prefix
 * ("events", "brightness", "factory", "factory.leds"), or a top-level key of
 * SnapshotValues ("welcomeSync" selects the welcome colour command).
 */
export type FieldSelector = SnapshotField | keyof SnapshotValues | 'factory.leds' | 'factory.wiring';

export type FieldGroup = 'custom' | 'zoning' | 'state' | 'settings' | 'factory';

export type SkipReason = 'unknown' | 'unsupported' | 'empty' | 'invalid';

// ---------------------------------------------------------------------------
// Field table: one row per restorable value, in sending order

interface FieldSpec {
  key: SnapshotField;
  group: FieldGroup;
  label: string;
  /** Canonical comparable value, or null when unknown. */
  read(v: SnapshotValues): string | null;
  /** The command restoring the value, or why there is none. */
  encode(v: SnapshotValues): string | SkipReason;
  /** Spanish rendering for diffs and reports. */
  format(v: SnapshotValues): string;
}

const UNKNOWN = '—';
const yesNo = (b: boolean | null): string => (b === null ? UNKNOWN : b ? 'sí' : 'no');
const optionName = (options: readonly { id: number; name: string }[], n: number | null): string =>
  n === null ? UNKNOWN : (options.find((o) => o.id === n)?.name ?? String(n));

/** Runs an encoder; an out-of-range value is reported as "invalid" instead of throwing. */
function safe(encode: () => string): string | SkipReason {
  try {
    return encode();
  } catch {
    return 'invalid';
  }
}

function numField(
  key: SnapshotField,
  group: FieldGroup,
  label: string,
  get: (v: SnapshotValues) => number | null,
  encode: (n: number) => string,
  format: (n: number) => string = String,
  unsupportable = false,
): FieldSpec {
  return {
    key,
    group,
    label,
    read: (v) => {
      const n = get(v);
      return n === null || n === undefined ? null : String(n);
    },
    encode: (v) => {
      const n = get(v);
      if (n === null || n === undefined) return 'unknown';
      if (unsupportable && n === UNSUPPORTED) return 'unsupported';
      return safe(() => encode(n));
    },
    format: (v) => {
      const n = get(v);
      if (n === null || n === undefined) return UNKNOWN;
      if (unsupportable && n === UNSUPPORTED) return 'no admitido';
      return format(n);
    },
  };
}

function boolField(
  key: SnapshotField,
  group: FieldGroup,
  label: string,
  get: (v: SnapshotValues) => boolean | null,
  encode: (on: boolean) => string,
): FieldSpec {
  return {
    key,
    group,
    label,
    read: (v) => {
      const b = get(v);
      return b === null || b === undefined ? null : String(b);
    },
    encode: (v) => {
      const b = get(v);
      return b === null || b === undefined ? 'unknown' : safe(() => encode(b));
    },
    format: (v) => yesNo(get(v) ?? null),
  };
}

function sequenceField(key: SnapshotField, label: string, get: (v: SnapshotValues) => Slot[] | null, encode: (s: Slot[]) => string): FieldSpec {
  const digits = (v: SnapshotValues): string | null => {
    const slots = get(v);
    if (!slots) return null;
    try {
      return cmd.encodeSequence(slots);
    } catch {
      return 'invalid';
    }
  };
  return {
    key,
    group: 'custom',
    label,
    read: digits,
    encode: (v) => {
      const slots = get(v);
      if (!slots) return 'unknown';
      // Never send an all-empty sequence: the enable flag alone says "off".
      if (slots.every((slot) => slot === null)) return 'empty';
      return safe(() => encode(slots));
    },
    format: (v) => {
      const d = digits(v);
      if (d === null) return UNKNOWN;
      return /^f{8}$/.test(d) ? 'vacía' : d;
    },
  };
}

const eventLabel = (key: CarEventKey): string => `Aviso: ${(CAR_EVENTS.find((e) => e.key === key)?.name ?? key).toLowerCase()}`;
const eventFormat = (n: number): string => (n === 1 ? 'activado' : n === 0 ? 'desactivado' : String(n));

const LED_LABELS: Record<SnapshotLedKey, string> = {
  driver: 'LEDs del conductor',
  passenger: 'LEDs del acompañante',
  frontDoors: 'LEDs de las puertas delanteras',
  rearDoors: 'LEDs de las puertas traseras',
  thirdRow: 'LEDs de la tercera fila',
};

function wiringName(key: WiringKey, n: number): string {
  const info = WIRING.find((w) => w.key === key);
  return info?.options.find((o) => o.id === n)?.name.toLowerCase() ?? String(n);
}

const FIELDS: readonly FieldSpec[] = [
  // Custom sequences first: the mode commands below may depend on them.
  sequenceField('rgbSequence', 'Secuencia RGB personalizada', (v) => v.rgbSequence, cmd.rgbCustomSequence),
  boolField('rgbCustomEnabled', 'custom', 'Secuencia RGB activada', (v) => v.rgbCustomEnabled, cmd.rgbCustomEnabled),
  sequenceField('effectSequence', 'Secuencia de efectos personalizada', (v) => v.effectSequence, cmd.effectCustomSequence),
  boolField('effectCustomEnabled', 'custom', 'Secuencia de efectos activada', (v) => v.effectCustomEnabled, cmd.effectCustomEnabled),
  numField('effectCustomLength', 'custom', 'Longitud del segmento', (v) => v.effectCustomLength, cmd.effectCustomLength),
  numField('effectCustomGap', 'custom', 'Separación del segmento', (v) => v.effectCustomGap, cmd.effectCustomGap),
  numField('zoning', 'zoning', 'Zonas de brillo', (v) => v.zoning, (n) => cmd.zoning(n as BinaryValue), (n) => optionName(ZONINGS, n)),
  // State ([04] before [06]: a mode chosen after the colour would replace it).
  numField('rgbMode', 'state', 'Modo RGB', (v) => v.rgbMode, cmd.rgbMode, (n) => `${n} (${rgbModeName(n) ?? '?'})`),
  {
    key: 'color',
    group: 'state',
    label: 'Color',
    read: (v) => (v.color ? v.color.toLowerCase() : null),
    // Zone "Todo", lowercase, as the vendor app sends it.
    encode: (v) => (v.color ? safe(() => cmd.color(0, v.color as string)) : 'unknown'),
    format: (v) => (v.color ? v.color.toLowerCase() : UNKNOWN),
  },
  numField('effect', 'state', 'Efecto', (v) => v.effect, cmd.effect, (n) => `${n} (${effectName(n, '4E') ?? '?'})`),
  numField('effectSpeed', 'state', 'Velocidad del efecto', (v) => v.effectSpeed, cmd.effectSpeed),
  numField(
    'effectDirection',
    'state',
    'Dirección del efecto',
    (v) => v.effectDirection,
    (n) => cmd.effectDirection(n as BinaryValue),
    (n) => optionName(DIRECTIONS, n).toLowerCase(),
  ),
  numField('rgbSpeed', 'state', 'Velocidad RGB', (v) => v.rgbSpeed, cmd.rgbSpeed),
  numField('brightness.b1', 'state', 'Brillo 1 (global / consola)', (v) => v.brightness.b1, (n) => cmd.brightness(1, n)),
  numField('brightness.b2', 'state', 'Brillo 2 (contorno / puertas)', (v) => v.brightness.b2, (n) => cmd.brightness(2, n)),
  numField('brightness.b3', 'state', 'Brillo 3 (pies)', (v) => v.brightness.b3, (n) => cmd.brightness(3, n)),
  numField('soundSensitivity', 'state', 'Sensibilidad al sonido', (v) => v.soundSensitivity, cmd.soundSensitivity),
  numField(
    'controlMethod',
    'state',
    'Control',
    (v) => v.controlMethod,
    (n) => cmd.controlMethod(n as BinaryValue),
    (n) => optionName(CONTROL_METHODS, n).toLowerCase(),
  ),
  // Settings (frame 26).
  boolField('welcomeEnabled', 'settings', 'Bienvenida', (v) => v.welcomeEnabled, cmd.welcomeEnabled),
  ...CAR_EVENT_KEYS.map((key) =>
    numField(`events.${key}`, 'settings', eventLabel(key), (v) => v.events[key], (n) => cmd.carEvent(key, n === 1), eventFormat, true),
  ),
  boolField('nightHalf', 'settings', 'Consola a mitad de brillo de noche', (v) => v.nightHalf, cmd.nightHalf),
  numField('welcomeMode', 'settings', 'Modo de bienvenida', (v) => v.welcomeMode, cmd.welcomeMode, (n) => optionName(WELCOME_MODES, n)),
  {
    key: 'welcomeColor',
    group: 'settings',
    label: 'Color de bienvenida',
    read: (v) => (v.welcomeSync === true ? 'sync' : v.welcomeColor === null ? null : String(v.welcomeColor)),
    encode: (v) => {
      if (v.welcomeSync === true) return cmd.welcomeColor('sync');
      return v.welcomeColor === null ? 'unknown' : safe(() => cmd.welcomeColor(v.welcomeColor as number));
    },
    format: (v) => {
      if (v.welcomeSync === true) return 'sincronizado con RGB';
      if (v.welcomeColor === null) return UNKNOWN;
      return paletteColor(v.welcomeColor)?.name.toLowerCase() ?? String(v.welcomeColor);
    },
  },
  numField(
    'soundSource',
    'settings',
    'Fuente de sonido',
    (v) => v.soundSource,
    (n) => cmd.soundSource(n as BinaryValue),
    (n) => optionName(SOUND_SOURCES, n).toLowerCase(),
    true,
  ),
  // Installation: only between [2101] and [2100], dial codes first.
  {
    key: 'factory.dial',
    group: 'factory',
    label: 'Códigos de modelo (coche / funciones)',
    read: (v) => (v.factory.carBits && v.factory.featureBits ? `${v.factory.carBits}/${v.factory.featureBits}` : null),
    encode: (v) =>
      v.factory.carBits && v.factory.featureBits
        ? safe(() => cmd.dialCodes(v.factory.carBits as string, v.factory.featureBits as string))
        : 'unknown',
    format: (v) => `${v.factory.carBits ?? '?'}/${v.factory.featureBits ?? '?'}`,
  },
  ...SNAPSHOT_LED_KEYS.map((key) =>
    numField(`factory.leds.${key}`, 'factory', LED_LABELS[key], (v) => v.factory.leds[key], (n) => cmd.ledCount(key, n)),
  ),
  ...WIRING_KEYS.map((key) =>
    numField(
      `factory.wiring.${key}`,
      'factory',
      WIRING.find((w) => w.key === key)?.name ?? key,
      (v) => v.factory.wiring[key],
      (n) => cmd.wiring(key, n as BinaryValue),
      (n) => wiringName(key, n),
    ),
  ),
  numField('factory.stripParam', 'factory', 'Parámetro de la tira', (v) => v.factory.stripParam, (n) => cmd.ledCount('stripParam', n)),
  numField('factory.customerCode', 'factory', 'Código de cliente', (v) => v.factory.customerCode, cmd.customerCode),
];

export const SNAPSHOT_FIELDS: readonly SnapshotField[] = FIELDS.map((f) => f.key);
export const SETTINGS_FIELDS: readonly SnapshotField[] = FIELDS.filter((f) => f.group !== 'factory').map((f) => f.key);
export const FACTORY_FIELDS: readonly SnapshotField[] = FIELDS.filter((f) => f.group === 'factory').map((f) => f.key);

const SPEC_BY_KEY = new Map<SnapshotField, FieldSpec>(FIELDS.map((f) => [f.key, f]));

export function fieldLabel(field: SnapshotField): string {
  return SPEC_BY_KEY.get(field)?.label ?? field;
}

export function formatField(field: SnapshotField, values: SnapshotValues): string {
  return SPEC_BY_KEY.get(field)?.format(values) ?? UNKNOWN;
}

/** Comparable value of a field, null when unknown. */
export function readField(field: SnapshotField, values: SnapshotValues): string | null {
  return SPEC_BY_KEY.get(field)?.read(values) ?? null;
}

export function isFactoryField(field: SnapshotField): boolean {
  return SPEC_BY_KEY.get(field)?.group === 'factory';
}

function selects(selectors: readonly FieldSelector[] | undefined, field: SnapshotField): boolean {
  if (!selectors) return true;
  return selectors.some(
    (sel) => sel === field || field.startsWith(`${sel}.`) || (sel === 'welcomeSync' && field === 'welcomeColor'),
  );
}

// ---------------------------------------------------------------------------
// Building values

export function emptyValues(): SnapshotValues {
  return valuesFromState(initialDeviceState());
}

/** The restorable subset of a device state (copies, never shares arrays). */
export function valuesFromState(state: DeviceState): SnapshotValues {
  const f = state.factory;
  return {
    rgbMode: state.rgbMode,
    color: state.color,
    rgbSpeed: state.rgbSpeed,
    rgbCustomEnabled: state.rgbCustomEnabled,
    rgbSequence: state.rgbSequence ? [...state.rgbSequence] : null,
    effect: state.effect,
    effectSpeed: state.effectSpeed,
    effectDirection: state.effectDirection,
    effectCustomEnabled: state.effectCustomEnabled,
    effectSequence: state.effectSequence ? [...state.effectSequence] : null,
    effectCustomLength: state.effectCustomLength,
    effectCustomGap: state.effectCustomGap,
    brightness: { ...state.brightness },
    zoning: state.zoning,
    nightHalf: state.nightHalf,
    controlMethod: state.controlMethod,
    soundSensitivity: state.soundSensitivity,
    soundSource: state.soundSource,
    welcomeEnabled: state.welcomeEnabled,
    welcomeMode: state.welcomeMode,
    welcomeColor: state.welcomeColor,
    welcomeSync: state.welcomeSync,
    events: { ...state.events },
    factory: {
      carBits: f.carBits,
      featureBits: f.featureBits,
      leds: {
        driver: f.leds.driver,
        passenger: f.leds.passenger,
        frontDoors: f.leds.frontDoors,
        rearDoors: f.leds.rearDoors,
        thirdRow: f.leds.thirdRow,
      },
      wiring: { ...f.wiring },
      stripParam: f.leds.stripParam,
      customerCode: f.customerCode,
    },
  };
}

/** Deep copy (JSON-safe values only). */
export function cloneValues(values: SnapshotValues): SnapshotValues {
  return JSON.parse(JSON.stringify(values)) as SnapshotValues;
}

/**
 * Frames are applied in a fixed order so that, for a value two frames carry
 * (the RGB speed is in the state frame and in 27), the documented position
 * wins: 27 after the state frame.
 */
const FRAME_ORDER = ['1F', '4E', '13', '26', '27', '23', '25', '4F', '58'];

/** Device state built only from frames (no optimistic command updates). */
export function stateFromFrames(frames: Record<string, string> | readonly string[]): DeviceState {
  const list = Array.isArray(frames) ? [...frames] : Object.values(frames);
  const rank = (raw: string) => {
    const i = FRAME_ORDER.indexOf(raw.substr(1, 2).toUpperCase());
    return i < 0 ? FRAME_ORDER.length : i;
  };
  list.sort((a, b) => rank(a) - rank(b));
  let state = initialDeviceState();
  for (const raw of list) state = applyFrame(state, parseFrame(raw), 0);
  return state;
}

export function valuesFromFrames(frames: Record<string, string> | readonly string[]): SnapshotValues {
  return valuesFromState(stateFromFrames(frames));
}

function newId(): string {
  return `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function snapshotFromFrames(
  frames: Record<string, string>,
  meta: Partial<Pick<Snapshot, 'id' | 'label' | 'takenAt' | 'source' | 'auto' | 'demo'>> = {},
): Snapshot {
  const state = stateFromFrames(frames);
  const takenAt = meta.takenAt ?? new Date().toISOString();
  return {
    id: meta.id ?? newId(),
    label: meta.label ?? `Copia · ${new Date(takenAt).toLocaleString('es')}`,
    takenAt,
    source: meta.source ?? 'module',
    firmware: state.version?.firmware || null,
    frames: { ...frames },
    values: valuesFromState(state),
    ...(meta.auto ? { auto: true } : {}),
    ...(meta.demo ? { demo: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Restore commands

export interface RestoreCommandOptions {
  /** 'all' also builds the installation block (default 'settings'). */
  include?: 'settings' | 'all';
  /** Restrict to these fields (see FieldSelector). */
  only?: readonly FieldSelector[];
  /** Drop every command whose value already matches these values (restore only what differs). */
  skipEqualTo?: SnapshotValues | null;
}

export interface RestoreCommands {
  /** Usage settings, in sending order. */
  settings: string[];
  /**
   * Installation block (include 'all'): dial codes first, then LED counts,
   * wiring, [40] and [43]. The caller must send it between [2101] and [2100].
   */
  factory: string[];
  /** Selected fields that produce no command, and why. */
  skipped: { field: SnapshotField; reason: SkipReason }[];
}

/**
 * The commands that put `values` back, built only with the encoders of
 * commands.ts. Unknown values are skipped, as are unsupported (255) events
 * and sound source, and all-empty custom sequences (only their enable flag is
 * sent). [04] and [1E] switch the custom sequences off in the vendor app, so
 * an enabled sequence's [2B01]/[3B01] goes right after them.
 */
export function restoreCommands(values: SnapshotValues, options: RestoreCommandOptions = {}): RestoreCommands {
  const include = options.include ?? 'settings';
  const items: { field: SnapshotField; command: string }[] = [];
  const skipped: RestoreCommands['skipped'] = [];
  for (const spec of FIELDS) {
    if (spec.group === 'factory' && include !== 'all') continue;
    if (!selects(options.only, spec.key)) continue;
    const command = spec.encode(values);
    if (!command.startsWith('[')) {
      skipped.push({ field: spec.key, reason: command as SkipReason });
      continue;
    }
    if (options.skipEqualTo && spec.encode(options.skipEqualTo) === command) continue;
    items.push({ field: spec.key, command });
  }

  // Re-enable a custom sequence after the mode command that switches it off.
  const followMode = (modeField: SnapshotField, flagField: SnapshotField, enabled: boolean | null, flag: string) => {
    const modeAt = items.findIndex((i) => i.field === modeField);
    if (modeAt < 0 || enabled !== true) return;
    const flagAt = items.findIndex((i) => i.field === flagField);
    if (flagAt >= 0) items.splice(flagAt, 1);
    items.splice(
      items.findIndex((i) => i.field === modeField) + 1,
      0,
      { field: flagField, command: flag },
    );
  };
  followMode('rgbMode', 'rgbCustomEnabled', values.rgbCustomEnabled, cmd.rgbCustomEnabled(true));
  followMode('effect', 'effectCustomEnabled', values.effectCustomEnabled, cmd.effectCustomEnabled(true));

  return {
    settings: items.filter((i) => !isFactoryField(i.field)).map((i) => i.command),
    factory: items.filter((i) => isFactoryField(i.field)).map((i) => i.command),
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Comparing

export type CheckStatus = 'match' | 'differs' | 'unknown';

export interface FieldCheck {
  field: SnapshotField;
  label: string;
  expected: string;
  actual: string;
  status: CheckStatus;
}

/**
 * Compares `actual` with `expected`, field by field. Fields unknown in
 * `expected` are left out (there is nothing to check); fields unknown in
 * `actual` come back as "unknown".
 */
export function diffValues(
  expected: SnapshotValues,
  actual: SnapshotValues,
  options: { only?: readonly FieldSelector[]; include?: 'settings' | 'all' } = {},
): FieldCheck[] {
  const include = options.include ?? 'all';
  const out: FieldCheck[] = [];
  for (const spec of FIELDS) {
    if (spec.group === 'factory' && include !== 'all') continue;
    if (!selects(options.only, spec.key)) continue;
    const want = spec.read(expected);
    if (want === null) continue;
    const got = spec.read(actual);
    out.push({
      field: spec.key,
      label: spec.label,
      expected: spec.format(expected),
      actual: spec.format(actual),
      status: got === null ? 'unknown' : got === want ? 'match' : 'differs',
    });
  }
  return out;
}

/** Fields known on both sides whose values differ. */
export function changedFields(
  expected: SnapshotValues,
  actual: SnapshotValues,
  options: { only?: readonly FieldSelector[]; include?: 'settings' | 'all' } = {},
): SnapshotField[] {
  return diffValues(expected, actual, options)
    .filter((c) => c.status === 'differs')
    .map((c) => c.field);
}

/** Number of usage settings with a known value. */
export function countKnown(values: SnapshotValues): number {
  return FIELDS.filter((f) => f.group !== 'factory' && f.read(values) !== null).length;
}

export function hasFactory(values: SnapshotValues): boolean {
  return FIELDS.some((f) => f.group === 'factory' && f.read(values) !== null);
}

// ---------------------------------------------------------------------------
// Feature switch nº 8

/** featureBits with switch `n` (1-8) set to `on`. */
export function withFeatureSwitch(featureBits: string, n: number, on: boolean): string {
  if (!/^[01]{8}$/.test(featureBits)) throw new RangeError('featureBits must be 8 characters of 0/1');
  cmd.assertInt('feature switch', n, 1, 8);
  return featureBits.slice(0, n - 1) + (on ? '1' : '0') + featureBits.slice(n);
}

// ---------------------------------------------------------------------------
// Validation of imported snapshots

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

class InvalidSnapshot extends Error {}

function nullableInt(x: unknown, path: string): number | null {
  if (x === null || x === undefined) return null;
  if (typeof x !== 'number' || !Number.isInteger(x)) throw new InvalidSnapshot(path);
  return x;
}

function nullableBool(x: unknown, path: string): boolean | null {
  if (x === null || x === undefined) return null;
  if (typeof x !== 'boolean') throw new InvalidSnapshot(path);
  return x;
}

function nullableBits(x: unknown, path: string): string | null {
  if (x === null || x === undefined) return null;
  if (typeof x !== 'string' || !/^[01]{8}$/.test(x)) throw new InvalidSnapshot(path);
  return x;
}

function nullableSlots(x: unknown, path: string): Slot[] | null {
  if (x === null || x === undefined) return null;
  if (!Array.isArray(x) || x.length !== cmd.SEQUENCE_LENGTH) throw new InvalidSnapshot(path);
  return x.map((slot) => {
    if (slot === null) return null;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= cmd.PALETTE_SIZE) throw new InvalidSnapshot(path);
    return slot;
  });
}

function sanitizeValues(raw: unknown): SnapshotValues {
  if (!isRecord(raw)) throw new InvalidSnapshot('values');
  const r = raw;
  const b = isRecord(r.brightness) ? r.brightness : {};
  const e = isRecord(r.events) ? r.events : {};
  const f = isRecord(r.factory) ? r.factory : {};
  const leds = isRecord(f.leds) ? f.leds : {};
  const wiring = isRecord(f.wiring) ? f.wiring : {};
  let color: string | null = null;
  if (r.color !== null && r.color !== undefined) {
    if (typeof r.color !== 'string' || !/^#?[0-9a-fA-F]{6}$/.test(r.color.trim())) throw new InvalidSnapshot('color');
    color = `#${cmd.normalizeHexColor(r.color)}`;
  }
  const values: SnapshotValues = {
    rgbMode: nullableInt(r.rgbMode, 'rgbMode'),
    color,
    rgbSpeed: nullableInt(r.rgbSpeed, 'rgbSpeed'),
    rgbCustomEnabled: nullableBool(r.rgbCustomEnabled, 'rgbCustomEnabled'),
    rgbSequence: nullableSlots(r.rgbSequence, 'rgbSequence'),
    effect: nullableInt(r.effect, 'effect'),
    effectSpeed: nullableInt(r.effectSpeed, 'effectSpeed'),
    effectDirection: nullableInt(r.effectDirection, 'effectDirection'),
    effectCustomEnabled: nullableBool(r.effectCustomEnabled, 'effectCustomEnabled'),
    effectSequence: nullableSlots(r.effectSequence, 'effectSequence'),
    effectCustomLength: nullableInt(r.effectCustomLength, 'effectCustomLength'),
    effectCustomGap: nullableInt(r.effectCustomGap, 'effectCustomGap'),
    brightness: { b1: nullableInt(b.b1, 'brightness.b1'), b2: nullableInt(b.b2, 'brightness.b2'), b3: nullableInt(b.b3, 'brightness.b3') },
    zoning: nullableInt(r.zoning, 'zoning'),
    nightHalf: nullableBool(r.nightHalf, 'nightHalf'),
    controlMethod: nullableInt(r.controlMethod, 'controlMethod'),
    soundSensitivity: nullableInt(r.soundSensitivity, 'soundSensitivity'),
    soundSource: nullableInt(r.soundSource, 'soundSource'),
    welcomeEnabled: nullableBool(r.welcomeEnabled, 'welcomeEnabled'),
    welcomeMode: nullableInt(r.welcomeMode, 'welcomeMode'),
    welcomeColor: nullableInt(r.welcomeColor, 'welcomeColor'),
    welcomeSync: nullableBool(r.welcomeSync, 'welcomeSync'),
    events: Object.fromEntries(CAR_EVENT_KEYS.map((key) => [key, nullableInt(e[key], `events.${key}`)])) as Record<
      CarEventKey,
      number | null
    >,
    factory: {
      carBits: nullableBits(f.carBits, 'factory.carBits'),
      featureBits: nullableBits(f.featureBits, 'factory.featureBits'),
      leds: Object.fromEntries(SNAPSHOT_LED_KEYS.map((key) => [key, nullableInt(leds[key], `factory.leds.${key}`)])) as Record<
        SnapshotLedKey,
        number | null
      >,
      wiring: Object.fromEntries(WIRING_KEYS.map((key) => [key, nullableInt(wiring[key], `factory.wiring.${key}`)])) as Record<
        WiringKey,
        number | null
      >,
      stripParam: nullableInt(f.stripParam, 'factory.stripParam'),
      customerCode: nullableInt(f.customerCode, 'factory.customerCode'),
    },
  };
  // Ranges: every known value must encode (the same check the commands use).
  const invalid = restoreCommands(values, { include: 'all' }).skipped.filter((s) => s.reason === 'invalid');
  if (invalid.length) throw new InvalidSnapshot(invalid.map((s) => s.field).join(', '));
  return values;
}

export type SnapshotParseResult = { ok: true; snapshot: Snapshot } | { ok: false; error: string };

/**
 * Validates an untrusted snapshot (pasted JSON). Types and ranges are
 * checked; frames must look like "[XX…]" printable ASCII.
 */
export function sanitizeSnapshot(input: unknown): SnapshotParseResult {
  try {
    const src = isRecord(input) && isRecord(input.snapshot) ? input.snapshot : input;
    if (!isRecord(src)) return { ok: false, error: 'No es una copia de seguridad (falta el objeto).' };
    if (!isRecord(src.values)) return { ok: false, error: 'No es una copia de seguridad (faltan los valores).' };
    const values = sanitizeValues(src.values);
    const frames: Record<string, string> = {};
    if (isRecord(src.frames)) {
      for (const [code, raw] of Object.entries(src.frames)) {
        if (typeof raw !== 'string' || raw.length > 80 || !/^\[[0-9A-Za-z]{2}[\x20-\x7e]*\]$/.test(raw)) {
          return { ok: false, error: `Trama no válida: ${code}` };
        }
        frames[code.slice(0, 4)] = raw;
      }
    }
    const takenAt = typeof src.takenAt === 'string' && !Number.isNaN(Date.parse(src.takenAt)) ? src.takenAt : new Date().toISOString();
    const label = typeof src.label === 'string' && src.label.trim() ? src.label.trim().slice(0, 80) : 'Copia importada';
    const firmware = typeof src.firmware === 'string' ? src.firmware.slice(0, 40) : null;
    const source: SnapshotSource = src.source === 'module' || src.source === 'builtin' || src.source === 'import' ? src.source : 'import';
    const id = typeof src.id === 'string' && /^[\w.-]{1,64}$/.test(src.id) ? src.id : newId();
    const flags = { ...(src.auto === true ? { auto: true } : {}), ...(src.demo === true ? { demo: true } : {}) };
    return { ok: true, snapshot: { id, label, takenAt, source, firmware, frames, values, ...flags } };
  } catch (error) {
    const field = error instanceof InvalidSnapshot ? error.message : '';
    return { ok: false, error: field ? `Valor no válido: ${field}` : 'No se pudo leer la copia.' };
  }
}

// ---------------------------------------------------------------------------
// The user's car (docs/mi-configuracion.md, docs/protocolo-zycela.md §6)

/** Frames read from the user's module ZYCL-FWD-41A0 on 2026-11-06. */
export const BUILTIN_FRAMES: Readonly<Record<string, string>> = {
  '4E': '[4E001801FF1000FF11010904010300090800]',
  '26': '[2601010000000101000504FF00FF]',
  '27': '[27FFFFFFFF00FFFFFFFF000305FF0800]',
  '13': '[1356372E31305A593435353432203235313132312D303233]',
};

/** Installation copied from the vendor app's factory page on 2026-11-06. */
export const BUILTIN_INSTALLATION: SnapshotFactory = {
  carBits: '01000010',
  featureBits: '00000000',
  leds: { driver: 50, passenger: 50, frontDoors: 50, rearDoors: 50, thirdRow: null },
  wiring: {
    driver: 0,
    passenger: 0,
    frontLeft: 1,
    frontRight: 1,
    rearLeft: 1,
    rearRight: 1,
    thirdLeft: null,
    thirdRight: null,
  },
  stripParam: 123,
  customerCode: 0,
};

export const BUILTIN_SNAPSHOT_ID = 'builtin-2026-11-06';

export const BUILTIN_SNAPSHOT: Snapshot = (() => {
  const base = snapshotFromFrames(
    { ...BUILTIN_FRAMES },
    { id: BUILTIN_SNAPSHOT_ID, label: 'Tu configuración (6/11/2026)', takenAt: '2026-11-06T19:28:00.000Z', source: 'builtin' },
  );
  return { ...base, values: { ...base.values, factory: JSON.parse(JSON.stringify(BUILTIN_INSTALLATION)) as SnapshotFactory } };
})();
