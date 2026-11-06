import { describe, expect, it } from 'vitest';
import * as cmd from '../src/protocol/zycela/commands';

describe('system commands', () => {
  it('encodes the fixed commands', () => {
    expect(cmd.requestState()).toBe('[0A01]');
    expect(cmd.restoreFactory()).toBe('[4200]');
    expect(cmd.factoryMode(true)).toBe('[2101]');
    expect(cmd.factoryMode(false)).toBe('[2100]');
    expect(cmd.debugMode(true)).toBe('[3702]');
    expect(cmd.debugMode(false)).toBe('[3700]');
    expect(cmd.activateOriginalMenu()).toBe('[4100]');
  });
});

describe('power, control and brightness', () => {
  it('power', () => {
    expect(cmd.power(1)).toBe('[0701]');
    expect(cmd.power(0)).toBe('[0700]');
    expect(cmd.power(2)).toBe('[0702]');
    expect(() => cmd.power(3 as cmd.PowerMode)).toThrow(RangeError);
  });

  it('control method', () => {
    expect(cmd.controlMethod(0)).toBe('[5100]');
    expect(cmd.controlMethod(1)).toBe('[5101]');
    expect(() => cmd.controlMethod(2 as cmd.BinaryValue)).toThrow(RangeError);
  });

  it('brightness sliders use 0200 / 0101 / 0102 + 2 lowercase hex digits', () => {
    expect(cmd.brightness(1, 9)).toBe('[020009]'); // the spec's "[0200 09]"
    expect(cmd.brightness(2, 5)).toBe('[010105]');
    expect(cmd.brightness(3, 0)).toBe('[010200]');
    expect(() => cmd.brightness(1, 10)).toThrow(RangeError);
    expect(() => cmd.brightness(1, -1)).toThrow(RangeError);
    expect(() => cmd.brightness(4 as 1, 1)).toThrow(RangeError);
  });

  it('zoning and night halving', () => {
    expect(cmd.zoning(0)).toBe('[1400]');
    expect(cmd.zoning(1)).toBe('[1401]');
    expect(cmd.nightHalf(true)).toBe('[1A01]');
    expect(cmd.nightHalf(false)).toBe('[1A00]');
  });
});

describe('colour and RGB', () => {
  it('colour per zone, 6 lowercase hex digits', () => {
    expect(cmd.color(0, '#FF0000')).toBe('[06ff0000]');
    expect(cmd.color(1, 'fc3700')).toBe('[10fc3700]');
    expect(cmd.color(2, '#00FE78')).toBe('[0900fe78]');
    expect(() => cmd.color(0, 'red')).toThrow(RangeError);
    expect(() => cmd.color(0, '#ff00')).toThrow(RangeError);
    expect(() => cmd.color(3 as cmd.ColorZone, '#ffffff')).toThrow(RangeError);
  });

  it('RGB mode 0-20 as 2 lowercase hex digits', () => {
    expect(cmd.rgbMode(0)).toBe('[0400]');
    expect(cmd.rgbMode(10)).toBe('[040a]');
    expect(cmd.rgbMode(20)).toBe('[0414]');
    expect(() => cmd.rgbMode(21)).toThrow(RangeError);
    expect(() => cmd.rgbMode(-1)).toThrow(RangeError);
    expect(() => cmd.rgbMode(1.5)).toThrow(RangeError);
  });

  it('RGB speed 1-10 (command code 3E as sent by the mini-program, value lowercase)', () => {
    expect(cmd.rgbSpeed(10)).toBe('[3E0a]');
    expect(cmd.rgbSpeed(1)).toBe('[3E01]');
    expect(() => cmd.rgbSpeed(0)).toThrow(RangeError);
    expect(() => cmd.rgbSpeed(11)).toThrow(RangeError);
  });

  it('RGB custom sequence and switch', () => {
    expect(cmd.rgbCustomEnabled(true)).toBe('[2B01]');
    expect(cmd.rgbCustomEnabled(false)).toBe('[2B00]');
    expect(cmd.rgbCustomSequence([0, 1, 2, 3, null, null, null, null])).toBe('[2A0123ffff]');
    expect(cmd.rgbCustomSequence([14, 13, 12, 11, 10, 9, 8, null])).toBe('[2Aedcba98f]');
    expect(cmd.encodeSequence([15, null, 0, 0, 0, 0, 0, 0])).toBe('ff000000');
    expect(() => cmd.rgbCustomSequence([0, 1, 2])).toThrow(RangeError);
    expect(() => cmd.rgbCustomSequence([16, null, null, null, null, null, null, null])).toThrow(RangeError);
  });
});

