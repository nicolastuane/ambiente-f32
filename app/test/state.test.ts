import { describe, expect, it } from 'vitest';
import { parseFrame } from '../src/protocol/zycela/parser';
import { applyCommand, deviceReducer, initialDeviceState, isUnsupported, zoneColor } from '../src/protocol/zycela/state';
import type { DeviceState } from '../src/protocol/zycela/state';
import { frameAt } from './helpers';

const STATE_4E = frameAt('4E', 38, {
  3: '03',
  5: '05',
  9: 'ff0000',
  21: '07',
  23: '06',
  25: '04',
  27: '02',
  29: '01',
  31: '09',
  33: '05',
  35: '01',
});

function frame(state: DeviceState, text: string): DeviceState {
  return deviceReducer(state, { type: 'frame', frame: parseFrame(text), at: 1 });
}

describe('device reducer: frames', () => {
  it('merges a 4E state frame', () => {
    const s = frame(initialDeviceState(), STATE_4E);
    expect(s.firmware).toBe('4E');
    expect(s.rgbMode).toBe(3);
    expect(s.effect).toBe(5);
    expect(s.color).toBe('#ff0000');
    expect(s.brightness).toEqual({ b1: 9, b2: 7, b3: 6 });
    expect(s.soundSensitivity).toBe(4);
    expect(s.effectSpeed).toBe(2);
    expect(s.effectDirection).toBe(1);
    expect(s.rgbSpeed).toBe(5);
    expect(s.controlMethod).toBe(1);
    expect(s.lastFrameAt).toBe(1);
  });

  it('a short frame does not clobber known values', () => {
    const s1 = frame(initialDeviceState(), STATE_4E);
    const s2 = frame(s1, '[1F0a]');
    expect(s2.rgbMode).toBe(10);
    expect(s2.firmware).toBe('1F');
    expect(s2.brightness).toEqual({ b1: 9, b2: 7, b3: 6 });
    expect(s2.color).toBe('#ff0000');
  });

  it('merges settings (26) including unsupported events', () => {
    const s = frame(
      initialDeviceState(),
      frameAt('26', 30, { 3: '01', 5: '01', 13: 'ff', 15: '00', 17: '01', 19: '02', 21: '1', 22: '4', 23: '01', 27: '00' }),
    );
    expect(s.welcomeEnabled).toBe(true);
    expect(s.events.door).toBe(1);
    expect(s.events.ac).toBe(255);
    expect(isUnsupported(s.events.ac)).toBe(true);
    expect(isUnsupported(s.events.door)).toBe(false);
    expect(s.nightHalf).toBe(false);
    expect(s.zoning).toBe(1);
    expect(s.welcomeMode).toBe(2);
    expect(s.welcomeSync).toBe(false);
    expect(s.welcomeColor).toBe(4);
    expect(s.welcomeSyncAvailable).toBe(true);
    expect(s.soundSource).toBe(1);
    expect(s.events.blindSpot).toBe(0);
  });

  // Regression: sync comes from character 22 (f), not from character 21.
  it('welcome sync and colour follow character 22 of frame 26', () => {
    let s = frame(initialDeviceState(), frameAt('26', 30, { 21: '1', 22: '9' }));
    expect(s).toMatchObject({ welcomeSync: false, welcomeColor: 9, welcomeSyncAvailable: true });
    s = frame(s, frameAt('26', 30, { 21: '1', 22: 'f' }));
    expect(s.welcomeSync).toBe(true);
    expect(s.welcomeColor).toBe(9); // last palette colour kept, but not shown as selected
    s = frame(s, frameAt('26', 30, { 21: '1', 22: '3' }));
    expect(s).toMatchObject({ welcomeSync: false, welcomeColor: 3 });
    // [380f] then a 26 frame with "0f": still synced.
    s = applyCommand(s, '[380f]');
    s = frame(s, frameAt('26', 30, { 21: '0', 22: 'f' }));
    expect(s).toMatchObject({ welcomeSync: true, welcomeSyncAvailable: false });
  });

  it('merges sequences (27)', () => {
    const s = frame(initialDeviceState(), frameAt('27', 34, { 3: '01ffffff', 11: '01', 13: 'ffffffff', 23: '04', 25: '05', 29: '03' }));
    expect(s.rgbSequence).toEqual([0, 1, null, null, null, null, null, null]);
    expect(s.rgbCustomEnabled).toBe(true);
    expect(s.effectSequence).toEqual(new Array(8).fill(null));
    expect(s.effectCustomEnabled).toBe(false);
    expect(s.effectCustomLength).toBe(4);
    expect(s.effectCustomGap).toBe(5);
    expect(s.rgbSpeed).toBe(3);
  });

  it('merges factory frames and remembers which arrived', () => {
    let s = frame(initialDeviceState(), '[231000000001000000]');
    s = frame(s, frameAt('25', 20, { 9: '0010', 15: '1234' }));
    s = frame(s, frameAt('58', 46, { 9: '0100', 13: '01', 25: '01', 31: '00', 33: '01', 35: '00', 37: '0080', 41: '01', 43: '01' }));
    expect(s.factory.carBits).toBe('10000000');
    expect(s.factory.featureBits).toBe('01000000');
    expect(s.factory.customerCode).toBe(1234);
    expect(s.factory.leds.stripParam).toBe(10);
    expect(s.factory.leds.driver).toBe(100);
    expect(s.factory.leds.thirdRow).toBe(80);
    expect(s.factory.wiring.driver).toBe(1);
    expect(s.factory.wiring.frontLeft).toBe(1);
    expect(s.factory.wiring.frontRight).toBe(1);
    expect(s.factory.wiring.thirdRight).toBe(1);
    expect(s.factory.thirdRow).toBe(true);
    expect(s.factory.received).toEqual(['23', '25', '58']);
  });

  it('version frame', () => {
    const s = frame(initialDeviceState(), '[13' + Array.from('H1.00CAR-F32 FW-1.2.3 ', (c) => c.charCodeAt(0).toString(16)).join('') + ']');
    expect(s.version).toMatchObject({ hardware: 'H1.00', carModel: 'CAR-F32', firmware: 'FW-1.2.3' });
  });

  it('reset', () => {
    const s = frame(initialDeviceState(), STATE_4E);
    expect(deviceReducer(s, { type: 'reset' })).toEqual(initialDeviceState());
  });
});

