/** Guided experiment: what does the module report when the car is unlocked, started, turned off…? */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AppController } from '../../state/controller';
import { ExperimentRunner, OFFLINE_WAIT, compactForStorage, describeCount, experimentSummary } from '../../state/experiment';
import type { ExperimentState, StepResult } from '../../state/experiment';
import type { LabExport } from '../../state/lab';
import { beep, unlockAudio } from '../../util/beep';
import { copyText } from '../../util/files';
import { keepAwake, refreshWakeLock } from '../../util/wakeLock';
import { useConnection, useController, useDevice, useLog, useReady } from '../AppContext';
import { Card, Toggle } from '../controls';
import { Icon } from '../Icon';

/** One runner per controller, so leaving the page does not lose a running experiment. */
const runners = new WeakMap<AppController, ExperimentRunner>();

const STORAGE_KEY = 'ambiente-f32.experiment.v2';
const OLD_STORAGE_KEYS = ['ambiente-f32.experiment.v1'];

/** Set when even a reduced copy did not fit in localStorage. */
let persistFailed = false;

/** The last experiment survives iOS closing Bluefy; storage errors (quota, private mode) are handled. */
const persist = {
  load(): unknown {
    try {
      // Results saved by the previous version are still readable (the runner fills the new fields).
      const raw = localStorage.getItem(STORAGE_KEY) ?? OLD_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  save(state: ExperimentState): void {
    try {
      if (state.phase === 'idle' && state.results.length === 0) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      for (const maxPerList of [150, 20]) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(compactForStorage(state, maxPerList)));
          for (const key of OLD_STORAGE_KEYS) localStorage.removeItem(key);
          persistFailed = false;
          return;
        } catch {
          // Try a smaller copy.
        }
      }
      // Never leave an older, shorter copy that a reload would show as the result.
      localStorage.removeItem(STORAGE_KEY);
      persistFailed = true;
    } catch {
      persistFailed = true;
    }
  },
};

/** Step whose start was already announced with a beep. */
let lastCue: string | null = null;

// iOS releases the wake lock while the page is hidden.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshWakeLock();
  });
}

function runnerFor(controller: AppController): ExperimentRunner {
  let runner = runners.get(controller);
  if (!runner) {
    const created = new ExperimentRunner({
      log: controller.log,
      device: controller.device,
      isReady: () => controller.session.status === 'ready',
      addMarker: (note) => controller.addMarker(note),
      requestState: () => controller.driver.requestState(),
      startDebug: () => controller.driver.startDebug(),
      stopDebug: () => controller.driver.stopDebug(),
      onReady: (listener) => {
        let previous = controller.session.status;
        return controller.session.state.subscribe(() => {
          const status = controller.session.status;
          if (status === 'ready' && previous !== 'ready') listener();
          previous = status;
        });
      },
      persist,
    });
    // Beep and keep the screen on from here, not from the page: the experiment outlives the page.
    created.state.subscribe(() => {
      const s = created.state.get();
      if (s.phase === 'running' && s.stepStartedAt && s.stepStartedAt !== lastCue) {
        lastCue = s.stepStartedAt;
        if (s.sound) beep();
      }
      keepAwake(s.phase === 'running' || s.phase === 'settling');
    });
    runners.set(controller, created);
    runner = created;
  }
  return runner;
}

function resultTone(result: StepResult): 'ok' | 'warn' | 'neutral' {
  if (result.skipped) return 'neutral';
  return !result.connected || result.interrupted || result.stateUnknown ? 'warn' : 'ok';
}

function ResultRow({ index, result }: { index: number; result: StepResult }) {
  const summary = result.skipped
    ? 'Saltado'
    : `Espontáneas: ${describeCount(result.spontaneous)} · respuesta: ${describeCount(result.response)} · ` +
      (result.stateUnknown ? 'estado desconocido' : `${result.changes.length} cambios`);
  return (
    <li className="exp-result">
      <div className="exp-result-head">
        <span className="exp-num">{index + 1}</span>
        <span className="exp-result-title">{result.step.title}</span>
        {resultTone(result) === 'warn' && <span className="log-flag">conexión</span>}
      </div>
      <div className="hint">{summary}</div>
      {result.spontaneous.slice(0, 5).map((entry) => (
        <div key={entry.id} className="log-text mono">
          {entry.text ?? entry.hex}
        </div>
      ))}
      {result.changes.map((change) => (
        <div key={change.field} className="log-meaning">
          {change.label}: {change.before} → {change.after}
        </div>
      ))}
    </li>
  );
}

