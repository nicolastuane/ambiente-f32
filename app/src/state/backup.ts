/**
 * Settings backup and restore against the live module, and the list of saved
 * copies (localStorage).
 *
 * Safety rules enforced here, whatever the caller asks:
 * - [41…] and [42…] are never sent;
 * - installation commands ([20…], LED counts, wiring, [40], [43]) only go out
 *   inside withFactoryMode(), which always ends with [2100] (finally);
 * - one factory-mode visit at a time (the "factory" lock, also held by the
 *   Instalación page while it is open) and one backup or restore at a time
 *   (the "module" lock), so two flows can never interleave their
 *   [2101]/[2100] or read each other's answers;
 * - the dial codes [20…] are only changed after reading frame 23, and are
 *   read back afterwards; restoring the installation first reads the whole
 *   module (a copy the caller can save) and refuses a different car code
 *   unless the user confirmed that change separately;
 * - a [2100] that could not be sent (link down, page closed in factory mode)
 *   is sent on the next connection;
 * - every command sent comes from restoreCommands() or an encoder.
 */
import { NotConnectedError } from '../ble/adapter';
import * as cmd from '../protocol/zycela/commands';
import { frameCode, parseFrame } from '../protocol/zycela/parser';
import {
  BUILTIN_SNAPSHOT,
  BUILTIN_SNAPSHOT_ID,
  diffValues,
  restoreCommands,
  sanitizeSnapshot,
  snapshotFromFrames,
  valuesFromFrames,
} from '../protocol/zycela/snapshot';
import type {
  FieldCheck,
  FieldSelector,
  Snapshot,
  SnapshotField,
  SnapshotParseResult,
  SnapshotSource,
  SnapshotValues,
} from '../protocol/zycela/snapshot';
import { createStore } from '../util/store';
import type { Store } from '../util/store';
import type { AppController } from './controller';
import type { KeyValueStorage } from './storage';

/** What backup and restore need from the controller (tests pass the real one with the mock adapter). */
export type BackupHost = Pick<AppController, 'driver' | 'session' | 'onFrame' | 'demo'>;

/** Answer to [0A01]: state, settings, sequences, version. "4E|1F" = either. */
export const STATE_GROUPS: readonly string[] = ['4E|1F', '26', '27', '13'];
/** Answer to [2101]: dial codes, factory parameters, strips. */
export const FACTORY_GROUPS: readonly string[] = ['23', '25', '4F|58'];
/** Enough to verify the usage settings. */
export const VERIFY_GROUPS: readonly string[] = ['4E|1F', '26', '27'];

export const DEFAULT_TIMEOUT_MS = 3000;
export const DEFAULT_QUIET_MS = 250;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Safety

const FORBIDDEN_CODES = new Set(['41', '42']);
const INSTALL_CODES = new Set(['20', '1C', '0F', '13', '1D', '52', '2C', '2F', '48', '49', '4A', '4B', '53', '54', '40', '43', '22']);

export class UnsafeCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeCommandError';
  }
}

/** A backup or restore that stopped before changing anything (the message says why, in Spanish). */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

/** Throws unless `command` may be sent in this context (see the rules at the top). */
export function assertSafeCommand(command: string, context: { inFactory: boolean }): void {
  if (!/^\[[0-9A-Fa-f]{2}[0-9A-Fa-f]*\]$/.test(command)) throw new UnsafeCommandError(`Orden no válida: ${command}`);
  const code = frameCode(command);
  if (FORBIDDEN_CODES.has(code)) throw new UnsafeCommandError(`La orden ${command} está prohibida`);
  if (code === '21') throw new UnsafeCommandError('El modo fábrica solo lo abre y lo cierra withFactoryMode()');
  if (INSTALL_CODES.has(code) && !context.inFactory) {
    throw new UnsafeCommandError(`${command} es de instalación: solo dentro del modo fábrica`);
  }
}

// ---------------------------------------------------------------------------
// Locks (per BLE session)

/**
 * "module": one backup, restore or car-test restore at a time (they all read
 * [0A01] and would take each other's answers). "factory": one factory-mode
 * visit at a time ([2101] … [2100]); the Instalación page holds it while open.
 * Always take "module" before "factory", never the other way round.
 */
