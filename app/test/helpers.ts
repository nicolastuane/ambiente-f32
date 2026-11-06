import type { MockState } from '../src/mock/zycelaMock';

/**
 * Builds a frame "by position", independently of the mock: `length` characters
 * filled with "0", "[" + code at 0-2, "]" at the end, and each field written at
 * its documented index.
 */
export function frameAt(code: string, length: number, fields: Record<number, string>): string {
  const chars = new Array<string>(length).fill('0');
  chars[0] = '[';
  chars[1] = code[0];
  chars[2] = code[1];
  chars[length - 1] = ']';
  for (const [index, value] of Object.entries(fields)) {
    for (let i = 0; i < value.length; i++) chars[Number(index) + i] = value[i];
  }
  return chars.join('');
}

export async function waitFor(condition: () => boolean, timeoutMs = 3000, label = 'condition'): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Collects every number in a nested object (to assert "no NaN"). */
export function numbersIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) for (const v of value) numbersIn(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) numbersIn(v, out);
  return out;
}

/**
 * Mock state matching the user's car (frames 4E/26/27 of 2026-11-06 and the
 * installation in docs/mi-configuracion.md).
 */
export function carLikeMockState(): Partial<MockState> {
  return {
    controlMethod: 0,
    b1: 9,
    b2: 9,
    b3: 4,
    zoning: 0,
    nightHalf: 1,
    color: 'ff1000',
    rgbMode: 0,
    rgbSpeed: 8,
    rgbCustom: 0,
    rgbSeq: 'ffffffff',
    effect: 24,
    effectSpeed: 3,
    direction: 0,
    effectCustom: 0,
    effectSeq: 'ffffffff',
    length: 3,
    gap: 5,
    sound: 1,
    soundSource: 0xff,
    welcome: 1,
    welcomeMode: 5,
    welcomeSync: 0,
    welcomeColor: 4,
    welcomeSyncAvailable: false,
    events: { '31': 1, '32': 0, '33': 0, '34': 0, '35': 1, '44': 0xff },
    turnColor: 0,
    carBits: '01000010',
    featureBits: '00000000',
    stripParam: 123,
    customerCode: 0,
    leds: { '1C': 50, '0F': 50, '13': 50, '1D': 50, '52': 0 },
    wiring: { '2C': 0, '2F': 0, '48': 1, '49': 1, '4A': 1, '4B': 1, '53': 0, '54': 0 },
  };
}
