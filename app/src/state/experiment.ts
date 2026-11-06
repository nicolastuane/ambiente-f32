/**
 * Guided car-events experiment: the user performs one action per step (open a
 * door, start the engine…) and then taps «Ya lo hice». The runner records
 * everything the link carried during the step, separates what the module sent
 * on its own from answers to commands, asks for the state and diffs it against
 * the previous step. The goal is to find out whether the module reports
 * engine/ignition changes, so the app could react to them.
 */
import type { DeviceState } from '../protocol/zycela/state';
import { createStore } from '../util/store';
import type { Store } from '../util/store';
import type { LogEntry } from './lab';

export interface ExperimentStep {
  id: string;
  title: string;
  detail: string;
  /** Shown instead of the generic "wait for the reconnection" text when the link is down (lock/unlock). */
  offlineHint?: string;
}

export const CAR_EVENT_STEPS: readonly ExperimentStep[] = [
  {
    id: 'baseline',
    title: 'Punto de partida',
    detail:
      'Estás dentro con la puerta cerrada, el motor apagado, sin contacto y el mando de luces en 0 (apagado). No toques nada durante unos segundos.',
  },
  { id: 'door', title: 'Abrir y cerrar la puerta', detail: 'Abre la puerta del conductor, espera 3 segundos y vuelve a cerrarla.' },
  { id: 'ignition', title: 'Poner el contacto', detail: 'Pulsa START sin pisar el freno: contacto puesto, motor apagado.' },
  { id: 'engine', title: 'Arrancar el motor', detail: 'Pisa el freno y pulsa START.' },
  {
    id: 'lights',
    title: 'Luces de cruce',
    detail: 'Gira el mando de luces a luces de cruce (faros encendidos). Si el coche ya las encendió solo, déjalas así.',
  },
  { id: 'turn', title: 'Intermitente', detail: 'Pon el intermitente izquierdo 3 segundos y quítalo.' },
  { id: 'reverse', title: 'Marcha atrás', detail: 'Con el freno pisado, pon marcha atrás 3 segundos y vuelve a P.' },
  { id: 'engineOff', title: 'Apagar el motor', detail: 'Apaga el motor con START. No abras la puerta todavía.' },
  { id: 'exit', title: 'Bajar del coche', detail: 'Abre la puerta, baja y ciérrala. No bloquees todavía.' },
  {
    id: 'lock',
    title: 'Bloquear',
    detail: 'Bloquea con la llave y espera 5 segundos.',
    offlineHint: 'Es normal que el móvil se desconecte al bloquear: sigue con el paso.',
  },
  {
    id: 'unlock',
    title: 'Desbloquear',
    detail: 'Espera 10 segundos fuera y desbloquea con la llave.',
    offlineHint:
      'Al desbloquear, la app intentará reconectarse sola. Si en unos segundos no pone «Conectado» arriba, pulsa «Conectar».',
  },
];

/** Generic instruction when the link is down in a step that needs it. */
export const OFFLINE_WAIT =
  'Sin conexión con el módulo. Espera a que se reconecte (indicador arriba) o pulsa «Conectar», y después haz la acción.';

export interface StateChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface StepResult {
  step: ExperimentStep;
  skipped: boolean;
  /** First step after «Continuar» (there is a gap before it). */
  resumed?: boolean;
  /** ISO times: the window opened, the user tapped «Ya lo hice», the state was requested, the step closed. */
  startedAt: string;
  doneAt: string;
  requestedAt: string | null;
  /** The state request could not be sent (link down or write failed). */
  requestFailed?: boolean;
  finishedAt: string;
  /** Link up when the step closed. */
  connected: boolean;
  /** The link dropped or reconnected during the step (see linkEvents). */
  interrupted: boolean;
  /** Notifications the module sent by itself (no command from the app just before). */
  spontaneous: LogEntry[];
  /** Notifications that arrived shortly after a command from the app (state request, reconnection [0A01]…). */
  response: LogEntry[];
  /** Commands the app sent during the step (the runner's and the session's own). */
  appTx: LogEntry[];
  /** Connection events (lost, recovered, errors). */
  linkEvents: LogEntry[];
  /** Entries dropped because the step received too many. */
  truncated?: number;
  /** The state could not be read reliably: no diff for this step. */
  stateUnknown?: boolean;
  changes: StateChange[];
}

