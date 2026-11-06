import { describe, expect, it } from 'vitest';
import { Framer, parseFrame } from '../src/protocol/zycela/parser';
import { toBytes } from '../src/protocol/zycela/commands';
import { frameAt, numbersIn } from './helpers';

function asciiHex(text: string): string {
  return Array.from(text, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

describe('parseFrame: state frames 1F / 4E', () => {
  const fields = {
    3: '0a', // RGB mode
    5: '19', // effect
    9: 'FF6A00', // colour
    21: '07', // slider 2
    23: '05', // slider 3
    25: '06', // sound
    27: '03', // effect speed
    29: '01', // direction
    31: '08', // slider 1
    33: '0a', // RGB speed
    35: '01', // control (4E only)
  };

  it('reads every 4E field at its position', () => {
    const f = parseFrame(frameAt('4E', 38, fields));
    expect(f).toMatchObject({
      kind: 'state',
      code: '4E',
      extended: true,
      rgbMode: 10,
      effect: 25,
      color: '#ff6a00',
      brightness2: 7,
      brightness3: 5,
      soundSensitivity: 6,
      effectSpeed: 3,
      effectDirection: 1,
      brightness1: 8,
      rgbSpeed: 10,
      controlMethod: 1,
    });
  });

  it('1F has no control field', () => {
    const f = parseFrame(frameAt('1F', 36, fields));
    expect(f.kind).toBe('state');
    if (f.kind !== 'state') return;
    expect(f.extended).toBe(false);
    expect(f.controlMethod).toBeUndefined();
    expect(f.rgbSpeed).toBe(10);
    expect(f.brightness1).toBe(8);
  });

  it('drops out-of-range RGB mode and RGB speed (only confirmed for 1F)', () => {
    const f = parseFrame(frameAt('4E', 38, { 3: '7f', 33: '20' }));
    if (f.kind !== 'state') throw new Error('expected state');
    expect(f.rgbMode).toBeUndefined();
    expect(f.rgbSpeed).toBeUndefined();
    const ok = parseFrame(frameAt('4E', 38, { 3: '14', 33: '0a' }));
    expect(ok).toMatchObject({ rgbMode: 20, rgbSpeed: 10 });
  });

  it('short frames give undefined fields, not NaN', () => {
    const f = parseFrame('[1F0a]');
    expect(f).toMatchObject({ kind: 'state', rgbMode: 10 });
    if (f.kind !== 'state') return;
    expect(f.effect).toBeUndefined();
    expect(f.color).toBeUndefined();
    expect(f.brightness1).toBeUndefined();
    expect(numbersIn(f).some(Number.isNaN)).toBe(false);
  });
});

describe('parseFrame: 26 settings', () => {
  it('reads every field', () => {
    const f = parseFrame(
      frameAt('26', 30, {
        3: '01',
        5: '01',
        7: '00',
        9: '01',
        11: '00',
        13: 'ff',
        15: '01',
        17: '01',
        19: '03',
        21: '1',
        22: 'c',
        23: '01',
        27: 'ff',
      }),
    );
    expect(f).toMatchObject({
      kind: 'settings',
      welcomeEnabled: 1,
      door: 1,
      radar: 0,
      speed: 1,
      turn: 0,
      ac: 255,
      nightHalf: 1,
      zoning: 1,
      welcomeMode: 3,
      welcomeSyncAvailable: true,
      welcomeSync: false,
      welcomeColor: 12,
      soundSource: 1,
      blindSpot: 255,
    });
  });

  it('blind spot only when the frame is longer than 28 characters', () => {
    const f = parseFrame(frameAt('26', 28, { 3: '01' }));
    expect(f.kind).toBe('settings');
    if (f.kind === 'settings') expect(f.blindSpot).toBeUndefined();
  });

  // Regression: character 21 only says whether the firmware offers "sync with
  // RGB" (the mini-program's wx:if around its button); the selection is
  // character 22, where f (15) means synced, as [380f] sets it.
  it('welcome sync: character 22 = f means synced', () => {
    const f = parseFrame(frameAt('26', 30, { 21: '1', 22: 'f' }));
    if (f.kind !== 'settings') throw new Error('expected settings');
    expect(f.welcomeSyncAvailable).toBe(true);
    expect(f.welcomeSync).toBe(true);
    expect(f.welcomeColor).toBeUndefined();
  });

  it('welcome sync: "13" = sync offered, palette colour 3 selected', () => {
    const f = parseFrame(frameAt('26', 30, { 21: '1', 22: '3' }));
    if (f.kind !== 'settings') throw new Error('expected settings');
    expect(f.welcomeSyncAvailable).toBe(true);
    expect(f.welcomeSync).toBe(false);
    expect(f.welcomeColor).toBe(3);
  });

  it('welcome sync: "0f" = synced even though the button flag is 0', () => {
    const f = parseFrame(frameAt('26', 30, { 21: '0', 22: 'f' }));
    if (f.kind !== 'settings') throw new Error('expected settings');
    expect(f.welcomeSyncAvailable).toBe(false);
    expect(f.welcomeSync).toBe(true);
    expect(f.welcomeColor).toBeUndefined();
  });
});

describe('parseFrame: 27 sequences', () => {
  it('reads both sequences and their parameters', () => {
    const f = parseFrame(
      frameAt('27', 34, { 3: '0123ffff', 11: '01', 13: '5e4fffff', 21: '00', 23: '03', 25: '02', 27: '04', 29: '07', 31: '02' }),
    );
    expect(f).toMatchObject({
      kind: 'sequences',
      rgbSequence: [0, 1, 2, 3, null, null, null, null],
      rgbCustomEnabled: 1,
      effectSequence: [5, 14, 4, null, null, null, null, null],
      effectCustomEnabled: 0,
      effectCustomLength: 3,
      effectCustomGap: 2,
      rgbSelectedSlot: 4,
      rgbSpeed: 7,
      effectSelectedSlot: 2,
    });
  });

  it('malformed sequences are undefined', () => {
    const f = parseFrame('[27zz]');
    if (f.kind !== 'sequences') throw new Error('expected sequences');
    expect(f.rgbSequence).toBeUndefined();
    expect(f.effectSequence).toBeUndefined();
  });
});

describe('parseFrame: 13 version', () => {
  it('decodes the hex-encoded ASCII payload', () => {
    const f = parseFrame(`[13${asciiHex('ZY-H2DEMO-F32V3.1-DEMO ')}]`);
    expect(f).toMatchObject({ kind: 'version', hardware: 'ZY-H2', carModel: 'DEMO-F32', firmware: 'V3.1-DEMO' });
  });

  it('uppercase hex works too; bad payload gives undefined', () => {
    const f = parseFrame(`[13${asciiHex('H1.00BMW F32 FW1').toUpperCase()}]`);
    expect(f).toMatchObject({ kind: 'version', hardware: 'H1.00', carModel: 'BMW F32', firmware: 'FW1' });
    const bad = parseFrame('[13ZZ1]');
    if (bad.kind !== 'version') throw new Error('expected version');
    expect(bad.text).toBeUndefined();
    expect(bad.hardware).toBeUndefined();
  });
});

describe('parseFrame: result frames', () => {
  it('2E, 17 and 18 read hex(3)', () => {
    expect(parseFrame('[2E01]')).toMatchObject({ kind: 'settingResult', result: 1 });
    expect(parseFrame('[2E00]')).toMatchObject({ kind: 'settingResult', result: 0 });
    expect(parseFrame('[1700]')).toMatchObject({ kind: 'keyLearnResult', result: 0 });
    expect(parseFrame('[1702]')).toMatchObject({ kind: 'keyLearnResult', result: 2 });
    expect(parseFrame('[1800]')).toMatchObject({ kind: 'flashResult', result: 0 });
    expect(parseFrame('[1801]')).toMatchObject({ kind: 'flashResult', result: 1 });
    const short = parseFrame('[2E]');
    expect(short.kind).toBe('settingResult');
    if (short.kind === 'settingResult') expect(short.result).toBeUndefined();
  });
});

describe('parseFrame: factory frames', () => {
  it('23 dial codes', () => {
    expect(parseFrame('[231000000000000001]')).toMatchObject({
      kind: 'dialCodes',
      carBits: '10000000',
      featureBits: '00000001',
    });
    const short = parseFrame('[2310]');
    if (short.kind !== 'dialCodes') throw new Error('expected dialCodes');
    expect(short.carBits).toBeUndefined();
  });

  it('25 strip parameter and customer code (decimal)', () => {
    expect(parseFrame(frameAt('25', 20, { 9: '0123', 15: '0042' }))).toMatchObject({
      kind: 'factoryParams',
      stripParam: 123,
      customerCode: 42,
    });
  });

  it('4F LEDs and wiring types 1-6', () => {
    const f = parseFrame(
      frameAt('4F', 38, {
        9: '0090',
        13: '00',
        15: '0091',
        19: '01',
        21: '0060',
        25: '01',
        27: '0050',
        31: '00',
        33: '01',
        35: '00',
      }),
    );
    expect(f).toMatchObject({
      kind: 'strips',
      thirdRow: false,
      leds: { driver: 90, passenger: 91, frontDoors: 60, rearDoors: 50 },
      wiring: { driver: 0, passenger: 1, frontLeft: 1, rearLeft: 0, frontRight: 1, rearRight: 0 },
    });
  });

  it('58 adds the third row', () => {
    const f = parseFrame(frameAt('58', 46, { 9: '0090', 37: '0120', 41: '01', 43: '00' }));
    expect(f).toMatchObject({
      kind: 'strips',
      thirdRow: true,
      leds: { driver: 90, thirdRow: 120 },
      wiring: { thirdLeft: 1, thirdRight: 0 },
    });
  });
});

describe('parseFrame: robustness', () => {
  it('unknown codes and non-frames', () => {
    expect(parseFrame('[9900]')).toMatchObject({ kind: 'unknown', code: '99' });
    expect(parseFrame('hola')).toMatchObject({ kind: 'unknown', code: '' });
    expect(parseFrame('')).toMatchObject({ kind: 'unknown', code: '' });
  });

  it('never throws and never yields NaN', () => {
    const inputs = ['[', '[]', '[1F', '[4E]', '[26', '[27]', '[13]', '[23]', '[25]', '[4F]', '[58]', '[1Fzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz]', '[4F' + 'x'.repeat(40) + ']'];
    for (const input of inputs) {
      const f = parseFrame(input);
      expect(numbersIn(f).some(Number.isNaN)).toBe(false);
    }
  });

  it('lowercase codes are accepted', () => {
    expect(parseFrame('[2e01]')).toMatchObject({ kind: 'settingResult', result: 1 });
  });
});

describe('Framer', () => {
  it('reassembles a frame split across notifications', () => {
    const framer = new Framer();
    expect(framer.push('[0A')).toEqual([]);
    expect(framer.push('01]')).toEqual(['[0A01]']);
  });

  it('splits merged notifications', () => {
    const framer = new Framer();
    expect(framer.push('[2E01][1700]')).toEqual(['[2E01]', '[1700]']);
  });

  it('handles 20-byte chunks of several frames (MTU 23)', () => {
    const framer = new Framer();
    const stream = frameAt('4E', 38, { 9: 'ff6a00' }) + '[1700]' + frameAt('26', 30, { 3: '01' });
    const out: string[] = [];
    for (let i = 0; i < stream.length; i += 20) out.push(...framer.push(toBytes(stream.slice(i, i + 20))));
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(frameAt('4E', 38, { 9: 'ff6a00' }));
    expect(out[1]).toBe('[1700]');
    expect(framer.pending).toBe('');
  });

  it('drops garbage between frames', () => {
    const framer = new Framer();
    expect(framer.push('xx\r\n[2E01]yy')).toEqual(['[2E01]']);
    expect(framer.push('zz[1800]')).toEqual(['[1800]']);
  });

  it('resyncs after an unterminated frame', () => {
    const framer = new Framer();
    expect(framer.push('[1F00')).toEqual([]);
    expect(framer.push('[2E01]')).toEqual(['[2E01]']);
  });

  it('caps the buffer', () => {
    const framer = new Framer(64);
    expect(framer.push('[' + 'a'.repeat(100))).toEqual([]);
    expect(framer.pending).toBe('');
    expect(framer.push('[2E01]')).toEqual(['[2E01]']);
  });
});
