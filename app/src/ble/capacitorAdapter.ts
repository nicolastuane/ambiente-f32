/**
 * Placeholder for a future native iOS/Android build with Capacitor and
 * @capacitor-community/bluetooth-le. It is NOT a dependency of this project;
 * this file only documents how each BleAdapter method maps onto that plugin so
 * the rest of the app (session, driver, UI) can stay unchanged.
 *
 * Mapping (BleClient is the plugin's main export):
 *
 *   isAvailable()          -> await BleClient.initialize(); return BleClient.isEnabled()
 *   requestDevice(opts)    -> BleClient.requestDevice(opts.showAll
 *                               ? { optionalServices: [ZYCELA_SERVICE] }
 *                               : { namePrefix: 'ZYCL-FWD', optionalServices: [ZYCELA_SERVICE] })
 *                             returns { deviceId, name } -> { id: deviceId, name }
 *   getKnownDevices()      -> BleClient.getDevices(knownIds) (ids must be stored by the app)
 *   connect(id)            -> BleClient.connect(id, onDisconnect, { timeout: 10000 })
 *                             (the plugin takes the disconnect callback here, so keep the
 *                             callbacks registered through onDisconnect() in a Map and call
 *                             them from that single callback)
 *   disconnect(id)         -> BleClient.disconnect(id)
 *   getCharacteristic()    -> (await BleClient.getServices(id)) -> find service/characteristic,
 *                             copy properties { read, write, writeWithoutResponse, notify, indicate }
 *   write(.., withResponse)-> withResponse
 *                               ? BleClient.write(id, service, char, toDataView(bytes))
 *                               : BleClient.writeWithoutResponse(id, service, char, toDataView(bytes))
 *                             where toDataView = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength)
 *   startNotifications()   -> BleClient.startNotifications(id, service, char,
 *                               (dv) => callback(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)))
 *   stopNotifications()    -> BleClient.stopNotifications(id, service, char)
 *   isConnected(id)        -> track connect/disconnect callbacks locally
 *
 * Native extras: BleClient.getMtu(id) gives the negotiated MTU (Web Bluetooth
 * cannot). ZYCELA commands are at most 20 bytes (the [20...] dial-code
 * command is exactly 20), so they fit one write at the minimum MTU.
 *
 * iOS project setup: Info.plist needs NSBluetoothAlwaysUsageDescription
 * (Spanish text, e.g. "Para controlar la luz ambiente del coche por Bluetooth").
 * UIBackgroundModes/bluetooth-central is not needed: the module reacts to the
 * car on its own.
 */
import type { BleAdapter, BleDeviceInfo, CharInfo, RequestDeviceOptions } from './adapter';

const NOT_IMPLEMENTED = 'CapacitorBleAdapter is a documented stub: install @capacitor-community/bluetooth-le and implement it';

export class CapacitorBleAdapter implements BleAdapter {
  readonly kind = 'capacitor' as const;

  isAvailable(): Promise<boolean> {
    return Promise.resolve(false);
  }

  requestDevice(_options?: RequestDeviceOptions): Promise<BleDeviceInfo> {
    return Promise.reject(new Error(NOT_IMPLEMENTED));
  }

  connect(_deviceId: string): Promise<void> {
    return Promise.reject(new Error(NOT_IMPLEMENTED));
  }

  disconnect(_deviceId: string): Promise<void> {
    return Promise.resolve();
  }

  getCharacteristic(_deviceId: string, _service: string, _characteristic: string): Promise<CharInfo> {
    return Promise.reject(new Error(NOT_IMPLEMENTED));
  }

  write(_deviceId: string, _service: string, _characteristic: string, _data: Uint8Array, _withResponse: boolean): Promise<void> {
    return Promise.reject(new Error(NOT_IMPLEMENTED));
  }

  startNotifications(
    _deviceId: string,
    _service: string,
    _characteristic: string,
    _callback: (data: Uint8Array) => void,
  ): Promise<void> {
    return Promise.reject(new Error(NOT_IMPLEMENTED));
  }

  stopNotifications(_deviceId: string, _service: string, _characteristic: string): Promise<void> {
    return Promise.resolve();
  }

  onDisconnect(_deviceId: string, _callback: () => void): () => void {
    return () => undefined;
  }
}
