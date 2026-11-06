import { describe, expect, it } from 'vitest';
import { sanitizeSceneData, sceneFromState, sceneToCommands } from '../src/protocol/zycela/scenes';
import { applyCommand, initialDeviceState } from '../src/protocol/zycela/state';
import { buildLabExport, parseConsoleInput } from '../src/state/lab';
import type { LogEntry } from '../src/state/lab';
import {
  SCHEMA_VERSION,
  STORAGE_KEY,
  defaultData,
  exportScenes,
  importScenes,
  loadData,
  migrate,
  saveData,
} from '../src/state/storage';
import type { KeyValueStorage } from '../src/state/storage';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const throwing: KeyValueStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('storage', () => {
  it('returns defaults (with the built-in scenes) when empty', () => {
    const data = loadData(memoryStorage());
    expect(data.version).toBe(SCHEMA_VERSION);
    expect(data.scenes.map((s) => s.name)).toContain('Naranja BMW');
    expect(data.autoReconnect).toBe(true);
    expect(data.demo).toBe(false);
    expect(data.showDangerous).toBe(false);
  });

  it('round-trips through the storage', () => {
    const storage = memoryStorage();
    const data = { ...defaultData(), favorites: ['#ff0000'], demo: true, lastDevice: { id: 'abc', name: 'ZYCL-FWD-1234' } };
    expect(saveData(data, storage)).toBe(true);
    expect(loadData(storage)).toEqual(data);
  });

  it('survives a storage that throws', () => {
    expect(loadData(throwing)).toEqual(defaultData());
    expect(saveData(defaultData(), throwing)).toBe(false);
    expect(loadData(null)).toEqual(defaultData());
  });

  it('ignores corrupt JSON and unknown future versions', () => {
    expect(loadData(memoryStorage({ [STORAGE_KEY]: '{not json' }))).toEqual(defaultData());
    expect(migrate({ version: 99, demo: true })).toEqual(defaultData());
    expect(migrate('hello')).toEqual(defaultData());
  });

  it('migrates version 1', () => {
    const migrated = migrate({
      version: 1,
      favoriteColors: ['FF0000', '#00ff00', 'nope', '#00FF00'],
      lastDeviceName: 'ZYCL-FWD-ABCD',
      demoMode: true,
      autoReconnect: false,
      scenes: [{ id: 'x', name: 'Rojo', data: { colors: { all: '#ff0000' } } }],
    });
    expect(migrated.version).toBe(2);
    expect(migrated.favorites).toEqual(['#ff0000', '#00ff00']);
    expect(migrated.lastDevice).toEqual({ id: null, name: 'ZYCL-FWD-ABCD' });
    expect(migrated.demo).toBe(true);
    expect(migrated.autoReconnect).toBe(false);
    expect(migrated.showDangerous).toBe(false);
    expect(migrated.scenes).toEqual([{ id: 'x', name: 'Rojo', data: { colors: { all: '#ff0000' } } }]);
  });

  it('drops invalid scenes', () => {
    const migrated = migrate({
      ...defaultData(),
      scenes: [
        { id: 'a', name: 'Bien', data: { rgbMode: 3 } },
        { id: 'b', name: 'Fuera de rango', data: { rgbMode: 99 } },
        { id: 'c', name: '', data: {} },
        { id: 'a', name: 'Id repetido', data: { power: 1 } },
      ],
    });
    expect(migrated.scenes.map((s) => s.name)).toEqual(['Bien', 'Id repetido']);
    expect(migrated.scenes[1].id).not.toBe('a');
  });

  it('exports and imports scenes', () => {
    const scenes = defaultData().scenes;
    const imported = importScenes(exportScenes(scenes));
    expect(imported.map((s) => s.name)).toEqual(scenes.map((s) => s.name));
    expect(imported[0].id).not.toBe(scenes[0].id);
    expect(importScenes('nope')).toEqual([]);
    expect(importScenes(JSON.stringify([{ name: 'Solo array', data: { power: 0 } }]))).toHaveLength(1);
  });
});

