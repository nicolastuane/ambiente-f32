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
