import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SNAPSHOT,
  changedFields,
  cloneValues,
  countKnown,
  diffValues,
  emptyValues,
  restoreCommands,
  sanitizeSnapshot,
  snapshotFromFrames,
  valuesFromFrames,
  withFeatureSwitch,
} from '../src/protocol/zycela/snapshot';
import { exportSnapshot } from '../src/state/backup';
import { frameAt } from './helpers';

/** The exact usage-settings restore of the user's car (frames of 2026-11-06). */
const BUILTIN_SETTINGS = [
  '[2B00]',
  '[3B00]',
  '[3C03]',
  '[3D05]',
  '[1400]',
  '[0400]',
  '[06ff1000]',
  '[1E18]',
  '[0B03]',
  '[0C00]',
  '[3E08]',
  '[020009]',
  '[010109]',
  '[010204]',
  '[030001]',
  '[5100]',
  '[3001]',
  '[3101]',
  '[3200]',
  '[3300]',
  '[3400]',
  '[3501]',
  '[1A01]',
  '[3905]',
  '[3804]',
];

/** And its installation block (sent only between [2101] and [2100]). */
const BUILTIN_FACTORY = [
  '[200100001000000000]',
  '[1C0050]',
  '[0F0050]',
  '[130050]',
  '[1D0050]',
  '[2C00]',
  '[2F00]',
  '[4801]',
  '[4901]',
  '[4A01]',
  '[4B01]',
  '[400123]',
  '[430000]',
];

