import { describe, expect, it } from 'vitest';
import { BluetoothUnavailableError, chooseWriteWithResponse } from '../src/ble/adapter';
import { QueueTimeoutError } from '../src/ble/queue';
import { NotConnectedError, bleErrorMessage, isChooserCancel } from '../src/ble/session';
import * as cmd from '../src/protocol/zycela/commands';
import { describeCommand, describeFrame } from '../src/protocol/zycela/describe';
import { parseFrame } from '../src/protocol/zycela/parser';
import { buildDialFrame, buildFactoryParamsFrame, buildSequencesFrame, buildSettingsFrame, buildStateFrame, buildStripsFrame, buildVersionFrame, defaultMockState } from '../src/mock/zycelaMock';

describe('describeCommand', () => {
  it('has a Spanish description for every command the app can send', () => {
    const all = [
      cmd.requestState(),
      cmd.restoreFactory(),
      cmd.factoryMode(true),
      cmd.debugMode(true),
      cmd.activateOriginalMenu(),
      cmd.power(2),
      cmd.controlMethod(1),
      cmd.brightness(1, 9),
      cmd.brightness(2, 1),
      cmd.brightness(3, 1),
      cmd.zoning(1),
      cmd.nightHalf(true),
      cmd.color(0, '#ff0000'),
      cmd.color(1, '#ff0000'),
      cmd.color(2, '#ff0000'),
      cmd.rgbMode(10),
      cmd.rgbSpeed(3),
      cmd.rgbCustomEnabled(true),
      cmd.rgbCustomSequence([0, null, null, null, null, null, null, null]),
      cmd.effect(25),
      cmd.effectVariant(2),
      cmd.effectSpeed(2),
      cmd.effectDirection(1),
      cmd.effectCustomEnabled(true),
      cmd.effectCustomSequence([0, null, null, null, null, null, null, null]),
      cmd.effectCustomLength(2),
      cmd.effectCustomGap(2),
      cmd.soundSensitivity(5),
      cmd.soundSource(1),
      cmd.welcomeEnabled(true),
      cmd.welcomeMode(2),
      cmd.welcomeColor('sync'),
      ...cmd.CAR_EVENT_KEYS.map((k) => cmd.carEvent(k, true)),
      cmd.doorColor(1),
      cmd.turnColor(1),
      cmd.blindSpotColor(1),
      cmd.dialCodes('10000000', '00000000'),
      ...cmd.LED_STRIP_KEYS.map((k) => cmd.ledCount(k, 60)),
      ...cmd.WIRING_KEYS.map((k) => cmd.wiring(k, 1)),
      cmd.customerCode(42),
      cmd.learnKey(3),
    ];
    for (const c of all) {
      const text = describeCommand(c);
      expect(text, c).not.toMatch(/^Comando /);
      expect(text, c).not.toBe('Texto libre');
    }
    expect(describeCommand('[0701]')).toBe('Encendido: Encendido');
    expect(describeCommand('[4801]')).toBe('Montaje · puerta delantera izquierda: Por delante');
    expect(describeCommand('[4B00]')).toBe('Montaje · puerta trasera derecha: Por detrás');
  });
});

describe('mock frames parse back with the documented positions', () => {
  it('every frame the mock builds is understood by the parser', () => {
    const s = defaultMockState();
    const frames = [
      buildStateFrame(s, '4E'),
      buildStateFrame(s, '1F'),
      buildSettingsFrame(s),
      buildSequencesFrame(s),
      buildVersionFrame('H1', 'CAR', 'FW'),
      buildDialFrame(s),
      buildFactoryParamsFrame(s),
      buildStripsFrame(s, false),
      buildStripsFrame(s, true),
    ];
    for (const f of frames) {
      const parsed = parseFrame(f);
      expect(parsed.kind, f).not.toBe('unknown');
      expect(describeFrame(parsed)).not.toMatch(/\?/);
    }
    expect(parseFrame(buildStateFrame(s, '4E'))).toMatchObject({ color: '#ff6a00', brightness1: 8, controlMethod: 0 });
    // The default mock mirrors the F32 (every door "front"): use distinct values so a swapped position shows.
    s.wiring = { ...s.wiring, '2C': 0, '2F': 1, '48': 1, '49': 0, '4A': 1, '4B': 0 };
    expect(parseFrame(buildStripsFrame(s, false))).toMatchObject({
      wiring: { driver: 0, passenger: 1, frontLeft: 1, frontRight: 0, rearLeft: 1, rearRight: 0 },
    });
  });

  it('the mock encodes welcome sync like the module: 21 = offered, 22 = f when synced', () => {
    const s = defaultMockState();
    expect(parseFrame(buildSettingsFrame(s))).toMatchObject({ welcomeSyncAvailable: true, welcomeSync: false, welcomeColor: 9 });
    const synced = parseFrame(buildSettingsFrame({ ...s, welcomeSync: 1 }));
    expect(synced).toMatchObject({ welcomeSyncAvailable: true, welcomeSync: true, welcomeColor: undefined });
    expect(describeFrame(synced)).toContain('sincronizada con RGB');
    const noSync = parseFrame(buildSettingsFrame({ ...s, welcomeSyncAvailable: false }));
    expect(noSync).toMatchObject({ welcomeSyncAvailable: false, welcomeSync: false, welcomeColor: 9 });
    expect(describeFrame(noSync)).toContain('sin opción de sincronizar');
  });
});

describe('BLE helpers', () => {
  it('prefers write with response when available', () => {
    const base = { read: false, notify: false, indicate: false };
    expect(chooseWriteWithResponse({ ...base, write: true, writeWithoutResponse: true })).toBe(true);
    expect(chooseWriteWithResponse({ ...base, write: false, writeWithoutResponse: true })).toBe(false);
    expect(chooseWriteWithResponse({ ...base, write: true, writeWithoutResponse: false })).toBe(true);
  });

  it('maps errors to Spanish messages', () => {
    const named = (name: string) => Object.assign(new Error('x'), { name });
    expect(bleErrorMessage(new NotConnectedError())).toBe('No hay conexión con el módulo.');
    expect(bleErrorMessage(new QueueTimeoutError('write', 10))).toBe('El módulo no respondió a tiempo.');
    expect(bleErrorMessage(new BluetoothUnavailableError())).toContain('Bluefy');
    expect(bleErrorMessage(named('NetworkError'))).toContain('WeChat');
    expect(bleErrorMessage(named('SecurityError'))).toContain('HTTPS');
    expect(isChooserCancel(named('NotFoundError'))).toBe(true);
    expect(isChooserCancel(named('NetworkError'))).toBe(false);
  });
});
