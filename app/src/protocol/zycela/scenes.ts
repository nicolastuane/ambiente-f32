/** Scenes: a saved look that is applied as a sequence of commands. */
import * as cmd from './commands';
import type { PowerMode } from './commands';
import type { DeviceState } from './state';

export interface SceneData {
  power?: PowerMode;
  colors?: { all?: string; zone1?: string; zone2?: string };
  rgbMode?: number;
  rgbSpeed?: number;
  effect?: { id: number; variant?: number; speed?: number; direction?: 0 | 1 };
  brightness?: { b1?: number; b2?: number; b3?: number };
}

export interface Scene {
  id: string;
  name: string;
  data: SceneData;
}

/**
 * Commands that apply a scene, in a fixed order: power, RGB mode and speed,
 * colours (after the mode so a fixed colour is not overridden), effect and its
 * parameters, then brightness. Throws RangeError if a value is out of range.
 */
export function sceneToCommands(data: SceneData): string[] {
  const out: string[] = [];
  if (data.power !== undefined) out.push(cmd.power(data.power));
  if (data.rgbMode !== undefined) out.push(cmd.rgbMode(data.rgbMode));
  if (data.rgbSpeed !== undefined) out.push(cmd.rgbSpeed(data.rgbSpeed));
  const colors = data.colors ?? {};
  if (colors.all !== undefined) out.push(cmd.color(0, colors.all));
  if (colors.zone1 !== undefined) out.push(cmd.color(1, colors.zone1));
  if (colors.zone2 !== undefined) out.push(cmd.color(2, colors.zone2));
  if (data.effect !== undefined) {
    out.push(cmd.effect(data.effect.id));
    if (data.effect.variant !== undefined) out.push(cmd.effectVariant(data.effect.variant));
    if (data.effect.speed !== undefined) out.push(cmd.effectSpeed(data.effect.speed));
    if (data.effect.direction !== undefined) out.push(cmd.effectDirection(data.effect.direction));
  }
  const b = data.brightness ?? {};
  if (b.b1 !== undefined) out.push(cmd.brightness(1, b.b1));
  if (b.b2 !== undefined) out.push(cmd.brightness(2, b.b2));
  if (b.b3 !== undefined) out.push(cmd.brightness(3, b.b3));
  return out;
}

const opt = <T>(value: T | null): T | undefined => (value === null ? undefined : value);

/** Snapshot of the current device state as a scene (unknown values are left out). */
export function sceneFromState(state: DeviceState): SceneData {
  const data: SceneData = {};
  if (state.power === 0 || state.power === 1 || state.power === 2) data.power = state.power;
  const all = opt(state.color);
  const zone1 = opt(state.zoneColors[1]);
  const zone2 = opt(state.zoneColors[2]);
  const colors: NonNullable<SceneData['colors']> = {};
  if (all) colors.all = all;
  if (zone1 && zone1 !== all) colors.zone1 = zone1;
  if (zone2 && zone2 !== all) colors.zone2 = zone2;
  if (Object.keys(colors).length) data.colors = colors;
  if (state.rgbMode !== null) data.rgbMode = state.rgbMode;
  if (state.rgbSpeed !== null) data.rgbSpeed = state.rgbSpeed;
  if (state.effect !== null) {
    data.effect = { id: state.effect };
    if (state.effectVariant !== null) data.effect.variant = state.effectVariant;
    if (state.effectSpeed !== null) data.effect.speed = state.effectSpeed;
    if (state.effectDirection === 0 || state.effectDirection === 1) data.effect.direction = state.effectDirection;
  }
  const { b1, b2, b3 } = state.brightness;
  if (b1 !== null || b2 !== null || b3 !== null) {
    data.brightness = {};
    if (b1 !== null) data.brightness.b1 = b1;
    if (b2 !== null) data.brightness.b2 = b2;
    if (b3 !== null) data.brightness.b3 = b3;
  }
  return data;
}

/** Validates untrusted scene data (e.g. from an imported file). */
export function sanitizeSceneData(input: unknown): SceneData | null {
  if (!input || typeof input !== 'object') return null;
  const src = input as Record<string, unknown>;
  const data: SceneData = {};
  const int = (x: unknown): number | undefined => (typeof x === 'number' && Number.isInteger(x) ? x : undefined);
  const str = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);
  const p = int(src.power);
  if (p === 0 || p === 1 || p === 2) data.power = p;
  if (src.colors && typeof src.colors === 'object') {
    const c = src.colors as Record<string, unknown>;
    data.colors = {};
    for (const key of ['all', 'zone1', 'zone2'] as const) {
      const value = str(c[key]);
      if (value === undefined) continue;
      if (!/^#?[0-9a-fA-F]{6}$/.test(value.trim())) return null;
      data.colors[key] = `#${cmd.normalizeHexColor(value)}`;
    }
  }
  if (int(src.rgbMode) !== undefined) data.rgbMode = int(src.rgbMode);
  if (int(src.rgbSpeed) !== undefined) data.rgbSpeed = int(src.rgbSpeed);
  if (src.effect && typeof src.effect === 'object') {
    const e = src.effect as Record<string, unknown>;
    const id = int(e.id);
    if (id !== undefined) {
      data.effect = { id };
      if (int(e.variant) !== undefined) data.effect.variant = int(e.variant);
      if (int(e.speed) !== undefined) data.effect.speed = int(e.speed);
      const d = int(e.direction);
      if (d === 0 || d === 1) data.effect.direction = d;
    }
  }
  if (src.brightness && typeof src.brightness === 'object') {
    const b = src.brightness as Record<string, unknown>;
    data.brightness = {};
    for (const key of ['b1', 'b2', 'b3'] as const) {
      const value = int(b[key]);
      if (value !== undefined) data.brightness[key] = value;
    }
  }
  // Throws (caught below) if any value is out of range.
  try {
    sceneToCommands(data);
  } catch {
    return null;
  }
  return data;
}

/** Built-in scenes offered on first run. */
export const BUILT_IN_SCENES: readonly Scene[] = [
  {
    id: 'builtin-naranja-bmw',
    name: 'Naranja BMW',
    data: {
      power: 1,
      rgbMode: 0,
      colors: { all: '#ff6a00' },
      effect: { id: 24 },
      brightness: { b1: 8, b2: 8, b3: 6 },
    },
  },
  {
    id: 'builtin-blanco-hielo',
    name: 'Blanco hielo',
    data: {
      power: 1,
      rgbMode: 0,
      colors: { all: '#e6f0ff' },
      effect: { id: 24 },
      brightness: { b1: 7, b2: 7, b3: 5 },
    },
  },
  {
    id: 'builtin-azul-noche',
    name: 'Azul noche (suave)',
    data: {
      power: 1,
      rgbMode: 0,
      colors: { all: '#1c69d4' },
      effect: { id: 24 },
      brightness: { b1: 3, b2: 3, b3: 2 },
    },
  },
  {
    id: 'builtin-fiesta',
    name: 'Fiesta (ritmo musical)',
    data: {
      power: 1,
      rgbMode: 15,
      rgbSpeed: 8,
      effect: { id: 15, variant: 1, speed: 4, direction: 0 },
      brightness: { b1: 9, b2: 9, b3: 9 },
    },
  },
];