export type LockName = 'module' | 'factory';

interface LockState {
  tail: Promise<void>;
  holder: string | null;
  readonly listeners: Set<() => void>;
}

const locks = new WeakMap<object, Record<LockName, LockState>>();

function lockOf(host: Pick<BackupHost, 'session'>, name: LockName): LockState {
  let entry = locks.get(host.session);
  if (!entry) {
    const make = (): LockState => ({ tail: Promise.resolve(), holder: null, listeners: new Set() });
    entry = { module: make(), factory: make() };
    locks.set(host.session, entry);
  }
  return entry[name];
}

function setHolder(lock: LockState, holder: string | null): void {
  lock.holder = holder;
  for (const listener of [...lock.listeners]) listener();
}

/** Waits for the lock (first come, first served) and resolves with its release function (idempotent). */
export function acquireLock(host: Pick<BackupHost, 'session'>, name: LockName, owner: string): Promise<() => void> {
  const lock = lockOf(host, name);
  const previous = lock.tail;
  let free!: () => void;
  const mine = new Promise<void>((resolve) => (free = resolve));
  lock.tail = previous.then(() => mine);
  return previous.then(() => {
    setHolder(lock, owner);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setHolder(lock, null);
      free();
    };
  });
}

export async function withLock<T>(host: Pick<BackupHost, 'session'>, name: LockName, owner: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireLock(host, name, owner);
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Who holds the lock now (null when free). */
export function lockHolder(host: Pick<BackupHost, 'session'>, name: LockName): string | null {
  return lockOf(host, name).holder;
}

export function onLockChange(host: Pick<BackupHost, 'session'>, name: LockName, listener: () => void): () => void {
  const lock = lockOf(host, name);
  lock.listeners.add(listener);
  return () => lock.listeners.delete(listener);
}

/** Resolves once nobody holds the lock (it is taken and released at once). */
export async function waitLockFree(host: Pick<BackupHost, 'session'>, name: LockName): Promise<void> {
  (await acquireLock(host, name, 'espera'))();
}

// ---------------------------------------------------------------------------
// Frames

export interface Collected {
  /** Raw frame text by code ("4E", "26"…). */
  frames: Record<string, string>;
  /** Groups that did not arrive before the timeout. */
  missing: string[];
}

/**
 * Listens for one frame of each group, then runs `trigger` (listening first
 * so a fast answer is not missed). Resolves when every group arrived or after
 * `timeoutMs` with the missing ones listed; rejects if `trigger` fails.
 */
export function collectFrames(
  host: Pick<BackupHost, 'onFrame'>,
  groups: readonly string[],
  trigger: () => Promise<unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Collected> {
  return new Promise<Collected>((resolve, reject) => {
    const frames: Record<string, string> = {};
    const pending = new Set(groups);
    let done = false;
    const stop = () => {
      done = true;
      clearTimeout(timer);
      off();
    };
    const off = host.onFrame((frame) => {
      const group = groups.find((g) => g.split('|').includes(frame.code));
      if (!group || done) return;
      frames[frame.code] = frame.raw;
      pending.delete(group);
      if (pending.size === 0) {
        stop();
        resolve({ frames, missing: [] });
      }
    });
    const timer = setTimeout(() => {
      if (done) return;
      stop();
      resolve({ frames, missing: [...pending] });
    }, timeoutMs);
    Promise.resolve()
      .then(trigger)
      .catch((error: unknown) => {
        if (done) return;
        stop();
        reject(error);
      });
  });
}

/**
 * Waits until nothing has arrived for `quietMs` (at most `maxMs`), so the
 * answers to earlier commands cannot be mistaken for the answer to the next
 * state request.
 */
export function waitQuiet(host: Pick<BackupHost, 'session'>, quietMs = DEFAULT_QUIET_MS, maxMs = 2000): Promise<void> {
  if (quietMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      clearTimeout(cap);
      off();
      resolve();
    };
    let timer = setTimeout(done, quietMs);
    const cap = setTimeout(done, maxMs);
    const off = host.session.rx.on(() => {
      clearTimeout(timer);
      timer = setTimeout(done, quietMs);
    });
  });
}

