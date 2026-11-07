/**
 * Data tables with the Spanish names shown in the UI. Ids are protocol values
 * (see docs/protocolo-zycela.md); nothing here is sent as-is except the ids.
 */
import type { CarEventKey, LedStripKey, WiringKey } from './commands';
import { LED_STRIP_SPECS, WIRING_CODES } from './commands';

export interface Option<T = number> {
  readonly id: T;
  readonly name: string;
}

export interface Group {
  readonly name: string;
  readonly items: readonly Option[];
}

export type FirmwareVariant = '1F' | '4E';

// ---------------------------------------------------------------------------
// Module palette (indices 0-14). Used by custom sequences and the welcome colour.

export interface PaletteColor {
  readonly index: number;
  readonly hex: string;
  readonly name: string;
}

export const MODULE_PALETTE: readonly PaletteColor[] = [
  { index: 0, hex: '#ff0000', name: 'Rojo' },
  { index: 1, hex: '#fc3700', name: 'Naranja' },
  { index: 2, hex: '#f7fc02', name: 'Amarillo' },
  { index: 3, hex: '#00fe00', name: 'Verde' },
  { index: 4, hex: '#32feff', name: 'Cian' },
  { index: 5, hex: '#0601fb', name: 'Azul' },
  { index: 6, hex: '#a100fc', name: 'Violeta' },
  { index: 7, hex: '#ff021e', name: 'Carmín' },
  { index: 8, hex: '#ff01ff', name: 'Magenta' },
  { index: 9, hex: '#ffffff', name: 'Blanco' },
  { index: 10, hex: '#00fe78', name: 'Verde primavera' },
  { index: 11, hex: '#3afeaa', name: 'Aguamarina' },
  { index: 12, hex: '#fe243c', name: 'Rosa intenso' },
  { index: 13, hex: '#b7ff8f', name: 'Verde lima' },
  { index: 14, hex: '#5970fc', name: 'Azul lavanda' },
];

export function paletteColor(index: number | null | undefined): PaletteColor | undefined {
  if (index === null || index === undefined) return undefined;
  return MODULE_PALETTE[index];
}

// ---------------------------------------------------------------------------
// RGB modes ([04XX], 0-20)

