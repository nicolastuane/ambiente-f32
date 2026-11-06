/**
 * BLE session: connection state machine for one ZYCL-FWD module.
 *
 *   idle -> requesting -> connecting -> discovering -> ready
 *   ready -> (unexpected drop) -> reconnecting (up to 5 attempts) -> ready | error
 *   any -> disconnected (user) | error
 *
 * On ready: notifications on FFE1 are enabled, then "[0A01]" is written to
 * FFE2. Every GATT operation goes through the serial GattQueue.
 *
 * Optionally (startSecondaryNotifications) the session also listens on FFE2,
 * which the module declares as "notify" too. Those packets are only logged
 * (rx with char = FFE2): they never reach the Framer or the parser, so they
 * cannot corrupt the device state.
 *
 * The module accepts a single connection, so the session takes care never to
 * leave a GATT link open that it does not track (a cancelled or timed-out
 * connect that succeeds late is closed again).
 */
import { Framer } from '../protocol/zycela/parser';
import { fromBytes, toBytes } from '../protocol/zycela/commands';
import { Emitter, createStore } from '../util/store';
import type { Store } from '../util/store';
import type { BleAdapter, BleDeviceInfo, RequestDeviceOptions } from './adapter';
import {
  NotConnectedError,
  ZYCELA_NOTIFY_CHAR,
  ZYCELA_SERVICE,
  ZYCELA_WRITE_CHAR,
  chooseWriteWithResponse,
  propertiesList,
} from './adapter';
import { GattQueue, QueueClearedError, QueueTimeoutError } from './queue';

export { NotConnectedError } from './adapter';

export type ConnStatus =
  | 'idle'
  | 'requesting'
  | 'connecting'
  | 'discovering'
  | 'ready'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface GattServiceInfo {
  service: string;
  characteristics: { uuid: string; properties: string[] }[];
}

export interface SessionState {
  status: ConnStatus;
  device: BleDeviceInfo | null;
  error: string | null;
  /** Current reconnect attempt (1..maxAttempts) while status is "reconnecting". */
  attempt: number;
  maxAttempts: number;
  /**
   * Unexpected drops in the current unstable period. Back to 0 once the link
   * has stayed ready for `stableMs`; reconnection stops when it exceeds the limit.
   */
  drops: number;
  withResponse: boolean | null;
  gatt: GattServiceInfo[];
  /**
   * Listening on FFE2: off (nobody asked), pending (asked, link not ready),
   * on, or failed (the subscription was refused).
   */
  ffe2: Ffe2Status;
}

export type Ffe2Status = 'off' | 'pending' | 'on' | 'failed';

export interface TxEvent {
  at: Date;
  bytes: Uint8Array;
  text: string;
  char: string;
  withResponse: boolean;
}

export interface RxEvent {
  at: Date;
  bytes: Uint8Array;
  text: string;
  char: string;
  /** Complete frames finished by this notification. */
  frames: string[];
}

export interface SessionLogEvent {
  at: Date;
  kind: 'info' | 'error';
  note: string;
}

export interface SessionOptions {
  autoReconnect?: boolean;
  maxAttempts?: number;
  /** Delay before each reconnect attempt (the last value repeats). */
  backoffMs?: number[];
  /** Per-operation GATT timeout. */
  operationTimeoutMs?: number;
  /** Pause after each write without response (no flow control on some stacks). */
  writeWithoutResponseGapMs?: number;
  /** Upper bound for one GATT connect (CoreBluetooth never gives up on its own). */
  connectTimeoutMs?: number;
  /** How long the link must stay ready before earlier drops are forgotten. */
  stableMs?: number;
  /** Unexpected drops allowed within one unstable period (default: maxAttempts). */
  maxDrops?: number;
}

/** gatt.connect() did not finish in time. */
export class ConnectTimeoutError extends Error {
  constructor(ms: number) {
    super(`GATT connect timed out after ${ms} ms`);
    this.name = 'ConnectTimeoutError';
  }
}

