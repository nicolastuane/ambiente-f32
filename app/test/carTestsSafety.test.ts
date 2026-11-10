/** Car tests: review fixes (offers, late answers, pending restores, evidence, resume after reload, locks). */
import { afterEach, describe, expect, it } from 'vitest';
import { ZYCELA_WRITE_CHAR } from '../src/ble/adapter';
import { MockAdapter } from '../src/ble/mockAdapter';
import { acquireLock } from '../src/state/backup';
import { BackupStore } from '../src/state/backup';
import { CAR_TESTS, CAR_TESTS_ROUND1, CarTestsRunner, carTestsReport, minimalCarTests } from '../src/state/carTests';
import type { CarTestsDeps, CarTestsState } from '../src/state/carTests';
import { AppController } from '../src/state/controller';
import type { KeyValueStorage } from '../src/state/storage';
import { carLikeMockState, waitFor } from './helpers';

const controllers: AppController[] = [];
const runners: CarTestsRunner[] = [];
afterEach(() => {
  for (const r of runners.splice(0)) r.dispose();
  for (const c of controllers.splice(0)) c.dispose();
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const since = (list: string[], from: number) => list.slice(from);

function memoryStorage(): KeyValueStorage {
  const data: Record<string, string> = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

function memoryPersist() {
  let saved: unknown = null;
  return { load: () => saved, save: (s: CarTestsState) => (saved = JSON.parse(JSON.stringify(s))) };
}

async function connected() {
  const adapter = new MockAdapter({ latencyMs: 3, connectDelayMs: 2 });
  Object.assign(adapter.device.state, carLikeMockState());
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

function newRunner(controller: AppController, extra: Partial<CarTestsDeps> = {}) {
  const runner = new CarTestsRunner({
    controller,
    backups: new BackupStore(memoryStorage()),
    pacingMs: 1,
    timeoutMs: 400,
    quietMs: 15,
    minTapMs: 0,
    // These tests cover the first round; the second has its own file.
    tests: CAR_TESTS_ROUND1,
    ...extra,
  });
  runners.push(runner);
  return runner;
}

async function started(extra: Partial<CarTestsDeps> = {}) {
  const env = await connected();
  const runner = newRunner(env.controller, extra);
  await runner.start();
  return { ...env, runner };
}

async function goTo(runner: CarTestsRunner, id: string) {
  for (let i = 0; i < CAR_TESTS.length && runner.state.get().cursor?.testId !== id; i++) await runner.skipTest();
  expect(runner.state.get().cursor).toMatchObject({ testId: id, stageId: null });
}

const record = (runner: CarTestsRunner, id: string) => runner.state.get().records[id];

async function dropLink(adapter: MockAdapter, controller: AppController) {
  controller.setAutoReconnect(false);
  adapter.simulateDrop(0);
  await waitFor(() => controller.session.status !== 'ready', 1000, 'link down');
}

/** Lets the runner's queued operations (onReady…) run. */
async function settle(runner: CarTestsRunner) {
  await pause(20);
  await runner.redoTest('none'); // queued behind them; does nothing
}

describe('which tests are offered, and what can be kept', () => {
  it('interruptor 8 comes first and is offered in order; the welcome test no longer leads to it', async () => {
    const { runner } = await started();
    expect(runner.state.get().cursor).toMatchObject({ testId: 'feature8', stageId: null });
    await goTo(runner, 'welcome');
    await runner.beginTest();
    await runner.answer('now');
    runner.skipCountdown();
    await runner.answer('no');
    runner.skipCountdown();
    await runner.answer('no');
    expect(record(runner, 'welcome').status).toBe('done');
    expect(record(runner, 'welcome').conclusions).toContain('Con el módulo despierto la bienvenida no aparece. Queda la prueba tras dormir el coche.');
    expect(record(runner, 'feature8').status).toBe('skipped');
    expect(runner.state.get().cursor).toMatchObject({ testId: 'sleep', stageId: null });
  });

  it('keeping the welcome keeps its mode and restores the door warning', async () => {
    const { adapter, runner } = await started();
    await goTo(runner, 'welcome');
    await runner.beginTest();
    await runner.answer('now');
    runner.skipCountdown();
    await runner.answer('unlock');
    expect(record(runner, 'welcome')).toMatchObject({ status: 'deciding', offers: ['keepWelcome', 'keepWelcomeWhite'] });
    await runner.decide(['keepWelcome']);
    expect(runner.state.get().target).toMatchObject({ welcomeMode: 0, welcomeColor: 4, welcomeEnabled: true });
    expect(adapter.device.state).toMatchObject({ welcomeMode: 0, welcomeColor: 4, events: expect.objectContaining({ '31': 1 }) });
    expect(record(runner, 'welcome').restore?.ok).toBe(true);
    expect(runner.state.get().cursor).toMatchObject({ testId: 'sleep' });
  });

  it('a radar that stopped working is reported; keeping interruptor 8 stays a choice, never the default', async () => {
    const { adapter, runner } = await started();
    await runner.beginTest({ acknowledged: true });
    for (const id of ['yes', 'no', 'no', 'no']) await runner.answer(id); // door works, radar stopped
    runner.skipCountdown();
    await runner.answer('no');
    runner.skipCountdown();
    await runner.answer('no');
    const r = record(runner, 'feature8');
    expect(r).toMatchObject({ status: 'deciding', offers: ['keepFeature8'] });
    expect(r.conclusions).toContain('Con el interruptor 8 el radar dejó de verse en las tiras: tenlo en cuenta antes de dejarlo encendido.');
    expect(r.conclusions).not.toContain('Con el interruptor 8 encendido no cambió nada: no hace falta dejarlo así.');
    await runner.decide([]); // «No, dejarlo como estaba»
    expect(adapter.device.state.featureBits).toBe('00000000');
    expect(record(runner, 'feature8').kept).toEqual([]);
  });

  it('«Restaurar todo ahora» goes back to the copy itself, undoing what was kept', async () => {
    const { adapter, runner } = await started();
    await goTo(runner, 'dimming');
    await runner.beginTest();
    await runner.answer('dash');
    await runner.answer('no');
    await runner.decide(['keepNightHalfOff']);
    expect(adapter.device.state.nightHalf).toBe(0);
    await runner.restoreAll();
    expect(runner.state.get().target?.nightHalf).toBe(true);
    expect(adapter.device.state.nightHalf).toBe(1);
    expect(record(runner, 'dimming')).toMatchObject({ kept: [], keptChanges: {} });
  });

  it('a repeated test answered «No, dejarlo como estaba» reverts what an earlier run kept', async () => {
    const { adapter, runner } = await started();
    await goTo(runner, 'dimming');
    await runner.beginTest();
    await runner.answer('dash');
    await runner.answer('no');
    await runner.decide(['keepNightHalfOff']);
    await runner.redoTest('dimming');
    expect(runner.state.get().target?.nightHalf).toBe(false); // still kept until decided again
    await runner.beginTest();
    await runner.answer('dash');
    await runner.answer('no');
    await runner.decide([]);
    expect(runner.state.get().target?.nightHalf).toBe(true);
    expect(adapter.device.state.nightHalf).toBe(1);
  });
});

describe('a deferred test answered days later', () => {
  it('only puts back its own settings that still have the test value, and says the evidence is late', async () => {
    const { adapter, runner, received } = await started();
    await goTo(runner, 'sleep');
    await runner.beginTest();
    await runner.finish();
    // Days later the user changed colour, brightness and the welcome colour by hand.
    adapter.device.state.color = '00ff00';
    adapter.device.state.b1 = 5;
    adapter.device.state.welcomeColor = 2;
    const mark = received.length;
    await runner.answer('yes');
    const st = record(runner, 'sleep').stages[0];
    expect(st.evidence).toBe('late');
    expect(st.unsolicited).toEqual([]);
    expect(st.changes.map((c) => c.field).sort()).toEqual(['events.door', 'welcomeColor', 'welcomeMode']);
    await runner.decide([]);
    const sent = since(received, mark).filter((c) => c !== '[0A01]');
    expect(sent.sort()).toEqual(['[3101]', '[3905]']);
    expect(adapter.device.state).toMatchObject({ color: '00ff00', b1: 5, welcomeColor: 2, welcomeMode: 5 });
    expect(record(runner, 'sleep').restore?.notes.join(' ')).toMatch(/Color de bienvenida: se cambió después de la prueba/);
    const report = carTestsReport(runner.state.get(), CAR_TESTS_ROUND1);
    expect(report).toContain('Contestada después de «Terminar»: no se escucharon notificaciones');
  });
});

describe('pending restores', () => {
  it('a different car code leaves the model codes alone (once) instead of retrying forever', async () => {
    const { adapter, controller, runner, received } = await started();
    await goTo(runner, 'sleep');
    await runner.redoTest('feature8');
    await runner.beginTest({ acknowledged: true });
    expect(adapter.device.state.featureBits).toBe('00000001');
    await dropLink(adapter, controller);
    await runner.finish();
    expect(runner.state.get().pendingRestore).toMatchObject({ dial: true, debugOff: true });
    adapter.device.state.carBits = '01000011'; // recoded elsewhere meanwhile
    const mark = received.length;
    await controller.connect();
    await waitFor(() => runner.state.get().pendingRestore === null, 3000, 'pending settled');
    expect(since(received, mark).some((c) => c.startsWith('[20'))).toBe(false);
    expect(adapter.device.state).toMatchObject({ welcomeMode: 5, welcomeColor: 4, events: expect.objectContaining({ '31': 1 }) });
    const restore = record(runner, 'feature8').restore;
    expect(restore).toMatchObject({ pending: false, ok: false });
    expect(restore?.notes.join(' ')).toMatch(/Códigos de modelo sin tocar: El código de coche del módulo \(01000011\)/);
  });

  it('stops retrying by itself after a few failures, and can be discarded', async () => {
    const { adapter, controller, runner } = await started();
    await goTo(runner, 'turn');
    await runner.beginTest();
    const handle = adapter.device.handle.bind(adapter.device);
    adapter.device.handle = (c: string) => {
      if (c === '[0A01]') adapter.device.received.push(c); // the module stops answering
      else handle(c);
    };
    await runner.answer('no');
    expect(runner.state.get().pendingRestore).toMatchObject({ attempts: 1, lastError: 'No se pudo leer el estado del módulo.' });
    await runner.restorePending();
    await runner.restorePending();
    expect(runner.state.get().pendingRestore?.attempts).toBe(3);
    // A reconnection does not try again on its own.
    adapter.simulateDrop(10);
    await waitFor(() => controller.session.status !== 'ready', 1000, 'down');
    await waitFor(() => controller.session.status === 'ready', 3000, 'up');
    await settle(runner);
    await pause(150);
    expect(runner.state.get().pendingRestore?.attempts).toBe(3);
    await runner.discardPending();
    const s = runner.state.get();
    expect(s.pendingRestore).toBeNull();
    expect(s.unreadableDirty).toEqual([]);
    expect(s.records.turn.restore?.notes).toEqual(['Restauración descartada: no se comprobó.']);
  });

  it('«Terminar» records the restore before waiting for FFE2 to stop', async () => {
    const persist = memoryPersist();
    const { controller, runner } = await started({ persist });
    await goTo(runner, 'hcStrips');
    await runner.beginTest();
    const stop = controller.session.stopSecondaryNotifications.bind(controller.session);
    let duringStop: CarTestsState | null = null;
    controller.session.stopSecondaryNotifications = async (owner?: string) => {
      duringStop = persist.load() as CarTestsState;
      await pause(30);
      return stop(owner);
    };
    await runner.finish();
    expect(duringStop).toMatchObject({ phase: 'finishing', pendingRestore: { reasons: expect.arrayContaining(['finish', 'hcStrips']), debugOff: true, sweep: true } });
  });

  it('a reload with only the minimal state (storage full) still restores', async () => {
    const persist = memoryPersist();
    const { adapter, controller, runner } = await started({ persist });
    await goTo(runner, 'hcStrips');
    await runner.beginTest();
    await dropLink(adapter, controller);
    await runner.finish();
    runner.dispose();
    persist.save(minimalCarTests(persist.load() as CarTestsState));
    const reloaded = newRunner(controller, { persist });
    expect(reloaded.state.get()).toMatchObject({ phase: 'finished', pendingRestore: expect.objectContaining({ sweep: true }) });
    await controller.connect();
    await waitFor(() => reloaded.state.get().pendingRestore === null, 3000, 'restored after reload');
    expect(adapter.device.state.effect).toBe(24);
  });
});

describe('evidence', () => {
  it('records positions nobody decodes that changed, and the restore is not verified', async () => {
    const { adapter, runner } = await started();
    const dev = adapter.device as unknown as { stateFrames: () => string[] };
    const original = dev.stateFrames.bind(adapter.device);
    let zone = false;
    dev.stateFrames = () => original().map((f) => (zone && f.startsWith('[4E') ? `${f.slice(0, 15)}FF2202${f.slice(21)}` : f));
    await goTo(runner, 'radio');
    await runner.beginTest(); // radio
    zone = true; // favourite 5 changed something stored only there
    await runner.answer('no');
    const r = record(runner, 'radio');
    expect(r.stages[0].unknownChanges).toEqual([{ label: '4E 15–20 (¿color de la zona 2?)', before: '000000', after: 'FF2202' }]);
    expect(r.restore).toMatchObject({ pending: false, ok: false });
    expect(r.restore?.notes.join(' ')).toMatch(/Posiciones desconocidas distintas de la copia/);
    expect(carTestsReport(runner.state.get(), CAR_TESTS_ROUND1)).toContain('Posiciones desconocidas cambiadas: 4E 15–20 (¿color de la zona 2?) 000000 → FF2202');
  });

  it('says which frames did not arrive instead of «ninguno»', async () => {
    const { adapter, runner } = await started();
    const dev = adapter.device as unknown as { stateFrames: () => string[] };
    const original = dev.stateFrames.bind(adapter.device);
    await goTo(runner, 'radio');
    await runner.beginTest();
    dev.stateFrames = () => original().filter((f) => !f.startsWith('[26'));
    await runner.answer('no');
    const st = record(runner, 'radio').stages[0];
    expect(st).toMatchObject({ stateUnknown: false, stateMissing: ['26'] });
    expect(carTestsReport(runner.state.get(), CAR_TESTS_ROUND1)).toContain('No llegaron las tramas 26: sus ajustes no se compararon');
  });

  it('counts link drops during the stage and does not claim «ninguna» for FFE2 when it was refused', async () => {
    const { adapter, controller } = await connected();
    const original = adapter.startNotifications.bind(adapter);
    adapter.startNotifications = async (...args: Parameters<typeof original>) => {
      if (args[2] === ZYCELA_WRITE_CHAR) throw new Error('NotSupportedError');
      return original(...args);
    };
    const runner = newRunner(controller);
    await runner.start();
    expect(controller.session.state.get().ffe2).toBe('failed');
    await goTo(runner, 'turn');
    await runner.beginTest();
    adapter.simulateDrop(10);
    await waitFor(() => controller.session.status !== 'ready', 1000, 'down');
    await waitFor(() => controller.session.status === 'ready', 3000, 'up');
    await runner.answer('yes');
    const st = record(runner, 'turn').stages[0];
    expect(st).toMatchObject({ linkDrops: 1, linkDown: false, ffe2: 'failed', evidence: 'live' });
    const report = carTestsReport(runner.state.get(), CAR_TESTS_ROUND1);
    expect(report).toContain('La conexión se cortó 1 vez durante la prueba');
    expect(report).toContain('FFE2 no se estaba escuchando (failed): solo se escuchó FFE1.');
    expect(report).not.toContain('ninguna (FFE1 ni FFE2)');
  });
});

describe('nothing happens on its own while nobody is looking', () => {
  it('after a reload: no debug and no preparation on reconnection until the page is open', async () => {
    const persist = memoryPersist();
    const { adapter, controller, runner, received } = await started({ persist });
    await goTo(runner, 'turn');
    await runner.beginTest();
    runner.dispose();
    await controller.session.stopSecondaryNotifications('carTests');
    await controller.stopDebugFor('carTests');
    // Bluefy died before the preparation went out.
    const saved = persist.load() as CarTestsState;
    persist.save({ ...saved, cursor: saved.cursor ? { ...saved.cursor, prepared: false } : null });
    adapter.device.state.events['34'] = 0;
    await dropLink(adapter, controller);
    const reloaded = newRunner(controller, { persist });
    const mark = received.length;
    await controller.connect();
    await waitFor(() => controller.session.status === 'ready', 3000, 'ready');
    await settle(reloaded);
    expect(since(received, mark)).not.toContain('[3702]');
    expect(since(received, mark)).not.toContain('[3401]');
    expect(reloaded.state.get().cursor?.prepared).toBe(false);

    const detach = reloaded.attach(); // the user opens the page
    await settle(reloaded);
    expect(since(received, mark)).toContain('[3702]');
    expect(controller.session.ffe2Wanted).toBe(true);
    // With the page open, a reconnection prepares the stage again.
    controller.setAutoReconnect(true);
    adapter.simulateDrop(10);
    await waitFor(() => controller.session.status !== 'ready', 1000, 'down');
    await waitFor(() => reloaded.state.get().cursor?.prepared === true, 3000, 'prepared');
    expect(adapter.device.state.events['34']).toBe(1);
    detach();
  });

  it('never prepares the interruptor 8 change by itself, even with the page open', async () => {
    const persist = memoryPersist();
    const { adapter, controller, runner, received } = await started({ persist });
    await goTo(runner, 'sleep');
    await runner.redoTest('feature8');
    const detach = runner.attach();
    // The stage is entered while offline: its preparation cannot go out.
    await dropLink(adapter, controller);
    await runner.beginTest({ acknowledged: true });
    expect(runner.state.get().status?.text).toMatch(/Conéctate primero/);
    // Simulate the real case: the stage was entered (record running) but not prepared.
    const saved = persist.load() as CarTestsState;
    runner.dispose();
    persist.save({
      ...saved,
      records: { ...saved.records, feature8: { ...saved.records.feature8, status: 'running' } },
      cursor: { ...(saved.cursor ?? { testId: 'feature8', stageStartedAt: new Date().toISOString(), readyAt: null, countdownUntil: null, countdownSkipped: false, sent: [], drops: 0 }), testId: 'feature8', stageId: 'a', prepared: false },
    });
    const reloaded = newRunner(controller, { persist });
    const detach2 = reloaded.attach();
    const mark = received.length;
    await controller.connect();
    await waitFor(() => controller.session.status === 'ready', 3000, 'ready');
    await settle(reloaded);
    expect(since(received, mark).some((c) => c.startsWith('[2101]') || c.startsWith('[20'))).toBe(false);
    expect(reloaded.state.get().cursor?.prepared).toBe(false);
    detach();
    detach2();
  });

  it('waits for a backup or restore of another page, and for the Instalación page to close', async () => {
    const { controller, runner, received } = await started();
    await goTo(runner, 'turn');
    await runner.beginTest();
    const releaseModule = await acquireLock(controller, 'module', 'Copia de seguridad');
    const mark = received.length;
    const restoring = runner.restoreAll();
    await pause(60);
    expect(since(received, mark)).toEqual([]);
    const releaseFactory = await acquireLock(controller, 'factory', 'Instalación');
    releaseModule();
    await pause(60);
    expect(since(received, mark)).toEqual([]); // still waiting for Instalación
    expect(runner.state.get().status?.text).toMatch(/cierres «Instalación»/);
    releaseFactory();
    await restoring;
    expect(since(received, mark)).toEqual(expect.arrayContaining(['[3400]', '[4500]']));
  });
});

describe('taps and debug', () => {
  it('a double tap on «Saltar esta prueba» skips one test only', async () => {
    const { runner } = await started({ minTapMs: 250 });
    await pause(300);
    await Promise.all([runner.skipTest(), runner.skipTest()]);
    expect(record(runner, 'feature8').status).toBe('skipped');
    expect(record(runner, 'radio').status).toBe('pending');
    expect(runner.state.get().cursor).toMatchObject({ testId: 'radio', stageId: null });
  });

  it('a failed «Me equivoqué» leaves the stage to be prepared again, not shown as ready', async () => {
    const { adapter, controller, runner } = await started();
    await goTo(runner, 'dimming');
    await runner.beginTest();
    await runner.answer('all'); // stage b: night half off
    const send = controller.driver.send.bind(controller.driver);
    let fail = true;
    controller.driver.send = (c: string) => (fail && c === '[1A01]' ? Promise.reject(new Error('Write failed')) : send(c));
    await runner.undo();
    expect(runner.state.get().cursor).toMatchObject({ stageId: 'b', prepared: false });
    fail = false;
    await runner.retryPrepare();
    expect(runner.state.get().cursor).toMatchObject({ stageId: 'b', prepared: true });
    expect(adapter.device.state.nightHalf).toBe(0);
    expect(record(runner, 'dimming').stages).toHaveLength(1);
  });

  it('«Terminar» keeps debug on while the experiment still uses it', async () => {
    const { controller, runner, received } = await started();
    await controller.startDebugFor('experiment');
    const mark = received.length;
    await runner.finish();
    expect(since(received, mark)).not.toContain('[3700]');
    await controller.stopDebugFor('experiment');
    expect(since(received, mark)).toContain('[3700]');
  });
});