export type ExperimentPhase = 'idle' | 'running' | 'settling' | 'finished';

export interface ExperimentState {
  phase: ExperimentPhase;
  steps: readonly ExperimentStep[];
  /** Index of the step being performed. */
  current: number;
  /** When the current step's window opened (ISO). */
  stepStartedAt: string | null;
  /** While settling: when listening started and the planned end (for the progress bar). */
  listenStartedAt: string | null;
  listenUntil: string | null;
  startedAt: string | null;
  debug: boolean;
  requestState: boolean;
  /** Beep when a new step starts. */
  sound: boolean;
  /** Loaded from storage after a reload (the in-memory lab log no longer matches). */
  restored?: boolean;
  results: StepResult[];
}

export interface ExperimentDeps {
  log: Store<LogEntry[]>;
  device: Store<DeviceState>;
  isReady: () => boolean;
  addMarker: (note: string) => void;
  requestState: () => Promise<unknown>;
  startDebug: () => Promise<unknown>;
  stopDebug: () => Promise<unknown>;
  /** Calls the listener each time the link becomes ready; returns an unsubscribe function. */
  onReady?: (listener: () => void) => () => void;
  /** Time to keep listening after «Ya lo hice» before asking for the state. */
  settleMs?: number;
  /** Time to wait for the answer to the state request. */
  responseMs?: number;
  /** Taps sooner than this after a step starts are ignored (double taps). */
  minStepMs?: number;
  /** Keeps the results when iOS closes the page (Bluefy in the background). */
  persist?: { load(): unknown; save(state: ExperimentState): void };
}

/** An rx this soon after a command from the app counts as its answer. */
export const RESPONSE_WINDOW_MS = 1500;
/** Cap on the entries kept for one step (the debug stream can be chatty). */
const MAX_STEP_ENTRIES = 4000;

const FIELD_LABELS: Record<string, string> = {
  firmware: 'Firmware',
  power: 'Encendido',
  controlMethod: 'Control coche/móvil',
  'brightness.b1': 'Brillo 1',
  'brightness.b2': 'Brillo 2',
  'brightness.b3': 'Brillo 3 (pies)',
  zoning: 'Zonas de brillo',
  nightHalf: 'Consola a mitad de noche',
  color: 'Color actual',
  rgbMode: 'Modo RGB',
  rgbSpeed: 'Velocidad RGB',
  effect: 'Efecto',
  effectSpeed: 'Velocidad del efecto',
  effectDirection: 'Dirección del efecto',
  soundSensitivity: 'Sensibilidad al sonido',
  soundSource: 'Fuente de sonido',
  welcomeEnabled: 'Bienvenida',
  welcomeMode: 'Modo de bienvenida',
  welcomeColor: 'Color de bienvenida',
  'events.door': 'Aviso de puerta abierta',
  'events.radar': 'Radar',
  'events.speed': 'Velocidad',
  'events.turn': 'Intermitentes',
  'events.ac': 'Aire acondicionado',
  'events.blindSpot': 'Ángulo muerto',
};

/** Fields that change on every frame or say nothing about the car. */
const IGNORED = new Set(['lastFrameAt']);

function flatten(value: unknown, prefix: string, out: Map<string, string>): void {
  if (value === null || value === undefined) {
    out.set(prefix, '—');
  } else if (Array.isArray(value)) {
    out.set(prefix, value.join(','));
  } else if (typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!IGNORED.has(path)) flatten(inner, path, out);
    }
  } else {
    out.set(prefix, String(value));
  }
}

/** Every leaf field whose value differs between two device states (keys of both sides). */
export function diffStates(before: DeviceState, after: DeviceState): StateChange[] {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  flatten(before, '', a);
  flatten(after, '', b);
  const changes: StateChange[] = [];
  for (const field of new Set([...a.keys(), ...b.keys()])) {
    const previous = a.get(field) ?? '—';
    const next = b.get(field) ?? '—';
    if (previous !== next) changes.push({ field, label: FIELD_LABELS[field] ?? field, before: previous, after: next });
  }
  return changes;
}

/** Complete "[...]" frames among notifications (a frame can arrive split over several). */
export function countFrames(entries: readonly LogEntry[]): number {
  return entries.reduce((n, entry) => n + (entry.meanings?.length ?? 0), 0);
}