/** One dot per step: done, skipped, current (pulsing) or pending. */
function StepDots({ state }: { state: ExperimentState }) {
  const statusText = { done: 'hecho', skipped: 'saltado', current: 'ahora', pending: 'pendiente' } as const;
  return (
    <ol className="exp-dots">
      {state.steps.map((s, i) => {
        const result = state.results[i];
        const status = result ? (result.skipped ? 'skipped' : 'done') : i === state.current ? 'current' : 'pending';
        return (
          <li key={s.id} className={`exp-dot exp-dot-${status}`} aria-current={status === 'current' ? 'step' : undefined}>
            <span className="sr-only">{`${i + 1}. ${s.title}: ${statusText[status]}`}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Listening progress, driven by the real planned end (it can be extended when the state request goes out). */
function ListenProgress({ from, until }: { from: string; until: string }) {
  const [now, setNow] = useState(() => Date.now());
  const best = useRef(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);
  const start = Date.parse(from);
  const end = Date.parse(until);
  const overdue = now > end + 300;
  best.current = Math.max(best.current, Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start))));
  return (
    <>
      <div className={overdue ? 'exp-progress exp-progress-wait' : 'exp-progress'} aria-hidden="true">
        <span style={{ transform: `scaleX(${overdue ? 1 : best.current})` }} />
      </div>
      {overdue && <p className="hint">Esperando la respuesta del módulo…</p>}
    </>
  );
}

function filterLab(lab: LabExport, from: string | null, to: string): LabExport {
  return { ...lab, events: lab.events.filter((e) => (!from || e.t >= from) && e.t <= to) };
}

export function Experiment() {
  const controller = useController();
  const runner = runnerFor(controller);
  const state = useSyncExternalStore(runner.state.subscribe, runner.state.get);
  const ready = useReady();
  const connection = useConnection();
  const device = useDevice();
  const log = useLog();
  const [confirmFinish, setConfirmFinish] = useState(false);
  const stepRef = useRef<HTMLDivElement>(null);
  const step = state.steps[state.current];
  const listening = state.phase === 'settling';
  const running = state.phase === 'running' || listening;
  const offline = running && !ready;
  const previous = state.current > 0 ? state.results[state.current - 1] : undefined;
  const stepKey = `${state.startedAt}-${state.current}`;

  const live = useMemo(
    () => (state.stepStartedAt ? log.filter((e) => e.kind === 'rx' && e.t >= state.stepStartedAt!) : []),
    [log, state.stepStartedAt],
  );

  // Bring the new step into view: the cue must not appear above the viewport.
  useEffect(() => {
    if (state.phase !== 'running') return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    stepRef.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [stepKey, state.phase]);

  useEffect(() => {
    if (!confirmFinish) return;
    const timer = setTimeout(() => setConfirmFinish(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmFinish]);

  const copy = (text: string, what: string) =>
    void copyText(text).then((ok) =>
      controller.toast(ok ? `${what} copiado: pégalo en el chat` : `No se pudo copiar el ${what.toLowerCase()}`, ok ? 'success' : 'error'),
    );

  const summary = () => experimentSummary(state, connection.device, device.firmware);
  const fullJson = () => {
    const last = state.results[state.results.length - 1];
    const lab = state.restored ? undefined : filterLab(controller.exportLab(), state.startedAt, last?.finishedAt ?? new Date().toISOString());
    return JSON.stringify({ experiment: { ...state, summary: summary() }, ...(lab ? { lab } : {}) }, null, 2);
  };

  const status =
    state.phase === 'settling'
      ? 'Escuchando al módulo, no hagas nada.'
      : state.phase === 'running' && step
        ? `Paso ${state.current + 1} de ${state.steps.length}: ${step.title}. ${offline ? 'Sin conexión. ' : ''}Hazlo ahora y luego pulsa Ya lo hice.`
        : state.phase === 'finished'
          ? 'Experimento terminado.'
          : '';

  const instructions = offline ? (step?.offlineHint ? [step.detail, step.offlineHint] : [OFFLINE_WAIT, step?.detail ?? '']) : [step?.detail ?? ''];
  const tone = previous ? resultTone(previous) : 'ok';
  const banner = previous
    ? previous.skipped
      ? `Paso ${state.current}: saltado`
      : tone === 'warn'
        ? `Paso ${state.current}: registrado con problemas de conexión`
        : `Paso ${state.current}: registrado`
    : '';

  return (
    <>
      <p className="sr-only" role="status">
        {status}
      </p>

      {state.phase === 'idle' && (
        <Card title="Eventos del coche" icon="flask" subtitle="Averigua qué avisa el módulo cuando abres, pones el contacto o arrancas.">
          <p className="exp-before">
            <strong>Antes de empezar:</strong> ve al coche, desbloquéalo, entra, cierra la puerta, pon el mando de luces en 0
            (apagado) y conéctate al módulo. Pon también <strong>Ajustes › Pantalla y brillo › Bloqueo automático</strong> en
            «Nunca» mientras dure y lleva el móvil en la mano.
          </p>
          <p className="hint">
            Después te guío paso a paso. En cada paso, <strong>primero haces la acción en el coche</strong> y, cuando ya la
            hiciste, pulsas «Ya lo hice». Si te equivocas, puedes repetir el paso. Al final copias el resultado y me lo pegas en
            el chat.
          </p>
          <ol className="exp-steps">
            {state.steps.map((s) => (
              <li key={s.id}>{s.title}</li>
            ))}
          </ol>
          <Toggle
            label="Pitido al empezar cada paso"
            description="Para no tener que mirar la pantalla. No suena con el iPhone en silencio."
            checked={state.sound}
            onChange={(sound) => runner.setOptions({ sound })}
          />
          <button
            type="button"
            className="btn"
            onClick={() => {
              unlockAudio();
              beep();
            }}
          >
            Probar pitido
          </button>
          <p className="hint">¿No suena? Quita el modo silencio del iPhone y sube el volumen.</p>
          <Toggle
            label="Activar la depuración del módulo [3702]"
            description="El modo oculto del mini-programa que muestra todo lo que envía el módulo."
            checked={state.debug}
            onChange={(debug) => runner.setOptions({ debug })}
          />
          <Toggle
            label="Pedir el estado después de cada paso"
            description="Envía [0A01] para ver si cambió algo, por ejemplo el brillo al arrancar."
            checked={state.requestState}
            onChange={(requestState) => runner.setOptions({ requestState })}
          />
          <button
            type="button"
            className="btn btn-primary btn-wide"
            disabled={!ready}
            onClick={() => {
              unlockAudio();
              void runner.start();
            }}
          >
            <Icon name="flag" size={18} />
            Empezar
          </button>
          {!ready && <p className="hint">Conéctate primero al módulo (botón «Conectar» arriba).</p>}
        </Card>
      )}

      {running && step && (
        <div ref={stepRef} className="exp-stage">
          <StepDots state={state} />
          {previous && (
            <div key={`ok-${stepKey}`} className={`exp-registered exp-registered-${tone}`}>
              <span className="exp-registered-text">
                {tone === 'ok' && <Icon name="check" size={16} />}
                {banner}
              </span>
              {state.phase === 'running' && (
                <button type="button" className="btn btn-ghost exp-undo" onClick={() => runner.undo()}>
                  Me equivoqué: repetir paso {state.current}
                </button>
              )}
            </div>
          )}
          <div key={stepKey} className="exp-enter">
            <Card
              className={listening ? 'exp-step exp-step-listening' : offline ? 'exp-step exp-step-offline' : 'exp-step exp-step-now'}
              title={`Paso ${state.current + 1} de ${state.steps.length}`}
              icon="car"
              actions={
                listening ? (
                  <span className="exp-badge exp-badge-wait">Espera</span>
                ) : offline ? (
                  <span className="exp-badge exp-badge-offline">Sin conexión</span>
                ) : (
                  <span className="exp-badge exp-badge-now">
                    <span className="exp-badge-dot" aria-hidden="true" />
                    Ahora
                  </span>
                )
              }
            >
              <h3 className="exp-step-title">{step.title}</h3>
              {listening && state.listenStartedAt && state.listenUntil ? (
                <>
                  <p className="exp-instruction">Escuchando al módulo… no hagas nada.</p>
                  <ListenProgress from={state.listenStartedAt} until={state.listenUntil} />
                </>
              ) : (
                <ol className="exp-howto">
                  {instructions.map((text, i) => (
                    <li key={i}>
                      <span className={text === step.detail ? 'exp-instruction' : 'exp-offline-hint'}>{text}</span>
                    </li>
                  ))}
                  <li>Cuando ya lo hayas hecho, pulsa «Ya lo hice».</li>
                </ol>
              )}
              <button
                type="button"
                className="btn btn-primary btn-wide exp-done"
                disabled={listening || !state.stepStartedAt}
                onClick={() => {
                  unlockAudio();
                  void runner.complete();
                }}
              >
                <Icon name="check" size={18} />
                {listening ? 'Escuchando…' : 'Ya lo hice'}
              </button>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={listening}
                  onClick={() => {
                    unlockAudio();
                    void runner.complete(true);
                  }}
                >
                  Saltar este paso
                </button>
                <button
                  type="button"
                  className={confirmFinish ? 'btn btn-danger' : 'btn btn-ghost'}
                  disabled={listening}
                  onClick={() => {
                    if (!confirmFinish) {
                      setConfirmFinish(true);
                      return;
                    }
                    setConfirmFinish(false);
                    void runner.finish();
                  }}
                >
                  {confirmFinish ? '¿Terminar? Toca otra vez' : 'Terminar'}
                </button>
              </div>
              <div className="exp-live">
                <p className="exp-live-count">
                  Recibido en este paso: {describeCount(live)}
                  {offline ? ' · sin conexión' : ''}
                </p>
                {live.slice(-3).map((entry) => (
                  <div key={entry.id} className="exp-live-line mono">
                    {entry.text ?? entry.hex}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {(state.results.length > 0 || state.phase === 'finished') && (
        <Card
          title={state.phase === 'finished' ? 'Resultado' : 'Pasos hechos'}
          icon="layers"
          subtitle={state.phase === 'finished' ? 'Copia el resultado y pégamelo en el chat.' : undefined}
        >
          {state.restored && <p className="hint">Recuperado de la sesión anterior (Bluefy se cerró o se recargó).</p>}
          {persistFailed && <p className="hint hint-error">No se pudo guardar en el navegador: cópialo antes de cerrar la app.</p>}
          {state.phase === 'finished' && (
            <>
              <div className="row-actions">
                <button type="button" className="btn btn-primary" onClick={() => copy(fullJson(), 'JSON')}>
                  <Icon name="copy" size={18} />
                  Copiar JSON completo
                </button>
                <button type="button" className="btn" onClick={() => copy(summary(), 'Resumen')}>
                  <Icon name="copy" size={18} />
                  Copiar resumen
                </button>
              </div>
              {state.results.length < state.steps.length && (
                <>
                  <button
                    type="button"
                    className="btn btn-wide"
                    disabled={!ready}
                    onClick={() => {
                      unlockAudio();
                      void runner.resume();
                    }}
                  >
                    Continuar desde el paso {state.results.length + 1}
                  </button>
                  {!ready && <p className="hint">Para continuar, conéctate primero al módulo.</p>}
                </>
              )}
            </>
          )}
          <ol className="exp-results">
            {state.results.map((result, i) => (
              <ResultRow key={`${result.step.id}-${i}`} index={i} result={result} />
            ))}
          </ol>
          {state.phase === 'finished' && (
            <button type="button" className="btn btn-ghost btn-wide" onClick={() => runner.reset()}>
              Repetir el experimento desde cero
            </button>
          )}
        </Card>
      )}
    </>
  );
}
