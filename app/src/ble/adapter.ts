/**
 * BLE access goes through BleAdapter so the same app can run on Web Bluetooth
 * (desktop Chrome, Bluefy on iPhone), on the demo mock, or later inside a
 * Capacitor native shell (see capacitorAdapter.ts).
 */

export const ZYCELA_SERVICE = '0000ffe0-0000-1000-8000-00805f9b34fb';
export const ZYCELA_WRITE_CHAR = '0000ffe2-0000-1000-8000-00805f9b34fb';
export const ZYCELA_NOTIFY_CHAR = '0000ffe1-0000-1000-8000-00805f9b34fb';
export const ZYCELA_NAME_PREFIX = 'ZYCL-FWD';

export interface BleDeviceInfo {
  id: string;
  name: string | null;
}

export interface CharProperties {
  read: boolean;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  indicate: boolean;
}

export interface CharInfo {
  uuid: string;
  properties: CharProperties;
}

export interface RequestDeviceOptions {
  /** Fallback "mostrar todos los dispositivos": acceptAllDevices instead of the name filter. */
  showAll?: boolean;
}

export interface BleAdapter {
  readonly kind: 'web' | 'mock' | 'capacitor';
  isAvailable(): Promise<boolean>;
  /**
   * Opens the device chooser. Web Bluetooth requires this to run inside a user
   * gesture, so callers must invoke it synchronously from a click handler.
   */
  requestDevice(options?: RequestDeviceOptions): Promise<BleDeviceInfo>;
  /** Devices this origin may reconnect to without a chooser (optional API). */
  getKnownDevices?(): Promise<BleDeviceInfo[]>;
  /** true when getKnownDevices() can actually find devices in this browser. */
  canListKnownDevices?(): boolean;
  connect(deviceId: string): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
  isConnected?(deviceId: string): boolean;
  getCharacteristic(deviceId: string, service: string, characteristic: string): Promise<CharInfo>;
  write(deviceId: string, service: string, characteristic: string, data: Uint8Array, withResponse: boolean): Promise<void>;
  startNotifications(
    deviceId: string,
    service: string,
    characteristic: string,
    callback: (data: Uint8Array) => void,
  ): Promise<void>;
  stopNotifications(deviceId: string, service: string, characteristic: string): Promise<void>;
  /** Registers a disconnect listener; returns a function that removes it. */
  onDisconnect(deviceId: string, callback: () => void): () => void;
}

/** Prefer write-with-response when the characteristic supports it. */
export function chooseWriteWithResponse(props: CharProperties): boolean {
  if (props.write) return true;
  return !props.writeWithoutResponse;
}

export function propertiesList(props: CharProperties): string[] {
  const out: string[] = [];
  if (props.read) out.push('read');
  if (props.write) out.push('write');
  if (props.writeWithoutResponse) out.push('writeWithoutResponse');
  if (props.notify) out.push('notify');
  if (props.indicate) out.push('indicate');
  return out;
}

/** Thrown when the browser has no navigator.bluetooth (e.g. Safari on iPhone). */
export class BluetoothUnavailableError extends Error {
  constructor() {
    super('Web Bluetooth is not available in this browser');
    this.name = 'BluetoothUnavailableError';
  }
}

/** The GATT link is not up (operation attempted on a dropped link). */
export class NotConnectedError extends Error {
  constructor() {
    super('Not connected');
    this.name = 'NotConnectedError';
  }
}

/** The adapter has no device with this id (e.g. after a page reload). */
export class UnknownDeviceError extends Error {
  constructor(id: string) {
    super(`Unknown device ${id}`);
    this.name = 'UnknownDeviceError';
  }
}

/** The chosen device exposes no GATT server (not a BLE peripheral). */
export class NoGattServerError extends Error {
  constructor() {
    super('This device has no GATT server');
    this.name = 'NoGattServerError';
  }
}

