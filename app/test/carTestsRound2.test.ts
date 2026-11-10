/** «Pruebas del coche», second round: what the module can do without the phone. */
import { afterEach, describe, expect, it } from 'vitest';
import { MockAdapter } from '../src/ble/mockAdapter';
import { BUILTIN_SNAPSHOT } from '../src/protocol/zycela/snapshot';
import { BackupStore } from '../src/state/backup';
import {
  CAR_TESTS,
  CAR_TESTS_ROUND1,
  CAR_TESTS_ROUND2,
  CarTestsRunner,
  carTestsReport,
  keptUnreadable,
  preparePlan,
  unreadableRestore,
} from '../src/state/carTests';
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
  return { load: () => saved, save: (st: CarTestsState) => (saved = JSON.parse(JSON.stringify(st))) };
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
  await runner.start();
  return { adapter, controller, runner, received: adapter.device.received };
}

async function goTo(runner: CarTestsRunner, id: string) {
  for (let i = 0; i < CAR_TESTS.length && runner.state.get().cursor?.testId !== id; i++) await runner.skipTest();
  expect(runner.state.get().cursor).toMatchObject({ testId: id, stageId: null });
}

const since = (list: string[], from: number) => list.slice(from);
const record = (runner: CarTestsRunner, id: string) => runner.state.get().records[id];

describe('second round: definitions', () => {
  it('offers the second round in order and keeps the first round on demand only', () => {
    expect(CAR_TESTS.map((t) => t.id)).toEqual([...CAR_TESTS_ROUND2, ...CAR_TESTS_ROUND1].map((t) => t.id));
    expect(CAR_TESTS.filter((t) => !t.archived).map((t) => t.id)).toEqual(CAR_TESTS_ROUND2.map((t) => t.id));
    expect(CAR_TESTS_ROUND2.some((t) => t.needsFactory)).toBe(false);
  });

  it('prepares the new actions with the command encoders', () => {
    expect(preparePlan([{ kind: 'power', mode: 2 }])).toMatchObject({ commands: ['[0702]'], touched: [], unreadable: ['power'] });
    expect(
      preparePlan([{ kind: 'zoning', value: 1 }], { ...BUILTIN_SNAPSHOT.values, brightness: { b1: 9, b2: 9, b3: 4 } }),
    ).toMatchObject({ commands: ['[1401]', '[020009]', '[010109]', '[010204]'], touched: ['zoning', 'brightness.b1', 'brightness.b2', 'brightness.b3'] });
    expect(preparePlan([{ kind: 'color', zone: 1, hex: '#ff00ff' }]).commands).toEqual(['[10ff00ff]']);
    expect(preparePlan([{ kind: 'rgbMode', mode: 15 }])).toMatchObject({ commands: ['[040f]'], touched: ['rgbMode', 'color'] });
  });

  it('puts unreadable values back to what was kept, or to their default', () => {
    expect(unreadableRestore('power', {})).toMatchObject({ command: '[0701]' });
    expect(unreadableRestore('power', { power: 2 })).toMatchObject({ command: '[0702]' });
    expect(unreadableRestore('doorColor', { doorColor: 3 })).toMatchObject({ command: '[4603]' });
  });
});

