import { afterEach, describe, expect, it } from 'vitest';
import { MockAdapter } from '../src/ble/mockAdapter';
import { carModelForBits } from '../src/protocol/zycela/catalog';
import { initialDeviceState } from '../src/protocol/zycela/state';
import { AppController } from '../src/state/controller';
import {
  ExperimentRunner,
  RESPONSE_WINDOW_MS,
  classifyEntries,
  compactForStorage,
  diffStates,
  experimentSummary,
} from '../src/state/experiment';
import type { ExperimentDeps, ExperimentState, ExperimentStep } from '../src/state/experiment';
import type { LogEntry } from '../src/state/lab';
import { waitFor } from './helpers';

const controllers: AppController[] = [];
afterEach(() => {
  for (const c of controllers.splice(0)) c.dispose();
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function connected() {
  const adapter = new MockAdapter({ latencyMs: 3, connectDelayMs: 2 });
  const controller = new AppController(adapter, {
    toastMs: 0,
    session: { operationTimeoutMs: 300, backoffMs: [5, 5, 5, 5, 5] },
  });
  controllers.push(controller);
  await controller.connect();
  await waitFor(() => controller.session.status === 'ready', 3000, 'ready');
  await waitFor(() => controller.device.get().brightness.b1 !== null, 3000, 'state frame');
  return { adapter, controller };
}

const THREE_STEPS: ExperimentStep[] = [
  { id: 'a', title: 'Paso A', detail: '' },
  { id: 'b', title: 'Paso B', detail: '' },
  { id: 'c', title: 'Paso C', detail: '' },
];

function depsFor(controller: AppController, extra: Partial<ExperimentDeps> = {}): ExperimentDeps {
  return {
    log: controller.log,
    device: controller.device,
    isReady: () => controller.session.status === 'ready',
    addMarker: (note) => controller.addMarker(note),
    requestState: () => controller.driver.requestState(),
    startDebug: () => controller.driver.startDebug(),
    stopDebug: () => controller.driver.stopDebug(),
    onReady: (listener) => {
      let previous = controller.session.status;
      return controller.session.state.subscribe(() => {
        const status = controller.session.status;
        if (status === 'ready' && previous !== 'ready') listener();
        previous = status;
      });
    },
    settleMs: 30,
    responseMs: 120,
    minStepMs: 0,
    ...extra,
  };
}

function memoryPersist() {
  let saved: unknown = null;
  return { load: () => saved, save: (s: ExperimentState) => (saved = JSON.parse(JSON.stringify(s))) };
}

const markers = (controller: AppController) => controller.log.get().filter((e) => e.kind === 'marker').map((e) => e.note);

describe('diffStates', () => {
  it('lists changed leaf fields with Spanish labels and ignores lastFrameAt', () => {
    const before = initialDeviceState();
    const after = { ...before, brightness: { ...before.brightness, b1: 4 }, lastFrameAt: 123 };
    expect(diffStates(before, after)).toEqual([{ field: 'brightness.b1', label: 'Brillo 1', before: '—', after: '4' }]);
  });

  it('also reports fields that only exist on the "before" side', () => {
    const before = { ...initialDeviceState(), version: { hardware: 'H', carModel: 'C', firmware: 'F', text: 't', raw: 'r' } };
    const changes = diffStates(before, initialDeviceState());
    expect(changes.some((c) => c.field === 'version.hardware' && c.before === 'H')).toBe(true);
  });
});

describe('classifyEntries', () => {
  const at = (ms: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, ms)).toISOString();
  const entry = (id: number, kind: LogEntry['kind'], ms: number, text?: string): LogEntry => ({ id, kind, t: at(ms), text });

  it('separates answers to app commands from frames the module sent by itself', () => {
    const buckets = classifyEntries([
      entry(1, 'rx', 0, '[AA]'),
      entry(2, 'tx', 100, '[0A01]'),
      entry(3, 'rx', 300, '[1F]'),
      entry(4, 'rx', 100 + RESPONSE_WINDOW_MS + 50, '[BB]'),
      entry(5, 'info', 200),
      entry(6, 'marker', 250),
    ]);
    expect(buckets.spontaneous.map((e) => e.id)).toEqual([1, 4]);
    expect(buckets.response.map((e) => e.id)).toEqual([3]);
    expect(buckets.appTx.map((e) => e.id)).toEqual([2]);
    expect(buckets.linkEvents.map((e) => e.id)).toEqual([5]);
  });
});

describe('ExperimentRunner with the demo module', () => {
  it('records each step, what changed, and finishes after the last one', async () => {
    const { adapter, controller } = await connected();
    const runner = new ExperimentRunner(depsFor(controller), THREE_STEPS);

    await runner.start();
    expect(runner.state.get().phase).toBe('running');
    await waitFor(() => adapter.device.received.includes('[3702]'), 1000, 'debug start');

    await runner.complete(); // A: nothing happens
    controller.run((d) => d.setBrightness(1, 3)); // B: the brightness changes (as if the car dimmed it)
    await waitFor(() => controller.device.get().brightness.b1 === 3, 1000, 'brightness 3');
    await runner.complete();
    await runner.complete(true); // C: skipped, last step

    const state = runner.state.get();
    expect(state.phase).toBe('finished');
    expect(adapter.device.received).toContain('[3700]');
    const [a, b, c] = state.results;
    expect(a.requestedAt).not.toBeNull();
    expect(a.response.length).toBeGreaterThan(0);
    expect(a.spontaneous).toEqual([]); // the [0A01] answer is not "spontaneous"
    expect(b.changes.some((ch) => ch.field === 'brightness.b1' && ch.after === '3')).toBe(true);
    expect(b.appTx.some((e) => e.text?.startsWith('[0200'))).toBe(true);
    expect(c.skipped).toBe(true);
    expect(markers(controller)).toEqual([
      'Experimento: inicio',
      'Paso 1: Paso A',
      'Paso 2: Paso B',
      'Paso 3: Paso C (saltado)',
      'Experimento: fin',
    ]);

    const text = experimentSummary(state, { name: 'ZYCL-FWD-DEMO' }, '4E');
    expect(text).toContain('2. Paso B');
    expect(text).toContain('Brillo 1: ');
    expect(text).toContain('3. Paso C: saltado');
  });

  it('counts a frame the module sends by itself as spontaneous, also in a skipped step', async () => {
    const { adapter, controller } = await connected();
    const runner = new ExperimentRunner(depsFor(controller), THREE_STEPS);
    await runner.start();
    await sleep(RESPONSE_WINDOW_MS + 100); // past the answer window of [3702]
    adapter.device.announce('[99AB]');
    await waitFor(() => controller.log.get().some((e) => e.text === '[99AB]'), 1000, 'announced frame');
    await runner.complete(true);
    const [a] = runner.state.get().results;
    expect(a.spontaneous.map((e) => e.text)).toContain('[99AB]');
    expect(experimentSummary(runner.state.get(), null, null)).toContain('Llegaron igualmente');
  });

  it('a reconnection mid-step: its [0A01] answer is a response, the drop is flagged and [3702] is sent again', async () => {
    const { adapter, controller } = await connected();
    const runner = new ExperimentRunner(depsFor(controller), THREE_STEPS);
    await runner.start();
    await sleep(RESPONSE_WINDOW_MS + 100);
    adapter.simulateDrop(30);
    await waitFor(() => controller.session.status === 'reconnecting', 1000, 'reconnecting');
    await waitFor(() => controller.session.status === 'ready', 3000, 'reconnected');
    await waitFor(() => adapter.device.received.filter((c) => c === '[3702]').length === 2, 2000, 'debug re-sent');
    await sleep(100);
    await runner.complete();
    const [a] = runner.state.get().results;
    expect(a.interrupted).toBe(true);
    expect(a.linkEvents.length).toBeGreaterThan(0);
    expect(a.spontaneous).toEqual([]);
    expect(a.response.length).toBeGreaterThan(0);
    expect(markers(controller)).toContain('Experimento: conexión recuperada');
  });

  it('marks the state unknown (no fake diff) when the link is down at the end of a step', async () => {
    const { adapter, controller } = await connected();
    controller.setAutoReconnect(false);
    const runner = new ExperimentRunner(depsFor(controller), THREE_STEPS);
    await runner.start();
    adapter.simulateDrop(60_000);
    await waitFor(() => controller.session.status !== 'ready', 1000, 'link down');
    await runner.complete();
    const [a] = runner.state.get().results;
    expect(a.connected).toBe(false);
    expect(a.stateUnknown).toBe(true);
    expect(a.requestFailed).toBe(true);
    expect(a.changes).toEqual([]);
  });

  it('«Me equivoqué» drops the last result and repeats that step', async () => {
    const { controller } = await connected();
    const runner = new ExperimentRunner(depsFor(controller), THREE_STEPS);
    await runner.start();
    await runner.complete();
    expect(runner.state.get().current).toBe(1);
    runner.undo();
    expect(runner.state.get().results).toEqual([]);
    expect(runner.state.get().current).toBe(0);
    expect(markers(controller)).toContain('Paso 1: deshecho, se repite');
    await runner.complete();
    expect(runner.state.get().results.map((r) => r.step.id)).toEqual(['a']);
  });

  it('ignores a second tap that comes right after a step starts', async () => {
    const { controller } = await connected();
    const runner = new ExperimentRunner(depsFor(controller, { minStepMs: 400 }), THREE_STEPS);
    await runner.start();
    await runner.complete(true); // too soon: ignored
    expect(runner.state.get().results).toEqual([]);
    await sleep(450);
    await runner.complete(true);
    await runner.complete(true); // double tap on the next step: ignored
    expect(runner.state.get().results.length).toBe(1);
  });

  it('«Terminar» while a step is settling wins over the late step result', async () => {
    const { controller } = await connected();
    const runner = new ExperimentRunner(depsFor(controller, { settleMs: 150 }), THREE_STEPS);
    await runner.start();
    const pending = runner.complete();
    await sleep(20);
    expect(runner.state.get().phase).toBe('settling');
    await runner.finish();
    await pending;
    expect(runner.state.get().phase).toBe('finished');
    expect(runner.state.get().results).toEqual([]);
    expect(markers(controller).filter((m) => m === 'Experimento: fin').length).toBe(1);
  });

  it('after a reload the results come back as finished and can be continued', async () => {
    const { controller } = await connected();
    const persist = memoryPersist();
    const first = new ExperimentRunner(depsFor(controller, { persist }), THREE_STEPS);
    await first.start();
    await first.complete();
    expect(first.state.get().phase).toBe('running'); // iOS closes the page here

    const reloaded = new ExperimentRunner(depsFor(controller, { persist }), THREE_STEPS);
    expect(reloaded.state.get()).toMatchObject({ phase: 'finished', restored: true });
    expect(reloaded.state.get().results.map((r) => r.step.id)).toEqual(['a']);

    await reloaded.resume();
    expect(reloaded.state.get()).toMatchObject({ phase: 'running', current: 1, restored: false });
    await reloaded.complete();
    expect(reloaded.state.get().results[1]).toMatchObject({ resumed: true });
    expect(markers(controller)).toContain('Experimento: continuado en el paso 2');

    reloaded.reset();
    expect(new ExperimentRunner(depsFor(controller, { persist }), THREE_STEPS).state.get().phase).toBe('idle');
  });

  it('discards stored data it cannot render', () => {
    const deps = {
      ...depsFor(new AppController(new MockAdapter(), { toastMs: 0 })),
      persist: { load: () => ({ phase: 'finished', results: [{ step: { id: 'x' } }] }), save: () => undefined },
    };
    controllers.push(new AppController(new MockAdapter(), { toastMs: 0 }));
    expect(new ExperimentRunner(deps, THREE_STEPS).state.get().phase).toBe('idle');
  });
});

describe('compactForStorage', () => {
  it('caps the lists, drops characteristic UUIDs and redundant hex, and counts what it dropped', () => {
    const rx = (id: number): LogEntry => ({ id, kind: 'rx', t: '2026-01-01T00:00:00.000Z', char: 'uuid', hex: '5B 5D', text: '[]' });
    const state = {
      phase: 'finished',
      steps: THREE_STEPS,
      current: 0,
      stepStartedAt: null,
      listenStartedAt: null,
      listenUntil: null,
      startedAt: null,
      debug: true,
      requestState: true,
      sound: true,
      results: [
        {
          step: THREE_STEPS[0],
          skipped: false,
          startedAt: '',
          doneAt: '',
          requestedAt: null,
          finishedAt: '',
          connected: true,
          interrupted: false,
          spontaneous: [rx(1), rx(2), rx(3)],
          response: [],
          appTx: [],
          linkEvents: [],
          changes: [],
        },
      ],
    } satisfies ExperimentState;
    const slim = compactForStorage(state, 2);
    expect(slim.results[0].spontaneous).toEqual([
      { id: 1, kind: 'rx', t: '2026-01-01T00:00:00.000Z', text: '[]' },
      { id: 2, kind: 'rx', t: '2026-01-01T00:00:00.000Z', text: '[]' },
    ]);
    expect(slim.results[0].truncated).toBe(1);
  });
});

describe('car-model codes', () => {
  it('names the F32 code from the vendor table', () => {
    expect(carModelForBits('01000010')?.model).toContain('Serie F');
    expect(carModelForBits('00000000')).toBeUndefined();
  });
});

describe('results saved by the previous version', () => {
  it('restores a v1 experiment with its own 10-step plan and the default plan on «Repetir»', () => {
    const oldSteps = [
      { id: 'baseline', title: 'Punto de partida', detail: '' },
      { id: 'lock', title: 'Bajar y bloquear', detail: '' },
    ];
    const v1 = {
      phase: 'finished',
      steps: oldSteps,
      current: 1,
      stepStartedAt: null,
      startedAt: '2026-11-06T19:28:02.249Z',
      debug: true,
      requestState: true,
      sound: true,
      results: oldSteps.map((step) => ({
        step,
        skipped: false,
        startedAt: '2026-11-06T19:28:02.440Z',
        doneAt: '2026-11-06T19:28:13.965Z',
        requestedAt: '2026-11-06T19:28:15.966Z',
        finishedAt: '2026-11-06T19:28:17.623Z',
        connected: true,
        spontaneous: [{ id: 3, t: '2026-11-06T19:28:05.000Z', kind: 'rx', text: '[AB]' }],
        response: [],
        changes: [],
      })),
    };
    const controller = new AppController(new MockAdapter(), { toastMs: 0 });
    controllers.push(controller);
    const runner = new ExperimentRunner(depsFor(controller, { persist: { load: () => v1, save: () => undefined } }));
    const state = runner.state.get();
    expect(state).toMatchObject({ phase: 'finished', restored: true });
    expect(state.steps.map((s) => s.id)).toEqual(['baseline', 'lock']);
    expect(state.results[1]).toMatchObject({ appTx: [], linkEvents: [], interrupted: false });
    expect(experimentSummary(state, null, null)).toContain('2. Bajar y bloquear: espontáneas 1 notificación');
    runner.reset();
    expect(runner.state.get().steps.map((s) => s.id)).toContain('exit');
  });
});