/** true when this browser exposes navigator.bluetooth (Chrome, Edge, Bluefy, WebBLE). */
export function hasWebBluetooth(): boolean {
  try {
    return typeof navigator !== 'undefined' && !!(navigator as Navigator & { bluetooth?: unknown }).bluetooth;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Web Bluetooth

function copyBytes(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

function toArrayBufferView(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy;
}

export class WebBluetoothAdapter implements BleAdapter {
  readonly kind = 'web' as const;
  private readonly devices = new Map<string, BluetoothDevice>();
  private readonly chars = new Map<string, BluetoothRemoteGATTCharacteristic>();
  private readonly listeners = new Map<string, (event: Event) => void>();

  private get bluetooth(): Bluetooth {
    if (!hasWebBluetooth()) throw new BluetoothUnavailableError();
    return navigator.bluetooth;
  }

  async isAvailable(): Promise<boolean> {
    if (!hasWebBluetooth()) return false;
    try {
      return typeof navigator.bluetooth.getAvailability === 'function' ? await navigator.bluetooth.getAvailability() : true;
    } catch {
      return true;
    }
  }

  requestDevice(options: RequestDeviceOptions = {}): Promise<BleDeviceInfo> {
    // No await before this call: it must stay inside the user gesture.
    let request: Promise<BluetoothDevice>;
    try {
      request = options.showAll
        ? this.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [ZYCELA_SERVICE] })
        : this.bluetooth.requestDevice({
            filters: [{ namePrefix: ZYCELA_NAME_PREFIX }],
            optionalServices: [ZYCELA_SERVICE],
          });
    } catch (error) {
      return Promise.reject(error);
    }
    return request.then((device) => {
      this.devices.set(device.id, device);
      return { id: device.id, name: device.name ?? null };
    });
  }

  canListKnownDevices(): boolean {
    if (!hasWebBluetooth()) return false;
    const bt = navigator.bluetooth as Bluetooth & { getDevices?: unknown };
    return typeof bt.getDevices === 'function';
  }

  async getKnownDevices(): Promise<BleDeviceInfo[]> {
    if (!this.canListKnownDevices()) return [];
    const bt = navigator.bluetooth as Bluetooth & { getDevices: () => Promise<BluetoothDevice[]> };
    try {
      const devices = await bt.getDevices();
      for (const device of devices) this.devices.set(device.id, device);
      return devices.map((d) => ({ id: d.id, name: d.name ?? null }));
    } catch {
      return [];
    }
  }

  private device(id: string): BluetoothDevice {
    const device = this.devices.get(id);
    if (!device) throw new UnknownDeviceError(id);
    return device;
  }

  async connect(deviceId: string): Promise<void> {
    const device = this.device(deviceId);
    if (!device.gatt) throw new NoGattServerError();
    this.clearCache(deviceId);
    await device.gatt.connect();
  }

  async disconnect(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    this.clearCache(deviceId);
    // Always call it: it does nothing on an idle server and, per the Web
    // Bluetooth spec, aborts a connect() that is still pending.
    device?.gatt?.disconnect();
  }

  isConnected(deviceId: string): boolean {
    return !!this.devices.get(deviceId)?.gatt?.connected;
  }

  private clearCache(deviceId: string): void {
    for (const key of [...this.chars.keys()]) if (key.startsWith(`${deviceId}|`)) this.chars.delete(key);
  }

  private async characteristic(
    deviceId: string,
    service: string,
    characteristic: string,
  ): Promise<BluetoothRemoteGATTCharacteristic> {
    const key = `${deviceId}|${service}|${characteristic}`;
    const cached = this.chars.get(key);
    if (cached) return cached;
    const server = this.device(deviceId).gatt;
    if (!server?.connected) throw new NotConnectedError();
    const svc = await server.getPrimaryService(service);
    const ch = await svc.getCharacteristic(characteristic);
    this.chars.set(key, ch);
    return ch;
  }

  async getCharacteristic(deviceId: string, service: string, characteristic: string): Promise<CharInfo> {
    const ch = await this.characteristic(deviceId, service, characteristic);
    // Copy plain values out: never keep or serialize the Web Bluetooth objects.
    const p = ch.properties;
    return {
      uuid: ch.uuid,
      properties: {
        read: !!p.read,
        write: !!p.write,
        writeWithoutResponse: !!p.writeWithoutResponse,
        notify: !!p.notify,
        indicate: !!p.indicate,
      },
    };
  }

  async write(
    deviceId: string,
    service: string,
    characteristic: string,
    data: Uint8Array,
    withResponse: boolean,
  ): Promise<void> {
    const ch = await this.characteristic(deviceId, service, characteristic);
    const value = toArrayBufferView(data);
    if (withResponse && typeof ch.writeValueWithResponse === 'function') {
      await ch.writeValueWithResponse(value);
    } else if (!withResponse && typeof ch.writeValueWithoutResponse === 'function') {
      await ch.writeValueWithoutResponse(value);
    } else {
      await ch.writeValue(value); // deprecated fallback (older Bluefy/WebBLE)
    }
  }

  async startNotifications(
    deviceId: string,
    service: string,
    characteristic: string,
    callback: (data: Uint8Array) => void,
  ): Promise<void> {
    const ch = await this.characteristic(deviceId, service, characteristic);
    const key = `${deviceId}|${service}|${characteristic}`;
    const previous = this.listeners.get(key);
    if (previous) ch.removeEventListener('characteristicvaluechanged', previous);
    const listener = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic | null;
      if (target?.value) callback(copyBytes(target.value));
    };
    this.listeners.set(key, listener);
    ch.addEventListener('characteristicvaluechanged', listener);
    await ch.startNotifications();
  }

  async stopNotifications(deviceId: string, service: string, characteristic: string): Promise<void> {
    const key = `${deviceId}|${service}|${characteristic}`;
    const ch = this.chars.get(key);
    const listener = this.listeners.get(key);
    this.listeners.delete(key);
    if (!ch) return;
    if (listener) ch.removeEventListener('characteristicvaluechanged', listener);
    try {
      await ch.stopNotifications();
    } catch {
      // Already disconnected.
    }
  }

  onDisconnect(deviceId: string, callback: () => void): () => void {
    const device = this.device(deviceId);
    const handler = () => {
      this.clearCache(deviceId);
      callback();
    };
    device.addEventListener('gattserverdisconnected', handler);
    return () => device.removeEventListener('gattserverdisconnected', handler);
  }
}
