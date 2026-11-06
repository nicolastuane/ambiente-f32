/** Locks, factory-mode exits, the installation restore and the copy store (review fixes). */
import { afterEach, describe, expect, it } from 'vitest';
import { MockAdapter } from '../src/ble/mockAdapter';
import { BUILTIN_SNAPSHOT, cloneValues } from '../src/protocol/zycela/snapshot';
import type { Snapshot } from '../src/protocol/zycela/snapshot';
import {
  BACKUPS_KEY,
  BackupStore,
  DEMO_BACKUPS_KEY,
  FACTORY_OPEN_KEY,
  MAX_AUTO_BACKUPS,
  MAX_BACKUPS,
  acquireLock,
  changeDialGuarded,
  enterFactoryModeMarked,
  guardFactoryExit,
  installationChanges,
  lockHolder,
  restoreSnapshot,
  sendPaced,
  setFactoryMarkerStorage,
  takeSnapshot,
  unknownPositionChanges,
  withFactoryMode,
} from '../src/state/backup';
import { AppController } from '../src/state/controller';
import type { KeyValueStorage } from '../src/state/storage';
import { carLikeMockState, waitFor } from './helpers';

const controllers: AppController[] = [];
afterEach(() => {
  for (const c of controllers.splice(0)) c.dispose();
});

const FAST = { timeoutMs: 500, quietMs: 15, pacingMs: 1 };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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

async function connected(options: { latencyMs?: number; pacingMs?: number; carLike?: boolean } = {}) {
  const adapter = new MockAdapter({ latencyMs: options.latencyMs ?? 3, connectDelayMs: 2 });
  if (options.carLike !== false) Object.assign(adapter.device.state, carLikeMockState());
  const controller = new AppController(adapter, {
    toastMs: 0,
    session: { operationTimeoutMs: 600, backoffMs: [5, 5, 5, 5, 5] },
    driver: { scenePacingMs: options.pacingMs ?? 1 },
  });
  controllers.push(controller);
  await controller.connect();
  await waitFor(() => controller.session.status === 'ready', 3000, 'ready');
  await waitFor(() => controller.device.get().brightness.b1 !== null, 3000, 'state frame');
  return { adapter, controller, received: adapter.device.received };
}

