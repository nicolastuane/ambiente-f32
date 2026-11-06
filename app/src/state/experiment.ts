/**
 * Guided car-events experiment: the user performs one action per step (open a
 * door, start the engine…) and the runner records which frames the module sent
 * on its own, asks for the state afterwards and diffs it against the previous
 * step. The goal is to find out whether the module reports engine/ignition
 * changes, so the app could react to them.
 */
import type { DeviceState } from '../protocol/zycela/state';
import { createStore } from '../util/store';
import type { Store } from '../util/store';
import type { LogEntry } from './lab';

export interface ExperimentStep {
  id: string;
  title: string;
  detail: string;
}

export const CAR_EVENT_STEPS: readonly ExperimentStep[] = [
  { id: 'baseline', title: 'Punto de partida', detail: 'Coche desbloqueado, motor apagado y sin contacto. No toques nada.' },
  { id: 'door', title: 'Abrir y cerrar la puerta', detail: 'Abre la puerta del conductor, espera 3 segundos y ciérrala.' },
  { id: 'ignition', title: 'Poner el contacto', detail: 'Pulsa START sin pisar el freno: contacto puesto, motor apagado.' },
  { id: 'engine', title: 'Arrancar el motor', detail: 'Pisa el freno y pulsa START.' },
  { id: 'lights', title: 'Luces de cruce', detail: 'Enciende las luces de cruce (o déjalas en automático si ya es de noche).' },
  { id: 'turn', title: 'Intermitente', detail: 'Pon el intermitente izquierdo 3 segundos y quítalo.' },
  { id: 'reverse', title: 'Marcha atrás', detail: 'Con el freno pisado, pon marcha atrás 3 segundos y vuelve a P.' },
  { id: 'engineOff', title: 'Apagar el motor', detail: 'Apaga el motor con START. No abras la puerta todavía.' },
  { id: 'lock', title: 'Bajar y bloquear', detail: 'Baja, cierra y bloquea con la llave. Si el móvil se desconecta, es normal: sigue.' },
  { id: 'unlock', title: 'Desbloquear', detail: 'Espera 10 segundos y desbloquea con la llave.' },
];

export interface StateChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface StepResult {
  step: ExperimentStep;
  skipped: boolean;
  /** ISO times: the window opened, the user tapped "Hecho", the state was requested, the step closed. */
  startedAt: string;
  doneAt: string;
  requestedAt: string | null;
  finishedAt: string;
  connected: boolean;
  /** Notifications the module sent by itself (before our state request). */
  spontaneous: LogEntry[];
  /** Notifications after our state request. */
  response: LogEntry[];
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
  startedAt: string | null;
  debug: boolean;
  requestState: boolean;
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
  /** Time to keep listening after "Hecho" before asking for the state. */
  settleMs?: number;
  /** Time to wait for the answer to the state request. */
  responseMs?: number;
  /** Keeps the results when iOS closes the page (Bluefy in the background). */
  persist?: { load(): ExperimentState | null; save(state: ExperimentState): void };
}

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