describe('built-in snapshot', () => {
  it('reads the real frames through the parser', () => {
    const s = BUILTIN_SNAPSHOT;
    expect(s.source).toBe('builtin');
    expect(s.label).toBe('Tu configuración (6/11/2026)');
    expect(s.firmware).toBe('251121-023');
    expect(s.values).toMatchObject({
      rgbMode: 0,
      color: '#ff1000',
      effect: 24,
      rgbSpeed: 8,
      brightness: { b1: 9, b2: 9, b3: 4 },
      soundSensitivity: 1,
      effectSpeed: 3,
      effectDirection: 0,
      controlMethod: 0,
      welcomeEnabled: true,
      welcomeMode: 5,
      welcomeColor: 4,
      welcomeSync: false,
      nightHalf: true,
      zoning: 0,
      soundSource: 255,
      events: { door: 1, radar: 0, speed: 0, turn: 0, ac: 1, blindSpot: 255 },
      rgbCustomEnabled: false,
      effectCustomEnabled: false,
      effectCustomLength: 3,
      effectCustomGap: 5,
      factory: { carBits: '01000010', featureBits: '00000000', stripParam: 123, customerCode: 0 },
    });
    expect(s.values.rgbSequence).toEqual(new Array(8).fill(null));
    expect(Object.keys(s.frames).sort()).toEqual(['13', '26', '27', '4E']);
    expect(countKnown(s.values)).toBe(29);
  });

  it('restores to this exact command list', () => {
    const plan = restoreCommands(BUILTIN_SNAPSHOT.values, { include: 'all' });
    expect(plan.settings).toEqual(BUILTIN_SETTINGS);
    expect(plan.factory).toEqual(BUILTIN_FACTORY);
    expect(restoreCommands(BUILTIN_SNAPSHOT.values).factory).toEqual([]);
    expect(restoreCommands(BUILTIN_SNAPSHOT.values).settings).toEqual(BUILTIN_SETTINGS);
  });

  it('never produces a forbidden command', () => {
    const { settings, factory } = restoreCommands(BUILTIN_SNAPSHOT.values, { include: 'all' });
    for (const c of [...settings, ...factory]) expect(c).not.toMatch(/^\[4[12]/);
  });
});

describe('restoreCommands skip rules', () => {
  it('skips unknown, unsupported (255) events / sound source and all-empty sequences', () => {
    const plan = restoreCommands(BUILTIN_SNAPSHOT.values, { include: 'all' });
    const reasons = Object.fromEntries(plan.skipped.map((s) => [s.field, s.reason]));
    expect(reasons).toMatchObject({
      'events.blindSpot': 'unsupported',
      soundSource: 'unsupported',
      rgbSequence: 'empty',
      effectSequence: 'empty',
      'factory.leds.thirdRow': 'unknown',
      'factory.wiring.thirdLeft': 'unknown',
    });
    expect(plan.settings.some((c) => c.startsWith('[44') || c.startsWith('[1B') || c.startsWith('[2A') || c.startsWith('[3A'))).toBe(false);
    expect(restoreCommands(emptyValues(), { include: 'all' })).toMatchObject({ settings: [], factory: [] });
  });

  it('sends a non-empty sequence before its flag, and an enabled flag right after the mode command', () => {
    const v = cloneValues(BUILTIN_SNAPSHOT.values);
    v.rgbSequence = [0, 1, 2, 3, null, null, null, null];
    v.rgbCustomEnabled = true;
    v.effectSequence = [5, null, null, null, null, null, null, null];
    v.effectCustomEnabled = true;
    const { settings } = restoreCommands(v);
    expect(settings.slice(0, 4)).toEqual(['[2A0123ffff]', '[3A5fffffff]', '[3C03]', '[3D05]']);
    expect(settings[settings.indexOf('[0400]') + 1]).toBe('[2B01]');
    expect(settings[settings.indexOf('[1E18]') + 1]).toBe('[3B01]');
    expect(settings.filter((c) => c.startsWith('[2B'))).toEqual(['[2B01]']);
  });

  it('welcome colour: [380f] when synced, otherwise the palette index', () => {
    const v = cloneValues(BUILTIN_SNAPSHOT.values);
    v.welcomeSync = true;
    expect(restoreCommands(v, { only: ['welcomeColor'] }).settings).toEqual(['[380f]']);
    v.welcomeSync = false;
    v.welcomeColor = 11;
    expect(restoreCommands(v, { only: ['welcomeSync'] }).settings).toEqual(['[380b]']);
  });

  it('reports out-of-range values instead of throwing', () => {
    const v = cloneValues(BUILTIN_SNAPSHOT.values);
    v.rgbSpeed = 0; // the 4E position is a guess: a 0 there must not become a command
    v.factory.leds.driver = 5;
    const plan = restoreCommands(v, { include: 'all' });
    expect(plan.settings.some((c) => c.startsWith('[3E'))).toBe(false);
    expect(plan.factory).not.toContain('[1C0005]');
    expect(plan.skipped).toEqual(expect.arrayContaining([{ field: 'rgbSpeed', reason: 'invalid' }]));
  });

  it('colour goes to zone "Todo" in lowercase', () => {
    const v = cloneValues(BUILTIN_SNAPSHOT.values);
    v.color = '#AABBCC';
    expect(restoreCommands(v, { only: ['color'] }).settings).toEqual(['[06aabbcc]']);
  });

  it('only: groups and single fields', () => {
    const v = BUILTIN_SNAPSHOT.values;
    expect(restoreCommands(v, { only: ['events'] }).settings).toEqual(['[3101]', '[3200]', '[3300]', '[3400]', '[3501]']);
    expect(restoreCommands(v, { only: ['brightness.b3', 'nightHalf'] }).settings).toEqual(['[010204]', '[1A01]']);
    expect(restoreCommands(v, { include: 'all', only: ['factory.wiring'] }).factory).toEqual([
      '[2C00]',
      '[2F00]',
      '[4801]',
      '[4901]',
      '[4A01]',
      '[4B01]',
    ]);
    // Without include 'all' the installation is never built, even when selected.
    expect(restoreCommands(v, { only: ['factory'] })).toMatchObject({ settings: [], factory: [] });
  });
});

describe('restoreCommands skipEqualTo', () => {
  it('drops everything when the module already matches', () => {
    expect(restoreCommands(BUILTIN_SNAPSHOT.values, { include: 'all', skipEqualTo: BUILTIN_SNAPSHOT.values })).toMatchObject({
      settings: [],
      factory: [],
    });
  });

  it('keeps only what differs (colour compared case-insensitively)', () => {
    const now = cloneValues(BUILTIN_SNAPSHOT.values);
    now.color = '#FF1000';
    now.nightHalf = false;
    now.events.turn = 1;
    now.factory.featureBits = '00000001';
    now.factory.leds.rearDoors = 60;
    const plan = restoreCommands(BUILTIN_SNAPSHOT.values, { include: 'all', skipEqualTo: now });
    expect(plan.settings).toEqual(['[3400]', '[1A01]']);
    expect(plan.factory).toEqual(['[200100001000000000]', '[1D0050]']);
  });

  it('an unknown current value counts as different', () => {
    const now = cloneValues(BUILTIN_SNAPSHOT.values);
    now.effect = null;
    expect(restoreCommands(BUILTIN_SNAPSHOT.values, { skipEqualTo: now }).settings).toEqual(['[1E18]']);
  });

  it('re-sends an enabled custom flag whenever its mode command goes out', () => {
    const want = cloneValues(BUILTIN_SNAPSHOT.values);
    want.rgbCustomEnabled = true;
    want.rgbSequence = [1, null, null, null, null, null, null, null];
    const now = cloneValues(want);
    now.rgbMode = 3;
    expect(restoreCommands(want, { skipEqualTo: now }).settings).toEqual(['[0400]', '[2B01]']);
  });
});

describe('snapshotFromFrames / diffValues', () => {
  it('builds values from any frame set, the documented 27 position winning for the RGB speed', () => {
    const state = frameAt('1F', 36, { 3: '05', 5: '03', 9: '00ff00', 21: '07', 23: '02', 25: '04', 27: '05', 29: '01', 31: '08', 33: '06' });
    const seq = frameAt('27', 34, { 3: '0123ffff', 11: '01', 13: 'ffffffff', 21: '00', 23: '02', 25: '03', 29: '04' });
    const v = valuesFromFrames([seq, state]);
    expect(v).toMatchObject({ rgbMode: 5, color: '#00ff00', rgbSpeed: 4, rgbCustomEnabled: true, controlMethod: null });
    const snap = snapshotFromFrames({ '1F': state }, { label: 'x', takenAt: '2026-11-06T10:00:00.000Z' });
    expect(snap).toMatchObject({ label: 'x', source: 'module', firmware: null, frames: { '1F': state } });
  });

  it('lists matches, differences and unknowns with Spanish labels', () => {
    const now = cloneValues(BUILTIN_SNAPSHOT.values);
    now.nightHalf = false;
    now.color = null;
    const checks = diffValues(BUILTIN_SNAPSHOT.values, now, { include: 'settings' });
    expect(checks.find((c) => c.field === 'nightHalf')).toMatchObject({
      label: 'Consola a mitad de brillo de noche',
      expected: 'sí',
      actual: 'no',
      status: 'differs',
    });
    expect(checks.find((c) => c.field === 'color')?.status).toBe('unknown');
    expect(checks.find((c) => c.field === 'events.blindSpot')).toMatchObject({ status: 'match', expected: 'no admitido' });
    expect(checks.some((c) => c.field.startsWith('factory'))).toBe(false);
    expect(changedFields(BUILTIN_SNAPSHOT.values, now)).toEqual(['nightHalf']);
  });
});

describe('sanitizeSnapshot', () => {
  it('round-trips the exported JSON', () => {
    const result = sanitizeSnapshot(JSON.parse(exportSnapshot(BUILTIN_SNAPSHOT)));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.values).toEqual(BUILTIN_SNAPSHOT.values);
      expect(result.snapshot.frames).toEqual(BUILTIN_SNAPSHOT.frames);
    }
  });

  it('rejects wrong types, bad bits, out-of-range values and odd frames', () => {
    const base = JSON.parse(exportSnapshot(BUILTIN_SNAPSHOT));
    const bad = (patch: (x: typeof base) => void) => {
      const copy = JSON.parse(JSON.stringify(base));
      patch(copy);
      return sanitizeSnapshot(copy);
    };
    expect(sanitizeSnapshot(null).ok).toBe(false);
    expect(sanitizeSnapshot({ label: 'x' }).ok).toBe(false);
    expect(bad((x) => (x.values.color = 'red')).ok).toBe(false);
    expect(bad((x) => (x.values.factory.carBits = '0100001')).ok).toBe(false);
    expect(bad((x) => (x.values.brightness.b1 = 12))).toEqual({ ok: false, error: 'Valor no válido: brightness.b1' });
    expect(bad((x) => (x.values.factory.leds.driver = 5))).toEqual({ ok: false, error: 'Valor no válido: factory.leds.driver' });
    expect(bad((x) => (x.values.nightHalf = 'yes')).ok).toBe(false);
    expect(bad((x) => (x.frames['4E'] = '<script>')).ok).toBe(false);
    expect(bad((x) => (x.values.rgbSequence = [1, 2, 3])).ok).toBe(false);
  });
});

describe('withFeatureSwitch', () => {
  it('sets one switch of the feature dial', () => {
    expect(withFeatureSwitch('00000000', 8, true)).toBe('00000001');
    expect(withFeatureSwitch('00000001', 8, false)).toBe('00000000');
    expect(withFeatureSwitch('00000000', 1, true)).toBe('10000000');
    expect(() => withFeatureSwitch('0000', 8, true)).toThrow(RangeError);
  });
});