/** True when every [20…] and installation command arrived between a [2101] and the next [2100]. */
function insideFactory(sent: readonly string[]): boolean {
  let open = false;
  for (const c of sent) {
    if (c === '[2101]') open = true;
    else if (c === '[2100]') open = false;
    else if (/^\[(20|1C|0F|13|1D|2C|2F|4[0389AB])/.test(c) && !open) return false;
  }
  return true;
}

describe('one factory-mode visit at a time', () => {
  it('a snapshot of the installation and a dial change never interleave their [2101]/[2100]', async () => {
    const { adapter, controller, received } = await connected({ latencyMs: 40 });
    const start = received.length;
    const snapshotting = takeSnapshot(controller, { factory: true, timeoutMs: 800, quietMs: 15 });
    // The dial change starts while the snapshot is reading the installation (reviewer's scenario).
    await waitFor(() => after(received, start).includes('[2101]'), 2000, 'snapshot in factory mode');
    const changing = changeDialGuarded(controller, { carBits: '01000010', featureBits: '00000001' }, { carBits: '01000010' }, 800);
    const [snap, dial] = await Promise.all([snapshotting, changing]);
    const sent = after(received, start);
    expect(insideFactory(sent)).toBe(true);
    expect(sent.filter((c) => c.startsWith('[21'))).toEqual(['[2101]', '[2100]', '[2101]', '[2100]']);
    expect(snap.missing).toEqual([]);
    expect(dial).toMatchObject({ verified: true, after: { featureBits: '00000001' } });
    expect(adapter.device.state).toMatchObject({ featureBits: '00000001', factoryMode: false });
  });

  it('waits while another holder (the Instalación page) is in factory mode', async () => {
    const { controller, received } = await connected();
    const release = await acquireLock(controller, 'factory', 'Instalación');
    expect(lockHolder(controller, 'factory')).toBe('Instalación');
    const start = received.length;
    const change = changeDialGuarded(controller, { carBits: '01000010', featureBits: '00000001' }, { carBits: '01000010' }, 500);
    await pause(60);
    expect(after(received, start)).toEqual([]);
    release();
    await expect(change).resolves.toMatchObject({ verified: true });
    expect(after(received, start)).toEqual(['[2101]', '[200100001000000001]', '[2100]']);
    expect(lockHolder(controller, 'factory')).toBeNull();
  });

  it('leaves a pause before [2101], before [20…] and around [2100]', async () => {
    const { adapter, controller } = await connected({ pacingMs: 40 });
    const times: { c: string; t: number }[] = [];
    const handle = adapter.device.handle.bind(adapter.device);
    adapter.device.handle = (c: string) => {
      times.push({ c, t: Date.now() });
      handle(c);
    };
    await changeDialGuarded(controller, { carBits: '01000010', featureBits: '00000001' }, { carBits: '01000010' }, 500);
    await sendPaced(controller, ['[3001]']);
    expect(times.map((x) => x.c)).toEqual(['[2101]', '[200100001000000001]', '[2100]', '[3001]']);
    for (let i = 1; i < times.length; i++) expect(times[i].t - times[i - 1].t).toBeGreaterThanOrEqual(30);
  });

  it('owes [2100] when the link drops in factory mode and sends it on reconnection', async () => {
    const { adapter, controller, received } = await connected();
    controller.setAutoReconnect(false);
    await withFactoryMode(
      controller,
      async () => {
        adapter.simulateDrop(0);
        await waitFor(() => controller.session.status !== 'ready', 1000, 'link down');
      },
      500,
    );
    expect(adapter.device.state.factoryMode).toBe(true);
    const start = received.length;
    await controller.connect();
    await waitFor(() => after(received, start).includes('[2100]'), 2000, 'owed [2100]');
    expect(adapter.device.state.factoryMode).toBe(false);
  });

  it('remembers factory mode across a reload and sends [2100] on the next connection', async () => {
    const storage = memoryStorage();
    setFactoryMarkerStorage(storage);
    try {
      const first = await connected();
      await enterFactoryModeMarked(first.controller);
      expect(storage.data[FACTORY_OPEN_KEY]).toBeTruthy();
      // The page dies here. A new page load (new controller) connects:
      const adapter = new MockAdapter({ latencyMs: 3, connectDelayMs: 2 });
      const controller = new AppController(adapter, { toastMs: 0, driver: { scenePacingMs: 1 } });
      controllers.push(controller);
      guardFactoryExit(controller);
      await controller.connect();
      await waitFor(() => adapter.device.received.includes('[2100]'), 2000, '[2100] after reload');
      await waitFor(() => !(FACTORY_OPEN_KEY in storage.data), 1000, 'marker cleared');
    } finally {
      setFactoryMarkerStorage(undefined);
    }
  });
});

describe('restoring the installation', () => {
  it('reads the module first and refuses another car code without changing anything', async () => {
    const { adapter, controller, received } = await connected();
    adapter.device.state.carBits = '01000011';
    const start = received.length;
    let saved = 0;
    await expect(
      restoreSnapshot(controller, BUILTIN_SNAPSHOT, { ...FAST, includeFactory: true, saveBefore: () => saved++ }),
    ).rejects.toMatchObject({ name: 'DialGuardError', reason: 'mismatch' });
    // Only the read: nothing was changed.
    expect(after(received, start)).toEqual(['[0A01]', '[2101]', '[2100]']);
    expect(saved).toBe(0);
    expect(adapter.device.state.carBits).toBe('01000011');
  });

  it('changes the car code only when confirmed separately, after handing over a copy of the module', async () => {
    const { adapter, controller, received } = await connected();
    adapter.device.state.carBits = '01000011';
    adapter.device.state.leds['1C'] = 30;
    const start = received.length;
    let before: Snapshot | null = null;
    let sentWhenSaved = -1;
    const report = await restoreSnapshot(controller, BUILTIN_SNAPSHOT, {
      ...FAST,
      includeFactory: true,
      allowCarCodeChange: true,
      saveBefore: (s) => {
        before = s;
        sentWhenSaved = received.length;
      },
    });
    expect(report.ok).toBe(true);
    expect(report.factorySent).toEqual(['[200100001000000000]', '[1C0050]']);
    expect(insideFactory(after(received, start))).toBe(true);
    const copy = before as Snapshot | null;
    expect(copy?.values.factory).toMatchObject({ carBits: '01000011', leds: expect.objectContaining({ driver: 30 }) });
    expect(copy?.auto).toBe(true);
    expect(received.slice(start, sentWhenSaved).some((c) => /^\[(20|1C)/.test(c))).toBe(false);
    expect(report.before?.id).toBe(copy?.id);
    expect(adapter.device.state).toMatchObject({ carBits: '01000010', factoryMode: false });
  });

  it('a settings-only restore also hands over a copy first', async () => {
    const { controller, received } = await connected({ carLike: false });
    const start = received.length;
    let before: Snapshot | null = null;
    const report = await restoreSnapshot(controller, BUILTIN_SNAPSHOT, { ...FAST, saveBefore: (s) => (before = s) });
    expect(report.ok).toBe(true);
    expect(after(received, start)[0]).toBe('[0A01]');
    expect((before as Snapshot | null)?.values.color).not.toBe(BUILTIN_SNAPSHOT.values.color);
  });

  it('lists what would change in the installation', () => {
    const module = cloneValues(BUILTIN_SNAPSHOT.values);
    module.factory.carBits = '01000011';
    module.factory.leds.driver = 30;
    expect(installationChanges(BUILTIN_SNAPSHOT.values, module).map((c) => `${c.field}: ${c.actual} → ${c.expected}`)).toEqual([
      'factory.dial: 01000011/00000000 → 01000010/00000000',
      'factory.leds.driver: 30 → 50',
    ]);
  });

  it('a backup or restore waits for the one in progress', async () => {
    const { controller, received } = await connected();
    const release = await acquireLock(controller, 'module', 'Pruebas del coche');
    const start = received.length;
    const snap = takeSnapshot(controller, FAST);
    await pause(50);
    expect(after(received, start)).toEqual([]);
    release();
    await expect(snap).resolves.toMatchObject({ missing: [] });
  });
});

describe('raw positions nobody decodes', () => {
  it('reports 4E 7–8 and 15–20 and 26 25–26 when they differ', () => {
    const before = { '4E': '[4E001801FF1000FF11010904010300090800]', '26': '[2601010000000101000504FF00FF]' };
    expect(unknownPositionChanges(before, before)).toEqual([]);
    const changed = {
      '4E': '[4E001800FF1000FF22010904010300090800]',
      '26': '[2601010000000101000504FF03FF]',
    };
    expect(unknownPositionChanges(before, changed)).toEqual([
      { label: '4E 7–8 (¿encendido?)', before: '01', after: '00' },
      { label: '4E 15–20 (¿color de la zona 2?)', before: 'FF1101', after: 'FF2201' },
      { label: '26 25–26 (¿color de puerta?)', before: '00', after: '03' },
    ]);
  });
});

describe('BackupStore kinds', () => {
  const snap = (n: number, auto = false): Snapshot => ({
    ...BUILTIN_SNAPSHOT,
    id: `${auto ? 'a' : 'u'}${n}`,
    label: `Copia ${n}`,
    source: 'module',
    ...(auto ? { auto } : {}),
  });

  it('automatic copies only push out other automatic copies', () => {
    const store = new BackupStore(memoryStorage());
    for (let i = 1; i <= 3; i++) store.add(snap(i));
    for (let i = 1; i <= 8; i++) store.add(snap(i, true));
    const ids = store.user().map((s) => s.id);
    expect(ids.filter((id) => id.startsWith('u'))).toEqual(['u3', 'u2', 'u1']);
    expect(ids.filter((id) => id.startsWith('a'))).toHaveLength(MAX_AUTO_BACKUPS);
    for (let i = 4; i <= 12; i++) store.add(snap(i));
    expect(store.user().filter((s) => !s.auto)).toHaveLength(MAX_BACKUPS);
    expect(store.user().filter((s) => s.auto)).toHaveLength(MAX_AUTO_BACKUPS);
  });

  it('keeps the demo module apart and marks its copies', async () => {
    const storage = memoryStorage();
    const real = new BackupStore(storage, BACKUPS_KEY);
    const demo = new BackupStore(storage, DEMO_BACKUPS_KEY);
    const { controller } = await connected();
    const { snapshot } = await takeSnapshot(controller, FAST);
    expect(snapshot.demo).toBe(true);
    demo.add(snapshot);
    expect(new BackupStore(storage, BACKUPS_KEY).user()).toEqual([]);
    expect(real.user()).toEqual([]);
    expect(new BackupStore(storage, DEMO_BACKUPS_KEY).user()[0]).toMatchObject({ demo: true });
  });
});
