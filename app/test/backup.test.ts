import { afterEach, describe, expect, it } from 'vitest';
import { NotConnectedError, ZYCELA_NOTIFY_CHAR, ZYCELA_WRITE_CHAR } from '../src/ble/adapter';
import { MockAdapter } from '../src/ble/mockAdapter';
import { BUILTIN_SNAPSHOT, BUILTIN_SNAPSHOT_ID, cloneValues } from '../src/protocol/zycela/snapshot';
import type { Snapshot } from '../src/protocol/zycela/snapshot';
import {
  BACKUPS_KEY,
  BackupStore,
  DialGuardError,
  MAX_BACKUPS,
  UnsafeCommandError,
  assertSafeCommand,
  changeDialGuarded,
  exportSnapshot,
  restoreSnapshot,
  sendPaced,
  takeSnapshot,
} from '../src/state/backup';
import { AppController } from '../src/state/controller';
import type { KeyValueStorage } from '../src/state/storage';
import { carLikeMockState, waitFor } from './helpers';

const controllers: AppController[] = [];
afterEach(() => {
  for (const c of controllers.splice(0)) c.dispose();
});

const FAST = { timeoutMs: 500, quietMs: 15, pacingMs: 1 };

async function connected(carLike = true) {
  const adapter = new MockAdapter({ latencyMs: 3, connectDelayMs: 2 });
  if (carLike) Object.assign(adapter.device.state, carLikeMockState());
  const controller = new AppController(adapter, {
    toastMs: 0,
    session: { operationTimeoutMs: 300, backoffMs: [5, 5, 5, 5, 5] },
    driver: { scenePacingMs: 1 },
  });
  controllers.push(controller);
  await controller.connect();
  await waitFor(() => controller.session.status === 'ready', 3000, 'ready');
  await waitFor(() => controller.device.get().brightness.b1 !== null, 3000, 'state frame');
  return { adapter, controller, received: adapter.device.received };
}

const after = (list: string[], from: number) => list.slice(from);

function memoryStorage(): KeyValueStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

describe('takeSnapshot', () => {
  it('collects 4E, 26, 27, 13 and, with the installation, 23, 25, 4F with [2100] at the end', async () => {
    const { controller, received } = await connected();
    const start = received.length;
    const { snapshot, missing } = await takeSnapshot(controller, { factory: true, ...FAST, label: 'Prueba' });
    expect(missing).toEqual([]);
    expect(Object.keys(snapshot.frames).sort()).toEqual(['13', '23', '25', '26', '27', '4E', '4F']);
    expect(after(received, start)).toEqual(['[0A01]', '[2101]', '[2100]']);
    expect(snapshot).toMatchObject({ label: 'Prueba', source: 'module', firmware: 'V3.1-DEMO' });
    // The demo module set up like the user's car reads back as the built-in values.
    expect(snapshot.values).toEqual(BUILTIN_SNAPSHOT.values);
  });

  it('without the installation stays out of factory mode', async () => {
    const { controller, received } = await connected();
    const start = received.length;
    const { snapshot } = await takeSnapshot(controller, FAST);
    expect(after(received, start)).toEqual(['[0A01]']);
    expect(snapshot.values.factory.carBits).toBeNull();
  });

  it('needs the link', async () => {
    const controller = new AppController(new MockAdapter(), { toastMs: 0 });
    controllers.push(controller);
    await expect(takeSnapshot(controller, FAST)).rejects.toBeInstanceOf(NotConnectedError);
  });
});