/** "3 notificaciones (2 tramas)" */
export function describeCount(entries: readonly LogEntry[]): string {
  const n = entries.length;
  return `${n} ${n === 1 ? 'notificación' : 'notificaciones'} (${countFrames(entries)} tramas)`;
}

/** Splits the entries of one step window into the result buckets. */
export function classifyEntries(entries: readonly LogEntry[]): Pick<StepResult, 'spontaneous' | 'response' | 'appTx' | 'linkEvents'> {
  const appTx = entries.filter((e) => e.kind === 'tx');
  const txTimes = appTx.map((e) => Date.parse(e.t));
  const spontaneous: LogEntry[] = [];
  const response: LogEntry[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'rx') continue;
    const at = Date.parse(entry.t);
    const answersCommand = txTimes.some((tx) => tx <= at && at - tx <= RESPONSE_WINDOW_MS);
    (answersCommand ? response : spontaneous).push(entry);
  }
  return { spontaneous, response, appTx, linkEvents: entries.filter((e) => e.kind === 'info' || e.kind === 'error') };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();

function initialState(steps: readonly ExperimentStep[]): ExperimentState {
  return {
    phase: 'idle',
    steps,
    current: 0,
    stepStartedAt: null,
    listenStartedAt: null,
    listenUntil: null,
    startedAt: null,
    debug: true,
    requestState: true,
    sound: true,
    results: [],
  };
}

/** Options the user chooses before starting; they survive «Repetir». */
function optionsOf(s: ExperimentState): Pick<ExperimentState, 'debug' | 'requestState' | 'sound'> {
  return { debug: s.debug !== false, requestState: s.requestState !== false, sound: s.sound !== false };
}

const isList = (value: unknown): value is LogEntry[] => Array.isArray(value);

/** Accepts a stored result only if the summary and the UI can render it; fills fields added later. */
function normalizeResult(value: unknown): StepResult | null {
  const r = value as Partial<StepResult> | null;
  if (!r || typeof r !== 'object' || !r.step || typeof r.step.id !== 'string' || typeof r.step.title !== 'string') return null;
  if (!isList(r.spontaneous) || !isList(r.response) || !Array.isArray(r.changes)) return null;
  return {
    ...(r as StepResult),
    appTx: isList(r.appTx) ? r.appTx : [],
    linkEvents: isList(r.linkEvents) ? r.linkEvents : [],
    interrupted: !!r.interrupted,
    connected: r.connected !== false,
  };
}

/** Smaller copy for localStorage: fewer entries per list, no characteristic UUIDs, no hex when text exists. */
export function compactForStorage(state: ExperimentState, maxPerList = 150): ExperimentState {
  let dropped = 0;
  const slim = (list: readonly LogEntry[]): LogEntry[] => {
    dropped += Math.max(0, list.length - maxPerList);
    return list.slice(0, maxPerList).map(({ char: _char, hex, ...rest }) => (rest.text !== undefined ? rest : { ...rest, hex }));
  };
  return {
    ...state,
    results: state.results.map((r) => {
      dropped = 0;
      const out = {
        ...r,
        spontaneous: slim(r.spontaneous),
        response: slim(r.response),
        appTx: slim(r.appTx),
        linkEvents: slim(r.linkEvents),
      };
      return dropped ? { ...out, truncated: (r.truncated ?? 0) + dropped } : out;
    }),
  };
}

export class ExperimentRunner {
  readonly state: Store<ExperimentState>;
  private snapshot: DeviceState | null = null;
  /** Snapshot used as "before" for each result, to undo a step. */
  private snapshotsBefore: (DeviceState | null)[] = [];
  /** Bumped by start/finish/reset/resume so a step still settling cannot write over them. */
  private run = 0;
  private buffer: LogEntry[] = [];
  private droppedInBuffer = 0;
  private lastSeenId = 0;
  private unwatchLog: (() => void) | null = null;
  private resumedNext = false;
  private readonly settleMs: number;
  private readonly responseMs: number;
  private readonly minStepMs: number;

