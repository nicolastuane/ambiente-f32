import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NotConnectedError,
  UnknownDeviceError,
  WebBluetoothAdapter,
  ZYCELA_SERVICE,
  ZYCELA_WRITE_CHAR,
} from '../src/ble/adapter';
import { ConnectTimeoutError, bleErrorMessage, chooserError, isChooserCancel } from '../src/ble/session';
import { commandRisk } from '../src/ui/safety';

const named = (name: string, message: string) => Object.assign(new Error(message), { name });

describe('chooser errors', () => {
  // Regression: every NotFoundError used to count as "chooser closed".
  it('only a real cancel is silent', () => {
    expect(chooserError(named('NotFoundError', 'User cancelled the requestDevice() chooser.'))).toBeNull();
    expect(chooserError(named('AbortError', ''))).toBeNull();
    expect(chooserError(named('NotFoundError', 'Bluetooth adapter not available.'))).toContain('adaptador Bluetooth');
    expect(chooserError(named('NotFoundError', 'Bluetooth Low Energy not available.'))).toContain('adaptador Bluetooth');
    expect(chooserError(named('NotFoundError', 'Web Bluetooth API globally disabled.'))).toContain('desactivado');
    expect(chooserError(named('NotFoundError', 'User or their enterprise policy has disabled Web Bluetooth.'))).toContain('desactivado');
    expect(chooserError(named('SecurityError', 'x'))).toContain('HTTPS');
    expect(isChooserCancel(named('NotFoundError', 'User cancelled the requestDevice() chooser.'))).toBe(true);
    expect(isChooserCancel(named('NotFoundError', 'Bluetooth adapter not available.'))).toBe(false);
  });
});

describe('bleErrorMessage', () => {
  it('gives the WeChat hint only while connecting', () => {
    expect(bleErrorMessage(named('NetworkError', 'x'), 'connect')).toContain('WeChat');
    expect(bleErrorMessage(named('NetworkError', 'GATT Server is disconnected'), 'operation')).not.toContain('WeChat');
  });

  it('never shows raw English adapter errors or "undefined"', () => {
    expect(bleErrorMessage(new NotConnectedError())).toBe('No hay conexión con el módulo.');
    expect(bleErrorMessage(new UnknownDeviceError('abc'))).toContain('Conectar');
    expect(bleErrorMessage(new ConnectTimeoutError(12000))).toBe('El módulo no respondió a tiempo.');
    expect(bleErrorMessage(named('Error', 'undefined'))).toBe('Error de Bluetooth desconocido.');
    expect(bleErrorMessage(named('Error', ''))).toBe('Error de Bluetooth desconocido.');
    expect(bleErrorMessage({ name: 'Error', message: undefined })).toBe('Error de Bluetooth desconocido.');
  });
});

describe('WebBluetoothAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeBluetooth(withGetDevices = false) {
    const gatt = {
      connected: false,
      connect: vi.fn(() => new Promise<never>(() => undefined)), // never settles, like CoreBluetooth
      disconnect: vi.fn(),
    };
    const device = { id: 'd1', name: 'ZYCL-FWD-1', gatt, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const bluetooth: Record<string, unknown> = { requestDevice: vi.fn(async () => device) };
    if (withGetDevices) bluetooth.getDevices = vi.fn(async () => [device]);
    vi.stubGlobal('navigator', { bluetooth });
    return { gatt, device };
  }

  // Regression: disconnect() skipped gatt.disconnect() while not yet connected,
  // so a pending connect was never aborted.
  it('always calls gatt.disconnect(), even while connect() is pending', async () => {
    const { gatt } = fakeBluetooth();
    const adapter = new WebBluetoothAdapter();
    await adapter.requestDevice();
    void adapter.connect('d1');
    await adapter.disconnect('d1');
    expect(gatt.disconnect).toHaveBeenCalledTimes(1);
  });

  it('throws named errors the UI can translate', async () => {
    fakeBluetooth();
    const adapter = new WebBluetoothAdapter();
    await adapter.requestDevice();
    await expect(adapter.connect('nope')).rejects.toBeInstanceOf(UnknownDeviceError);
    await expect(adapter.write('d1', ZYCELA_SERVICE, ZYCELA_WRITE_CHAR, new Uint8Array([0x5b]), true)).rejects.toBeInstanceOf(
      NotConnectedError,
    );
  });

  // Regression: "Reconectar a …" showed up in browsers without getDevices().
  it('reports whether known devices can be listed', () => {
    fakeBluetooth(false);
    expect(new WebBluetoothAdapter().canListKnownDevices()).toBe(false);
    vi.unstubAllGlobals();
    fakeBluetooth(true);
    expect(new WebBluetoothAdapter().canListKnownDevices()).toBe(true);
  });
});

describe('lab console safety', () => {
  // Regression: the console sent [4100] with no gate at all.
  it('classifies dangerous commands, wherever they appear', () => {
    expect(commandRisk('[4100]')).toBe('flash');
    expect(commandRisk('[4101]')).toBe('flash');
    expect(commandRisk('\r\n[4100]')).toBe('flash');
    expect(commandRisk('[0A01][4100]')).toBe('flash');
    expect(commandRisk('[4200]')).toBe('confirm');
    expect(commandRisk('[201000000000000000]')).toBe('confirm');
    expect(commandRisk('[0A01]')).toBe('none');
    expect(commandRisk('[2101]')).toBe('none');
    expect(commandRisk('hola')).toBe('none');
  });
});