const BUSY: readonly ConnStatus[] = ['requesting', 'connecting', 'discovering', 'ready'];

function errorName(error: unknown): string {
  return error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
}

function errorMessageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message;
    return message === undefined || message === null ? '' : String(message);
  }
  return error === undefined || error === null ? '' : String(error);
}

const NO_ADAPTER = /adapter|low energy/i;
const BT_DISABLED = /disabled|policy|denied|permission/i;
const MSG_NO_ADAPTER = 'No se encontró un adaptador Bluetooth. Activa el Bluetooth del ordenador o del móvil y vuelve a intentarlo.';
const MSG_BT_DISABLED =
  'El navegador tiene el Bluetooth web desactivado o sin permiso. Revisa los permisos del sitio y los del sistema (Bluetooth para el navegador).';

/**
 * Classifies a requestDevice() rejection: null when the user simply closed
 * the chooser, otherwise the Spanish message to show. Chrome uses
 * NotFoundError both for "User cancelled the requestDevice() chooser." and for
 * "Bluetooth adapter not available." / "Web Bluetooth API globally disabled."
 * and similar, so the message decides.
 */
export function chooserError(error: unknown): string | null {
  const name = errorName(error);
  if (name === 'AbortError') return null;
  if (name === 'NotFoundError') {
    const message = errorMessageOf(error);
    if (NO_ADAPTER.test(message)) return MSG_NO_ADAPTER;
    if (BT_DISABLED.test(message)) return MSG_BT_DISABLED;
    // A NotFoundError from the chooser itself never means "service missing".
    return null;
  }
  return bleErrorMessage(error, 'connect');
}

/** true when the user closed the device chooser without picking anything. */
export function isChooserCancel(error: unknown): boolean {
  return chooserError(error) === null;
}

/**
 * Spanish, user-facing description of a BLE error. `context` says whether it
 * happened while connecting (where the WeChat hint makes sense) or while
 * sending a command.
 */