  constructor(
    private readonly deps: ExperimentDeps,
    private readonly defaultSteps: readonly ExperimentStep[] = CAR_EVENT_STEPS,
  ) {
    const steps = defaultSteps;
    this.state = createStore(initialState(steps));
    this.settleMs = deps.settleMs ?? 2000;
    this.responseMs = deps.responseMs ?? 1500;
    this.minStepMs = deps.minStepMs ?? 700;
    this.restore(steps);
    if (deps.persist) this.state.subscribe(() => deps.persist?.save(this.state.get()));
    deps.onReady?.(() => this.onReconnected());
  }

  private restore(defaultSteps: readonly ExperimentStep[]): void {
    let steps = defaultSteps;
    const saved = this.deps.persist?.load() as Partial<ExperimentState> | null | undefined;
    if (!saved || typeof saved !== 'object' || !Array.isArray(saved.results)) return;
    const results = saved.results.map(normalizeResult);
    if (!results.length || results.some((r) => r === null)) return;
    // Keep the plan the results were recorded with (an older version may have had other steps).
    const savedSteps = Array.isArray(saved.steps) ? saved.steps : null;
    const validSteps =
      savedSteps && savedSteps.length >= results.length && savedSteps.every((s) => s && typeof s.id === 'string' && typeof s.title === 'string');
    if (validSteps) steps = savedSteps;
    // A page reload cannot resume the timers: show what was recorded as a finished experiment.
    this.state.set({
      ...initialState(steps),
      ...optionsOf(saved as ExperimentState),
      startedAt: typeof saved.startedAt === 'string' ? saved.startedAt : null,
      results: results as StepResult[],
      current: Math.min(results.length, steps.length - 1),
      phase: 'finished',
      restored: true,
    });
    this.snapshotsBefore = results.map(() => null);
  }

  setOptions(options: { debug?: boolean; requestState?: boolean; sound?: boolean }): void {
    this.state.update((s) => (s.phase === 'idle' ? { ...s, ...options } : s));
  }

  private stale(run: number): boolean {
    return this.run !== run || this.state.get().phase !== 'settling';
  }

  private watchLog(): void {
    this.unwatchLog?.();
    const list = this.deps.log.get();
    this.lastSeenId = list.length ? list[list.length - 1].id : 0;
    this.buffer = [];
    this.droppedInBuffer = 0;
    this.unwatchLog = this.deps.log.subscribe(() => this.collect());
  }

  /** Copies new log entries into the runner's own buffer (the shared log is capped and can be cleared). */
  private collect(): void {
    const list = this.deps.log.get();
    let first = list.length;
    while (first > 0 && list[first - 1].id > this.lastSeenId) first--;
    for (let i = first; i < list.length; i++) this.buffer.push(list[i]);
    if (first < list.length) this.lastSeenId = list[list.length - 1].id;
    if (this.buffer.length > MAX_STEP_ENTRIES) {
      const excess = this.buffer.length - MAX_STEP_ENTRIES;
      this.buffer.splice(0, excess);
      this.droppedInBuffer += excess;
    }
  }

  private stopWatching(): void {
    this.unwatchLog?.();
    this.unwatchLog = null;
    this.buffer = [];
  }

  private onReconnected(): void {
    const s = this.state.get();
    if (s.phase !== 'running' && s.phase !== 'settling') return;
    this.deps.addMarker('Experimento: conexión recuperada');
    if (s.debug) {
      this.deps.startDebug().catch(() => this.deps.addMarker('Experimento: no se pudo reactivar la depuración [3702]'));
    }
  }

  private async enableDebug(debug: boolean): Promise<void> {
    if (!debug || !this.deps.isReady()) return;
    await this.deps.startDebug().catch(() => this.deps.addMarker('Experimento: no se pudo activar la depuración [3702]'));
  }

  async start(): Promise<void> {
    const s = this.state.get();
    if (s.phase !== 'idle' && s.phase !== 'finished') return;
    this.run++;
    this.snapshot = this.deps.device.get();
    this.snapshotsBefore = [];
    this.resumedNext = false;
    this.watchLog();
    const at = nowIso();
    this.state.set({ ...initialState(this.defaultSteps), ...optionsOf(s), phase: 'running', startedAt: at, stepStartedAt: at });
    this.deps.addMarker('Experimento: inicio');
    await this.enableDebug(s.debug);
  }

