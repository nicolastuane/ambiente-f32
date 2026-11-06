import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockAdapter } from '../src/ble/mockAdapter';
import { ZycelaDriver } from '../src/protocol/zycela/driver';
import type { ZycelaTransport } from '../src/protocol/zycela/driver';
import type { ParsedFrame } from '../src/protocol/zycela/parser';
import { BUILT_IN_SCENES, sceneToCommands } from '../src/protocol/zycela/scenes';
import { AppController } from '../src/state/controller';
import { Emitter } from '../src/util/store';
import { waitFor } from './helpers';

type MockOptions = ConstructorParameters<typeof MockAdapter>[0];
type SessionOpts = NonNullable<ConstructorParameters<typeof AppController>[1]>['session'];

function makeController(options: MockOptions = {}, session: SessionOpts = {}) {
  const adapter = new MockAdapter({ latencyMs: 3, connectDelayMs: 2, learnDelayMs: 40, ...options });
  const controller = new AppController(adapter, {
    toastMs: 0,
    autoReconnect: true,
    session: { backoffMs: [5, 5, 5, 5, 5], operationTimeoutMs: 500, ...session },
    driver: { scenePacingMs: 5, factorySettleMs: 50 },
  });
  return { adapter, controller };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const controllers: AppController[] = [];
afterEach(() => {
  for (const c of controllers.splice(0)) c.dispose();
  vi.useRealTimers();
});

async function connected(options?: MockOptions, session?: SessionOpts) {
  const made = makeController(options, session);
  controllers.push(made.controller);
  await made.controller.connect();
  await waitFor(() => made.controller.session.status === 'ready', 3000, 'ready');
  await waitFor(
    () => {
      const d = made.controller.device.get();
      return d.firmware !== null && d.version !== null && d.rgbSequence !== null && d.welcomeEnabled !== null;
    },
    3000,
    'initial state frames',
  );
  return made;
}

describe('driver + mock adapter round trip', () => {
  it('connects, enables notifications, sends [0A01] and receives the state', async () => {
    const { adapter, controller } = await connected();
    expect(adapter.device.received[0]).toBe('[0A01]');
    const d = controller.device.get();
    expect(d.firmware).toBe('4E');
    expect(d.color).toBe('#ff6a00');
    expect(d.brightness).toEqual({ b1: 8, b2: 7, b3: 5 });
    expect(d.events.blindSpot).toBe(255); // the mock reports the blind spot as unsupported
    expect(d.version?.carModel).toBe('DEMO-F32');
    expect(d.rgbSequence).toEqual([0, 1, 2, 9, null, null, null, null]);
    expect(controller.session.state.get().withResponse).toBe(true);
    const tx = controller.log.get().filter((e) => e.kind === 'tx');
    expect(tx[0]).toMatchObject({ text: '[0A01]', hex: '5B 30 41 30 31 5D', char: '0000ffe2-0000-1000-8000-00805f9b34fb' });
  });

  it('changes the colour: optimistic update, then the module state frame', async () => {
    const { adapter, controller } = await connected();
    const frames: ParsedFrame[] = [];
    controller.onFrame((f) => frames.push(f));
    await controller.driver.setColor(0, '#00FF00');
    expect(controller.device.get().color).toBe('#00ff00'); // optimistic
    await waitFor(() => frames.some((f) => f.kind === 'state' && f.color === '#00ff00'), 2000, 'state frame');
    expect(adapter.device.state.color).toBe('00ff00');
    expect(adapter.device.received).toContain('[0600ff00]');
    expect(controller.device.get().color).toBe('#00ff00');
  });

  it('reconciles an optimistic value with the module frame', async () => {
    const { adapter, controller } = await connected();
    // The module ignores the blind-spot switch (unsupported): the reply keeps "ff".
    await controller.driver.setCarEvent('blindSpot', true);
    expect(controller.device.get().events.blindSpot).toBe(1);
    await waitFor(() => controller.device.get().events.blindSpot === 255, 2000, 'reconciled blind spot');
    expect(adapter.device.state.events['44']).toBe(255);
  });

  it('applies a scene as an ordered command sequence, then reads the state back', async () => {
    const { adapter, controller } = await connected();
    const scene = BUILT_IN_SCENES[0];
    const before = adapter.device.received.length;
    await controller.driver.applyScene(scene.data);
    expect(adapter.device.received.slice(before)).toEqual([...sceneToCommands(scene.data), '[0A01]']);
    expect(sceneToCommands(scene.data)).toEqual(['[0701]', '[0400]', '[06ff6a00]', '[1E18]', '[020008]', '[010108]', '[010206]']);
  });

  it('learns a steering-wheel key: [2101], factory frames, [22XX], wait for 17, [2100]', async () => {
    const { adapter, controller } = await connected();
    const before = adapter.device.received.length;
    // Regression: [22XX] must wait until factory mode is in effect (4F/58 received).
    const original = adapter.device.handle.bind(adapter.device);
    let factoryFramesAtLearn: string[] | null = null;
    let enteredAt = 0;
    let learnAt = 0;
    adapter.device.handle = (command: string) => {
      if (command === '[2101]') enteredAt = Date.now();
      if (command.startsWith('[22')) {
        learnAt = Date.now();
        factoryFramesAtLearn = [...controller.device.get().factory.received];
      }
      original(command);
    };
    const outcome = await controller.driver.learnKey(4, { timeoutMs: 2000 });
    expect(outcome).toBe('learned');
    expect(adapter.device.received.slice(before)).toEqual(['[2101]', '[2204]', '[2100]']);
    expect(factoryFramesAtLearn).toContain('4F');
    expect(learnAt - enteredAt).toBeGreaterThanOrEqual(40); // factorySettleMs (50) minus timer jitter
    expect(controller.toasts.get().some((t) => t.text === 'Botón aprendido')).toBe(true);
  });

  it('the mock only answers [22XX] in factory mode', async () => {
    const { adapter, controller } = await connected();
    const frames: ParsedFrame[] = [];
    controller.onFrame((f) => frames.push(f));
    await controller.driver.send('[2204]');
    await sleep(150); // learnDelayMs is 40
    expect(frames.some((f) => f.kind === 'keyLearnResult')).toBe(false);
    expect(adapter.device.state.factoryMode).toBe(false);
  });

  it('key learning can be cancelled while waiting for factory mode', async () => {
    const { adapter, controller } = await connected();
    const before = adapter.device.received.length;
    const ac = new AbortController();
    const pending = controller.driver.learnKey(2, { timeoutMs: 2000, signal: ac.signal });
    ac.abort();
    expect(await pending).toBe('cancelled');
    const sent = adapter.device.received.slice(before);
    expect(sent).not.toContain('[2202]');
    expect(sent[sent.length - 1]).toBe('[2100]');
  });

  it('key learning times out and still leaves factory mode', async () => {
    const { adapter, controller } = await connected({ learnDelayMs: 5000 });
    const before = adapter.device.received.length;
    const outcome = await controller.driver.learnKey(1, { timeoutMs: 60 });
    expect(outcome).toBe('timeout');
    expect(adapter.device.received.slice(before)).toEqual(['[2101]', '[2201]', '[2100]']);
  });

  it('factory mode returns 23, 25 and 4F; settings answer with 2E', async () => {
    const { controller } = await connected();
    await controller.driver.enterFactoryMode();
    await waitFor(() => controller.device.get().factory.received.length === 3, 2000, 'factory frames');
    expect(controller.device.get().factory).toMatchObject({ carBits: '01000010', customerCode: 0 });
    await controller.driver.setDialCodes('01000000', '00000000');
    await waitFor(() => controller.toasts.get().some((t) => t.text === 'Ajuste aplicado'), 2000, '2E toast');
    expect(controller.device.get().factory.carBits).toBe('01000000');
  });

  it('[4100] answers 18 "not supported" and [4200] answers 2E', async () => {
    const { controller } = await connected();
    await controller.driver.activateOriginalMenu();
    await waitFor(() => controller.toasts.get().some((t) => t.text === 'Tu módulo no admite esta función'), 2000, '18 toast');
    await controller.driver.restoreFactory();
    await waitFor(() => controller.toasts.get().some((t) => t.text === 'Ajuste aplicado'), 2000, '2E toast');
  });

  it('rejects commands while disconnected', async () => {
    const { controller } = makeController();
    controllers.push(controller);
    await expect(controller.driver.setPower(1)).rejects.toThrow('Not connected');
  });

  it('sendRaw sends text as ASCII and bytes as-is', async () => {
    const { adapter, controller } = await connected();
    await controller.driver.sendRaw('[0701]');
    await controller.driver.sendRaw(new Uint8Array([0x5b, 0x30, 0x37, 0x30, 0x30, 0x5d]));
    expect(adapter.device.received.slice(-2)).toEqual(['[0701]', '[0700]']);
    expect(controller.device.get().power).toBe(0);
  });
});

describe('session: reconnection', () => {
  it('reconnects automatically after an unexpected drop', async () => {
    const { adapter, controller } = await connected();
    const statuses: string[] = [];
    controller.session.state.subscribe(() => statuses.push(controller.session.status));
    adapter.simulateDrop(0);
    await waitFor(() => controller.session.status === 'ready' && statuses.includes('reconnecting'), 3000, 'reconnected');
    expect(statuses[0]).toBe('reconnecting');
    // [0A01] is sent again right after reconnecting.
    await waitFor(() => adapter.device.received.filter((c) => c === '[0A01]').length === 2, 2000, 'second [0A01]');
    const texts = controller.toasts.get().map((t) => t.text);
    expect(texts).toContain('Se perdió la conexión. Reconectando…');
    expect(texts).toContain('Conexión recuperada');
  });

  it('gives up after 5 attempts', async () => {
    const { adapter, controller } = await connected();
    adapter.simulateDrop(60_000);
    await waitFor(() => controller.session.status === 'error', 5000, 'error');
    expect(controller.session.state.get().error).toContain('5 intentos');
  });

  it('never reconnects after a user disconnect', async () => {
    const { controller } = await connected();
    await controller.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(controller.session.status).toBe('disconnected');
  });

  // Regression: cancelling during a pending gatt.connect() left a link open
  // that nothing tracked (the single-link module then stays invisible).
  it('closes a link that connects after the user cancelled the reconnection', async () => {
    const { adapter, controller } = await connected();
    adapter.setConnectDelay(150);
    adapter.simulateDrop(0);
    await waitFor(() => controller.session.status === 'reconnecting', 1000, 'reconnecting');
    await sleep(40); // the reconnect's connect() is now pending
    await controller.disconnect();
    expect(controller.session.status).toBe('disconnected');
    await sleep(250); // the pending connect resolves
    expect(adapter.isConnected('x')).toBe(false);
    expect(controller.session.status).toBe('disconnected');
  });

  // Regression: connect() had no time limit (CoreBluetooth never gives up).
  it('bounds each connect attempt and gives up after 5, closing late links', async () => {
    const { adapter, controller } = await connected({}, { connectTimeoutMs: 40 });
    adapter.setConnectDelay(120);
    adapter.simulateDrop(0);
    await waitFor(() => controller.session.status === 'error', 3000, 'error after 5 bounded attempts');
    expect(controller.session.state.get().error).toContain('5 intentos');
    await sleep(250); // every late connect has resolved by now
    expect(adapter.isConnected('x')).toBe(false);
  });

  // Regression: a connect-then-drop loop reset the attempt counter forever.
  it('stops a connect-then-drop loop and toasts once per episode', async () => {
    const { adapter, controller } = await connected();
    let readies = 0;
    controller.session.state.subscribe(() => {
      if (controller.session.status === 'ready') {
        readies++;
        setTimeout(() => adapter.simulateDrop(0), 1);
      }
    });
    adapter.simulateDrop(0);
    await waitFor(() => controller.session.status === 'error', 5000, 'error after repeated drops');
    expect(controller.session.state.get().error).toContain('una y otra vez');
    expect(readies).toBeLessThanOrEqual(6);
    const texts = controller.toasts.get().map((t) => t.text);
    expect(texts.filter((t) => t.startsWith('Se perdió la conexión'))).toHaveLength(1);
    expect(texts.filter((t) => t === 'Conexión recuperada')).toHaveLength(1);
    await sleep(60);
    expect(controller.session.status).toBe('error');
  });

  // Regression: cancelling the chooser cleared the user's "Desconectar", and
  // the next visibility change reconnected silently.
  it('a cancelled chooser keeps an earlier user disconnect in force', async () => {
    const { adapter, controller } = await connected();
    await controller.disconnect();
    adapter.failNextRequest();
    await controller.connect();
    expect(controller.session.status).toBe('disconnected');
    controller.onVisible();
    await sleep(100);
    expect(controller.session.status).toBe('disconnected');
    expect(adapter.isConnected('x')).toBe(false);
  });

  it('a chooser that fails for lack of an adapter shows a message', async () => {
    const { adapter, controller } = makeController();
    controllers.push(controller);
    const error = Object.assign(new Error('Bluetooth adapter not available.'), { name: 'NotFoundError' });
    adapter.failNextRequest(error);
    await controller.connect();
    expect(controller.session.status).toBe('error');
    expect(controller.session.state.get().error).toContain('adaptador Bluetooth');
  });

  // Regression: without gattserverdisconnected (possible on Bluefy) a dead
  // link stayed "ready" forever; writes are also never retried.
  it('a failed write on a dead link starts the reconnection, without retrying the write', async () => {
    const { adapter, controller } = await connected();
    const writes = vi.spyOn(adapter, 'write');
    const statuses: string[] = [];
    controller.session.state.subscribe(() => statuses.push(controller.session.status));
    adapter.simulateSilentDrop();
    await expect(controller.driver.setPower(1)).rejects.toMatchObject({ name: 'NetworkError' });
    expect(writes).toHaveBeenCalledTimes(1);
    await waitFor(() => statuses.includes('reconnecting') && controller.session.status === 'ready', 3000, 'reconnected');
  });
});

describe('colour throttling', () => {
  function fakeTransport() {
    const sent: string[] = [];
    const frames = new Emitter<ParsedFrame>();
    const transport: ZycelaTransport = {
      send: async (text) => {
        sent.push(text);
      },
      sendBytes: async () => undefined,
      onFrame: (listener) => frames.on(listener),
    };
    return { sent, transport };
  }

  it('sends at most one colour every 120 ms and always the last value', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const { sent, transport } = fakeTransport();
    const driver = new ZycelaDriver(transport);
    driver.setColorLive(0, '#000001'); // leading edge: sent now
    for (let i = 2; i <= 10; i++) {
      await vi.advanceTimersByTimeAsync(10);
      driver.setColorLive(0, `#00000${i.toString(16)}`);
    }
    expect(sent).toEqual(['[06000001]']);
    await vi.advanceTimersByTimeAsync(120);
    expect(sent).toEqual(['[06000001]', '[0600000a]']);
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).toHaveLength(2);
  });

  // Regression: with slow writes (200 ms round trip) a time-only throttle
  // queued a backlog of stale colours that kept playing after the drag.
  it('never has more than one live colour write in flight on a slow link', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const sent: { text: string; at: number }[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const transport: ZycelaTransport = {
      send: async (text) => {
        sent.push({ text, at: Date.now() });
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 200));
        inFlight--;
      },
      sendBytes: async () => undefined,
      onFrame: () => () => undefined,
    };
    const driver = new ZycelaDriver(transport);
    // 3 s drag, one colour every 16 ms.
    let last = '';
    for (let t = 0; t < 3000; t += 16) {
      last = `#${t.toString(16).padStart(6, '0')}`;
      driver.setColorLive(0, last);
      await vi.advanceTimersByTimeAsync(16);
    }
    const releasedAt = Date.now();
    const flushed = driver.flushColor();
    await vi.advanceTimersByTimeAsync(1000);
    await flushed;
    expect(maxInFlight).toBe(1);
    expect(sent[sent.length - 1].text).toBe(`[06${last.slice(1)}]`);
    // After the finger lifts: only the final value, right after the write in flight.
    expect(sent.filter((s) => s.at >= releasedAt).length).toBeLessThanOrEqual(1);
    expect(sent.filter((s) => s.at > releasedAt + 200)).toHaveLength(0);
  });

  it('paces scene commands and reads the state back', async () => {
    const times: number[] = [];
    const sentScene: string[] = [];
    const transport: ZycelaTransport = {
      send: async (text) => {
        sentScene.push(text);
        times.push(Date.now());
      },
      sendBytes: async () => undefined,
      onFrame: () => () => undefined,
    };
    const driver = new ZycelaDriver(transport, { scenePacingMs: 30 });
    await driver.applyScene(BUILT_IN_SCENES[0].data);
    expect(sentScene).toEqual([...sceneToCommands(BUILT_IN_SCENES[0].data), '[0A01]']);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(25);
  });

  it('flushColor sends the pending value immediately', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const { sent, transport } = fakeTransport();
    const driver = new ZycelaDriver(transport);
    driver.setColorLive(1, '#ff0000');
    driver.setColorLive(1, '#00ff00');
    await driver.flushColor();
    expect(sent).toEqual(['[10ff0000]', '[1000ff00]']);
    vi.advanceTimersByTime(500);
    expect(sent).toHaveLength(2);
  });

  it('validates input synchronously', () => {
    const { transport } = fakeTransport();
    const driver = new ZycelaDriver(transport);
    expect(() => driver.setColorLive(0, 'nope')).toThrow(RangeError);
  });
});
