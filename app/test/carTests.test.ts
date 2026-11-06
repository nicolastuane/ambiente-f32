import { afterEach, describe, expect, it } from 'vitest';
import { MockAdapter } from '../src/ble/mockAdapter';
import { BUILTIN_SNAPSHOT } from '../src/protocol/zycela/snapshot';
import { BackupStore } from '../src/state/backup';
import { CAR_TESTS, CarTestsRunner, carTestsReport, preparePlan } from '../src/state/carTests';
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

/** Skips tests until `id` is shown. */
async function goTo(runner: CarTestsRunner, id: string) {
  for (let i = 0; i < CAR_TESTS.length && runner.state.get().cursor?.testId !== id; i++) await runner.skipTest();
  expect(runner.state.get().cursor).toMatchObject({ testId: id, stageId: null });
}

const since = (list: string[], from: number) => list.slice(from);
const record = (runner: CarTestsRunner, id: string) => runner.state.get().records[id];

describe('preparePlan', () => {
  it('turns the declared actions into encoder commands and touched fields', () => {
    expect(
      preparePlan([
        { kind: 'event', key: 'turn', on: true },
        { kind: 'turnColor', index: 1 },
      ]),
    ).toEqual({ commands: ['[3401]', '[4501]'], touched: ['events.turn'], unreadable: ['turnColor'], feature8: null, skipped: [] });
    expect(preparePlan([{ kind: 'welcome', enabled: true, mode: 0, color: 9 }, { kind: 'event', key: 'door', on: false }])).toMatchObject({
      commands: ['[3001]', '[3900]', '[3809]', '[3100]'],
      touched: ['welcomeEnabled', 'welcomeMode', 'welcomeColor', 'events.door'],
    });
    expect(preparePlan([{ kind: 'effect', id: 3 }])).toMatchObject({ commands: ['[1E03]'], touched: ['effect', 'effectCustomEnabled'] });
    expect(preparePlan([{ kind: 'dialFeature8', on: true }])).toMatchObject({ commands: [], touched: ['factory.dial'], feature8: true });
    expect(preparePlan([{ kind: 'event', key: 'blindSpot', on: true }], BUILTIN_SNAPSHOT.values)).toMatchObject({
      commands: [],
      skipped: ['blindSpot: no admitido por el coche'],
    });
  });

  it('every built-in test only prepares with allowed commands', () => {
    for (const test of CAR_TESTS) {
      for (const stage of test.stages) {
        for (const c of preparePlan(stage.prepare ?? []).commands) expect(c).not.toMatch(/^\[(4[0-3]|2[0-2]|1C|0F|1D|52|2C|2F|4[89AB])/);
      }
    }
  });
});

describe('CarTestsRunner session', () => {
  it('starts with a saved backup (installation included), debug and FFE2 on', async () => {
    const { adapter, runner, received } = await started();
    const s = runner.state.get();
    expect(s.phase).toBe('active');
    expect(s.snapshot?.values).toEqual(BUILTIN_SNAPSHOT.values);
    expect(s.snapshot?.label).toMatch(/^Antes de las pruebas · /);
    expect(s.status?.text).toBe('Copia guardada: 29 ajustes, instalación 01000010/00000000.');
    expect(received).toEqual(expect.arrayContaining(['[2101]', '[2100]', '[3702]']));
    expect(received.indexOf('[3702]')).toBeGreaterThan(received.indexOf('[2100]'));
    expect(adapter.listeningOnWriteChar).toBe(true);
    expect(s.cursor).toMatchObject({ testId: 'radio', stageId: null });
  });

  it('does not start without the state frames', async () => {
    const { adapter, controller } = await connected();
    const handle = adapter.device.handle.bind(adapter.device);
    adapter.device.handle = (c: string) => (c === '[0A01]' ? undefined : handle(c));
    const runner = newRunner(controller, { timeoutMs: 80 });
    await runner.start();
    expect(runner.state.get().phase).toBe('idle');
    expect(runner.state.get().status?.kind).toBe('error');
    expect(adapter.device.received).not.toContain('[3702]');
  });

  it('branches on the answers and restores what the test touched', async () => {
    const { adapter, runner, received } = await started();
    await goTo(runner, 'dimming');
    await runner.beginTest();
    expect(runner.state.get().cursor).toMatchObject({ stageId: 'a', prepared: true });
    await runner.answer('all');
    expect(runner.state.get().cursor).toMatchObject({ stageId: 'b', prepared: true });
    expect(adapter.device.state.nightHalf).toBe(0);
    await runner.answer('yes');
    expect(runner.state.get().cursor).toMatchObject({ stageId: 'c', prepared: true });
    expect(adapter.device.state.controlMethod).toBe(1);
    const mark = received.length;
    await runner.answer('no');

    const r = record(runner, 'dimming');
    expect(r.status).toBe('done');
    expect(r.stages.map((st) => `${st.stageId}:${st.answerId}`)).toEqual(['a:all', 'b:yes', 'c:no']);
    expect(r.conclusions).toEqual(['El módulo copia la atenuación del coche (control «coche + móvil»).']);
    expect(r.stages[1].changes).toEqual([expect.objectContaining({ field: 'nightHalf', before: 'sí', after: 'no', byTest: true })]);
    expect(r.touched.sort()).toEqual(['controlMethod', 'nightHalf']);
    expect(since(received, mark)).toEqual(expect.arrayContaining(['[5100]', '[1A01]']));
    expect(r.restore).toMatchObject({ pending: false, ok: true });
    expect(adapter.device.state).toMatchObject({ nightHalf: 1, controlMethod: 0 });
    expect(runner.state.get().cursor).toMatchObject({ testId: 'idrive', stageId: null });

    await runner.beginTest();
    await runner.answer('no');
    expect(record(runner, 'idrive')).toMatchObject({
      status: 'done',
      conclusions: ['Tu iDrive no tiene el menú; se podría activar con codificación (BimmerCode), opcional.'],
    });
  });

  it('also restores values the car changed by itself (radio buttons)', async () => {
    const { adapter, runner } = await started();
    await runner.beginTest(); // radio: nothing to prepare
    adapter.device.state.color = '00ff00'; // as if favourite 5 had changed the colour
    await runner.answer('color');
    const r = record(runner, 'radio');
    expect(r.stages[0].changes).toEqual([expect.objectContaining({ field: 'color', after: '#00ff00', byTest: false })]);
    expect(r.restore?.sent).toEqual(['[06ff1000]']);
    expect(adapter.device.state.color).toBe('ff1000');
  });

  it('«Dejarla desactivada» keeps [1A00] through the test restore and «Terminar»', async () => {
    const { adapter, runner, received } = await started();
    await goTo(runner, 'dimming');
    await runner.beginTest();
    await runner.answer('dash');
    await runner.answer('no');
    expect(record(runner, 'dimming')).toMatchObject({ status: 'deciding', offers: ['keepNightHalfOff'] });
    const mark = received.length;
    await runner.decide(['keepNightHalfOff']);
    expect(runner.state.get().target?.nightHalf).toBe(false);
    expect(record(runner, 'dimming')).toMatchObject({ status: 'done', kept: ['keepNightHalfOff'] });
    expect(record(runner, 'dimming').restore?.ok).toBe(true);
    await runner.finish();
    expect(since(received, mark)).not.toContain('[1A01]');
    expect(adapter.device.state.nightHalf).toBe(0);
    expect(carTestsReport(runner.state.get())).toContain('[1A00]');
  });

  it('sets the unreadable turn colour back to its default, with a note', async () => {
    const { adapter, runner } = await started();
    await goTo(runner, 'turn');
    await runner.beginTest();
    expect(adapter.device.state).toMatchObject({ turnColor: 1, events: expect.objectContaining({ '34': 1 }) });
    await runner.answer('no');
    const r = record(runner, 'turn');
    expect(r.restore?.sent).toEqual(['[3400]', '[4500]']);
    expect(r.restore?.notes.join(' ')).toMatch(/color del intermitente no se puede leer/);
    expect(adapter.device.state).toMatchObject({ turnColor: 0, events: expect.objectContaining({ '34': 0 }) });
    expect(runner.state.get().unreadableDirty).toEqual([]);

    await runner.beginTest(); // door
    await runner.answer('no');
    expect(record(runner, 'door').conclusions).toContain(
      'El módulo no parece estar leyendo el coche. Revisa el cable de protocolo (CAN) en el conector de 4 pines del mando del iDrive.',
    );
  });

  it('keeps a restore pending while the link is down and applies it on reconnection', async () => {
    const { adapter, controller, runner } = await started();
    await goTo(runner, 'turn');
    await runner.beginTest();
    controller.setAutoReconnect(false);
    adapter.simulateDrop(0);
    await waitFor(() => controller.session.status !== 'ready', 1000, 'link down');
    await runner.answer('no');
    let s = runner.state.get();
    expect(s.records.turn.stages[0].stateUnknown).toBe(true);
    expect(s.records.turn.restore?.pending).toBe(true);
    expect(s.pendingRestore).toMatchObject({ reasons: ['turn'], fields: ['events.turn'], unreadable: ['turnColor'] });
    expect(s.status?.text).toMatch(/pulsa «Conectar» arriba: se restaurarán solos al conectar/);
    expect(adapter.device.state.events['34']).toBe(1);

    await controller.connect();
    await waitFor(() => runner.state.get().pendingRestore === null, 3000, 'pending applied');
    s = runner.state.get();
    expect(s.records.turn.restore).toMatchObject({ pending: false, ok: true });
    expect(adapter.device.state).toMatchObject({ turnColor: 0, events: expect.objectContaining({ '34': 0 }) });
  });

  it('«Me equivoqué» undoes the current stage and repeats the previous question', async () => {
    const { adapter, runner } = await started();
    await goTo(runner, 'dimming');
    await runner.beginTest();
    await runner.answer('all');
    expect(adapter.device.state.nightHalf).toBe(0);
    await runner.undo();
    expect(runner.state.get().cursor).toMatchObject({ stageId: 'a', prepared: true });
    expect(record(runner, 'dimming').stages).toEqual([]);
    expect(adapter.device.state.nightHalf).toBe(1);
    await runner.answer('no');
    expect(record(runner, 'dimming').stages.map((st) => st.answerId)).toEqual(['no']);
  });

  it('ignores taps that come too soon (double taps)', async () => {
    const { runner } = await started({ minTapMs: 250 });
    await runner.beginTest(); // right after «Empezar»: ignored
    expect(runner.state.get().cursor?.stageId).toBeNull();
    await new Promise((r) => setTimeout(r, 300));
    await runner.beginTest();
    expect(runner.state.get().cursor?.stageId).toBe('a');
    await runner.answer('no'); // too soon after the stage appeared
    expect(record(runner, 'radio').stages).toEqual([]);
  });

  it('logs FFE1 and FFE2 notifications nobody asked for, without parsing FFE2', async () => {
    const { adapter, controller, runner } = await started();
    await runner.beginTest(); // radio, no preparation: nothing sent in this stage
    const color = controller.device.get().color;
    adapter.emitOnWriteChar('[4E00180100ff00FF11010904010300090800]');
    adapter.device.announce('[99AB]');
    await waitFor(() => controller.log.get().some((e) => e.text === '[99AB]'), 1000, 'ffe1 announce');
    expect(controller.device.get().color).toBe(color);
    await runner.answer('no');
    const unsolicited = record(runner, 'radio').stages[0].unsolicited;
    expect(unsolicited).toEqual([
      expect.objectContaining({ char: 'FFE2', text: '[4E00180100ff00FF11010904010300090800]' }),
      expect.objectContaining({ char: 'FFE1', text: '[99AB]' }),
    ]);
    const report = carTestsReport(runner.state.get());
    expect(report).toContain('Notificaciones no pedidas: 2');
    expect(report).toMatch(/FFE2 \d\d:\d\d:\d\d\.\d{3} \[4E00180100ff00/);
  });
});

describe('feature switch nº 8', () => {
  async function toFeature8() {
    const env = await started();
    await goTo(env.runner, 'sleep'); // welcome skipped: feature 8 is not offered…
    expect(record(env.runner, 'feature8').status).toBe('notOffered');
    await env.runner.redoTest('feature8'); // …but can be run on demand
    expect(env.runner.state.get().cursor).toMatchObject({ testId: 'feature8', stageId: null });
    return env;
  }

  it('needs the acknowledgement, then [2101] → 23 → [20…] → 23 → [2100], and reverts the same way', async () => {
    const { adapter, runner, received } = await toFeature8();
    await runner.beginTest();
    expect(runner.state.get().cursor?.stageId).toBeNull();
    let mark = received.length;
    await runner.beginTest({ acknowledged: true });
    expect(since(received, mark)).toEqual(['[2101]', '[200100001000000001]', '[2100]', '[3001]', '[3900]', '[3809]', '[3100]']);
    expect(adapter.device.state.featureBits).toBe('00000001');
    expect(record(runner, 'feature8').notes.join(' ')).toMatch(/00000000 → 00000001/);

    await runner.answer('unlock'); // the countdown has not run: ignored
    expect(runner.state.get().cursor).toMatchObject({ stageId: 'a' });
    runner.skipCountdown(); // «Ya lo he hecho»
    await runner.answer('unlock');
    expect(runner.state.get().cursor).toMatchObject({ stageId: 'b', prepared: true });
    await runner.answer('yes');
    expect(record(runner, 'feature8')).toMatchObject({ status: 'deciding', offers: ['keepFeature8', 'keepWelcome', 'keepWelcomeWhite'] });
    mark = received.length;
    await runner.decide([]);
    const revert = since(received, mark).filter((c) => /^\[(20|21)/.test(c));
    expect(revert).toEqual(['[2101]', '[200100001000000000]', '[2100]']);
    expect(adapter.device.state).toMatchObject({ featureBits: '00000000', factoryMode: false, welcomeMode: 5, welcomeColor: 4 });
    expect(record(runner, 'feature8').restore).toMatchObject({ ok: true });
  });

  it('«Dejar el interruptor 8 encendido» keeps it through «Terminar»', async () => {
    const { adapter, runner, received } = await toFeature8();
    await runner.beginTest({ acknowledged: true });
    runner.skipCountdown();
    await runner.answer('door');
    await runner.answer('yes');
    const mark = received.length;
    await runner.decide(['keepFeature8']);
    await runner.finish();
    expect(since(received, mark)).not.toContain('[200100001000000000]');
    expect(adapter.device.state.featureBits).toBe('00000001');
    expect(runner.state.get().target?.factory.featureBits).toBe('00000001');
  });

  it('aborts without touching the dial when the car bits differ from the snapshot', async () => {
    const { adapter, runner, received } = await toFeature8();
    adapter.device.state.carBits = '01000011';
    const mark = received.length;
    await runner.beginTest({ acknowledged: true });
    const sent = since(received, mark);
    expect(sent.some((c) => c.startsWith('[20'))).toBe(false);
    expect(sent.slice(0, 2)).toEqual(['[2101]', '[2100]']);
    expect(sent).not.toContain('[3900]');
    const r = record(runner, 'feature8');
    expect(r.status).toBe('aborted');
    expect(r.dialChanged).toBe(false);
    expect(r.conclusions[0]).toMatch(/^No se hizo: El código de coche del módulo \(01000011\)/);
    expect(adapter.device.state.featureBits).toBe('00000000');
  });
});

describe('finish, waiting test and «Restaurar todo ahora»', () => {
  it('«Terminar» sends [3700], stops FFE2 and restores what differs', async () => {
    const { adapter, runner, received } = await started();
    await goTo(runner, 'hcStrips');
    await runner.beginTest();
    expect(adapter.device.state.effect).toBe(3);
    adapter.device.state.b3 = 2; // changed outside the tests
    const mark = received.length;
    await runner.finish();
    const s = runner.state.get();
    expect(s.phase).toBe('finished');
    expect(record(runner, 'hcStrips').status).toBe('interrupted');
    expect(since(received, mark)).toEqual(expect.arrayContaining(['[3700]', '[1E18]', '[010204]']));
    expect(adapter.listeningOnWriteChar).toBe(false);
    expect(adapter.device.state).toMatchObject({ effect: 24, b3: 4 });
    expect(s.pendingRestore).toBeNull();
  });

  it('a deferred test stays waiting with its settings, then restores once answered', async () => {
    const { adapter, runner } = await started();
    await goTo(runner, 'sleep');
    await runner.beginTest();
    expect(adapter.device.state).toMatchObject({ welcomeMode: 0, welcomeColor: 9 });
    await runner.finish();
    let s = runner.state.get();
    expect(s.phase).toBe('finished');
    expect(s.waiting).toEqual({ testId: 'sleep', stageId: 'a' });
    expect(record(runner, 'sleep').status).toBe('waiting');
    expect(adapter.device.state).toMatchObject({ welcomeMode: 0, welcomeColor: 9, events: expect.objectContaining({ '31': 0 }) });
    runner.reset(); // not allowed while waiting
    expect(runner.state.get().phase).toBe('finished');

    await runner.answer('yes');
    // It worked: the user is asked whether to keep that welcome (no by default).
    expect(record(runner, 'sleep')).toMatchObject({ status: 'deciding', offers: ['keepWelcome', 'keepWelcomeWhite'] });
    expect(runner.state.get().waiting).not.toBeNull();
    await runner.decide([]);
    s = runner.state.get();
    expect(s.waiting).toBeNull();
    expect(record(runner, 'sleep')).toMatchObject({
      status: 'done',
      conclusions: ['La bienvenida aparece tras dormir el coche: depende de que el módulo arranque.'],
    });
    expect(adapter.device.state).toMatchObject({ welcomeMode: 5, welcomeColor: 4, events: expect.objectContaining({ '31': 1 }) });
  });

  it('«Restaurar todo ahora» stops the test in progress and puts everything back', async () => {
    const { adapter, runner } = await started();
    await goTo(runner, 'turn');
    await runner.beginTest();
    await runner.restoreAll();
    expect(record(runner, 'turn').status).toBe('interrupted');
    expect(adapter.device.state).toMatchObject({ turnColor: 0, events: expect.objectContaining({ '34': 0 }) });
    expect(runner.state.get().cursor).toMatchObject({ testId: 'door', stageId: null });
  });
});

describe('persistence', () => {
  it('a session survives a reload and goes on where it was', async () => {
    const persist = memoryPersist();
    const { adapter, controller, runner } = await started({ persist });
    await goTo(runner, 'turn');
    await runner.beginTest();
    runner.dispose(); // iOS closed Bluefy
    await controller.session.stopSecondaryNotifications('carTests'); // a new page load starts without FFE2

    const reloaded = newRunner(controller, { persist });
    const s = reloaded.state.get();
    expect(s).toMatchObject({ phase: 'active', restored: true, cursor: { testId: 'turn', stageId: 'a', prepared: true } });
    expect(s.records.turn.touched).toEqual(['events.turn']);
    // Nothing resumes until the tests page is open again.
    expect(controller.session.ffe2Wanted).toBe(false);
    reloaded.attach();
    expect(controller.session.ffe2Wanted).toBe(true);
    await reloaded.answer('yes');
    expect(record(reloaded, 'turn')).toMatchObject({ status: 'done', conclusions: ['El módulo lee los intermitentes del coche.'] });
    expect(adapter.device.state.events['34']).toBe(0);
  });

  it('a pending restore survives a reload and is applied when the link comes back', async () => {
    const persist = memoryPersist();
    const { adapter, controller, runner } = await started({ persist });
    await goTo(runner, 'hcStrips');
    await runner.beginTest();
    controller.setAutoReconnect(false);
    adapter.simulateDrop(0);
    await waitFor(() => controller.session.status !== 'ready', 1000, 'link down');
    await runner.answer('no');
    expect(runner.state.get().pendingRestore).not.toBeNull();
    runner.dispose();

    const reloaded = newRunner(controller, { persist });
    expect(reloaded.state.get().pendingRestore).toMatchObject({ fields: expect.arrayContaining(['effect']) });
    await controller.connect();
    await waitFor(() => reloaded.state.get().pendingRestore === null, 3000, 'applied after reload');
    expect(adapter.device.state.effect).toBe(24);
    expect(record(reloaded, 'hcStrips').restore).toMatchObject({ pending: false, ok: true });
  });

  it('keeps the demo and the real module apart', async () => {
    const persist = memoryPersist();
    const { controller } = await started({ persist });
    const saved = persist.load() as CarTestsState;
    expect(saved.demo).toBe(true);
    persist.save({ ...saved, demo: false });
    expect(newRunner(controller, { persist }).state.get().phase).toBe('idle');
  });
});

describe('report', () => {
  it('is plain Spanish text with the module, the answers, the evidence and the restores', async () => {
    const { runner } = await started();
    await goTo(runner, 'turn');
    await runner.beginTest();
    await runner.answer('no');
    await runner.finish();
    const text = carTestsReport(runner.state.get());
    expect(text).toMatch(/^Pruebas del coche · Ambiente F32 · /);
    expect(text).toContain('Módulo: ZYCL-FWD-DEMO · firmware V3.1-DEMO · MODO DEMO');
    expect(text).toContain('Copia antes de las pruebas: 29 ajustes · instalación 01000010/00000000');
    expect(text).toContain('Igual que tu configuración guardada (6/11/2026).');
    expect(text).toContain('1. Botones de favoritos de la radio: saltada');
    expect(text).toContain('3. ¿Lee los intermitentes?: hecha');
    expect(text).toContain('¿Parpadean las tiras en amarillo? → No');
    expect(text).toContain('Preparado: [3401] [4501]');
    expect(text).toContain('Cambios de estado: Aviso: intermitentes desactivado → activado (lo puso la prueba)');
    expect(text).toContain('Restaurado: [3400] [4500] · comprobado');
  });
});