describe('restoreSnapshot', () => {
  it('sends the restore list with pacing and verifies it with [0A01]', async () => {
    const { adapter, controller, received } = await connected(false); // demo defaults: different from the car
    const start = received.length;
    const report = await restoreSnapshot(controller, BUILTIN_SNAPSHOT, FAST);
    expect(report.sent[0]).toBe('[2B00]');
    expect(report.sent).toContain('[06ff1000]');
    expect(report.factorySent).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checks.length).toBeGreaterThan(20);
    expect(report.checks.every((c) => c.status === 'match')).toBe(true);
    // Unsupported values are not checked against what the demo module happens to have.
    expect(report.checks.some((c) => c.field === 'soundSource')).toBe(false);
    const sent = after(received, start);
    expect(sent.filter((c) => c !== '[0A01]')).toEqual(report.sent);
    expect(sent.some((c) => /^\[(2[01]|4[0-3]|1C|0F|1D)/.test(c))).toBe(false);
    expect(adapter.device.state).toMatchObject({ color: 'ff1000', effect: 24, nightHalf: 1, welcomeMode: 5, welcomeColor: 4 });
  });

  it('reports what still differs after the restore', async () => {
    const { adapter, controller } = await connected();
    // A module that ignores the night-half command.
    const handle = adapter.device.handle.bind(adapter.device);
    adapter.device.handle = (command: string) => (command.startsWith('[1A') ? undefined : handle(command));
    adapter.device.state.nightHalf = 0;
    const report = await restoreSnapshot(controller, BUILTIN_SNAPSHOT, { ...FAST, onlyDifferent: true });
    expect(report.sent).toEqual(['[1A01]']);
    expect(report.ok).toBe(false);
    expect(report.checks.filter((c) => c.status !== 'match')).toEqual([
      expect.objectContaining({ field: 'nightHalf', expected: 'sí', actual: 'no', status: 'differs' }),
    ]);
  });

  it('restores only the installation values that differ, inside [2101]…[2100], dial first and read back', async () => {
    const { adapter, controller, received } = await connected();
    adapter.device.state.featureBits = '00000001';
    adapter.device.state.leds['1C'] = 60;
    const start = received.length;
    const report = await restoreSnapshot(controller, BUILTIN_SNAPSHOT, { ...FAST, includeFactory: true, onlyDifferent: true });
    expect(report.factorySent).toEqual(['[200100001000000000]', '[1C0050]']);
    expect(report.dial).toMatchObject({ changed: true, verified: true, before: { featureBits: '00000001' } });
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.field === 'factory.leds.driver')?.status).toBe('match');
    const sent = after(received, start);
    const enter = sent.indexOf('[2101]');
    const exit = sent.lastIndexOf('[2100]');
    expect(enter).toBeGreaterThanOrEqual(0);
    expect(sent.indexOf('[200100001000000000]')).toBeGreaterThan(enter);
    expect(sent.indexOf('[1C0050]')).toBeGreaterThan(sent.indexOf('[200100001000000000]'));
    expect(exit).toBeGreaterThan(sent.indexOf('[1C0050]'));
    expect(adapter.device.state).toMatchObject({ featureBits: '00000000', factoryMode: false });
    expect(adapter.device.state.leds['1C']).toBe(50);
  });
});

describe('guarded dial change', () => {
  it('[2101] → 23 → [20…] → 23 read back → [2100]', async () => {
    const { adapter, controller, received } = await connected();
    const start = received.length;
    const result = await changeDialGuarded(controller, { carBits: '01000010', featureBits: '00000001' }, { carBits: '01000010' }, 500);
    expect(result).toMatchObject({ changed: true, verified: true, command: '[200100001000000001]' });
    expect(after(received, start)).toEqual(['[2101]', '[200100001000000001]', '[2100]']);
    expect(adapter.device.state.featureBits).toBe('00000001');
  });

  it('asks again with [2101] when the module does not volunteer frame 23', async () => {
    const { adapter, controller, received } = await connected();
    const handle = adapter.device.handle.bind(adapter.device);
    // Apply [20…] silently, like a module that only answers [2101].
    adapter.device.handle = (command: string) => {
      if (!command.startsWith('[20')) return handle(command);
      adapter.device.received.push(command);
      adapter.device.state.featureBits = command.slice(11, 19);
    };
    const start = received.length;
    const result = await changeDialGuarded(controller, { carBits: '01000010', featureBits: '00000001' }, {}, 150);
    expect(result.verified).toBe(true);
    expect(after(received, start)).toEqual(['[2101]', '[200100001000000001]', '[2101]', '[2100]']);
  });

  it('refuses when the car bits differ from the copy, and still leaves factory mode', async () => {
    const { adapter, controller, received } = await connected();
    adapter.device.state.carBits = '01000011';
    const start = received.length;
    await expect(
      changeDialGuarded(controller, { carBits: '01000010', featureBits: '00000001' }, { carBits: '01000010' }, 500),
    ).rejects.toBeInstanceOf(DialGuardError);
    expect(after(received, start)).toEqual(['[2101]', '[2100]']);
    expect(adapter.device.state.featureBits).toBe('00000000');
  });

  it('refuses when frame 23 never arrives', async () => {
    const { adapter, controller, received } = await connected();
    const handle = adapter.device.handle.bind(adapter.device);
    adapter.device.handle = (command: string) => (command === '[2101]' ? adapter.device.received.push(command) && undefined : handle(command));
    const start = received.length;
    await expect(changeDialGuarded(controller, { carBits: '01000010', featureBits: '00000001' }, {}, 80)).rejects.toThrow(
      /trama 23/,
    );
    expect(after(received, start)).toEqual(['[2101]', '[2100]']);
  });
});