export function bleErrorMessage(error: unknown, context: 'connect' | 'operation' = 'connect'): string {
  if (error instanceof NotConnectedError || errorName(error) === 'NotConnectedError') return 'No hay conexión con el módulo.';
  if (error instanceof QueueTimeoutError || error instanceof ConnectTimeoutError) return 'El módulo no respondió a tiempo.';
  if (error instanceof QueueClearedError) return 'Se canceló la operación porque se cortó la conexión.';
  if (error instanceof RangeError) return 'Valor fuera de rango.';
  switch (errorName(error)) {
    case 'BluetoothUnavailableError':
      return 'Este navegador no tiene Bluetooth web. En iPhone, abre la página en la app Bluefy; en el ordenador, usa Chrome o Edge.';
    case 'NetworkError':
      return context === 'connect'
        ? 'No se pudo conectar con el módulo. Si el mini-programa de WeChat está abierto, ciérralo: el módulo solo acepta una conexión.'
        : 'No se pudo enviar la orden: se cortó la comunicación con el módulo.';
    case 'NotFoundError': {
      const message = errorMessageOf(error);
      if (NO_ADAPTER.test(message)) return MSG_NO_ADAPTER;
      if (BT_DISABLED.test(message)) return MSG_BT_DISABLED;
      return 'El dispositivo no tiene el servicio FFE0. ¿Seguro que es un módulo ZYCL-FWD?';
    }
    case 'UnknownDeviceError':
      return 'El navegador ya no recuerda el módulo. Pulsa «Conectar» y elígelo en la lista.';
    case 'NoGattServerError':
      return 'El dispositivo elegido no admite conexiones Bluetooth LE.';
    case 'SecurityError':
      return 'El navegador bloqueó el Bluetooth. La página debe abrirse por HTTPS (o localhost) y la búsqueda debe empezar con un toque en «Conectar».';
    case 'NotSupportedError':
      return 'Este navegador no admite esta operación de Bluetooth.';
    case 'InvalidStateError':
      return 'El Bluetooth no está listo. Comprueba que está activado.';
    default: {
      const message = errorMessageOf(error).trim();
      // Bluefy sometimes rejects with an empty or "undefined" message.
      if (!message || message === 'undefined' || message === 'null') return 'Error de Bluetooth desconocido.';
      return `Error de Bluetooth: ${message}`;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BleSession {
  readonly state: Store<SessionState>;
  /** Complete "[...]" frames, in arrival order. */
  readonly frames = new Emitter<string>();
  readonly rx = new Emitter<RxEvent>();
  readonly tx = new Emitter<TxEvent>();
  readonly log = new Emitter<SessionLogEvent>();

  private readonly queue: GattQueue;
  private readonly framer = new Framer();
  private readonly maxAttempts: number;
  private readonly maxDrops: number;
  private readonly backoffMs: number[];
  private readonly gapMs: number;
  private readonly connectTimeoutMs: number;
  private readonly stableMs: number;
  private autoReconnect: boolean;
  /** Set by disconnect(); only cleared once the user actually picks a device again. */
  private userDisconnected = false;
  /** The last loss of the link was not asked for (enables reconnecting when the page is visible again). */
  private lostUnexpectedly = false;
  /** Token of the establish() call in progress, if any. */
  private establishingToken: number | null = null;
  private attemptSeq = 0;
  /** Set once a connection reached "ready" in this session (enables reconnects). */
  private hadConnection = false;
  private generation = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private offDisconnect: (() => void) | null = null;
  /** Who asked for FFE2 notifications (the lab toggle, the car tests…). */
  private readonly ffe2Owners = new Set<string>();

  constructor(
    readonly adapter: BleAdapter,
    options: SessionOptions = {},
  ) {
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.maxDrops = options.maxDrops ?? this.maxAttempts;
    this.backoffMs = options.backoffMs ?? [500, 1000, 2000, 4000, 8000];
    this.gapMs = options.writeWithoutResponseGapMs ?? 10;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 12000;
    this.stableMs = options.stableMs ?? 10000;
    this.queue = new GattQueue(options.operationTimeoutMs ?? 5000, 1);
    this.state = createStore<SessionState>({
      status: 'idle',
      device: null,
      error: null,
      attempt: 0,
      maxAttempts: this.maxAttempts,
      drops: 0,
      withResponse: null,
      gatt: [],
      ffe2: 'off',
    });
  }

  get status(): ConnStatus {
    return this.state.get().status;
  }

  get ready(): boolean {
    return this.state.get().status === 'ready';
  }

  setAutoReconnect(enabled: boolean): void {
    this.autoReconnect = enabled;
  }

  private patch(partial: Partial<SessionState>): void {
    this.state.update((s) => ({ ...s, ...partial }));
  }

  private info(note: string): void {
    this.log.emit({ at: new Date(), kind: 'info', note });
  }

  private logError(note: string): void {
    this.log.emit({ at: new Date(), kind: 'error', note });
  }

  /**
   * Opens the chooser and connects. Call it synchronously from a click
   * handler: the adapter's requestDevice() runs before any await.
   */
  connect(options: RequestDeviceOptions = {}): Promise<void> {
    if (BUSY.includes(this.status)) return Promise.resolve();
    this.cancelReconnect();
    const generation = ++this.generation;
    const hadDevice = !!this.state.get().device;
    this.patch({ status: 'requesting', error: null, attempt: 0 });
    let request: Promise<BleDeviceInfo>;
    try {
      request = this.adapter.requestDevice(options);
    } catch (error) {
      request = Promise.reject(error);
    }
    return request.then(
      (device) => {
        if (generation !== this.generation) return undefined;
        // Only now does the user's earlier "Desconectar" stop applying.
        this.userDisconnected = false;
        this.lostUnexpectedly = false;
        this.patch({ drops: 0 });
        return this.start(device, generation);
      },
      (error: unknown) => {
        if (generation !== this.generation) return;
        const message = chooserError(error);
        if (message === null) {
          // Chooser closed: back to the previous resting state. A previous
          // "Desconectar" stays in force (userDisconnected was not touched).
          this.patch({ status: hadDevice ? 'disconnected' : 'idle' });
          return;
        }
        this.logError(message);
        this.patch({ status: 'error', error: message, attempt: 0 });
      },
    );
  }

  /** Connects to a device the adapter already knows (no chooser, no gesture needed). */
  connectTo(device: BleDeviceInfo): Promise<void> {
    if (BUSY.includes(this.status)) return Promise.resolve();
    this.cancelReconnect();
    this.userDisconnected = false;
    this.lostUnexpectedly = false;
    const generation = ++this.generation;
    this.patch({ error: null, attempt: 0, drops: 0 });
    return this.start(device, generation);
  }

  private async start(device: BleDeviceInfo, generation: number): Promise<void> {
    this.patch({ device });
    try {
      await this.establish(device, generation, false);
    } catch (error) {
      if (generation !== this.generation) return;
      await this.safeDisconnect(device.id);
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    const message = bleErrorMessage(error, 'connect');
    this.logError(message);
    this.patch({ status: 'error', error: message, attempt: 0 });
  }

  private async establish(device: BleDeviceInfo, generation: number, reconnecting: boolean): Promise<void> {
    const token = ++this.attemptSeq;
    const stale = () => generation !== this.generation || this.userDisconnected;
    this.establishingToken = token;
    let ready = false;
    try {
      if (!reconnecting) this.patch({ status: 'connecting' });
      this.offDisconnect?.();
      this.offDisconnect = this.adapter.onDisconnect(device.id, () => this.handleDisconnect());
      await this.connectBounded(device.id, token);
      if (stale()) return await this.releaseStaleLink(device.id, token);
      if (!reconnecting) this.patch({ status: 'discovering' });
      const writeChar = await this.queue.run(
        () => this.adapter.getCharacteristic(device.id, ZYCELA_SERVICE, ZYCELA_WRITE_CHAR),
        { label: 'discover FFE2' },
      );
      const notifyChar = await this.queue.run(
        () => this.adapter.getCharacteristic(device.id, ZYCELA_SERVICE, ZYCELA_NOTIFY_CHAR),
        { label: 'discover FFE1' },
      );
      if (stale()) return await this.releaseStaleLink(device.id, token);
      const withResponse = chooseWriteWithResponse(writeChar.properties);
      this.framer.reset();
      await this.queue.run(
        () => this.adapter.startNotifications(device.id, ZYCELA_SERVICE, ZYCELA_NOTIFY_CHAR, (data) => this.handleData(data)),
        { label: 'notify FFE1' },
      );
      if (stale()) return await this.releaseStaleLink(device.id, token);
      this.hadConnection = true;
      this.lostUnexpectedly = false;
      this.patch({
        status: 'ready',
        attempt: 0,
        error: null,
        withResponse,
        gatt: [
          {
            service: ZYCELA_SERVICE,
            characteristics: [
              { uuid: ZYCELA_NOTIFY_CHAR, properties: propertiesList(notifyChar.properties) },
              { uuid: ZYCELA_WRITE_CHAR, properties: propertiesList(writeChar.properties) },
            ],
          },
        ],
      });
      this.armStableTimer();
      this.info(`Conectado a ${device.name ?? 'módulo'} (escritura ${withResponse ? 'con' : 'sin'} respuesta)`);
      ready = true;
    } finally {
      if (this.establishingToken === token) this.establishingToken = null;
    }
    if (!ready || stale()) return;
    if (this.ffe2Owners.size > 0) await this.subscribeSecondary();
    if (stale()) return;
    // Ask for the full state, as the mini-program does right after connecting.
    await this.sendText('[0A01]').catch((error: unknown) => this.logError(bleErrorMessage(error, 'operation')));
  }

  /**
   * adapter.connect() with an upper time limit. On timeout the attempt is
   * abandoned (disconnect() aborts a pending connect per the spec) and, should
   * it still succeed later, the late link is closed unless someone uses it.
   */
  private async connectBounded(deviceId: string, token: number): Promise<void> {
    const attempt = this.adapter.connect(deviceId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ConnectTimeoutError(this.connectTimeoutMs)), this.connectTimeoutMs);
    });
    try {
      await Promise.race([attempt, timeout]);
    } catch (error) {
      if (error instanceof ConnectTimeoutError) {
        attempt.then(
          () => this.releaseStaleLink(deviceId, token),
          () => undefined,
        );
        await this.safeDisconnect(deviceId);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Called when a connection attempt finished after it stopped mattering
   * (user disconnect, newer attempt, timeout). Closes the link unless a newer
   * attempt or a ready session is using the same device, so the single-link
   * module stays free for the next connection (or for WeChat).
   */
  private async releaseStaleLink(deviceId: string, token: number): Promise<void> {
    const { device, status } = this.state.get();
    const newerAttempt = this.establishingToken !== null && this.establishingToken !== token;
    const inUse = device?.id === deviceId && (newerAttempt || status === 'ready');
    if (!inUse) {
      this.info('Se cerró una conexión que ya no hacía falta');
      await this.safeDisconnect(deviceId);
    }
  }

  private handleData(data: Uint8Array): void {
    const frames = this.framer.push(data);
    this.rx.emit({ at: new Date(), bytes: data, text: fromBytes(data), char: ZYCELA_NOTIFY_CHAR, frames });
    for (const frame of frames) this.frames.emit(frame);
  }

  /** FFE2 packets: logged only, never framed or parsed. */
  private handleSecondaryData(data: Uint8Array): void {
    this.rx.emit({ at: new Date(), bytes: data, text: fromBytes(data), char: ZYCELA_WRITE_CHAR, frames: [] });
  }

  /** true while someone asked for FFE2 notifications. */
  get ffe2Wanted(): boolean {
    return this.ffe2Owners.size > 0;
  }

  /** true while `owner` asked for FFE2 notifications. */
  ffe2WantedBy(owner: string): boolean {
    return this.ffe2Owners.has(owner);
  }

  /**
   * Also listen for notifications on FFE2. `owner` lets several features ask
   * independently (it stays on while any of them wants it). Re-applied after
   * every reconnection while enabled. Never throws: a refusal is logged and
   * shown as ffe2 = "failed".
   */
  async startSecondaryNotifications(owner = 'default'): Promise<void> {
    const already = this.ffe2Owners.size > 0;
    this.ffe2Owners.add(owner);
    if (already && this.state.get().ffe2 === 'on') return;
    await this.subscribeSecondary();
  }

  /** Stops FFE2 notifications once no owner wants them any more. */
  async stopSecondaryNotifications(owner = 'default'): Promise<void> {
    this.ffe2Owners.delete(owner);
    if (this.ffe2Owners.size > 0) return;
    const { status, device, ffe2 } = this.state.get();
    this.setFfe2('off');
    if (status !== 'ready' || !device || ffe2 !== 'on') return;
    try {
      await this.queue.run(() => this.adapter.stopNotifications(device.id, ZYCELA_SERVICE, ZYCELA_WRITE_CHAR), {
        label: 'stop notify FFE2',
        retries: 0,
      });
      this.info('Ya no se escucha FFE2');
    } catch (error) {
      if (!(error instanceof QueueClearedError)) this.logError(`No se pudo dejar de escuchar FFE2: ${bleErrorMessage(error, 'operation')}`);
    }
  }

  private async subscribeSecondary(): Promise<void> {
    const { status, device } = this.state.get();
    if (status !== 'ready' || !device) {
      this.setFfe2('pending');
      return;
    }
    try {
      await this.queue.run(
        () =>
          this.adapter.startNotifications(device.id, ZYCELA_SERVICE, ZYCELA_WRITE_CHAR, (data) => this.handleSecondaryData(data)),
        { label: 'notify FFE2' },
      );
      if (this.ffe2Owners.size === 0) {
        // Switched off while the subscription was being set up.
        await this.adapter.stopNotifications(device.id, ZYCELA_SERVICE, ZYCELA_WRITE_CHAR).catch(() => undefined);
        return;
      }
      this.setFfe2('on');
      this.info('Escuchando también FFE2');
    } catch (error) {
      if (this.ffe2Owners.size === 0) return;
      this.setFfe2('failed');
      this.logError(`No se pudo escuchar FFE2: ${bleErrorMessage(error, 'operation')}`);
    }
  }

  private handleDisconnect(): void {
    const { status, device, drops } = this.state.get();
    // A late or repeated event while the link is actually up: nothing was lost.
    if (device && this.adapter.isConnected?.(device.id)) return;
    this.queue.clear('Desconectado');
    this.framer.reset();
    this.clearStableTimer();
    // FFE2 listening resumes after the next connection; folded into the status update below.
    const ffe2: Ffe2Status = this.ffe2Owners.size > 0 ? 'pending' : 'off';
    if (this.establishingToken !== null || this.userDisconnected || status !== 'ready') {
      // establish() fails and handles it / disconnect() already set the status / nothing was up.
      this.setFfe2(ffe2);
      return;
    }
    this.lostUnexpectedly = true;
    this.logError('Se perdió la conexión con el módulo');
    const count = drops + 1;
    if (!this.autoReconnect || !device) {
      this.patch({ status: 'disconnected', drops: count, error: 'Se perdió la conexión con el módulo.', ffe2 });
      return;
    }
    if (count > this.maxDrops) {
      // Connect-then-drop loop (e.g. Bluefy, or WeChat grabbing the module): stop.
      this.patch({
        status: 'error',
        attempt: 0,
        drops: count,
        error: 'La conexión con el módulo se corta una y otra vez. Cierra el mini-programa de WeChat, comprueba que el módulo tiene corriente y vuelve a conectar.',
        ffe2,
      });
      this.logError('Reconexión abandonada: demasiados cortes seguidos');
      return;
    }
    this.scheduleReconnect(1, { drops: count, ffe2 });
  }

  /** Updates the FFE2 status only when it changes (no spurious state notifications). */
  private setFfe2(ffe2: Ffe2Status): void {
    if (this.state.get().ffe2 !== ffe2) this.patch({ ffe2 });
  }

  /** `extra` is merged into the same state update (one notification per transition). */
  private scheduleReconnect(attempt: number, extra: Partial<SessionState> = {}): void {
    const device = this.state.get().device;
    if (!device) return;
    if (attempt > this.maxAttempts) {
      this.patch({
        ...extra,
        status: 'error',
        attempt: 0,
        error: `No se pudo reconectar tras ${this.maxAttempts} intentos. Comprueba que el módulo tiene corriente y vuelve a conectar.`,
      });
      this.logError('Reconexión abandonada');
      return;
    }
    const generation = this.generation;
    this.patch({ ...extra, status: 'reconnecting', attempt, error: null });
    const wait = this.backoffMs[Math.min(attempt - 1, this.backoffMs.length - 1)] ?? 1000;
    this.cancelReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (generation !== this.generation || this.userDisconnected) return;
      this.info(`Reintentando conexión (${attempt}/${this.maxAttempts})`);
      this.establish(device, generation, true).catch(async (error: unknown) => {
        if (generation !== this.generation || this.userDisconnected) return;
        this.logError(`Intento ${attempt} fallido: ${bleErrorMessage(error, 'connect')}`);
        await this.safeDisconnect(device.id);
        this.scheduleReconnect(attempt + 1);
      });
    }, wait);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /** Forgets earlier drops once the link has stayed up for `stableMs`. */
  private armStableTimer(): void {
    this.clearStableTimer();
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null;
      if (this.status === 'ready' && this.state.get().drops !== 0) this.patch({ drops: 0 });
    }, this.stableMs);
  }

  private clearStableTimer(): void {
    if (this.stableTimer !== null) clearTimeout(this.stableTimer);
    this.stableTimer = null;
  }

  private async safeDisconnect(deviceId: string): Promise<void> {
    try {
      await this.adapter.disconnect(deviceId);
    } catch {
      // Ignore: we are cleaning up.
    }
  }

  /** User-initiated disconnect: never followed by an automatic reconnect. */
  async disconnect(): Promise<void> {
    this.userDisconnected = true;
    this.lostUnexpectedly = false;
    this.generation++;
    this.cancelReconnect();
    this.clearStableTimer();
    this.queue.clear('Desconectado por el usuario');
    const device = this.state.get().device;
    if (device) await this.safeDisconnect(device.id);
    this.framer.reset();
    this.patch({ status: 'disconnected', attempt: 0, error: null, drops: 0, ffe2: this.ffe2Owners.size > 0 ? 'pending' : 'off' });
    this.info('Desconectado');
  }

  /** Call when the page becomes visible again (iOS suspends JavaScript in the background). */
  onVisible(): void {
    const { status, device } = this.state.get();
    if (!device || this.userDisconnected) return;
    if (status === 'ready' && this.adapter.isConnected && !this.adapter.isConnected(device.id)) {
      this.handleDisconnect();
      return;
    }
    // Only resume after a loss the user did not ask for.
    if ((status === 'disconnected' || status === 'error') && this.hadConnection && this.lostUnexpectedly && this.autoReconnect) {
      this.scheduleReconnect(1);
    }
  }

  /** Writes raw bytes to FFE2 through the queue. Each command is sent once (no retry). */
  write(bytes: Uint8Array): Promise<void> {
    const { status, device, withResponse } = this.state.get();
    if (status !== 'ready' || !device) return Promise.reject(new NotConnectedError());
    const mode = withResponse ?? true;
    return this.queue
      .run(
        async () => {
          this.tx.emit({ at: new Date(), bytes, text: fromBytes(bytes), char: ZYCELA_WRITE_CHAR, withResponse: mode });
          await this.adapter.write(device.id, ZYCELA_SERVICE, ZYCELA_WRITE_CHAR, bytes, mode);
          if (!mode && this.gapMs > 0) await delay(this.gapMs);
        },
        // The mini-program sends every command exactly once; some ([4100],
        // [22XX], [4200]) must not run twice.
        { label: 'write FFE2', retries: 0 },
      )
      .catch((error: unknown) => {
        if (!(error instanceof QueueClearedError)) {
          this.logError(`Error al escribir: ${bleErrorMessage(error, 'operation')}`);
          this.checkLink(device.id);
        }
        throw error;
      });
  }

  /**
   * After a failed write: if the link is in fact down but no
   * gattserverdisconnected arrived (not guaranteed on Bluefy), start the
   * usual drop handling.
   */
  private checkLink(deviceId: string): void {
    const { status, device } = this.state.get();
    if (status !== 'ready' || device?.id !== deviceId || !this.adapter.isConnected) return;
    if (!this.adapter.isConnected(deviceId)) this.handleDisconnect();
  }

  /** Writes an ASCII command such as "[0A01]". */
  sendText(text: string): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = toBytes(text);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.write(bytes);
  }

  dispose(): void {
    this.offDisconnect?.();
    this.offDisconnect = null;
    this.clearStableTimer();
    void this.disconnect();
    this.frames.clear();
    this.rx.clear();
    this.tx.clear();
    this.log.clear();
  }
}