describe('dynamic effects', () => {
  it('effect 0-27', () => {
    expect(cmd.effect(0)).toBe('[1E00]');
    expect(cmd.effect(25)).toBe('[1E19]');
    expect(cmd.effect(27)).toBe('[1E1b]');
    expect(() => cmd.effect(28)).toThrow(RangeError);
  });

  it('variant, speed, direction', () => {
    expect(cmd.effectVariant(1)).toBe('[2901]');
    expect(cmd.effectVariant(6)).toBe('[2906]');
    expect(() => cmd.effectVariant(0)).toThrow(RangeError);
    expect(() => cmd.effectVariant(7)).toThrow(RangeError);
    expect(cmd.effectSpeed(5)).toBe('[0B05]');
    expect(() => cmd.effectSpeed(6)).toThrow(RangeError);
    expect(cmd.effectDirection(0)).toBe('[0C00]');
    expect(cmd.effectDirection(1)).toBe('[0C01]');
  });

  it('custom sequence, switch, length and gap', () => {
    expect(cmd.effectCustomEnabled(true)).toBe('[3B01]');
    expect(cmd.effectCustomEnabled(false)).toBe('[3B00]');
    expect(cmd.effectCustomSequence([5, 14, 4, null, null, null, null, null])).toBe('[3A5e4fffff]');
    expect(cmd.effectCustomLength(9)).toBe('[3C09]');
    expect(cmd.effectCustomGap(1)).toBe('[3D01]');
    expect(() => cmd.effectCustomLength(0)).toThrow(RangeError);
    expect(() => cmd.effectCustomGap(10)).toThrow(RangeError);
  });
});

describe('music', () => {
  it('sensitivity and source', () => {
    expect(cmd.soundSensitivity(7)).toBe('[030007]');
    expect(cmd.soundSensitivity(0)).toBe('[030000]');
    expect(() => cmd.soundSensitivity(10)).toThrow(RangeError);
    expect(cmd.soundSource(0)).toBe('[1B00]');
    expect(cmd.soundSource(1)).toBe('[1B01]');
  });
});

describe('welcome and car events', () => {
  it('welcome', () => {
    expect(cmd.welcomeEnabled(true)).toBe('[3001]');
    expect(cmd.welcomeEnabled(false)).toBe('[3000]');
    expect(cmd.welcomeMode(5)).toBe('[3905]');
    expect(() => cmd.welcomeMode(6)).toThrow(RangeError);
    expect(cmd.welcomeColor(14)).toBe('[380e]');
    expect(cmd.welcomeColor(0)).toBe('[3800]');
    expect(cmd.welcomeColor('sync')).toBe('[380f]');
    expect(() => cmd.welcomeColor(15)).toThrow(RangeError);
  });

  it('the six car-event switches', () => {
    expect(cmd.carEvent('door', true)).toBe('[3101]');
    expect(cmd.carEvent('radar', false)).toBe('[3200]');
    expect(cmd.carEvent('speed', true)).toBe('[3301]');
    expect(cmd.carEvent('turn', true)).toBe('[3401]');
    expect(cmd.carEvent('ac', false)).toBe('[3500]');
    expect(cmd.carEvent('blindSpot', true)).toBe('[4401]');
    expect(() => cmd.carEvent('horn' as cmd.CarEventKey, true)).toThrow(RangeError);
  });

  it('door, turn and blind-spot colours', () => {
    expect(cmd.doorColor(3)).toBe('[4603]');
    expect(() => cmd.doorColor(4)).toThrow(RangeError);
    expect(cmd.turnColor(1)).toBe('[4501]');
    expect(cmd.blindSpotColor(1)).toBe('[4701]');
    expect(() => cmd.blindSpotColor(2)).toThrow(RangeError);
  });
});

