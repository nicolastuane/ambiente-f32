import { afterEach, describe, expect, it } from 'vitest';
import { MockAdapter } from '../src/ble/mockAdapter';
import { carModelForBits } from '../src/protocol/zycela/catalog';
import { initialDeviceState } from '../src/protocol/zycela/state';
import { AppController } from '../src/state/controller';
import { ExperimentRunner, diffStates, experimentSummary } from '../src/state/experiment';
import { waitFor } from './helpers';

const controllers: AppController[] = [];
afterEach(() => {
  for (const c of controllers.splice(0)) c.dispose();
});

async function connected() {
  const adapter = new MockAdapter({ latencyMs: 3, connectDelayMs: 2 });
  const controller = new AppController(adapter, { toastMs: 0, session: { operationTimeoutMs: 500 } });
  controllers.push(controller);
  await controller.connect();
  await waitFor(() => controller.session.status === 'ready', 3000, 'ready');
  await waitFor(() => controller.device.get().brightness.b1 !== null, 3000, 'state frame');
  return { adapter, controller };
}

function runnerFor(controller: AppController) {
  return new ExperimentRunner(
    {
      log: controller.log,
      device: controller.device,
      isReady: () => controller.session.status === 'ready',
      addMarker: (note) => controller.addMarker(note),
      requestState: () => controller.driver.requestState(),
      startDebug: () => controller.driver.startDebug(),
      stopDebug: () => controller.driver.stopDebug(),
      settleMs: 30,
      responseMs: 120,
    },
    [
      { id: 'a', title: 'Paso A', detail: '' },
      { id: 'b', title: 'Paso B', detail: '' },
      { id: 'c', title: 'Paso C', detail: '' },
    ],
  );
}

describe('diffStates', () => {
  it('lists changed leaf fields with Spanish labels and ignores lastFrameAt', () => {
    const before = initialDeviceState();
    const after = { ...before, brightness: { ...before.brightness, b1: 4 }, lastFrameAt: 123 };
    expect(diffStates(before, after)).toEqual([{ field: 'brightness.b1', label: 'Brillo 1', before: '—', after: '4' }]);
  });
});

describe('ExperimentRunner with the demo module', () => {
  it('records spontaneous frames, the state answer and what changed in each step', async () => {
    const { adapter, controller } = await connected();
    const runner = runnerFor(controller);

    await runner.start();
    expect(runner.state.get().phase).toBe('running');
    await waitFor(() => adapter.device.received.includes('[3702]'), 1000, 'debug start');

    // Step A: nothing happens.
    await runner.complete();
    // Step B: brightness changes during the step (as if the car dimmed the lights).
    controller.run((d) => d.setBrightness(1, 3));
    await waitFor(() => controller.device.get().brightness.b1 === 3, 1000, 'brightness 3');
    await runner.complete();
    // Step C: skipped; the last step finishes the experiment.
    await runner.complete(true);

    const state = runner.state.get();
    expect(state.phase).toBe('finished');
    expect(state.results.map((r) => r.step.id)).toEqual(['a', 'b', 'c']);
    expect(adapter.device.received).toContain('[3700]');

    const [a, b, c] = state.results;
    expect(a.requestedAt).not.toBeNull();
    expect(a.response.length).toBeGreaterThan(0);
    expect(b.changes.some((ch) => ch.field === 'brightness.b1' && ch.after === '3')).toBe(true);
    expect(c.skipped).toBe(true);
    expect(c.response).toEqual([]);

    const markers = controller.log.get().filter((e) => e.kind === 'marker').map((e) => e.note);
    expect(markers).toEqual(['Experimento: inicio', 'Paso 1: Paso A', 'Paso 2: Paso B', 'Paso 3: Paso C (saltado)', 'Experimento: fin']);

    const text = experimentSummary(state, { name: 'ZYCL-FWD-DEMO' }, '4E');
    expect(text).toContain('2. Paso B');
    expect(text).toContain('Brillo 1: ');
    expect(text).toContain('3. Paso C: saltado');
  });

  it('can be finished early and reset', async () => {
    const { controller } = await connected();
    const runner = runnerFor(controller);
    await runner.start();
    await runner.finish();
    expect(runner.state.get().phase).toBe('finished');
    runner.reset();
    expect(runner.state.get().phase).toBe('idle');
    expect(runner.state.get().results).toEqual([]);
  });
});

describe('car-model codes', () => {
  it('names the F32 code from the vendor table', () => {
    expect(carModelForBits('01000010')?.model).toContain('Serie F');
    expect(carModelForBits('00000000')).toBeUndefined();
  });
});