describe('second round: session', () => {
  it('starts with the kit-type test and lists the first round as not offered', async () => {
    const { runner } = await started();
    expect(runner.state.get().cursor).toMatchObject({ testId: 'kitType', stageId: null });
    for (const t of CAR_TESTS_ROUND1) {
      expect(record(runner, t.id)).toMatchObject({ status: 'notOffered', notes: [expect.stringMatching(/primera ronda/)] });
    }
    // A first-round test can still be run on demand.
    await runner.redoTest('radio');
    expect(runner.state.get().cursor).toMatchObject({ testId: 'radio', stageId: null });
  });

  it('kit type: zone colours, then all white with the multicolour effect; both put back', async () => {
    const { adapter, runner, received } = await started();
    let mark = received.length;
    await runner.beginTest();
    expect(since(received, mark)).toEqual(expect.arrayContaining(['[10ff00ff]', '[09ffffff]']));
    mark = received.length;
    await runner.answer('vendor');
    expect(since(received, mark).filter((c) => c !== '[0A01]')).toEqual(['[06ffffff]', '[1E00]']);
    expect(adapter.device.state.effect).toBe(0);
    await runner.answer('no');
    const r = record(runner, 'kitType');
    expect(r.conclusions.join(' ')).toMatch(/color fijo/);
    expect(r.restore).toMatchObject({ ok: true });
    expect(adapter.device.state).toMatchObject({ color: 'ff1000', effect: 24 });
    expect(runner.state.get().cursor).toMatchObject({ testId: 'acLook' });
  });

  it('A/C on a white base; each stage has its own conclusion', async () => {
    const { adapter, runner, received } = await started();
    await goTo(runner, 'acLook');
    const mark = received.length;
    await runner.beginTest();
    expect(since(received, mark)).toEqual(['[06ffffff]', '[3501]']);
    await runner.answer('none');
    await runner.answer('stay');
    expect(record(runner, 'acLook').conclusions).toEqual(['Al bajar, el color se queda: la temperatura cambia el color del kit.']);
    expect(adapter.device.state.color).toBe('ff1000');
  });

  it('follow lights: [0702], and «Dejar…» keeps it through the restore and «Terminar»', async () => {
    const { adapter, runner, received } = await started();
    await goTo(runner, 'followLights');
    await runner.beginTest();
    expect(adapter.device.state.power).toBe(2);
    await runner.answer('on'); // low beams: on
    await runner.answer('off'); // lights off: off
    await runner.answer('off'); // AUTO by day
    expect(record(runner, 'followLights')).toMatchObject({ status: 'deciding', offers: ['keepFollowLights'] });
    const mark = received.length;
    await runner.decide(['keepFollowLights']);
    expect(since(received, mark)).toContain('[0702]');
    expect(since(received, mark)).not.toContain('[0701]');
    expect(adapter.device.state.power).toBe(2);
    expect(record(runner, 'followLights').restore?.notes.join(' ')).toMatch(/siguiendo las luces del coche, como elegiste/);
    expect(keptUnreadable(runner.state.get().records)).toEqual({ power: 2 });

    await runner.finish();
    expect(adapter.device.state.power).toBe(2);
  });

  it('follow lights not detected: back on ([0701]); «Restaurar todo ahora» also undoes a kept one', async () => {
    const { adapter, runner } = await started();
    await goTo(runner, 'followLights');
    await runner.beginTest();
    await runner.answer('off'); // off even with the lights on: ends the test
    expect(record(runner, 'followLights').status).toBe('done');
    expect(adapter.device.state.power).toBe(1);

    await runner.redoTest('followLights');
    await runner.beginTest();
    await runner.answer('on');
    await runner.answer('off');
    await runner.answer('on');
    await runner.decide(['keepFollowLights']);
    expect(adapter.device.state.power).toBe(2);
    await runner.restoreAll();
    expect(adapter.device.state.power).toBe(1);
  });

  it('a repeated test asks again about what an earlier run kept (never kept silently)', async () => {
    const { adapter, runner } = await started();
    await goTo(runner, 'followLights');
    await runner.beginTest();
    await runner.answer('on');
    await runner.answer('off');
    await runner.answer('off');
    await runner.decide(['keepFollowLights']);
    await runner.redoTest('followLights');
    await runner.beginTest();
    await runner.answer('off'); // this time: not detected, no offer from the answers
    expect(record(runner, 'followLights')).toMatchObject({ status: 'deciding', offers: ['keepFollowLights'] });
    await runner.decide([]); // «No, dejarlo como estaba»
    expect(adapter.device.state.power).toBe(1);
    expect(keptUnreadable(runner.state.get().records)).toEqual({});
  });

  it('a value kept in an earlier session is what «dejarlo como estaba» means in the next one', async () => {
    const { adapter, runner } = await started();
    await goTo(runner, 'followLights');
    await runner.beginTest();
    await runner.answer('on');
    await runner.answer('off');
    await runner.answer('off');
    await runner.decide(['keepFollowLights']);
    await runner.finish();
    runner.reset();
    expect(runner.state.get().knownUnreadable).toEqual({ power: 2 });
    await runner.start();
    expect(runner.state.get().knownUnreadable).toEqual({ power: 2 });
    await goTo(runner, 'followLights');
    await runner.beginTest();
    await runner.answer('on');
    await runner.answer('off');
    await runner.answer('off');
    await runner.decide([]);
    expect(adapter.device.state.power).toBe(2);
    expect(record(runner, 'followLights').restore?.notes.join(' ')).toMatch(/sesión anterior/);
  });

  it('a kept value is not reported as an unknown difference', async () => {
    const { adapter, runner } = await started();
    // As if the module reported the power state at 4E 7–8.
    const dev = adapter.device as unknown as { stateFrames: () => string[] };
    const original = dev.stateFrames.bind(adapter.device);
    dev.stateFrames = () =>
      original().map((f) => (f.startsWith('[4E') ? `${f.slice(0, 7)}0${adapter.device.state.power}${f.slice(9)}` : f));
    // The copy has to be taken with that reporting: start again.
    await runner.finish();
    runner.reset();
    await runner.start();
    await goTo(runner, 'followLights');
    await runner.beginTest();
    await runner.answer('on');
    await runner.answer('off');
    await runner.answer('off');
    await runner.decide(['keepFollowLights']);
    expect(record(runner, 'followLights').restore).toMatchObject({ ok: true });
    await runner.finish();
    expect(runner.state.get().status?.kind).toBe('success');
  });

  it('night: a baseline with the usual zones, then front/rear zones and night half; both can be kept', async () => {
    const { adapter, runner, received } = await started();
    await goTo(runner, 'night');
    await runner.beginTest();
    const mark = received.length;
    await runner.answer('all'); // usual zones: everything dims
    expect(since(received, mark).filter((c) => c !== '[0A01]')).toEqual(['[1401]', '[020009]', '[010109]', '[010204]']);
    await runner.answer('dash');
    expect(adapter.device.state.nightHalf).toBe(0);
    await runner.answer('no');
    expect(record(runner, 'night')).toMatchObject({ status: 'deciding', offers: ['keepFrontRearZones', 'keepNightHalfOff'] });
    await runner.decide(['keepFrontRearZones']);
    expect(adapter.device.state).toMatchObject({ zoning: 1, nightHalf: 1, b1: 9, b2: 9, b3: 4 });
    expect(runner.state.get().target).toMatchObject({ zoning: 1, nightHalf: true });
  });

  it('«Terminar» in the middle of the night test puts the zoning and the brightness back', async () => {
    const { adapter, runner, received } = await started();
    await goTo(runner, 'night');
    await runner.beginTest();
    await runner.answer('all');
    expect(adapter.device.state.zoning).toBe(1);
    const mark = received.length;
    await runner.finish();
    const sent = since(received, mark).filter((c) => c !== '[0A01]');
    expect(sent).toEqual(expect.arrayContaining(['[1400]', '[020009]', '[010109]', '[010204]']));
    expect(sent.indexOf('[1400]')).toBeLessThan(sent.indexOf('[020009]'));
    expect(adapter.device.state.zoning).toBe(0);
  });

  it('door and turn at night: green then blue base; keeping the door warning keeps its colour', async () => {
    const { adapter, runner, received } = await started();
    await goTo(runner, 'doorTurnNight');
    let mark = received.length;
    await runner.beginTest();
    expect(since(received, mark)).toEqual(['[0600ff00]', '[3101]', '[4603]', '[3401]', '[4501]']);
    mark = received.length;
    await runner.answer('yes');
    expect(since(received, mark).filter((c) => c !== '[0A01]')).toEqual(['[060000ff]']);
    await runner.answer('no');
    expect(record(runner, 'doorTurnNight')).toMatchObject({ status: 'deciding', offers: ['keepDoorWarning'] });
    await runner.decide(['keepDoorWarning']);
    expect(adapter.device.state).toMatchObject({ color: 'ff1000', doorColor: 3, turnColor: 0, events: expect.objectContaining({ '31': 1 }) });
    const notes = record(runner, 'doorTurnNight').restore?.notes.join(' ') ?? '';
    expect(notes).toMatch(/puerta abierta se deja como elegiste/);
    expect(notes).toMatch(/intermitente no se puede leer/);
  });

  it('radar and speed can be kept on; the drive-mode check comes first', async () => {
    const { adapter, runner } = await started();
    await goTo(runner, 'pdc');
    await runner.beginTest();
    await runner.answer('noButton');
    await runner.decide(['keepRadarOn']);
    expect(adapter.device.state.events['32']).toBe(1);
    await runner.beginTest(); // speed: drive modes, then driving
    expect(adapter.device.state.events['33']).toBe(1);
    await runner.answer('no');
    await runner.answer('mid');
    await runner.decide([]);
    expect(adapter.device.state.events).toMatchObject({ '32': 1, '33': 0 });
    expect(runner.state.get().target?.events).toMatchObject({ radar: 1, speed: 0 });
  });

  it('radio map: the colour after each touch is in the evidence and is put back', async () => {
    const { adapter, runner } = await started();
    await goTo(runner, 'radioMap');
    await runner.beginTest();
    adapter.device.state.color = '00ff00'; // as if favourite 5 had been touched
    await runner.answer('yes');
    expect(runner.state.get().cursor).toMatchObject({ stageId: 'p2' });
    adapter.device.state.color = '0000ff';
    await runner.answer('new');
    adapter.device.state.color = '00ff00';
    await runner.answer('seen');
    expect(runner.state.get().cursor).toMatchObject({ stageId: 'k6' });
    const st = record(runner, 'radioMap').stages;
    expect(st.map((x) => x.changes.find((c) => c.field === 'color')?.after)).toEqual(['#00ff00', '#0000ff', '#00ff00']);
    for (const id of ['back', 'mode', 'up', 'down']) await runner.answer(id);
    expect(record(runner, 'radioMap')).toMatchObject({ status: 'done', conclusions: ['Basta con tocar el botón, sin apretarlo.'] });
    expect(record(runner, 'radioMap').restore).toMatchObject({ ok: true });
    expect(adapter.device.state.color).toBe('ff1000');
  });

  it('the report leaves out tests that were not run, and numbers the rest in order', async () => {
    const { runner } = await started();
    await runner.beginTest();
    await runner.answer('vendor');
    await runner.answer('no');
    await runner.finish();
    const text = carTestsReport(runner.state.get());
    expect(text).toContain('1. ¿Tiras de color fijo o animadas?: hecha');
    expect(text).toContain('2. Qué hace el climatizador en las tiras: sin hacer');
    expect(text).not.toContain('Interruptor de funciones nº 8');
  });

  it('a session saved before the second round does not list the new tests', async () => {
    const persist = memoryPersist();
    const { controller, runner } = await started({ tests: CAR_TESTS_ROUND1, persist });
    await runner.skipTest();
    await runner.finish();
    runner.dispose();
    const reloaded = newRunner(controller, { persist });
    const text = carTestsReport(reloaded.state.get());
    expect(text).toContain('1. Interruptor de funciones nº 8: saltada');
    expect(text).not.toContain('Tiras de color fijo');
    expect(reloaded.state.get().records.kitType).toMatchObject({ status: 'notOffered', notes: ['No existía en esta sesión.'] });
  });
});
