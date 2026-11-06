/** Guided experiment: what does the module report when the car is unlocked, started, turned off…? */
import { useMemo, useSyncExternalStore } from 'react';
import type { AppController } from '../../state/controller';
import { ExperimentRunner, describeCount, experimentSummary } from '../../state/experiment';
import type { ExperimentState, StepResult } from '../../state/experiment';
import { copyText } from '../../util/files';
import { useConnection, useController, useDevice, useLog, useReady } from '../AppContext';
import { Card, Toggle } from '../controls';
import { Icon } from '../Icon';

/** One runner per controller, so leaving the page does not lose a running experiment. */
const runners = new WeakMap<AppController, ExperimentRunner>();

const STORAGE_KEY = 'ambiente-f32.experiment.v1';

/** The last experiment survives iOS closing Bluefy; storage errors (quota, private mode) are ignored. */
const persist = {
  load(): ExperimentState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ExperimentState) : null;
    } catch {
      return null;
    }
  },
  save(state: ExperimentState): void {
    try {
      if (state.phase === 'idle' && state.results.length === 0) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Not critical: the results stay on screen while the page is open.
    }
  },
};

function runnerFor(controller: AppController): ExperimentRunner {
  let runner = runners.get(controller);
  if (!runner) {
    runner = new ExperimentRunner({
      log: controller.log,
      device: controller.device,
      isReady: () => controller.session.status === 'ready',
      addMarker: (note) => controller.addMarker(note),
      requestState: () => controller.driver.requestState(),
      startDebug: () => controller.driver.startDebug(),
      stopDebug: () => controller.driver.stopDebug(),
      persist,
    });
    runners.set(controller, runner);
  }
  return runner;
}

function ResultRow({ index, result }: { index: number; result: StepResult }) {
  const summary = result.skipped
    ? 'Saltado'
    : `Espontáneas: ${describeCount(result.spontaneous)} · respuesta: ${describeCount(result.response)} · ${result.changes.length} cambios`;
  return (
    <li className="exp-result">
      <div className="exp-result-head">
        <span className="exp-num">{index + 1}</span>
        <span className="exp-result-title">{result.step.title}</span>
        {!result.skipped && !result.connected && <span className="log-flag">desconectado</span>}
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

export function Experiment() {
  const controller = useController();
  const runner = runnerFor(controller);
  const state = useSyncExternalStore(runner.state.subscribe, runner.state.get);
  const ready = useReady();
  const connection = useConnection();
  const device = useDevice();
  const log = useLog();
  const step = state.steps[state.current];

  const live = useMemo(
    () => (state.stepStartedAt ? log.filter((e) => e.kind === 'rx' && e.t >= state.stepStartedAt!) : []),
    [log, state.stepStartedAt],
  );

  const copy = (text: string, what: string) =>
    void copyText(text).then((ok) =>
      controller.toast(ok ? `${what} copiado: pégalo en el chat` : `No se pudo copiar el ${what.toLowerCase()}`, ok ? 'success' : 'error'),
    );

  const summary = () => experimentSummary(state, connection.device, device.firmware);
  const fullJson = () =>
    JSON.stringify({ experiment: { ...state, summary: summary() }, lab: controller.exportLab() }, null, 2);

  const running = state.phase === 'running' || state.phase === 'settling';

  return (
    <>
      {state.phase === 'idle' && (
        <Card title="Eventos del coche" icon="flask" subtitle="Averigua qué avisa el módulo cuando abres, pones el contacto o arrancas.">
          <p className="hint">
            Te guío paso a paso. En cada paso, <strong>primero haces la acción en el coche</strong> y, cuando ya la hiciste,
            pulsas «Ya lo hice». La app apunta lo que el módulo envía por su cuenta, le pide el estado y compara con el paso
            anterior. Al final copias el resultado y me lo pegas en el chat.
          </p>
          <ol className="exp-steps">
            {state.steps.map((s) => (
              <li key={s.id}>{s.title}</li>
            ))}
          </ol>
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
          <button type="button" className="btn btn-primary btn-wide" disabled={!ready} onClick={() => void runner.start()}>
            <Icon name="flag" size={18} />
            Empezar
          </button>
          {!ready && <p className="hint">Conéctate primero al módulo (pestaña Color).</p>}
        </Card>
      )}

      {running && step && (
        <Card title={`Paso ${state.current + 1} de ${state.steps.length}`} icon="car" subtitle={step.title}>
          <ol className="exp-howto">
            <li>
              <span className="exp-instruction">{step.detail}</span>
            </li>
            <li>Cuando ya lo hayas hecho, pulsa «Ya lo hice».</li>
          </ol>
          <p className="hint" aria-live="polite">
            {state.phase === 'settling'
              ? 'Escuchando lo que envía el módulo…'
              : `Recibido en este paso: ${describeCount(live)}${ready ? '' : ' · sin conexión'}`}
          </p>
          {live.slice(-3).map((entry) => (
            <div key={entry.id} className="log-text mono">
              {entry.text ?? entry.hex}
            </div>
          ))}
          <button
            type="button"
            className="btn btn-primary btn-wide"
            disabled={state.phase === 'settling'}
            onClick={() => void runner.complete()}
          >
            <Icon name="check" size={18} />
            {state.phase === 'settling' ? 'Un momento…' : 'Ya lo hice'}
          </button>
          <div className="row-actions">
            <button type="button" className="btn" disabled={state.phase === 'settling'} onClick={() => void runner.complete(true)}>
              Saltar este paso
            </button>
            <button type="button" className="btn btn-ghost" disabled={state.phase === 'settling'} onClick={() => void runner.finish()}>
              Terminar
            </button>
          </div>
        </Card>
      )}

      {(state.results.length > 0 || state.phase === 'finished') && (
        <Card
          title={state.phase === 'finished' ? 'Resultado' : 'Pasos hechos'}
          icon="layers"
          subtitle={state.phase === 'finished' ? 'Copia el resumen y pégamelo en el chat.' : undefined}
        >
          {state.phase === 'finished' && (
            <div className="row-actions">
              <button type="button" className="btn btn-primary" onClick={() => copy(summary(), 'Resumen')}>
                <Icon name="copy" size={18} />
                Copiar resumen
              </button>
              <button type="button" className="btn" onClick={() => copy(fullJson(), 'JSON')}>
                <Icon name="copy" size={18} />
                Copiar JSON completo
              </button>
            </div>
          )}
          <ol className="exp-results">
            {state.results.map((result, i) => (
              <ResultRow key={result.step.id} index={i} result={result} />
            ))}
          </ol>
          {state.phase === 'finished' && (
            <button type="button" className="btn btn-ghost btn-wide" onClick={() => runner.reset()}>
              Repetir el experimento
            </button>
          )}
        </Card>
      )}
    </>
  );
}
