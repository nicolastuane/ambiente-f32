/** BleAdapter backed by the simulated module (demo mode and tests). */
import { ZycelaMockDevice } from '../mock/zycelaMock';
import type { MockDeviceOptions } from '../mock/zycelaMock';
import type { BleAdapter, BleDeviceInfo, CharInfo, RequestDeviceOptions } from './adapter';
import { ZYCELA_NOTIFY_CHAR, ZYCELA_SERVICE, ZYCELA_WRITE_CHAR } from './adapter';

export const MOCK_DEVICE: BleDeviceInfo = { id: 'demo-zycl-fwd', name: 'ZYCL-FWD-DEMO' };

export interface MockAdapterOptions extends MockDeviceOptions {
  /** Delay of the "chooser" and of the GATT connection. */
  connectDelayMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bleError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

export class MockAdapter implements BleAdapter {
  readonly kind = 'mock' as const;
  readonly device: ZycelaMockDevice;
  private connected = false;
  private unreachableUntil = 0;
  private notify: ((data: Uint8Array) => void) | null = null;
  /** FFE2 subscription (the real module declares notify on FFE2 too; the simulated one stays silent). */
  private notifyWrite: ((data: Uint8Array) => void) | null = null;
  private readonly disconnectListeners = new Set<() => void>();
  private connectDelayMs: number;
  private readonly latencyMs: number;
  private nextRequestError: Error | null = null;

  constructor(options: MockAdapterOptions = {}) {
    this.connectDelayMs = options.connectDelayMs ?? 400;
    this.latencyMs = options.latencyMs ?? 60;
    this.device = new ZycelaMockDevice((bytes) => {
      if (this.connected) this.notify?.(bytes);
    }, options);
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  requestDevice(_options?: RequestDeviceOptions): Promise<BleDeviceInfo> {
    const error = this.nextRequestError;
    this.nextRequestError = null;
    return delay(this.connectDelayMs).then(() => {
      if (error) throw error;
      return { ...MOCK_DEVICE };
    });
  }

  /** Makes the next requestDevice() reject, e.g. as if the user closed the chooser. */
  failNextRequest(error: Error = bleError('NotFoundError', 'User cancelled the requestDevice() chooser.')): void {
    this.nextRequestError = error;
  }

  /** Changes how long connect() (and the chooser) take from now on (simulates an unresponsive module). */
  setConnectDelay(ms: number): void {
    this.connectDelayMs = ms;
  }

  /** The link dies without a gattserverdisconnected event (as may happen on Bluefy). */
  simulateSilentDrop(unreachableMs = 0): void {
    this.unreachableUntil = Date.now() + unreachableMs;
    this.connected = false;
    this.notify = null;
    this.notifyWrite = null;
    this.device.stop();
  }

  /** true while the app is subscribed to FFE2 notifications (tests). */
  get listeningOnWriteChar(): boolean {
    return this.connected && this.notifyWrite !== null;
  }

  /** Emits a notification on FFE2, as the real module might (tests). Returns false when nobody listens. */
  emitOnWriteChar(data: Uint8Array | string): boolean {
    if (!this.connected || !this.notifyWrite) return false;
    const bytes = typeof data === 'string' ? Uint8Array.from(data, (c) => c.charCodeAt(0) & 0xff) : data;
    this.notifyWrite(bytes);
    return true;
  }

  getKnownDevices(): Promise<BleDeviceInfo[]> {
    return Promise.resolve([{ ...MOCK_DEVICE }]);
  }

  async connect(deviceId: string): Promise<void> {
    await delay(this.connectDelayMs);
    if (deviceId !== MOCK_DEVICE.id) throw bleError('NotFoundError', 'Unknown device');
    if (Date.now() < this.unreachableUntil) throw bleError('NetworkError', 'Connection attempt failed (simulated)');
    this.connected = true;
  }

  async disconnect(_deviceId: string): Promise<void> {
    if (!this.connected) return;
    this.dropLink();
  }

  isConnected(_deviceId: string): boolean {
    return this.connected;
  }

  /** Simulates the link dropping (e.g. the car is locked). The module stays unreachable for `unreachableMs`. */
  simulateDrop(unreachableMs = 1200): void {
    this.unreachableUntil = Date.now() + unreachableMs;
    if (this.connected) this.dropLink();
  }

  private dropLink(): void {
    this.connected = false;
    this.notify = null;
    this.notifyWrite = null;
    this.device.stop();
    // Web Bluetooth fires gattserverdisconnected for user disconnects too.
    for (const listener of [...this.disconnectListeners]) listener();
  }

  async getCharacteristic(_deviceId: string, service: string, characteristic: string): Promise<CharInfo> {
    await delay(Math.round(this.latencyMs / 4));
    if (!this.connected) throw bleError('NetworkError', 'Not connected');
    if (service !== ZYCELA_SERVICE) throw bleError('NotFoundError', 'No such service');
    if (characteristic === ZYCELA_WRITE_CHAR) {
      // Like the real module (protocolo-zycela.md §6): FFE2 also declares notify.
      return {
        uuid: characteristic,
        properties: { read: false, write: true, writeWithoutResponse: true, notify: true, indicate: false },
      };
    }
    if (characteristic === ZYCELA_NOTIFY_CHAR) {
      return {
        uuid: characteristic,
        properties: { read: false, write: false, writeWithoutResponse: false, notify: true, indicate: false },
      };
    }
    throw bleError('NotFoundError', 'No such characteristic');
  }

  async write(
    _deviceId: string,
    _service: string,
    characteristic: string,
    data: Uint8Array,
    _withResponse: boolean,
  ): Promise<void> {
    await delay(Math.round(this.latencyMs / 3));
    if (!this.connected) throw bleError('NetworkError', 'GATT Server is disconnected');
    if (characteristic !== ZYCELA_WRITE_CHAR) throw bleError('NotSupportedError', 'Characteristic is not writable');
    this.device.receive(data.slice());
  }

  async startNotifications(
    _deviceId: string,
    _service: string,
    characteristic: string,
    callback: (data: Uint8Array) => void,
  ): Promise<void> {
    await delay(Math.round(this.latencyMs / 4));
    if (!this.connected) throw bleError('NetworkError', 'Not connected');
    if (characteristic === ZYCELA_WRITE_CHAR) {
      this.notifyWrite = callback;
      return;
    }
    if (characteristic !== ZYCELA_NOTIFY_CHAR) throw bleError('NotSupportedError', 'Characteristic does not notify');
    this.notify = callback;
  }

  async stopNotifications(_deviceId?: string, _service?: string, characteristic?: string): Promise<void> {
    if (characteristic === ZYCELA_WRITE_CHAR) this.notifyWrite = null;
    else this.notify = null;
  }

  onDisconnect(_deviceId: string, callback: () => void): () => void {
    this.disconnectListeners.add(callback);
    return () => this.disconnectListeners.delete(callback);
  }
}