describe('device reducer: optimistic commands', () => {
  it('colour per zone, reconciled by a later frame', () => {
    let s = applyCommand(initialDeviceState(), '[06ff0000]');
    expect(s.color).toBe('#ff0000');
    expect(zoneColor(s, 1)).toBe('#ff0000');
    s = applyCommand(s, '[10fc3700]');
    expect(zoneColor(s, 1)).toBe('#fc3700');
    expect(zoneColor(s, 2)).toBe('#ff0000');
    s = applyCommand(s, '[0900fe78]');
    expect(zoneColor(s, 2)).toBe('#00fe78');
    s = frame(s, frameAt('1F', 36, { 9: '00ff00' }));
    expect(s.color).toBe('#00ff00');
  });

  it('brightness, power, control, zoning, night', () => {
    let s = initialDeviceState();
    s = applyCommand(s, '[020009]');
    s = applyCommand(s, '[010105]');
    s = applyCommand(s, '[010203]');
    s = applyCommand(s, '[0702]');
    s = applyCommand(s, '[5101]');
    s = applyCommand(s, '[1401]');
    s = applyCommand(s, '[1A01]');
    expect(s.brightness).toEqual({ b1: 9, b2: 5, b3: 3 });
    expect(s.power).toBe(2);
    expect(s.controlMethod).toBe(1);
    expect(s.zoning).toBe(1);
    expect(s.nightHalf).toBe(true);
  });

  it('modes, effects and sequences', () => {
    let s = applyCommand(initialDeviceState(), '[2B01]');
    expect(s.rgbCustomEnabled).toBe(true);
    s = applyCommand(s, '[040a]');
    expect(s.rgbMode).toBe(10);
    expect(s.rgbCustomEnabled).toBe(false);
    s = applyCommand(s, '[3E0a]');
    expect(s.rgbSpeed).toBe(10);
    s = applyCommand(s, '[2A0123ffff]');
    expect(s.rgbSequence).toEqual([0, 1, 2, 3, null, null, null, null]);
    s = applyCommand(s, '[2904]');
    expect(s.effectVariant).toBe(4);
    s = applyCommand(s, '[1E19]');
    expect(s.effect).toBe(25);
    expect(s.effectVariant).toBe(1);
    s = applyCommand(s, '[0B05]');
    s = applyCommand(s, '[0C01]');
    s = applyCommand(s, '[3B01]');
    s = applyCommand(s, '[3A5e4fffff]');
    s = applyCommand(s, '[3C09]');
    s = applyCommand(s, '[3D02]');
    expect(s).toMatchObject({
      effectSpeed: 5,
      effectDirection: 1,
      effectCustomEnabled: true,
      effectSequence: [5, 14, 4, null, null, null, null, null],
      effectCustomLength: 9,
      effectCustomGap: 2,
    });
  });

  it('welcome, events, colours, music', () => {
    let s = applyCommand(initialDeviceState(), '[3001]');
    s = applyCommand(s, '[3904]');
    s = applyCommand(s, '[3803]');
    expect(s).toMatchObject({ welcomeEnabled: true, welcomeMode: 4, welcomeColor: 3, welcomeSync: false });
    s = applyCommand(s, '[380f]');
    expect(s.welcomeSync).toBe(true);
    expect(s.welcomeColor).toBe(3);
    s = applyCommand(s, '[3101]');
    s = applyCommand(s, '[4401]');
    expect(s.events.door).toBe(1);
    expect(s.events.blindSpot).toBe(1);
    s = applyCommand(s, '[4603]');
    s = applyCommand(s, '[4502]');
    s = applyCommand(s, '[4701]');
    expect(s).toMatchObject({ doorColor: 3, turnColor: 2, blindSpotColor: 1 });
    s = applyCommand(s, '[030007]');
    s = applyCommand(s, '[1B01]');
    expect(s).toMatchObject({ soundSensitivity: 7, soundSource: 1 });
  });

  it('installation', () => {
    let s = applyCommand(initialDeviceState(), '[201000000000000001]');
    s = applyCommand(s, '[1C0030]');
    s = applyCommand(s, '[0F0200]');
    s = applyCommand(s, '[400012]');
    s = applyCommand(s, '[4A01]');
    s = applyCommand(s, '[430042]');
    expect(s.factory).toMatchObject({
      carBits: '10000000',
      featureBits: '00000001',
      customerCode: 42,
      leds: { driver: 30, passenger: 200, stripParam: 12 },
      wiring: { rearLeft: 1 },
    });
  });

  it('unknown or malformed commands leave the state untouched', () => {
    const s = initialDeviceState();
    expect(applyCommand(s, '[0A01]')).toBe(s);
    expect(applyCommand(s, '[06zz]')).toBe(s);
    expect(applyCommand(s, 'hola')).toBe(s);
    expect(applyCommand(s, '[4200]')).toBe(s);
  });
});
