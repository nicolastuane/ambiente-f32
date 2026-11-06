/** Lab helpers: raw console input parsing and the lab export JSON (shared with tools/). */
import { hexToBytes, toBytes } from '../protocol/zycela/commands';
import type { GattServiceInfo } from '../ble/session';

export type LogKind = 'tx' | 'rx' | 'marker' | 'info' | 'error';

export interface LogEntry {
  id: number;
  /** ISO-8601 with milliseconds. */
  t: string;
  kind: LogKind;
  char?: string;
  /** "AA 01 FF" */
  hex?: string;
  /** ASCII rendering of the bytes. */
  text?: string;
  withResponse?: boolean;
  note?: string;
  /** Parsed meaning of the command or of the frames completed by this notification. */
  meanings?: string[];
}

export type ConsoleMode = 'command' | 'bytes';

export type ConsoleParseResult =
  | { ok: true; bytes: Uint8Array; text: string | null }
  | { ok: false; error: string };

const HEX_PAIRS = /^(?:[0-9a-fA-F]{2})+$/;

/**
 * "command" mode: "0A01" (hex pairs, wrapped in brackets like the original
 * debug console) or full text "[0A01]". "bytes" mode: raw hex bytes such as
 * "5B 30 41 30 31 5D".
 */
export function parseConsoleInput(input: string, mode: ConsoleMode): ConsoleParseResult {
  const value = input.trim();
  if (!value) return { ok: false, error: 'Escribe un comando.' };
  if (mode === 'bytes') {
    try {
      return { ok: true, bytes: hexToBytes(value), text: null };
    } catch {
      return { ok: false, error: 'Escribe bytes en hexadecimal, por ejemplo 5B 30 41 30 31 5D.' };
    }
  }
  if (value.startsWith('[')) {
    if (!value.endsWith(']') || value.length < 4) return { ok: false, error: 'El texto debe ser una trama completa, como [0A01].' };
    if (!/^[\x20-\x7e]+$/.test(value)) return { ok: false, error: 'Solo se admiten caracteres ASCII.' };
    return { ok: true, bytes: toBytes(value), text: value };
  }
  if (!HEX_PAIRS.test(value)) {
    return { ok: false, error: 'Comando no válido: usa pares hexadecimales sin espacios, como 0A01.' };
  }
  const text = `[${value}]`;
  return { ok: true, bytes: toBytes(text), text };
}

export interface LabExport {
  app: 'ambiente-f32-lab';
  version: 1;
  exportedAt: string;
  device: { name: string | null; id: string | null };
  gatt: GattServiceInfo[];
  events: {
    t: string;
    kind: LogKind;
    char?: string;
    hex?: string;
    withResponse?: boolean;
    note?: string;
  }[];
}

export function buildLabExport(
  log: readonly LogEntry[],
  device: { name: string | null; id: string | null } | null,
  gatt: GattServiceInfo[],
): LabExport {
  return {
    app: 'ambiente-f32-lab',
    version: 1,
    exportedAt: new Date().toISOString(),
    device: { name: device?.name ?? null, id: device?.id ?? null },
    gatt: gatt.map((s) => ({
      service: s.service.toLowerCase(),
      characteristics: s.characteristics.map((c) => ({ uuid: c.uuid.toLowerCase(), properties: [...c.properties] })),
    })),
    events: log.map((entry) => {
      const event: LabExport['events'][number] = { t: entry.t, kind: entry.kind };
      if (entry.char) event.char = entry.char.toLowerCase();
      if (entry.hex) event.hex = entry.hex;
      if (entry.withResponse !== undefined) event.withResponse = entry.withResponse;
      const notes = [entry.note, entry.text, ...(entry.meanings ?? [])].filter((x): x is string => !!x);
      if (notes.length) event.note = notes.join(' | ');
      return event;
    }),
  };
}
