/**
 * Persistent app data in localStorage, as one versioned JSON document.
 * Every access is wrapped in try/catch: storage can be missing or throw
 * (private mode, blocked site data, some WebViews) and the app must still work.
 */
import type { Scene } from '../protocol/zycela/scenes';
import { BUILT_IN_SCENES, sanitizeSceneData } from '../protocol/zycela/scenes';

export const STORAGE_KEY = 'ambiente-f32';
export const SCHEMA_VERSION = 2;
export const MAX_FAVORITES = 12;

export interface LastDevice {
  id: string | null;
  name: string | null;
}

export interface StoredData {
  version: typeof SCHEMA_VERSION;
  scenes: Scene[];
  /** "#rrggbb" */
  favorites: string[];
  lastDevice: LastDevice | null;
  demo: boolean;
  autoReconnect: boolean;
  showDangerous: boolean;
}

/** Shape written by version 1 (kept for migration). */
interface StoredDataV1 {
  version: 1;
  scenes?: unknown;
  favoriteColors?: unknown;
  lastDeviceName?: unknown;
  demoMode?: unknown;
  autoReconnect?: unknown;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultData(): StoredData {
  return {
    version: SCHEMA_VERSION,
    scenes: BUILT_IN_SCENES.map((scene) => ({ ...scene, data: structuredCloneSafe(scene.data) })),
    favorites: [],
    lastDevice: null,
    demo: false,
    autoReconnect: true,
    showDangerous: false,
  };
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

function sanitizeFavorites(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const m = /^#?([0-9a-fA-F]{6})$/.exec(item.trim());
    if (!m) continue;
    const hex = `#${m[1].toLowerCase()}`;
    if (!out.includes(hex)) out.push(hex);
  }
  return out.slice(0, MAX_FAVORITES);
}

export function sanitizeScenes(input: unknown): Scene[] {
  if (!Array.isArray(input)) return [];
  const out: Scene[] = [];
  const ids = new Set<string>();
  for (const item of input) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 60) : '';
    const data = sanitizeSceneData(item.data);
    if (!name || !data) continue;
    let id = typeof item.id === 'string' && item.id ? item.id : newId();
    if (ids.has(id)) id = newId();
    ids.add(id);
    out.push({ id, name, data });
  }
  return out;
}

function sanitizeLastDevice(input: unknown): LastDevice | null {
  if (!isRecord(input)) return null;
  const id = typeof input.id === 'string' ? input.id : null;
  const name = typeof input.name === 'string' ? input.name : null;
  return id || name ? { id, name } : null;
}

/** Migrates any stored shape to the current schema. Unknown input yields defaults. */
export function migrate(raw: unknown): StoredData {
  if (!isRecord(raw)) return defaultData();
  const base = defaultData();
  if (raw.version === 1) {
    const v1 = raw as unknown as StoredDataV1;
    return {
      ...base,
      scenes: v1.scenes === undefined ? base.scenes : sanitizeScenes(v1.scenes),
      favorites: sanitizeFavorites(v1.favoriteColors),
      lastDevice: typeof v1.lastDeviceName === 'string' ? { id: null, name: v1.lastDeviceName } : null,
      demo: v1.demoMode === true,
      autoReconnect: v1.autoReconnect !== false,
      showDangerous: false,
    };
  }
  if (raw.version === SCHEMA_VERSION) {
    return {
      version: SCHEMA_VERSION,
      scenes: Array.isArray(raw.scenes) ? sanitizeScenes(raw.scenes) : base.scenes,
      favorites: sanitizeFavorites(raw.favorites),
      lastDevice: sanitizeLastDevice(raw.lastDevice),
      demo: raw.demo === true,
      autoReconnect: raw.autoReconnect !== false,
      showDangerous: raw.showDangerous === true,
    };
  }
  // A newer (or unknown) schema: do not guess, start clean.
  return base;
}

export function loadData(storage: KeyValueStorage | null = browserStorage()): StoredData {
  if (!storage) return defaultData();
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (!text) return defaultData();
    return migrate(JSON.parse(text));
  } catch {
    return defaultData();
  }
}

/** Returns false when the data could not be written (the app keeps working in memory). */
export function saveData(data: StoredData, storage: KeyValueStorage | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearData(storage: KeyValueStorage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Fall through.
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Scene file export / import

export const SCENES_FILE_KIND = 'ambiente-f32-scenes';

export function exportScenes(scenes: Scene[]): string {
  return JSON.stringify({ app: SCENES_FILE_KIND, version: 1, exportedAt: new Date().toISOString(), scenes }, null, 2);
}

/** Parses an exported file (or a bare array of scenes). Returns the valid scenes with fresh ids. */
export function importScenes(text: string): Scene[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.scenes : undefined;
  return sanitizeScenes(list).map((scene) => ({ ...scene, id: newId() }));
}