describe('scenes', () => {
  it('snapshots the device state and turns it back into commands', () => {
    let s = initialDeviceState();
    for (const c of ['[0701]', '[0400]', '[06ff6a00]', '[10112233]', '[3E05]', '[1E03]', '[2902]', '[0B04]', '[0C01]', '[020007]', '[010106]', '[010205]'])
      s = applyCommand(s, c);
    const data = sceneFromState(s);
    expect(sceneToCommands(data)).toEqual([
      '[0701]',
      '[0400]',
      '[3E05]',
      '[06ff6a00]',
      '[10112233]',
      '[1E03]',
      '[2902]',
      '[0B04]',
      '[0C01]',
      '[020007]',
      '[010106]',
      '[010205]',
    ]);
  });

  it('sanitizes untrusted scene data', () => {
    expect(sanitizeSceneData({ colors: { all: 'FF6A00' } })).toEqual({ colors: { all: '#ff6a00' } });
    expect(sanitizeSceneData({ colors: { all: 'orange' } })).toBeNull();
    expect(sanitizeSceneData({ brightness: { b1: 12 } })).toBeNull();
    expect(sanitizeSceneData(null)).toBeNull();
  });
});

describe('lab', () => {
  it('parses console input like the original debug page', () => {
    expect(parseConsoleInput('0A01', 'command')).toMatchObject({ ok: true, text: '[0A01]' });
    expect(parseConsoleInput(' [0701] ', 'command')).toMatchObject({ ok: true, text: '[0701]' });
    expect(parseConsoleInput('0A0', 'command').ok).toBe(false);
    expect(parseConsoleInput('0A 01', 'command').ok).toBe(false);
    expect(parseConsoleInput('[0A01', 'command').ok).toBe(false);
    expect(parseConsoleInput('', 'command').ok).toBe(false);
    const bytes = parseConsoleInput('5B 30 41 30 31 5D', 'bytes');
    expect(bytes.ok && Array.from(bytes.bytes)).toEqual([0x5b, 0x30, 0x41, 0x30, 0x31, 0x5d]);
    expect(parseConsoleInput('5B 3', 'bytes').ok).toBe(false);
  });

  it('builds the shared lab export JSON', () => {
    const log: LogEntry[] = [
      { id: 1, t: '2026-11-06T10:00:00.000Z', kind: 'tx', char: '0000FFE2-0000-1000-8000-00805F9B34FB', hex: '5B 30 41 30 31 5D', text: '[0A01]', withResponse: true, meanings: ['Pedir estado'] },
      { id: 2, t: '2026-11-06T10:00:00.050Z', kind: 'rx', char: '0000ffe1-0000-1000-8000-00805f9b34fb', hex: '5B 32 45 30 31 5D', text: '[2E01]' },
      { id: 3, t: '2026-11-06T10:00:01.000Z', kind: 'marker', note: 'abro la puerta' },
    ];
    const out = buildLabExport(log, { id: 'id1', name: 'ZYCL-FWD' }, [
      { service: '0000ffe0-0000-1000-8000-00805f9b34fb', characteristics: [{ uuid: '0000ffe1-0000-1000-8000-00805f9b34fb', properties: ['notify'] }] },
    ]);
    expect(out.app).toBe('ambiente-f32-lab');
    expect(out.version).toBe(1);
    expect(out.device).toEqual({ id: 'id1', name: 'ZYCL-FWD' });
    expect(out.gatt[0].characteristics[0].properties).toEqual(['notify']);
    expect(out.events[0]).toEqual({
      t: '2026-11-06T10:00:00.000Z',
      kind: 'tx',
      char: '0000ffe2-0000-1000-8000-00805f9b34fb',
      hex: '5B 30 41 30 31 5D',
      withResponse: true,
      note: '[0A01] | Pedir estado',
    });
    expect(out.events[2]).toEqual({ t: '2026-11-06T10:00:01.000Z', kind: 'marker', note: 'abro la puerta' });
  });
});