/** Every leaf field whose value differs between two device states. */
export function diffStates(before: DeviceState, after: DeviceState): StateChange[] {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  flatten(before, '', a);
  flatten(after, '', b);
  const changes: StateChange[] = [];
  for (const [field, value] of b) {
    const previous = a.get(field) ?? '—';
    if (previous !== value) changes.push({ field, label: FIELD_LABELS[field] ?? field, before: previous, after: value });
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

function rxBetween(log: readonly LogEntry[], from: string, to: string): LogEntry[] {
  return log.filter((entry) => entry.kind === 'rx' && entry.t >= from && entry.t < to);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function initialState(steps: readonly ExperimentStep[]): ExperimentState {
  return {
    phase: 'idle',
    steps,
    current: 0,
    stepStartedAt: null,
    startedAt: null,
    debug: true,
    requestState: true,
    results: [],
  };
}

export class ExperimentRunner {
  readonly state: Store<ExperimentState>;
  private snapshot: DeviceState | null = null;
  private readonly settleMs: number;
  private readonly responseMs: number;

  constructor(
    private readonly deps: ExperimentDeps,
    steps: readonly ExperimentStep[] = CAR_EVENT_STEPS,
  ) {
    this.state = createStore(initialState(steps));
    this.settleMs = deps.settleMs ?? 2000;
    this.responseMs = deps.responseMs ?? 1500;
    const saved = deps.persist?.load();
    if (saved && Array.isArray(saved.results) && saved.results.length > 0) {
      // A page reload cannot resume the timers: show what was recorded as a finished experiment.
      this.state.set({ ...initialState(steps), ...saved, steps, phase: 'finished', stepStartedAt: null });
    }
    if (deps.persist) this.state.subscribe(() => deps.persist?.save(this.state.get()));
  }

  setOptions(options: { debug?: boolean; requestState?: boolean }): void {
    this.state.update((s) => (s.phase === 'idle' ? { ...s, ...options } : s));
  }

  async start(): Promise<void> {
    const s = this.state.get();
    if (s.phase !== 'idle' && s.phase !== 'finished') return;
    const now = new Date().toISOString();
    this.state.set({ ...initialState(s.steps), debug: s.debug, requestState: s.requestState, phase: 'running', startedAt: now });
    this.deps.addMarker('Experimento: inicio');
    if (s.debug && this.deps.isReady()) await this.deps.startDebug().catch(() => undefined);
    this.snapshot = this.deps.device.get();
    this.state.update((x) => ({ ...x, stepStartedAt: new Date().toISOString() }));
  }

  /** The user performed the current step (or skips it). */
  async complete(skipped = false): Promise<void> {
    const s = this.state.get();
    if (s.phase !== 'running' || s.stepStartedAt === null) return;
    const step = s.steps[s.current];
    const doneAt = new Date().toISOString();
    this.deps.addMarker(`Paso ${s.current + 1}: ${step.title}${skipped ? ' (saltado)' : ''}`);
    let requestedAt: string | null = null;
    if (!skipped) {
      this.state.set({ ...s, phase: 'settling' });
      await sleep(this.settleMs);
      if (s.requestState && this.deps.isReady()) {
        requestedAt = new Date().toISOString();
        await this.deps.requestState().catch(() => undefined);
        await sleep(this.responseMs);
      }
    }
    const finishedAt = new Date().toISOString();
    const log = this.deps.log.get();
    const after = this.deps.device.get();
    const result: StepResult = {
      step,
      skipped,
      startedAt: s.stepStartedAt,
      doneAt,
      requestedAt,
      finishedAt,
      connected: this.deps.isReady(),
      spontaneous: rxBetween(log, s.stepStartedAt, requestedAt ?? finishedAt),
      response: requestedAt ? rxBetween(log, requestedAt, finishedAt) : [],
      changes: skipped || !this.snapshot ? [] : diffStates(this.snapshot, after),
    };
    if (!skipped) this.snapshot = after;
    const results = [...this.state.get().results, result];
    if (s.current + 1 >= s.steps.length) {
      this.state.update((x) => ({ ...x, results }));
      await this.finish();
    } else {
      this.state.update((x) => ({ ...x, results, phase: 'running', current: s.current + 1, stepStartedAt: finishedAt }));
    }
  }

  async finish(): Promise<void> {
    const s = this.state.get();
    if (s.phase === 'idle' || s.phase === 'finished') return;
    if (s.debug && this.deps.isReady()) await this.deps.stopDebug().catch(() => undefined);
    this.deps.addMarker('Experimento: fin');
    this.state.update((x) => ({ ...x, phase: 'finished', stepStartedAt: null }));
  }

  reset(): void {
    const s = this.state.get();
    this.snapshot = null;
    this.state.set({ ...initialState(s.steps), debug: s.debug, requestState: s.requestState });
  }
}

function clock(iso: string): string {
  const d = new Date(iso);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

const MAX_FRAMES_PER_STEP = 30;

function frameLines(entries: readonly LogEntry[]): string[] {
  const lines = entries.slice(0, MAX_FRAMES_PER_STEP).map((e) => {
    const meaning = e.meanings?.length ? `  (${e.meanings.join('; ')})` : '';
    return `     ${clock(e.t)}  ${e.text ?? e.hex ?? ''}${meaning}`;
  });
  if (entries.length > MAX_FRAMES_PER_STEP) lines.push(`     … y ${entries.length - MAX_FRAMES_PER_STEP} más (ver JSON)`);
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
    if (r.skipped) {
      lines.push(`${i + 1}. ${r.step.title}: saltado`);
      return;
    }
    lines.push(
      `${i + 1}. ${r.step.title}${r.connected ? '' : ' (DESCONECTADO al terminar)'}: ` +
        `espontáneas ${describeCount(r.spontaneous)}, respuesta ${describeCount(r.response)}, ${r.changes.length} cambios`,
    );
    if (r.spontaneous.length) lines.push('   Espontáneas:', ...frameLines(r.spontaneous));
    if (r.changes.length) {
      lines.push('   Cambios de estado:');
      for (const c of r.changes) lines.push(`     ${c.label}: ${c.before} → ${c.after}`);
    }
  });
  return lines.join('\n');
}