  /** Continues a restored or stopped experiment from the first step without a result. */
  async resume(): Promise<void> {
    const s = this.state.get();
    if (s.phase !== 'finished' || s.results.length >= s.steps.length) return;
    this.run++;
    const device = this.deps.device.get();
    this.snapshot = this.deps.isReady() && device.lastFrameAt !== null ? device : null;
    while (this.snapshotsBefore.length < s.results.length) this.snapshotsBefore.push(null);
    this.resumedNext = true;
    this.watchLog();
    const at = nowIso();
    this.state.set({ ...s, phase: 'running', current: s.results.length, stepStartedAt: at, restored: false });
    this.deps.addMarker(`Experimento: continuado en el paso ${s.results.length + 1}`);
    await this.enableDebug(s.debug);
  }

  /** The user performed the current step (or skips it). */
  async complete(skipped = false): Promise<void> {
    const s = this.state.get();
    if (s.phase !== 'running' || s.stepStartedAt === null) return;
    if (Date.now() - Date.parse(s.stepStartedAt) < this.minStepMs) return;
    const run = this.run;
    const step = s.steps[s.current];
    const doneAt = nowIso();
    this.deps.addMarker(`Paso ${s.current + 1}: ${step.title}${skipped ? ' (saltado)' : ''}`);
    let requestedAt: string | null = null;
    let requestFailed = false;
    if (!skipped) {
      this.state.set({ ...s, phase: 'settling', listenStartedAt: doneAt, listenUntil: new Date(Date.now() + this.settleMs).toISOString() });
      await sleep(this.settleMs);
      if (this.stale(run)) return;
      if (s.requestState && this.deps.isReady()) {
        requestedAt = nowIso();
        this.state.update((x) => ({ ...x, listenUntil: new Date(Date.now() + this.responseMs).toISOString() }));
        const sent = await this.deps.requestState().then(
          () => true,
          () => false,
        );
        if (this.stale(run)) return;
        if (sent) {
          this.state.update((x) => ({ ...x, listenUntil: new Date(Date.now() + this.responseMs).toISOString() }));
          await sleep(this.responseMs);
          if (this.stale(run)) return;
        } else {
          requestFailed = true;
        }
      } else if (s.requestState) {
        requestFailed = true;
      }
    }
    const finishedAt = nowIso();
    // The buffer holds exactly what arrived since this step's window opened (it is emptied at
    // every step boundary), so no timestamp comparison can drop an entry logged in the same ms.
    this.collect();
    const entries = this.buffer;
    this.buffer = [];
    const buckets = classifyEntries(entries);
    const connected = this.deps.isReady();
    const after = this.deps.device.get();
    const fresh =
      connected &&
      after.lastFrameAt !== null &&
      (requestedAt === null || requestFailed || after.lastFrameAt >= Date.parse(requestedAt)) &&
      !(s.requestState && requestFailed);
    const before = this.snapshot;
    let changes: StateChange[] = [];
    let stateUnknown = false;
    if (!skipped) {
      if (fresh) {
        if (before) changes = diffStates(before, after);
        this.snapshot = after;
      } else {
        stateUnknown = true;
      }
    }
    const result: StepResult = {
      step,
      skipped,
      ...(this.resumedNext ? { resumed: true } : {}),
      startedAt: s.stepStartedAt,
      doneAt,
      requestedAt: requestFailed ? null : requestedAt,
      ...(requestFailed ? { requestFailed: true } : {}),
      finishedAt,
      connected,
      interrupted: buckets.linkEvents.length > 0,
      ...buckets,
      ...(this.droppedInBuffer ? { truncated: this.droppedInBuffer } : {}),
      ...(stateUnknown ? { stateUnknown: true } : {}),
      changes,
    };
    this.resumedNext = false;
    this.droppedInBuffer = 0;
    this.snapshotsBefore.push(before);
    const results = [...this.state.get().results, result];
    if (s.current + 1 >= s.steps.length) {
      this.state.update((x) => ({ ...x, results }));
      await this.finish();
    } else {
      this.state.update((x) => ({
        ...x,
        results,
        phase: 'running',
        current: s.current + 1,
        stepStartedAt: finishedAt,
        listenStartedAt: null,
        listenUntil: null,
      }));
    }
  }