export const RGB_MODE_GROUPS: readonly Group[] = [
  {
    name: 'Fijo',
    items: [
      { id: 0, name: 'Un color' },
      { id: 1, name: 'Siete colores' },
      { id: 2, name: 'Aleatorio' },
    ],
  },
  {
    name: 'Respiración',
    items: [
      { id: 3, name: 'Un color' },
      { id: 4, name: 'Siete colores' },
      { id: 5, name: 'Aleatorio' },
    ],
  },
  {
    name: 'Degradado',
    items: [
      { id: 6, name: 'Siete colores' },
      { id: 7, name: 'Cian-amarillo-morado' },
      { id: 8, name: 'Rojo-amarillo-rosa' },
      { id: 9, name: 'Rojo-azul' },
      { id: 10, name: 'Verde-azul' },
      { id: 11, name: 'Aleatorio' },
    ],
  },
  {
    name: 'Estroboscópico',
    items: [
      { id: 12, name: 'Siete colores' },
      { id: 13, name: 'Rojo-verde-azul' },
      { id: 14, name: 'Cian-amarillo-morado' },
    ],
  },
  {
    name: 'Ritmo musical',
    items: [
      { id: 15, name: 'Siete colores' },
      { id: 16, name: 'Rojo-amarillo-rosa' },
      { id: 17, name: 'Cian-amarillo-morado' },
    ],
  },
  {
    name: 'Movimiento',
    items: [
      { id: 18, name: 'Azul-rojo' },
      { id: 19, name: 'Rojo-verde' },
      { id: 20, name: 'Rojo-cian' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Dynamic effects ([1EXX], 0-27). Two lists: basic (state frame 1F) and
// extended (state frame 4E, newer firmware).

const PHANTOM: Group = {
  name: 'Fantasma',
  items: [
    { id: 0, name: 'Multicolor' },
    { id: 1, name: 'Luz y sombra' },
    { id: 2, name: 'Respiración' },
  ],
};
const TRAIL: Group = {
  name: 'Estela',
  items: [
    { id: 12, name: 'Siete colores' },
    { id: 13, name: 'Multicolor' },
    { id: 14, name: 'Un color' },
  ],
};
const RHYTHM: Group = {
  name: 'Ritmo',
  items: [
    { id: 15, name: 'Espectro' },
    { id: 16, name: 'Estirar' },
    { id: 17, name: 'Onda' },
    { id: 18, name: 'Contraer' },
    { id: 19, name: 'Columnas' },
    { id: 20, name: 'Un color' },
  ],
};
const MOTION: Group = {
  name: 'Movimiento',
  items: [
    { id: 21, name: 'Estirar' },
    { id: 22, name: 'Contraer' },
    { id: 23, name: 'Rojo-azul' },
  ],
};
const SINGLE: Group = {
  name: 'Un color',
  items: [{ id: 24, name: 'Sincronizar con RGB' }],
};

export const EFFECT_GROUPS_BASIC: readonly Group[] = [
  PHANTOM,
  {
    name: 'Flujo',
    items: [
      { id: 3, name: 'Flujo' },
      { id: 4, name: 'Abrir-cerrar' },
      { id: 5, name: 'Onda' },
      { id: 6, name: 'Telón abre' },
      { id: 7, name: 'Telón cierra' },
      { id: 8, name: 'Acumulación' },
      { id: 9, name: 'Persecución' },
      { id: 10, name: 'Mágico' },
      { id: 11, name: 'Meteoro' },
    ],
  },
  TRAIL,
  RHYTHM,
  MOTION,
  SINGLE,
];

export const EFFECT_GROUPS_EXTENDED: readonly Group[] = [
  PHANTOM,
  {
    name: 'Flujo',
    items: [
      { id: 3, name: 'Flujo' },
      { id: 4, name: 'Abrir-cerrar' },
      { id: 5, name: 'Onda' },
      { id: 6, name: 'Telón abre' },
      { id: 7, name: 'Telón cierra' },
      { id: 25, name: 'Ping-pong' },
      { id: 9, name: 'Persecución' },
      { id: 10, name: 'Mágico' },
      { id: 11, name: 'Meteoro' },
    ],
  },
  {
    name: 'Acumulación',
    items: [
      { id: 8, name: 'Acumulación' },
      { id: 26, name: 'Apilado' },
      { id: 27, name: 'Convergencia' },
    ],
  },
  TRAIL,
  RHYTHM,
  MOTION,
  SINGLE,
];

export function effectGroups(firmware: FirmwareVariant | null | undefined): readonly Group[] {
  return firmware === '4E' ? EFFECT_GROUPS_EXTENDED : EFFECT_GROUPS_BASIC;
}

function findName(groups: readonly Group[], id: number | null | undefined): string | undefined {
  if (id === null || id === undefined) return undefined;
  for (const group of groups) {
    const item = group.items.find((i) => i.id === id);
    if (item) return `${group.name} · ${item.name}`;
  }
  return undefined;
}

export const rgbModeName = (id: number | null | undefined): string | undefined => findName(RGB_MODE_GROUPS, id);
export const effectName = (id: number | null | undefined, firmware?: FirmwareVariant | null): string | undefined =>
  findName(effectGroups(firmware), id) ?? findName(EFFECT_GROUPS_EXTENDED, id);

// ---------------------------------------------------------------------------
// Simple option lists

export const POWER_MODES: readonly Option[] = [
  { id: 1, name: 'Encendido' },
  { id: 0, name: 'Apagado' },
  { id: 2, name: 'Seguir luces del coche' },
];

export const COLOR_ZONES: readonly Option[] = [
  { id: 0, name: 'Todo' },
  { id: 1, name: 'Zona 1' },
  { id: 2, name: 'Zona 2' },
];

export const CONTROL_METHODS: readonly Option[] = [
  { id: 0, name: 'Coche + móvil' },
  { id: 1, name: 'Solo móvil' },
];

export const ZONINGS: readonly Option[] = [
  { id: 0, name: 'Arriba / abajo' },
  { id: 1, name: 'Delante / detrás' },
];

/** Labels of the three brightness sliders, by zoning type ([14XX]). */
export function brightnessLabels(zoningType: number | null | undefined): readonly [string, string, string] {
  return zoningType === 1 ? ['Consola central', 'Puertas', 'Pies'] : ['Global', 'Contorno', 'Pies'];
}

export const DIRECTIONS: readonly Option[] = [
  { id: 0, name: 'Hacia delante' },
  { id: 1, name: 'Hacia atrás' },
];

export const SOUND_SOURCES: readonly Option[] = [
  { id: 0, name: 'Micrófono' },
  { id: 1, name: 'Altavoces del coche' },
];

export const WELCOME_MODES: readonly Option[] = [
  { id: 0, name: 'Envolvente consola' },
  { id: 1, name: 'Envolvente puertas' },
  { id: 2, name: 'Puertas + retorno' },
  { id: 3, name: 'Cuatro puertas a la vez ①' },
  { id: 4, name: 'Cuatro puertas a la vez ②' },
  { id: 5, name: 'Cuatro puertas a la vez ③' },
];

export interface ColorChoice extends Option {
  readonly hex: string;
}

export const DOOR_COLORS: readonly ColorChoice[] = [
  { id: 0, name: 'Rojo', hex: '#ff2a2a' },
  { id: 1, name: 'Amarillo', hex: '#ffd400' },
  { id: 2, name: 'Magenta', hex: '#ff2bd6' },
  { id: 3, name: 'Azul', hex: '#2f6bff' },
];
export const TURN_COLORS: readonly ColorChoice[] = DOOR_COLORS;
export const BLIND_SPOT_COLORS: readonly ColorChoice[] = DOOR_COLORS.slice(0, 2);

export interface CarEventInfo {
  readonly key: CarEventKey;
  readonly name: string;
  readonly description: string;
}

export const CAR_EVENTS: readonly CarEventInfo[] = [
  { key: 'door', name: 'Puerta abierta', description: 'Aviso al abrir una puerta, con el color de «Puerta abierta».' },
  {
    key: 'radar',
    name: 'Radar de aparcamiento',
    // Seen on the user's F32 (2026-11-07): the strips blink in a colour that follows the distance with this on or off.
    description: 'Vinculado a los sensores de aparcamiento. En tu F32 las tiras siguen al radar aunque esté desactivado.',
  },
  { key: 'speed', name: 'Velocidad', description: 'Vinculado a la velocidad del coche.' },
  { key: 'turn', name: 'Intermitentes', description: 'Vinculado a los intermitentes, con el color de «Intermitente».' },
  { key: 'ac', name: 'Aire acondicionado', description: 'Aviso del climatizador.' },
  { key: 'blindSpot', name: 'Ángulo muerto', description: 'Vinculado al detector de ángulo muerto, con su color.' },
];

export const KEY_FUNCTIONS: readonly Option[] = [
  { id: 1, name: 'Despertar' },
  { id: 2, name: 'Modo principal de efectos' },
  { id: 3, name: 'Submodo de efectos' },
  { id: 4, name: 'Modo / color +' },
  { id: 5, name: 'Modo / color −' },
];

// ---------------------------------------------------------------------------
// Installation

export interface LedStripInfo {
  readonly key: LedStripKey;
  readonly name: string;
  readonly code: string;
  readonly min: number;
  readonly max: number;
  readonly thirdRowOnly?: boolean;
}

export const LED_STRIPS: readonly LedStripInfo[] = [
  { key: 'driver', name: 'Conductor (LEDs)', ...LED_STRIP_SPECS.driver },
  { key: 'passenger', name: 'Acompañante (LEDs)', ...LED_STRIP_SPECS.passenger },
  { key: 'frontDoors', name: 'Puertas delanteras (LEDs)', ...LED_STRIP_SPECS.frontDoors },
  { key: 'rearDoors', name: 'Puertas traseras (LEDs)', ...LED_STRIP_SPECS.rearDoors },
  { key: 'stripParam', name: 'Parámetro de la tira', ...LED_STRIP_SPECS.stripParam },
  { key: 'thirdRow', name: 'Tercera fila (LEDs)', ...LED_STRIP_SPECS.thirdRow, thirdRowOnly: true },
];

export interface WiringInfo {
  readonly key: WiringKey;
  readonly name: string;
  readonly code: string;
  readonly options: readonly Option[];
  readonly thirdRowOnly?: boolean;
}

const LEFT_RIGHT: readonly Option[] = [
  { id: 0, name: 'Izquierda' },
  { id: 1, name: 'Derecha' },
];
const FRONT_REAR: readonly Option[] = [
  { id: 1, name: 'Por delante' },
  { id: 0, name: 'Por detrás' },
];

export const WIRING: readonly WiringInfo[] = [
  { key: 'driver', name: 'Salida del cable · conductor', code: WIRING_CODES.driver, options: LEFT_RIGHT },
  { key: 'passenger', name: 'Salida del cable · acompañante', code: WIRING_CODES.passenger, options: LEFT_RIGHT },
  { key: 'frontLeft', name: 'Montaje · puerta delantera izquierda', code: WIRING_CODES.frontLeft, options: FRONT_REAR },
  { key: 'frontRight', name: 'Montaje · puerta delantera derecha', code: WIRING_CODES.frontRight, options: FRONT_REAR },
  { key: 'rearLeft', name: 'Montaje · puerta trasera izquierda', code: WIRING_CODES.rearLeft, options: FRONT_REAR },
  { key: 'rearRight', name: 'Montaje · puerta trasera derecha', code: WIRING_CODES.rearRight, options: FRONT_REAR },
  {
    key: 'thirdLeft',
    name: 'Salida del cable · tercera fila izquierda',
    code: WIRING_CODES.thirdLeft,
    options: FRONT_REAR,
    thirdRowOnly: true,
  },
  {
    key: 'thirdRight',
    name: 'Salida del cable · tercera fila derecha',
    code: WIRING_CODES.thirdRight,
    options: FRONT_REAR,
    thirdRowOnly: true,
  },
];

// ---------------------------------------------------------------------------
// Car-model codes (vendor table "中雅车联 三代控制拨码车型表", BMW rows)

export interface CarModelCode {
  /** Switches 1→8, "1" = 下 (on, red in the app). */
  bits: string;
  brand: string;
  model: string;
  control: string;
  /** Follow lights, door, radar, speed, turn, A/C, blind spot. */
  supports: readonly [boolean, boolean, boolean, boolean, boolean, boolean, boolean];
}

const BMW_SUPPORTS = [true, true, true, true, true, true, false] as const;

export const CAR_MODEL_CODES: readonly CarModelCode[] = [
  { bits: '01000001', brand: 'BMW', model: 'F18 con menú de solo brillo (sin colores)', control: 'pantalla', supports: BMW_SUPPORTS },
  { bits: '01000010', brand: 'BMW', model: 'Serie F: F18 antiguo / X1 / X3 / X4 / X5 / X6', control: 'pantalla', supports: BMW_SUPPORTS },
  { bits: '01000011', brand: 'BMW', model: 'G38 / G28 / nuevos X1 / X2 / X3 / X4', control: 'pantalla', supports: BMW_SUPPORTS },
  { bits: '01000100', brand: 'BMW', model: 'CIC (iDrive antiguo)', control: 'botones', supports: BMW_SUPPORTS },
  { bits: '01000101', brand: 'BMW', model: 'Serie 3 2023–25 (pantalla curva iD8)', control: 'pantalla', supports: BMW_SUPPORTS },
];

export const carModelForBits = (bits: string | null | undefined): CarModelCode | undefined =>
  bits ? CAR_MODEL_CODES.find((code) => code.bits === bits) : undefined;

// ---------------------------------------------------------------------------
// Result frames

export const SETTING_RESULT: Readonly<Record<number, string>> = {
  0: 'Tu módulo no admite este ajuste',
  1: 'Ajuste aplicado',
  2: 'El ajuste ha fallado',
};

export const KEY_LEARN_RESULT: Readonly<Record<number, string>> = {
  0: 'Botón aprendido',
  1: 'No se pudo aprender el botón',
  2: 'Tu módulo no admite esta función',
};

export const FLASH_RESULT: Readonly<Record<number, string>> = {
  0: 'Tu módulo no admite esta función',
  1: 'Menú original activado',
  2: 'La activación ha fallado',
};

export const FIRMWARE_NAMES: Readonly<Record<FirmwareVariant, string>> = {
  '1F': 'Básico (trama 1F)',
  '4E': 'Nuevo (trama 4E, lista ampliada de efectos)',
};