describe('command safety', () => {
  it('blocks [41]/[42] always, installation codes outside factory mode, and [21] from callers', () => {
    expect(() => assertSafeCommand('[4200]', { inFactory: true })).toThrow(UnsafeCommandError);
    expect(() => assertSafeCommand('[4100]', { inFactory: true })).toThrow(UnsafeCommandError);
    expect(() => assertSafeCommand('[1C0050]', { inFactory: false })).toThrow(UnsafeCommandError);
    expect(() => assertSafeCommand('[200100001000000000]', { inFactory: false })).toThrow(UnsafeCommandError);
    expect(() => assertSafeCommand('[2101]', { inFactory: false })).toThrow(UnsafeCommandError);
    expect(() => assertSafeCommand('[0A01][4200]', { inFactory: false })).toThrow(UnsafeCommandError);
    expect(() => assertSafeCommand('[1C0050]', { inFactory: true })).not.toThrow();
    expect(() => assertSafeCommand('[06ff1000]', { inFactory: false })).not.toThrow();
  });

  it('sendPaced checks the whole list before sending anything', async () => {
    const { controller, received } = await connected();
    const start = received.length;
    await expect(sendPaced(controller, ['[3101]', '[4200]'], { pacingMs: 0 })).rejects.toBeInstanceOf(UnsafeCommandError);
    expect(after(received, start)).toEqual([]);
  });
});

describe('BackupStore', () => {
  const snap = (n: number): Snapshot => ({ ...BUILTIN_SNAPSHOT, id: `s${n}`, label: `Copia ${n}`, source: 'module' });

  it('always lists the built-in copy last and never deletes it', () => {
    const store = new BackupStore(memoryStorage());
    expect(store.snapshots.get().map((s) => s.id)).toEqual([BUILTIN_SNAPSHOT_ID]);
    expect(store.remove(BUILTIN_SNAPSHOT_ID)).toBe(false);
    expect(store.snapshots.get()).toHaveLength(1);
  });

  it(`keeps at most ${MAX_BACKUPS} copies, newest first, and survives a reload`, () => {
    const storage = memoryStorage();
    const store = new BackupStore(storage);
    for (let i = 1; i <= 12; i++) store.add(snap(i));
    const ids = store.snapshots.get().map((s) => s.id);
    expect(ids).toHaveLength(MAX_BACKUPS + 1);
    expect(ids[0]).toBe('s12');
    expect(ids[MAX_BACKUPS]).toBe(BUILTIN_SNAPSHOT_ID);
    expect(ids).not.toContain('s1');
    expect(JSON.parse(storage.data[BACKUPS_KEY]).snapshots).toHaveLength(MAX_BACKUPS);
    expect(new BackupStore(storage).snapshots.get().map((s) => s.id)).toEqual(ids);
    expect(store.remove('s12')).toBe(true);
    expect(new BackupStore(storage).snapshots.get()[0].id).toBe('s11');
  });

  it('imports pasted JSON after validating it', () => {
    const store = new BackupStore(memoryStorage());
    const values = cloneValues(BUILTIN_SNAPSHOT.values);
    values.color = '#00ff00';
    const ok = store.importText(exportSnapshot({ ...BUILTIN_SNAPSHOT, label: 'Del otro móvil', values }));
    expect(ok.ok).toBe(true);
    expect(store.snapshots.get()[0]).toMatchObject({ label: 'Del otro móvil', source: 'import' });
    expect(store.snapshots.get()[0].id).not.toBe(BUILTIN_SNAPSHOT_ID);
    expect(store.importText('{nope')).toEqual({ ok: false, error: 'El texto no es JSON válido.' });
    expect(store.importText(JSON.stringify({ values: { brightness: { b1: 40 } } })).ok).toBe(false);
    expect(store.snapshots.get()).toHaveLength(2);
  });

  it('never throws when the storage does', () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    const store = new BackupStore(throwing);
    expect(() => store.add(snap(1))).not.toThrow();
    expect(store.saveFailed).toBe(true);
    expect(store.snapshots.get()).toHaveLength(2);
  });
});