  /** «Me equivoqué»: drops the last result and repeats that step. */
  undo(): void {
    const s = this.state.get();
    if (s.phase !== 'running' || s.results.length === 0) return;
    const results = s.results.slice(0, -1);
    this.snapshot = this.snapshotsBefore.pop() ?? null;
    this.buffer = [];
    this.droppedInBuffer = 0;
    this.deps.addMarker(`Paso ${results.length + 1}: deshecho, se repite`);
    this.state.set({ ...s, results, current: results.length, stepStartedAt: nowIso() });
  }

  async finish(): Promise<void> {
    const s = this.state.get();
    if (s.phase !== 'running' && s.phase !== 'settling') return;
    this.run++;
    this.stopWatching();
    this.state.update((x) => ({ ...x, phase: 'finished', stepStartedAt: null, listenStartedAt: null, listenUntil: null }));
    this.deps.addMarker('Experimento: fin');
    if (s.debug && this.deps.isReady()) await this.deps.stopDebug().catch(() => undefined);
  }

  reset(): void {
    const s = this.state.get();
    this.run++;
    this.stopWatching();
    this.snapshot = null;
    this.snapshotsBefore = [];
    this.state.set({ ...initialState(this.defaultSteps), ...optionsOf(s) });
  }
}

function clock(iso: string): string {
  const d = new Date(iso);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

const MAX_FRAMES_PER_STEP = 30;

function entryLine(e: LogEntry): string {
  const meaning = e.meanings?.length ? `  (${e.meanings.join('; ')})` : '';
  return `${clock(e.t)}  ${e.text ?? e.hex ?? e.note ?? ''}${meaning}`;
}

function frameLines(entries: readonly LogEntry[], indent = '     '): string[] {
  const lines = entries.slice(0, MAX_FRAMES_PER_STEP).map((e) => indent + entryLine(e));
  if (entries.length > MAX_FRAMES_PER_STEP) lines.push(`${indent}… y ${entries.length - MAX_FRAMES_PER_STEP} más (ver JSON)`);
  return lines;
}

/** Plain-text report to paste in a chat. */
export function experimentSummary(state: ExperimentState, device: { name: string | null } | null, firmware: string | null): string {
  const lines = [
    `Experimento Ambiente F32 · ${state.startedAt ? new Date(state.startedAt).toLocaleString('es') : ''}`,
    `Módulo: ${device?.name ?? '?'} · firmware ${firmware ?? '?'} · depuración [3702]: ${state.debug ? 'sí' : 'no'} · pedir estado: ${state.requestState ? 'sí' : 'no'}`,
    '',
  ];
  state.results.forEach((r, i) => {
    const flags = [
      r.resumed ? 'continuado tras una pausa' : '',
      r.interrupted ? 'la conexión se cortó o se recuperó' : '',
      !r.skipped && !r.connected ? 'DESCONECTADO al terminar' : '',
      r.requestFailed ? 'no se pudo pedir el estado' : '',
      r.truncated ? `${r.truncated} entradas descartadas` : '',
    ].filter(Boolean);
    const head = r.skipped
      ? `${i + 1}. ${r.step.title}: saltado`
      : `${i + 1}. ${r.step.title}: espontáneas ${describeCount(r.spontaneous)}, respuesta ${describeCount(r.response)}, ` +
        (r.stateUnknown ? 'estado desconocido' : `${r.changes.length} cambios`);
    lines.push(head + (flags.length ? ` [${flags.join('; ')}]` : ''));
    if (r.spontaneous.length) lines.push(r.skipped ? '   Llegaron igualmente:' : '   Espontáneas:', ...frameLines(r.spontaneous));
    if (r.linkEvents.length) lines.push('   Conexión:', ...frameLines(r.linkEvents));
    // The experiment's own state request is implied; list the others (reconnection [0A01], [3702]…).
    const requested = r.requestedAt ? Date.parse(r.requestedAt) : null;
    const otherTx = r.appTx.filter((e) => {
      const at = Date.parse(e.t);
      return !(e.text === '[0A01]' && requested !== null && at >= requested && at - requested < 6000);
    });
    if (otherTx.length) lines.push('   Órdenes enviadas por la app:', ...frameLines(otherTx));
    if (r.changes.length) {
      lines.push('   Cambios de estado:');
      for (const c of r.changes) lines.push(`     ${c.label}: ${c.before} → ${c.after}`);
    }
  });
  return lines.join('\n');
}