/** [0A01] and the values it reports (usage settings only), or null when nothing arrived. */
export async function readModuleValues(
  host: BackupHost,
  options: { timeoutMs?: number; quietMs?: number } = {},
): Promise<{ values: SnapshotValues; collected: Collected } | null> {
  if (!host.session.ready) return null;
  await waitQuiet(host, options.quietMs ?? DEFAULT_QUIET_MS);
  const collected = await collectFrames(host, VERIFY_GROUPS, () => host.driver.requestState(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (Object.keys(collected.frames).length === 0) return null;
  return { values: valuesFromFrames(collected.frames), collected };
}

/** Positions of the state frames that no app reads (docs/protocolo-zycela.md): compared raw. */
const UNKNOWN_SPANS: readonly { codes: readonly string[]; from: number; to: number; hint: string }[] = [
  { codes: ['4E', '1F'], from: 7, to: 8, hint: '¿encendido?' },
  { codes: ['4E', '1F'], from: 15, to: 20, hint: '¿color de la zona 2?' },
  { codes: ['26'], from: 25, to: 26, hint: '¿color de puerta?' },
];

export interface RawChange {
  /** "4E 15–20 (¿color de la zona 2?)". */
  label: string;
  before: string;
  after: string;
}

/**
 * Differences at the positions nobody decodes (4E 7–8 and 15–20, 26 25–26),
 * between two sets of raw frames. Only frames with the same code are compared.
 */
export function unknownPositionChanges(before: Record<string, string>, after: Record<string, string>): RawChange[] {
  const out: RawChange[] = [];
  for (const span of UNKNOWN_SPANS) {
    for (const code of span.codes) {
      const a = before[code];
      const b = after[code];
      if (!a || !b || a.length <= span.to || b.length <= span.to) continue;
      const x = a.slice(span.from, span.to + 1).toUpperCase();
      const y = b.slice(span.from, span.to + 1).toUpperCase();
      if (x !== y) out.push({ label: `${code} ${span.from}–${span.to} (${span.hint})`, before: x, after: y });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Factory mode

export const FACTORY_OPEN_KEY = 'ambiente-f32.factory-open.v1';

/** undefined: the browser's localStorage (tests pass their own, or null). */
let markerStorage: KeyValueStorage | null | undefined;

export function setFactoryMarkerStorage(storage: KeyValueStorage | null | undefined): void {
  markerStorage = storage;
}

function markerStore(): KeyValueStorage | null {
  return markerStorage === undefined ? browserStorage() : markerStorage;
}

/** Remembered across reloads: if the page dies in factory mode, [2100] goes out on the next connection. */
function setFactoryOpen(open: boolean): void {
  try {
    const storage = markerStore();
    if (!storage) return;
    if (open) storage.setItem(FACTORY_OPEN_KEY, new Date().toISOString());
    else storage.removeItem(FACTORY_OPEN_KEY);
  } catch {
    // Storage blocked: only the in-memory debt is kept.
  }
}

function factoryOpenMarked(): boolean {
  try {
    return !!markerStore()?.getItem(FACTORY_OPEN_KEY);
  } catch {
    return false;
  }
}

/** Sessions that owe a [2100] (in this page load). */
const owed = new WeakSet<object>();
const guarded = new WeakSet<object>();

function exitOwed(host: BackupHost): boolean {
  return owed.has(host.session) || factoryOpenMarked();
}

async function settleOwedExit(host: BackupHost): Promise<void> {
  // Someone is in factory mode on purpose: they send their own [2100].
  if (!exitOwed(host) || lockHolder(host, 'factory')) return;
  const release = await acquireLock(host, 'factory', 'Salir del modo fábrica');
  try {
    if (!exitOwed(host) || !host.session.ready) return;
    await host.driver.exitFactoryMode();
    owed.delete(host.session);
    setFactoryOpen(false);
  } catch {
    // Still owed: next time the link is ready.
  } finally {
    release();
  }
}

/**
 * Sends an owed [2100] (link dropped before it, or the page was closed or
 * reloaded in factory mode) as soon as the link is ready and nobody holds the
 * factory lock. Installed once per session (by the app and by withFactoryMode).
 */
export function guardFactoryExit(host: BackupHost): void {
  if (guarded.has(host.session)) return;
  guarded.add(host.session);
  let previous = host.session.status;
  host.session.state.subscribe(() => {
    const status = host.session.status;
    const becameReady = status === 'ready' && previous !== 'ready';
    previous = status;
    if (becameReady) void settleOwedExit(host);
  });
  if (host.session.ready) void settleOwedExit(host);
}

/** [2101] for a holder of the factory lock; marks factory mode as open first, in case the page dies. */
export function enterFactoryModeMarked(host: BackupHost): Promise<void> {
  setFactoryOpen(true);
  return host.driver.enterFactoryMode();
}

/** [2100] now, or owed until the link is ready again. */
export async function leaveFactoryMode(host: BackupHost): Promise<void> {
  if (host.session.ready) {
    try {
      await host.driver.exitFactoryMode();
      owed.delete(host.session);
      setFactoryOpen(false);
      return;
    } catch {
      // Owed below.
    }
  }
  owed.add(host.session);
  guardFactoryExit(host);
}

/**
 * Takes the factory lock, [2101], collects 23/25/4F|58, runs `fn`, and
 * [2100] in a finally (also when `fn` throws). If [2100] cannot be sent, it
 * is sent on the next connection. Paced like the other commands on both sides.
 */
export async function withFactoryMode<T>(
  host: BackupHost,
  fn: (current: Collected) => Promise<T>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  owner = 'app',
): Promise<T> {
  if (!host.session.ready) throw new NotConnectedError();
  guardFactoryExit(host);
  const release = await acquireLock(host, 'factory', owner);
  const pacing = host.driver.pacingMs;
  let entered = false;
  try {
    if (!host.session.ready) throw new NotConnectedError();
    if (pacing > 0) await sleep(pacing);
    const current = await collectFrames(
      host,
      FACTORY_GROUPS,
      () => {
        entered = true;
        return enterFactoryModeMarked(host);
      },
      timeoutMs,
    );
    return await fn(current);
  } finally {
    try {
      if (entered) {
        if (pacing > 0) await sleep(pacing);
        await leaveFactoryMode(host);
        if (pacing > 0) await sleep(pacing);
      }
    } finally {
      release();
    }
  }
}

/** The dial codes were not changed (nothing was sent). `reason`: the car code differs ('mismatch') or frame 23 was not read ('unread'). */
export class DialGuardError extends Error {
  constructor(
    message: string,
    readonly reason: 'mismatch' | 'unread' | 'other' = 'other',
  ) {
    super(message);
    this.name = 'DialGuardError';
  }
}

export interface DialBits {
  carBits: string;
  featureBits: string;
}

export interface DialResult {
  before: DialBits;
  after: { carBits: string | null; featureBits: string | null };
  /** [20…] was sent. */
  changed: boolean;
  /** Frame 23 read back with the target bits (true when nothing had to change). */
  verified: boolean;
  command: string | null;
}

function dialFrom(collected: Collected): { carBits: string | null; featureBits: string | null } {
  const raw = collected.frames['23'];
  const frame = raw ? parseFrame(raw) : null;
  if (!frame || frame.kind !== 'dialCodes') return { carBits: null, featureBits: null };
  return { carBits: frame.carBits ?? null, featureBits: frame.featureBits ?? null };
}

/**
 * Changes the dial codes from inside factory mode (`current` = what [2101]
 * reported). Aborts, sending nothing, if frame 23 is missing or if the car
 * bits differ from `expect.carBits`. Reads frame 23 back after [20…]; if the
 * module does not volunteer it, asks again with [2101].
 */
export async function changeDialInFactory(
  host: BackupHost,
  current: Collected,
  target: DialBits,
  expect: { carBits?: string | null } = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DialResult> {
  const now = dialFrom(current);
  if (!now.carBits || !now.featureBits) {
    throw new DialGuardError('No se pudieron leer los códigos de modelo (trama 23): no se cambia nada.', 'unread');
  }
  if (expect.carBits && now.carBits !== expect.carBits) {
    throw new DialGuardError(
      `El código de coche del módulo (${now.carBits}) no coincide con la copia (${expect.carBits}): no se cambia nada.`,
      'mismatch',
    );
  }
  const before = { carBits: now.carBits, featureBits: now.featureBits };
  if (before.carBits === target.carBits && before.featureBits === target.featureBits) {
    return { before, after: before, changed: false, verified: true, command: null };
  }
  const command = cmd.dialCodes(target.carBits, target.featureBits);
  assertSafeCommand(command, { inFactory: true });
  if (host.driver.pacingMs > 0) await sleep(host.driver.pacingMs);
  let readBack = await collectFrames(host, ['23'], () => host.driver.send(command), timeoutMs);
  if (readBack.missing.length) {
    await waitQuiet(host);
    readBack = await collectFrames(host, ['23'], () => host.driver.enterFactoryMode(), timeoutMs);
  }
  const after = dialFrom(readBack);
  return {
    before,
    after,
    changed: true,
    verified: after.carBits === target.carBits && after.featureBits === target.featureBits,
    command,
  };
}

/** The whole guarded sequence: [2101] → 23 → [20…] → 23 read-back → [2100] (finally). */
export function changeDialGuarded(
  host: BackupHost,
  target: DialBits,
  expect: { carBits?: string | null } = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  owner = 'app',
): Promise<DialResult> {
  return withFactoryMode(host, (current) => changeDialInFactory(host, current, target, expect, timeoutMs), timeoutMs, owner);
}

// ---------------------------------------------------------------------------
// Snapshot

export interface TakeSnapshotOptions {
  /** Also read the installation ([2101] … [2100]). */
  factory?: boolean;
  timeoutMs?: number;
  quietMs?: number;
  label?: string;
  source?: SnapshotSource;
  /** Made by the app on its own (see Snapshot.auto). */
  auto?: boolean;
  /** Who is waiting, for the lock (shown by the Instalación page). */
  owner?: string;
}

export interface TakeSnapshotResult {
  snapshot: Snapshot;
  /** Frame groups that did not arrive ("4E|1F", "23"…). */
  missing: string[];
}

/** Reads the module (and its installation, if asked). Waits for any backup, restore or factory-mode visit in progress. */
export function takeSnapshot(host: BackupHost, options: TakeSnapshotOptions = {}): Promise<TakeSnapshotResult> {
  if (!host.session.ready) return Promise.reject(new NotConnectedError());
  return withLock(host, 'module', options.owner ?? 'Copia de seguridad', () => readSnapshot(host, options));
}

async function readSnapshot(host: BackupHost, options: TakeSnapshotOptions): Promise<TakeSnapshotResult> {
  if (!host.session.ready) throw new NotConnectedError();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  await waitQuiet(host, options.quietMs ?? DEFAULT_QUIET_MS);
  const main = await collectFrames(host, STATE_GROUPS, () => host.driver.requestState(), timeoutMs);
  let frames = { ...main.frames };
  const missing = [...main.missing];
  if (options.factory) {
    const factory = await withFactoryMode(host, async (current) => current, timeoutMs, options.owner ?? 'Copia de seguridad');
    frames = { ...frames, ...factory.frames };
    missing.push(...factory.missing);
  }
  const snapshot = snapshotFromFrames(frames, {
    label: options.label,
    source: options.source ?? 'module',
    auto: options.auto,
    demo: host.demo,
  });
  return { snapshot, missing };
}

/** The state frames a usable snapshot needs. */
export function missingEssentials(missing: readonly string[]): string[] {
  return missing.filter((group) => group === '4E|1F' || group === '26' || group === '27');
}

// ---------------------------------------------------------------------------
// Restore

export async function sendPaced(
  host: BackupHost,
  commands: readonly string[],
  options: { pacingMs?: number; inFactory?: boolean } = {},
): Promise<void> {
  const pacing = options.pacingMs ?? host.driver.pacingMs;
  // Check the whole list before sending anything.
  for (const command of commands) assertSafeCommand(command, { inFactory: !!options.inFactory });
  for (let i = 0; i < commands.length; i++) {
    if (i > 0 && pacing > 0) await sleep(pacing);
    await host.driver.send(commands[i]);
  }
}

export interface RestoreSnapshotOptions {
  /**
   * Also restore the installation (dial, LEDs, wiring, [40], [43]); only what
   * differs is sent. The module is read first (installation included), and a
   * different car code is refused unless allowCarCodeChange.
   */
  includeFactory?: boolean;
  /** The user confirmed, separately, that the copy's car code may replace the module's. */
  allowCarCodeChange?: boolean;
  /** Receives the copy of the module read before anything is sent (save it to undo the restore). */
  saveBefore?: (snapshot: Snapshot) => void;
  only?: readonly FieldSelector[];
  /** Read the module first and send only the settings that differ. */
  onlyDifferent?: boolean;
  pacingMs?: number;
  timeoutMs?: number;
  quietMs?: number;
  onProgress?: (text: string) => void;
  owner?: string;
}

export interface RestoreReport {
  /** Usage-settings commands sent. */
  sent: string[];
  /** Installation commands sent inside [2101]…[2100] (dial included). */
  factorySent: string[];
  dial: DialResult | null;
  /** Expected vs read back, for every restored field. */
  checks: FieldCheck[];
  /** Frame groups missing in the read-back. */
  missing: string[];
  /** The copy of the module taken before the restore (when it was read). */
  before: Snapshot | null;
  /** Everything read back matches. */
  ok: boolean;
}

/** Fields of `values` that restoreCommands would send (selected and encodable). */
function restorableFields(values: SnapshotValues, only: readonly FieldSelector[] | undefined, include: 'settings' | 'all'): SnapshotField[] {
  const skipped = new Set(restoreCommands(values, { include, only }).skipped.map((s) => s.field));
  return diffValues(values, values, { only, include })
    .map((c) => c.field)
    .filter((field) => !skipped.has(field));
}

/** Installation values of `copy` that differ from `module` (both known), as shown before a restore. */
export function installationChanges(copy: SnapshotValues, module: SnapshotValues): FieldCheck[] {
  return diffValues(copy, module, { only: ['factory'], include: 'all' }).filter((c) => c.status !== 'match');
}

/**
 * Puts a snapshot back: usage settings first (paced like the vendor app),
 * then, only when asked, the installation inside factory mode with the dial
 * read back, and finally [0A01] to compare what the module reports with what
 * was expected. Waits for any other backup or restore in progress.
 */
export function restoreSnapshot(
  host: BackupHost,
  snapshot: Snapshot | SnapshotValues,
  options: RestoreSnapshotOptions = {},
): Promise<RestoreReport> {
  if (!host.session.ready) return Promise.reject(new NotConnectedError());
  return withLock(host, 'module', options.owner ?? 'Copia de seguridad', () => restoreUnlocked(host, snapshot, options));
}

async function restoreUnlocked(host: BackupHost, snapshot: Snapshot | SnapshotValues, options: RestoreSnapshotOptions): Promise<RestoreReport> {
  if (!host.session.ready) throw new NotConnectedError();
  const values = 'values' in snapshot && 'frames' in snapshot ? snapshot.values : (snapshot as SnapshotValues);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const quietMs = options.quietMs ?? DEFAULT_QUIET_MS;
  const pacing = options.pacingMs ?? host.driver.pacingMs;
  const progress = options.onProgress ?? (() => undefined);
  const owner = options.owner ?? 'Copia de seguridad';

  // A copy of the module first: always before touching the installation.
  let before: Snapshot | null = null;
  let moduleCar: string | null = null;
  if (options.includeFactory || options.saveBefore) {
    progress('Guardando cómo está el módulo ahora…');
    const read = await readSnapshot(host, {
      factory: !!options.includeFactory,
      timeoutMs,
      quietMs,
      owner,
      auto: true,
      label: `Antes de restaurar · ${new Date().toLocaleString('es')}${host.demo ? ' · demo' : ''}`,
    });
    const essentials = missingEssentials(read.missing);
    if (essentials.length) throw new BackupError(`No se pudo leer el módulo (faltan ${essentials.join(', ')}): no se ha cambiado nada.`);
    if (options.includeFactory) {
      const f = read.snapshot.values.factory;
      if (!f.carBits || !f.featureBits) {
        throw new DialGuardError('No se pudieron leer los códigos de modelo (trama 23): no se ha cambiado nada.', 'unread');
      }
      moduleCar = f.carBits;
      const copyCar = values.factory.carBits;
      if (copyCar && copyCar !== moduleCar && !options.allowCarCodeChange) {
        throw new DialGuardError(
          `El código de coche del módulo (${moduleCar}) no coincide con la copia (${copyCar}): no se ha cambiado nada.`,
          'mismatch',
        );
      }
    }
    before = read.snapshot;
    options.saveBefore?.(before);
  }

  let current: SnapshotValues | null = null;
  if (options.onlyDifferent) {
    if (before) current = before.values;
    else {
      progress('Leyendo el módulo…');
      current = (await readModuleValues(host, { timeoutMs, quietMs }))?.values ?? null;
    }
  }
  const settings = restoreCommands(values, { only: options.only, skipEqualTo: current }).settings;
  progress(`Enviando ${settings.length} ajustes…`);
  await sendPaced(host, settings, { pacingMs: pacing });

  let dial: DialResult | null = null;
  const factorySent: string[] = [];
  let factoryChecks: FieldCheck[] = [];
  const missing: string[] = [];
  if (options.includeFactory) {
    progress('Instalación: modo fábrica…');
    const factoryOnly: FieldSelector[] = options.only ? options.only.filter((sel) => sel.startsWith('factory')) : ['factory'];
    await withFactoryMode(
      host,
      async (now) => {
        const nowValues = valuesFromFrames(now.frames);
        // The car code must still be the one read (and confirmed) a moment ago.
        if (moduleCar && nowValues.factory.carBits && nowValues.factory.carBits !== moduleCar) {
          throw new DialGuardError('El código de coche del módulo ha cambiado desde la lectura: no se cambia la instalación.', 'mismatch');
        }
        const plan = restoreCommands(values, { include: 'all', only: factoryOnly, skipEqualTo: nowValues }).factory;
        const dialCommand = plan.find((c) => frameCode(c) === '20');
        if (dialCommand && values.factory.carBits && values.factory.featureBits) {
          dial = await changeDialInFactory(
            host,
            now,
            { carBits: values.factory.carBits, featureBits: values.factory.featureBits },
            { carBits: moduleCar },
            timeoutMs,
          );
          if (dial.command) factorySent.push(dial.command);
          if (!dial.verified) throw new DialGuardError('Los códigos de modelo leídos después no coinciden con la copia.');
        }
        const rest = plan.filter((c) => c !== dialCommand);
        if (rest.length && pacing > 0) await sleep(pacing);
        await sendPaced(host, rest, { pacingMs: pacing, inFactory: true });
        factorySent.push(...rest);
        // Read the installation back (asking again with [2101], still inside factory mode).
        await waitQuiet(host, quietMs);
        const after = await collectFrames(host, FACTORY_GROUPS, () => host.driver.enterFactoryMode(), timeoutMs);
        missing.push(...after.missing);
        factoryChecks = diffValues(values, valuesFromFrames(after.frames), {
          only: restorableFields(values, factoryOnly, 'all'),
          include: 'all',
        });
      },
      timeoutMs,
      owner,
    );
  }

  progress('Comprobando…');
  const read = await readModuleValues(host, { timeoutMs, quietMs });
  if (read) missing.push(...read.collected.missing);
  else missing.push(...VERIFY_GROUPS);
  const settingsFields = restorableFields(values, options.only, 'settings');
  const settingsChecks = settingsFields.length
    ? diffValues(values, read?.values ?? valuesFromFrames({}), { only: settingsFields, include: 'settings' })
    : [];
  const checks = [...settingsChecks, ...factoryChecks];
  const finalDial = dial as DialResult | null;
  return {
    sent: settings,
    factorySent,
    dial: finalDial,
    checks,
    missing,
    before,
    ok: checks.every((c) => c.status === 'match') && (!finalDial || finalDial.verified),
  };
}

// ---------------------------------------------------------------------------
// Saved copies

export const BACKUPS_KEY = 'ambiente-f32.backups.v1';
/** The demo module's copies are kept apart: they can never be restored onto the real module. */
export const DEMO_BACKUPS_KEY = 'ambiente-f32.backups.demo.v1';
export const MAX_BACKUPS = 10;
/** Automatic copies (before the tests, before a restore) only push out other automatic copies. */
export const MAX_AUTO_BACKUPS = 5;

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** JSON for «Copiar JSON» (and what «Pegar JSON» accepts). */
export function exportSnapshot(snapshot: Snapshot): string {
  return JSON.stringify({ app: 'ambiente-f32-backup', version: 1, ...snapshot }, null, 2);
}

/** Newest first: at most MAX_BACKUPS copies of the user and MAX_AUTO_BACKUPS automatic ones. */
function trimCopies(list: readonly Snapshot[]): Snapshot[] {
  let user = 0;
  let auto = 0;
  return list.filter((s) => (s.auto ? auto++ < MAX_AUTO_BACKUPS : user++ < MAX_BACKUPS));
}

/**
 * Copies (newest first) in localStorage, plus the built-in copy of the user's
 * configuration, which is always listed last and cannot be deleted. Storage
 * failures never throw (saveFailed tells the UI).
 */
export class BackupStore {
  readonly snapshots: Store<Snapshot[]>;
  saveFailed = false;

  constructor(
    private readonly storage: KeyValueStorage | null = browserStorage(),
    private readonly key: string = BACKUPS_KEY,
  ) {
    this.snapshots = createStore<Snapshot[]>([...this.load(), BUILTIN_SNAPSHOT]);
  }

  private load(): Snapshot[] {
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { snapshots?: unknown };
      const list = Array.isArray(parsed?.snapshots) ? parsed.snapshots : [];
      const out: Snapshot[] = [];
      for (const item of list) {
        const result = sanitizeSnapshot(item);
        if (result.ok && result.snapshot.id !== BUILTIN_SNAPSHOT_ID && !out.some((s) => s.id === result.snapshot.id)) {
          out.push(result.snapshot);
        }
      }
      return trimCopies(out);
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      if (!this.storage) throw new Error('no storage');
      this.storage.setItem(this.key, JSON.stringify({ version: 1, snapshots: this.user() }));
      this.saveFailed = false;
    } catch {
      this.saveFailed = true;
    }
  }

  /** Copies made or imported by the user (newest first), without the built-in one. */
  user(): Snapshot[] {
    return this.snapshots.get().filter((s) => s.id !== BUILTIN_SNAPSHOT_ID);
  }

  get(id: string): Snapshot | undefined {
    return this.snapshots.get().find((s) => s.id === id);
  }

  /** Adds a copy at the top; the oldest of the same kind (user or automatic) beyond its limit is dropped. */
  add(snapshot: Snapshot): Snapshot {
    const taken = new Set(this.snapshots.get().map((s) => s.id));
    let id = snapshot.id;
    while (taken.has(id) || id === BUILTIN_SNAPSHOT_ID) id = `${snapshot.id}-${Math.random().toString(36).slice(2, 6)}`;
    const stored: Snapshot = { ...snapshot, id, source: snapshot.source === 'builtin' ? 'import' : snapshot.source };
    this.snapshots.set(trimCopies([stored, ...this.user()]).concat(BUILTIN_SNAPSHOT));
    this.save();
    return stored;
  }

  /** The built-in copy cannot be removed. */
  remove(id: string): boolean {
    if (id === BUILTIN_SNAPSHOT_ID || !this.get(id)) return false;
    this.snapshots.set([...this.user().filter((s) => s.id !== id), BUILTIN_SNAPSHOT]);
    this.save();
    return true;
  }

  /** «Pegar JSON»: validates and adds the copy (source "import", never automatic). */
  importText(text: string): SnapshotParseResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: 'El texto no es JSON válido.' };
    }
    const result = sanitizeSnapshot(parsed);
    if (!result.ok) return result;
    const imported: Snapshot = { ...result.snapshot, id: `import-${Date.now().toString(36)}`, source: 'import' };
    delete imported.auto;
    const snapshot = this.add(imported);
    return { ok: true, snapshot };
  }
}

const shared: { real: BackupStore | null; demo: BackupStore | null } = { real: null, demo: null };

/** The app's list of copies (one per page load, backed by localStorage), apart for the demo module. */
export function getBackupStore(demo = false): BackupStore {
  if (demo) return (shared.demo ??= new BackupStore(browserStorage(), DEMO_BACKUPS_KEY));
  return (shared.real ??= new BackupStore(browserStorage(), BACKUPS_KEY));
}
