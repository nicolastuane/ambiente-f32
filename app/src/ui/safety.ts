/** Safety gates shared by the confirmation dialogs and the lab console. */
import { frameCode } from '../protocol/zycela/parser';

/** Default arming delay of danger dialogs (longer than a double tap). */
export const DANGER_ARM_MS = 500;

/** Arming delay of the last confirmation before [4100]. */
export const FINAL_CONFIRM_ARM_MS = 2000;

export type CommandRisk =
  /** [4100]: may reprogram something in the car. Needs "show dangerous options" and two confirmations. */
  | 'flash'
  /** [4200] factory reset, [20…] model codes: confirm once. */
  | 'confirm'
  | 'none';

/**
 * How careful the lab console must be before sending `text` (ASCII such as
 * "[4100]"). Every "[XX" in the text counts, so raw bytes with several
 * commands or leading garbage cannot slip a dangerous one through.
 */
export function commandRisk(text: string): CommandRisk {
  let risk: CommandRisk = 'none';
  for (const match of text.matchAll(/\[[0-9A-Fa-f]{2}/g)) {
    const code = frameCode(match[0]);
    if (code === '41') return 'flash';
    if (code === '42' || code === '20') risk = 'confirm';
  }
  return risk;
}