describe('FFE2 listening', () => {
  it('logs FFE2 packets with their characteristic but never parses them', async () => {
    const { adapter, controller } = await connected();
    expect(adapter.listeningOnWriteChar).toBe(false);
    await controller.session.startSecondaryNotifications('lab');
    expect(controller.session.state.get().ffe2).toBe('on');
    expect(adapter.listeningOnWriteChar).toBe(true);

    const before = controller.device.get();
    let parsed = 0;
    const off = controller.onFrame(() => parsed++);
    // A perfectly valid state frame with another colour: it must not reach the state.
    expect(adapter.emitOnWriteChar('[4E00180100ff00FF11010904010300090800]')).toBe(true);
    await waitFor(() => controller.log.get().some((e) => e.kind === 'rx' && e.char === ZYCELA_WRITE_CHAR), 1000, 'ffe2 rx');
    off();
    const entry = controller.log.get().find((e) => e.kind === 'rx' && e.char === ZYCELA_WRITE_CHAR);
    expect(entry).toMatchObject({ text: '[4E00180100ff00FF11010904010300090800]', meanings: [] });
    expect(parsed).toBe(0);
    expect(controller.device.get().color).toBe(before.color);
    // FFE1 still works and is labelled as such.
    controller.run((d) => d.requestState());
    await waitFor(() => controller.log.get().some((e) => e.kind === 'rx' && e.char === ZYCELA_NOTIFY_CHAR && (e.meanings?.length ?? 0) > 0), 1000, 'ffe1');
  });

  it('is re-applied after a reconnection and stops when the last owner stops', async () => {
    const { adapter, controller } = await connected();
    await controller.session.startSecondaryNotifications('lab');
    await controller.session.startSecondaryNotifications('carTests');
    adapter.simulateDrop(20);
    await waitFor(() => controller.session.status === 'reconnecting', 1000, 'reconnecting');
    expect(controller.session.state.get().ffe2).toBe('pending');
    await waitFor(() => controller.session.status === 'ready', 3000, 'ready again');
    await waitFor(() => adapter.listeningOnWriteChar, 1000, 'ffe2 again');
    expect(controller.session.state.get().ffe2).toBe('on');
    await controller.session.stopSecondaryNotifications('lab');
    expect(adapter.listeningOnWriteChar).toBe(true); // the car tests still want it
    await controller.session.stopSecondaryNotifications('carTests');
    expect(adapter.listeningOnWriteChar).toBe(false);
    expect(controller.session.state.get().ffe2).toBe('off');
    // FFE1 is untouched.
    const start = controller.device.get().lastFrameAt ?? 0;
    controller.run((d) => d.requestState());
    await waitFor(() => (controller.device.get().lastFrameAt ?? 0) > start, 1000, 'ffe1 frames');
  });
});