describe('installation', () => {
  it('dial codes are 16 literal 0/1 characters after 20', () => {
    expect(cmd.dialCodes('10000000', '00000000')).toBe('[201000000000000000]');
    expect(cmd.dialCodes([0, 1, 0, 0, 0, 0, 0, 1], [1, 1, 1, 1, 0, 0, 0, 0])).toBe('[200100000111110000]');
    expect(() => cmd.dialCodes('1000000', '00000000')).toThrow(RangeError);
    expect(() => cmd.dialCodes('1000000a', '00000000')).toThrow(RangeError);
  });

  it('LED counts as 4-digit decimal with the spec ranges', () => {
    expect(cmd.ledCount('driver', 30)).toBe('[1C0030]');
    expect(cmd.ledCount('passenger', 200)).toBe('[0F0200]');
    expect(cmd.ledCount('frontDoors', 60)).toBe('[130060]');
    expect(cmd.ledCount('rearDoors', 45)).toBe('[1D0045]');
    expect(cmd.ledCount('stripParam', 0)).toBe('[400000]');
    expect(cmd.ledCount('thirdRow', 120)).toBe('[520120]');
    expect(() => cmd.ledCount('driver', 29)).toThrow(RangeError);
    expect(() => cmd.ledCount('passenger', 201)).toThrow(RangeError);
    expect(() => cmd.ledCount('thirdRow', -1)).toThrow(RangeError);
  });

  it('wiring directions as 2-digit uppercase hex, codes as in the mini-program', () => {
    expect(cmd.wiring('driver', 1)).toBe('[2C01]');
    expect(cmd.wiring('passenger', 0)).toBe('[2F00]');
    expect(cmd.wiring('frontLeft', 1)).toBe('[4801]');
    expect(cmd.wiring('frontRight', 1)).toBe('[4901]');
    expect(cmd.wiring('rearLeft', 0)).toBe('[4A00]');
    expect(cmd.wiring('rearRight', 1)).toBe('[4B01]');
    expect(cmd.wiring('thirdLeft', 1)).toBe('[5301]');
    expect(cmd.wiring('thirdRight', 0)).toBe('[5400]');
    expect(() => cmd.wiring('driver', 2 as cmd.BinaryValue)).toThrow(RangeError);
  });

  it('customer code 0-9999 as 4-digit decimal', () => {
    expect(cmd.customerCode(42)).toBe('[430042]');
    expect(cmd.customerCode(0)).toBe('[430000]');
    expect(cmd.customerCode(9999)).toBe('[439999]');
    expect(() => cmd.customerCode(10000)).toThrow(RangeError);
    expect(() => cmd.customerCode(-1)).toThrow(RangeError);
  });

  it('key learning 1-5', () => {
    expect(cmd.learnKey(1)).toBe('[2201]');
    expect(cmd.learnKey(5)).toBe('[2205]');
    expect(() => cmd.learnKey(0)).toThrow(RangeError);
    expect(() => cmd.learnKey(6)).toThrow(RangeError);
  });

  it('every command fits in one 20-byte write', () => {
    const longest = [cmd.dialCodes('11111111', '11111111'), cmd.rgbCustomSequence(new Array(8).fill(14))];
    for (const c of longest) expect(c.length).toBeLessThanOrEqual(20);
  });
});

describe('bytes', () => {
  it('toBytes is one byte per ASCII character', () => {
    expect(Array.from(cmd.toBytes('[0A01]'))).toEqual([0x5b, 0x30, 0x41, 0x30, 0x31, 0x5d]);
    expect(() => cmd.toBytes('[ñ]')).toThrow(RangeError);
  });

  it('fromBytes / bytesToHex / hexToBytes', () => {
    const bytes = cmd.toBytes('[0A01]');
    expect(cmd.fromBytes(bytes)).toBe('[0A01]');
    expect(cmd.bytesToHex(bytes)).toBe('5B 30 41 30 31 5D');
    expect(Array.from(cmd.hexToBytes('5b 30:41-30315D'))).toEqual(Array.from(bytes));
    expect(() => cmd.hexToBytes('5B3')).toThrow(RangeError);
    expect(() => cmd.hexToBytes('zz')).toThrow(RangeError);
  });
});
