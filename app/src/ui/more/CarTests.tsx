/** «Pruebas del coche»: guided tests in the car, with a backup first and everything restored afterwards. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { countKnown, fieldLabel, withFeatureSwitch } from '../../protocol/zycela/snapshot';
import { getBackupStore } from '../../state/backup';
import {
  CarTestsRunner,
  DEFAULT_MIN_TAP_MS,
  MAX_AUTO_ATTEMPTS,
  carTestsReport,
  compactCarTests,
  countdownDone,
  differencesWithBuiltin,
  evidenceNotes,
  minimalCarTests,
  testStatusText,
} from '../../state/carTests';
import type { CarTest, CarTestsState, Offer, Stage, TestRecord } from '../../state/carTests';
import type { AppController } from '../../state/controller';
import { beep, unlockAudio } from '../../util/beep';
import { copyText } from '../../util/files';
import { createStore } from '../../util/store';
import { keepAwake, refreshWakeLock } from '../../util/wakeLock';
import { useController, useReady } from '../AppContext';
import { Card, Notice, Spinner, Toggle } from '../controls';
import { useConfirm } from '../feedback';
import { Icon } from '../Icon';
import { openMorePage } from '../nav';

const STORAGE_KEY = 'ambiente-f32.cartests.v1';
/** Sessions with the demo module are kept apart, so they can never restore onto the real one. */
const DEMO_STORAGE_KEY = 'ambiente-f32.cartests.demo.v1';

const persistFailed = createStore(false);

function persistFor(demo: boolean) {
  const key = demo ? DEMO_STORAGE_KEY : STORAGE_KEY;
  return {
    load(): unknown {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    save(state: CarTestsState): void {
      try {
        if (state.phase === 'idle' && !state.pendingRestore && !state.waiting) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(state));
        persistFailed.set(false);
        return;
      } catch {
        persistFailed.set(true);
      }
      // Never leave an older state behind (it could come back after a reload
      // without a pending restore): keep what a reload needs, or nothing.
      try {
        localStorage.setItem(key, JSON.stringify(minimalCarTests(state)));
      } catch {
        try {
          localStorage.removeItem(key);
        } catch {
          // Storage unavailable: nothing was saved, nothing stale stays.
        }
      }
    },
  };
}

const runners = new WeakMap<AppController, CarTestsRunner>();
/** The tests page is open: the global banner hides, the screen stays on and preparations resume. */
const pageOpen = createStore(0);
let lastCue: string | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshWakeLock();
  });
}

/**
 * One runner per controller, created when the app starts (App.tsx), so a
 * pending restore is applied on reconnection even if this page is closed.
 */
export function carTestsFor(controller: AppController): CarTestsRunner {
  let runner = runners.get(controller);
  if (!runner) {
    const created = new CarTestsRunner({
      controller,
      backups: getBackupStore(controller.demo),
      persist: persistFor(controller.demo),
    });
    const awake = () => {
      const s = created.state.get();
      // The screen stays on while the page is open during a session (not while the user does other things).
      keepAwake('carTests', s.phase === 'starting' || s.phase === 'finishing' || (s.phase === 'active' && pageOpen.get() > 0));
    };
    created.state.subscribe(() => {
      const s = created.state.get();
      const c = s.cursor;
      const cue = c?.stageId && c.prepared ? `${c.testId}/${c.stageId}/${c.readyAt}` : null;
      if (cue && cue !== lastCue && s.phase === 'active') {
        lastCue = cue;
        if (s.sound) beep();
      }
      awake();
    });
    pageOpen.subscribe(awake);
    runners.set(controller, created);
    runner = created;
  }
  return runner;
}

function useRunnerState(runner: CarTestsRunner): CarTestsState {
  return useSyncExternalStore(runner.state.subscribe, runner.state.get);
}

/** Re-renders every `ms` while `active` (countdowns, the double-tap guard). */
function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [active, ms]);
  return now;
}

/** Labels of the settings a test in progress has changed. */
function changedByTests(state: CarTestsState, runner: CarTestsRunner): { titles: string[]; labels: string[] } {
  const open = Object.values(state.records).filter((r) => r.status === 'running' || r.status === 'deciding');
  const labels = new Set<string>();
  for (const r of open) {
    r.touched.forEach((f) => labels.add(f === 'factory.dial' ? 'interruptor 8 (instalación)' : fieldLabel(f).toLowerCase()));
    if (r.unreadable.includes('turnColor')) labels.add('color del intermitente');
    if (r.unreadable.includes('doorColor')) labels.add('color de puerta abierta');
    if (r.unreadable.includes('power')) labels.add('encendido de las tiras');
  }
  return { titles: open.map((r) => runner.test(r.testId)?.title ?? r.testId), labels: [...labels] };
}

/** Global banner (under the header): a session in progress, settings waiting to be restored, or a test waiting for its answer. */
export function CarTestsBanner() {
  const controller = useController();
  const runner = carTestsFor(controller);
  const state = useRunnerState(runner);
  const ready = useReady();
  const onPage = useSyncExternalStore(pageOpen.subscribe, pageOpen.get) > 0;
  if (onPage) return null;
  const open = () => openMorePage('cartests');

  if (state.pendingRestore) {
    const pending = state.pendingRestore;
    const stuck = pending.attempts >= MAX_AUTO_ATTEMPTS;
    return (
      <div className="banner ct-banner" role="status">
        <h2>
          <Icon name="warning" size={20} />
          Hay ajustes por restaurar
        </h2>
        <p>
          {state.busy ??
            (!ready
              ? 'Las pruebas del coche dejaron ajustes cambiados. Cuando vuelvas al coche, pulsa «Conectar» arriba: se restaurarán solos al conectar.'
              : stuck
                ? `No se pudieron restaurar solos (${pending.lastError ?? 'sin respuesta'}). Pulsa «Restaurar ahora» o míralo en Pruebas del coche.`
                : 'Las pruebas del coche dejaron ajustes cambiados. Pulsa «Restaurar ahora».')}
        </p>
        <div className="row-actions">
          {ready && !state.busy && (
            <button type="button" className="btn btn-primary" onClick={() => void runner.restorePending()}>
              Restaurar ahora
            </button>
          )}
          <button type="button" className="btn" onClick={open}>
            Ver
          </button>
        </div>
      </div>
    );
  }

  if (state.waiting) {
    const test = runner.test(state.waiting.testId);
    const deciding = state.records[state.waiting.testId]?.status === 'deciding';
    return (
      <div className="banner ct-banner" role="status">
        <h2>
          <Icon name="flag" size={20} />
          {deciding ? 'Prueba esperando tu decisión' : 'Prueba esperando tu respuesta'}
        </h2>
        <p>
          {test?.title}. {test?.waitingNote ?? 'Sus ajustes siguen puestos hasta que contestes.'}
        </p>
        <div className="row-actions">
          <button type="button" className="btn btn-primary" onClick={open}>
            {deciding ? 'Decidir' : 'Contestar'}
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === 'active' || state.phase === 'finishing' || state.phase === 'starting') {
    const { titles, labels } = changedByTests(state, runner);
    return (
      <div className="banner ct-banner" role="status">
        <h2>
          <Icon name="warning" size={20} />
          Pruebas del coche a medias
        </h2>
        <p>
          {labels.length
            ? `«${titles.join('», «')}» tiene ajustes cambiados: ${labels.join(', ')}.`
            : 'La sesión de pruebas sigue abierta. Termínala para dejarlo todo como en la copia.'}
        </p>
        <div className="row-actions">
          <button type="button" className="btn btn-primary" onClick={open}>
            Continuar
          </button>
          {state.phase === 'active' && (
            <button type="button" className="btn" disabled={!!state.busy} onClick={() => void runner.finish()}>
              Terminar y restaurar
            </button>
          )}
        </div>
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------

function StatusLine({ state }: { state: CarTestsState }) {
  if (state.busy) {
    return (
      <p className="ct-status" role="status">
        <Spinner />
        {state.busy}
      </p>
    );
  }
  if (!state.status) return null;
  return (
    <p className={`ct-status ct-status-${state.status.kind}`} role={state.status.kind === 'error' ? 'alert' : 'status'}>
      {state.status.text}
    </p>
  );
}

function PendingCard({ state, runner, ready }: { state: CarTestsState; runner: CarTestsRunner; ready: boolean }) {
  const confirm = useConfirm();
  const pending = state.pendingRestore;
  if (!pending) return null;
  const what = [
    ...pending.fields.map(fieldLabel),
    ...pending.ifStill.map((x) => fieldLabel(x.field)),
    ...(pending.unreadable.includes('turnColor') ? ['Color del intermitente'] : []),
    ...(pending.unreadable.includes('doorColor') ? ['Color de puerta abierta'] : []),
    ...(pending.unreadable.includes('power') ? ['Encendido de las tiras'] : []),
    ...(pending.dial ? ['Códigos de modelo (interruptor 8)'] : []),
    ...(pending.full ? ['Todos los ajustes'] : []),
  ];
  const discard = async () => {
    const ok = await confirm({
      title: 'Descartar los ajustes pendientes',
      message: (
        <>
          <p>La app dejará de intentar restaurarlos y el módulo se quedará como esté ahora.</p>
          <p>Podrás volver a tu configuración desde «Copia de seguridad».</p>
        </>
      ),
      confirmLabel: 'Descartar',
      danger: true,
    });
    if (ok) void runner.discardPending();
  };
  return (
    <section className="ct-pending" aria-labelledby="ct-pending-title">
      <h2 id="ct-pending-title">
        <Icon name="warning" size={22} />
        Hay ajustes por restaurar
      </h2>
      <p>
        {!ready
          ? 'Sin conexión. Cuando vuelvas al coche, pulsa «Conectar» arriba: se restaurarán solos al conectar (y se comprobarán).'
          : 'Pulsa «Restaurar ahora».'}
      </p>
      {pending.attempts > 0 && (
        <p className="hint hint-error">
          Ha fallado {pending.attempts === 1 ? '1 vez' : `${pending.attempts} veces`}: {pending.lastError ?? 'sin respuesta'}
          {pending.attempts >= MAX_AUTO_ATTEMPTS ? '. Ya no se reintenta solo.' : ''}
        </p>
      )}
      {what.length > 0 && <p className="hint">Pendiente: {what.join(', ')}{pending.sweep ? ' y cualquier ajuste que no coincida con la copia' : ''}.</p>}
      <button type="button" className="btn btn-primary btn-wide" disabled={!ready || !!state.busy} onClick={() => void runner.restorePending()}>
        <Icon name="reset" size={18} />
        Restaurar ahora
      </button>
      <button type="button" className="btn btn-ghost btn-wide" disabled={!!state.busy} onClick={() => void discard()}>
        Descartar ajustes pendientes…
      </button>
    </section>
  );
}

function SnapshotCard({ state }: { state: CarTestsState }) {
  const snapshot = state.snapshot;
  if (!snapshot) return null;
  const f = snapshot.values.factory;
  const diffs = differencesWithBuiltin(snapshot);
  const summary = (
    <>
      Copia guardada: <strong>{countKnown(snapshot.values)} ajustes</strong>
      {f.carBits && f.featureBits ? (
        <>
          , instalación <span className="mono">{f.carBits}/{f.featureBits}</span>
        </>
      ) : (
        ', sin la instalación'
      )}
      {diffs.length > 0 && ` · ${diffs.length} distintos de tu configuración del 6/11/2026`}.
    </>
  );
  const details = (
    <>
      {state.snapshotMissing.length > 0 && (
        <Notice kind="warning">
          No llegaron las tramas {state.snapshotMissing.join(', ')}.
          {state.snapshotMissing.includes('23') && ' Sin los códigos de modelo, la prueba del interruptor 8 no se puede hacer.'}
        </Notice>
      )}
      {diffs.length > 0 && (
        <Notice kind="warning" title="Distinto de tu configuración guardada (6/11/2026)">
          <ul className="check-list">
            {diffs.map((d) => (
              <li key={d.field}>
                {d.label}: guardado {d.expected}, ahora {d.actual}
              </li>
            ))}
          </ul>
        </Notice>
      )}
    </>
  );
  // During the tests the step matters more: the copy is a one-line summary that opens on demand.
  if (state.phase === 'active') {
    return (
      <details className="ct-details">
        <summary>
          <Icon name="download" size={18} />
          <span>{summary}</span>
        </summary>
        <div className="ct-details-body">
          <p className="hint">Al terminar todo vuelve a quedar como en esta copia.</p>
          {details}
        </div>
      </details>
    );
  }
  return (
    <Card title="Copia de seguridad" icon="download" className={diffs.length ? 'card-warn' : undefined}>
      <p className="ct-snapshot">{summary} Al terminar todo vuelve a quedar así.</p>
      {details}
    </Card>
  );
}

function TestDots({ state, tests }: { state: CarTestsState; tests: readonly CarTest[] }) {
  return (
    <ol className="exp-dots">
      {tests
        // An earlier round's test shows only while it is run again (or once done).
        .filter((t) => !t.archived || state.cursor?.testId === t.id || !['pending', 'notOffered'].includes(state.records[t.id]?.status ?? 'pending'))
        .map((t) => {
        const r = state.records[t.id];
        const current = state.cursor?.testId === t.id;
        const status = current
          ? 'current'
          : r?.status === 'done'
            ? 'done'
            : r && r.status !== 'pending'
              ? 'skipped'
              : 'pending';
        return (
          <li key={t.id} className={`exp-dot exp-dot-${status}`} aria-current={current ? 'step' : undefined}>
            <span className="sr-only">{`${t.title}: ${current ? 'ahora' : testStatusText(r?.status ?? 'pending')}`}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Countdown({
  until,
  seconds,
  sound,
  skipped,
  onStart,
  onSkip,
}: {
  until: string | null;
  seconds: number;
  sound: boolean;
  skipped: boolean;
  onStart: () => void;
  onSkip: () => void;
}) {
  const now = useNow(!!until);
  const cued = useRef<string | null>(null);
  const left = until ? Math.max(0, Math.ceil((Date.parse(until) - now) / 1000)) : null;
  useEffect(() => {
    if (until && left === 0 && cued.current !== until) {
      cued.current = until;
      if (sound) beep();
    }
  }, [until, left, sound]);
  const start = () => {
    unlockAudio();
    onStart();
  };
  return (
    <div className="ct-countdown">
      {left === null ? (
        <>
          <button type="button" className="btn btn-primary btn-wide" onClick={start}>
            Empezar cuenta atrás ({seconds} s)
          </button>
          {!skipped && (
            <button type="button" className="btn btn-ghost" onClick={onSkip}>
              Ya lo he hecho
            </button>
          )}
        </>
      ) : left > 0 ? (
        <>
          {/* Read aloud only every 5 s, not every second. */}
          <span className="ct-countdown-num" aria-hidden="true">
            {left}
          </span>
          <span className="sr-only" aria-live="polite">
            {left % 5 === 0 ? `${left} segundos` : ''}
          </span>
          <span>Espera…</span>
        </>
      ) : (
        <>
          <span className="ct-countdown-num" role="status">
            ¡Ya!
          </span>
          <button type="button" className="btn btn-ghost" onClick={start}>
            Repetir cuenta atrás
          </button>
        </>
      )}
    </div>
  );
}

function StageCard({
  state,
  runner,
  test,
  stage,
  ready,
  waiting,
}: {
  state: CarTestsState;
  runner: CarTestsRunner;
  test: CarTest;
  stage: Stage;
  ready: boolean;
  waiting?: boolean;
}) {
  const cursor = state.cursor;
  const record = state.records[test.id];
  const readyAt = cursor?.readyAt ? Date.parse(cursor.readyAt) : null;
  const countingDown = !!cursor?.countdownUntil && Date.parse(cursor.countdownUntil) > Date.now();
  const arming = readyAt !== null && Date.now() - readyAt < DEFAULT_MIN_TAP_MS;
  const now = useNow(countingDown || arming);
  if (!cursor) return null;
  const prepared = cursor.prepared;
  const index = test.stages.indexOf(stage);
  const busy = !!state.busy;
  const armed = readyAt !== null && now - readyAt >= DEFAULT_MIN_TAP_MS;
  const counted = waiting || countdownDone(cursor, stage, now);
  const canAnswer = prepared && !busy && armed && counted;
  const badge = !ready && !waiting ? (
    <span className="exp-badge exp-badge-offline">Sin conexión</span>
  ) : !prepared ? (
    <span className="exp-badge exp-badge-wait">{busy ? 'Preparando' : 'En pausa'}</span>
  ) : (
    <span className="exp-badge exp-badge-now">
      <span className="exp-badge-dot" aria-hidden="true" />
      Ahora
    </span>
  );
  return (
    <div className="exp-stage">
      <div key={`${test.id}-${stage.id}`} className="exp-enter">
        <Card
          className={!prepared || (!ready && !waiting) ? 'exp-step exp-step-offline' : 'exp-step exp-step-now'}
          title={test.stages.length > 1 ? `${test.title} · ${index + 1} de ${test.stages.length}` : test.title}
          icon="car"
          actions={badge}
        >
          <ol className="exp-howto">
            <li>
              <span className="exp-instruction">{stage.instruction}</span>
            </li>
            <li>Mira: {stage.observe}</li>
          </ol>
          {stage.countdownSec && prepared && (
            <Countdown
              until={cursor.countdownUntil}
              seconds={stage.countdownSec}
              sound={state.sound}
              skipped={cursor.countdownSkipped}
              onStart={() => runner.startCountdown()}
              onSkip={() => runner.skipCountdown()}
            />
          )}
          {!prepared && (
            <>
              <p className="exp-offline-hint">
                {busy
                  ? 'Preparando el módulo para esta prueba…'
                  : ready
                    ? 'Esta prueba está en pausa: pulsa «Continuar la prueba» para preparar el módulo.'
                    : 'Sin conexión. Cuando vuelvas al coche, pulsa «Conectar» arriba y luego «Continuar la prueba».'}
              </p>
              {ready && !busy && (
                <button type="button" className="btn btn-primary btn-wide" onClick={() => void runner.retryPrepare()}>
                  Continuar la prueba
                </button>
              )}
            </>
          )}
          <h3 className="exp-step-title ct-question">{stage.question}</h3>
          {prepared && !counted && <p className="hint">Contesta después de la cuenta atrás (o pulsa «Ya lo he hecho»).</p>}
          {prepared && counted && !armed && <p className="hint">Un momento…</p>}
          <div className="ct-answers" role="group" aria-label={stage.question}>
            {stage.answers.map((a) => (
              <button
                key={a.id}
                type="button"
                className="btn btn-primary btn-wide ct-answer"
                disabled={!canAnswer}
                onClick={() => {
                  unlockAudio();
                  void runner.answer(a.id);
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
          {!waiting && (
            <div className="row-actions">
              {record && record.stages.length > 0 && (
                <button type="button" className="btn btn-ghost exp-undo" disabled={busy} onClick={() => void runner.undo()}>
                  Me equivoqué: volver a la pregunta anterior
                </button>
              )}
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void runner.skipTest()}>
                Saltar esta prueba
              </button>
            </div>
          )}
          {stage.deferred && !waiting && <p className="hint">{test.note}</p>}
          {waiting && test.waitingNote && <p className="hint">{test.waitingNote}</p>}
        </Card>
      </div>
    </div>
  );
}

function IntroCard({ state, runner, test, ready }: { state: CarTestsState; runner: CarTestsRunner; test: CarTest; ready: boolean }) {
  const [ack, setAck] = useState(false);
  const busy = !!state.busy;
  const when = test.offeredWhen;
  const offered =
    !when || state.records[when.test]?.stages.some((st) => st.stageId === when.stage && when.answers.includes(st.answerId));
  const f = state.snapshot?.values.factory;
  const dialPreview =
    test.needsFactory && f?.carBits && f.featureBits ? `${f.carBits}/${f.featureBits} → ${f.carBits}/${withFeatureSwitch(f.featureBits, 8, true)}` : null;
  return (
    <div key={test.id} className="exp-enter">
      <Card title={test.title} icon={test.advanced ? 'wrench' : 'car'} className={test.advanced ? 'card-warn' : undefined}>
        {test.advanced && <span className="exp-badge exp-badge-offline">Avanzada</span>}
        <p className="ct-why">{test.why}</p>
        {test.note && <Notice>{test.note}</Notice>}
        {when && !offered && <p className="hint">{when.reason}</p>}
        {dialPreview && (
          <p className="ct-snapshot">
            Códigos de modelo: <span className="mono">{dialPreview}</span> (solo el interruptor 8).
          </p>
        )}
        {test.needsFactory && !dialPreview && (
          <Notice kind="warning">La copia no tiene los códigos de modelo: esta prueba no se puede hacer.</Notice>
        )}
        {test.acknowledge && (
          <label className={ack ? 'ack ack-danger' : 'ack'}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>{test.acknowledge}</span>
          </label>
        )}
        <button
          type="button"
          className={test.advanced ? 'btn btn-danger btn-wide exp-done' : 'btn btn-primary btn-wide exp-done'}
          disabled={!ready || busy || (!!test.acknowledge && !ack)}
          onClick={() => {
            unlockAudio();
            void runner.beginTest({ acknowledged: ack });
          }}
        >
          <Icon name="flag" size={18} />
          Empezar esta prueba
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void runner.skipTest()}>
          Saltar esta prueba
        </button>
        {!ready && <p className="hint">Conéctate al módulo para empezar.</p>}
      </Card>
    </div>
  );
}

const OFFER_LABELS: Record<Offer, string> = {
  keepNightHalfOff: 'Dejar desactivada la «consola a mitad de brillo de noche»',
  keepFeature8: 'Dejar el interruptor 8 encendido (los avisos vuelven a como estaban: actívalos luego en la pestaña Coche)',
  keepWelcome: 'Dejar la bienvenida en este modo, con tu color de siempre',
  keepWelcomeWhite: 'Dejar la bienvenida en este modo y en blanco',
  keepFollowLights: 'Dejar las tiras siguiendo las luces del coche (de día, con el mando en AUTO, se quedan apagadas)',
  keepFrontRearZones:
    'Dejar las zonas de brillo «Delante / detrás» (de noche baja solo el salpicadero; en la pestaña Brillo los deslizadores pasan a ser «Consola central» y «Puertas»)',
  keepSpeedOn: 'Dejar activado el aviso de velocidad',
  keepRadarOn: 'Dejar activado el radar (marcha atrás)',
  keepDoorWarning: 'Dejar activado el aviso de puerta, en azul',
  keepTurnWarning: 'Dejar activado el aviso de intermitentes, en amarillo',
};

function DecideCard({ runner, test, record, busy }: { runner: CarTestsRunner; test: CarTest; record: TestRecord; busy: boolean }) {
  const [checked, setChecked] = useState<Offer[]>([]);
  const toggle = (offer: Offer, on: boolean) => {
    setChecked((list) => {
      let next = on ? [...list, offer] : list.filter((o) => o !== offer);
      // The two welcome options exclude each other.
      if (on && offer === 'keepWelcome') next = next.filter((o) => o !== 'keepWelcomeWhite');
      if (on && offer === 'keepWelcomeWhite') next = next.filter((o) => o !== 'keepWelcome');
      // In the interruptor 8 test the welcome only appeared with the switch on: tick it too (it can be unticked).
      const welcome = offer === 'keepWelcome' || offer === 'keepWelcomeWhite';
      if (on && welcome && record.offers.includes('keepFeature8') && !next.includes('keepFeature8')) next = [...next, 'keepFeature8'];
      return next;
    });
  };
  return (
    <Card title={test.title} icon="check" className="exp-step exp-step-now">
      {record.conclusions.map((c) => (
        <p key={c} className="ct-conclusion">
          {c}
        </p>
      ))}
      <p className="ct-why">Lo normal es dejarlo todo como estaba. Si quieres conservar algo de esta prueba, márcalo:</p>
      <div className="ct-offers">
        {record.offers.map((offer) => (
          <label key={offer} className={checked.includes(offer) ? 'ack ack-danger' : 'ack'}>
            <input type="checkbox" checked={checked.includes(offer)} onChange={(e) => toggle(offer, e.target.checked)} />
            <span>{OFFER_LABELS[offer]}</span>
          </label>
        ))}
      </div>
      <div className="ct-answers">
        <button type="button" className="btn btn-primary btn-wide ct-answer" disabled={busy} onClick={() => void runner.decide([])}>
          No, dejarlo como estaba
        </button>
        <button
          type="button"
          className="btn btn-wide ct-answer"
          disabled={busy || checked.length === 0}
          onClick={() => void runner.decide(checked)}
        >
          Dejar lo marcado y restaurar lo demás
        </button>
      </div>
    </Card>
  );
}

function ResultRow({ index, test, record, canRedo, onRedo }: { index: number; test: CarTest; record: TestRecord; canRedo: boolean; onRedo: () => void }) {
  const restore = record.restore;
  return (
    <li className="exp-result">
      <div className="exp-result-head">
        <span className="exp-num">{index + 1}</span>
        <span className="exp-result-title">{test.title}</span>
        <span className="hint">{testStatusText(record.status)}</span>
      </div>
      {record.stages.map((st) => (
        <div key={`${st.stageId}-${st.answeredAt}`} className="log-meaning">
          {st.question} → <strong>{st.answer}</strong>
          {st.unsolicited.length > 0 && ` · ${st.unsolicited.length} notificaciones no pedidas`}
          {st.changes.some((c) => !c.byTest) && ` · cambió: ${st.changes.filter((c) => !c.byTest).map((c) => c.label).join(', ')}`}
          {(st.unknownChanges?.length ?? 0) > 0 && ` · posiciones desconocidas cambiadas: ${st.unknownChanges?.map((c) => c.label).join(', ')}`}
          {(st.stateMissing?.length ?? 0) > 0 && ` · no llegaron las tramas ${st.stateMissing?.join(', ')}`}
          {evidenceNotes(st).map((n) => (
            <span key={n} className="hint">
              {' '}
              · {n}
            </span>
          ))}
        </div>
      ))}
      {record.conclusions.map((c) => (
        <p key={c} className="ct-conclusion">
          {c}
        </p>
      ))}
      {record.notes.map((n) => (
        <div key={n} className="hint">
          {n}
        </div>
      ))}
      {restore && (
        <div className={restore.pending ? 'check-unknown' : restore.ok ? 'check-ok' : 'check-bad'}>
          {restore.pending
            ? 'Restaurar: pendiente (se aplicará al conectar)'
            : restore.ok
              ? `Restaurado y comprobado${restore.sent.length ? ` (${restore.sent.length} órdenes)` : ''}`
              : `Restaurado, pero sin comprobar del todo${
                  restore.checks.some((c) => c.status !== 'match')
                    ? `: no coincide ${restore.checks
                        .filter((c) => c.status !== 'match')
                        .map((c) => c.label)
                        .join(', ')}`
                    : ' (mira las notas)'
                }`}
        </div>
      )}
      {restore && !restore.pending && restore.notes.length > 0 && (
        <ul className="check-list">
          {restore.notes.map((n) => (
            <li key={n} className="hint">
              {n}
            </li>
          ))}
        </ul>
      )}
      {canRedo && (
        <button type="button" className="btn btn-ghost" onClick={onRedo}>
          {record.status === 'notOffered' || record.status === 'skipped' ? 'Hacerla ahora' : 'Repetir'}
        </button>
      )}
    </li>
  );
}

/** What a screen reader announces when the step changes. */
function announcement(state: CarTestsState, test: CarTest | undefined, stage: Stage | undefined, record: TestRecord | undefined): string {
  if (!test) return state.phase === 'active' ? 'Pruebas terminadas: pulsa Terminar y restaurar.' : '';
  if (record?.status === 'deciding') return `${test.title}: decide si quieres conservar algo.`;
  if (!stage) return `Prueba: ${test.title}.`;
  const n = test.stages.indexOf(stage) + 1;
  return `Paso ${n} de ${test.stages.length}: ${stage.instruction} Pregunta: ${stage.question}`;
}

export function CarTests() {
  const controller = useController();
  const runner = carTestsFor(controller);
  const state = useRunnerState(runner);
  const ready = useReady();
  const storageFailed = useSyncExternalStore(persistFailed.subscribe, persistFailed.get);
  const [confirmFinish, setConfirmFinish] = useState<number | null>(null);
  const stepRef = useRef<HTMLDivElement>(null);
  const tests = runner.tests;
  const cursor = state.cursor;
  const test = cursor ? runner.test(cursor.testId) : undefined;
  const record = test ? state.records[test.id] : undefined;
  const stage = test && cursor?.stageId ? test.stages.find((st) => st.id === cursor.stageId) : undefined;
  const busy = !!state.busy;
  const inSession = state.phase === 'active' || state.phase === 'starting' || state.phase === 'finishing';
  const somethingOpen = Object.values(state.records).some((r) => r.status === 'running' || r.status === 'deciding');
  const deciding = !!test && record?.status === 'deciding' && (state.phase === 'active' || state.waiting?.testId === test.id);
  const stepKey = `${state.phase}-${cursor?.testId ?? ''}-${cursor?.stageId ?? ''}-${record?.status ?? ''}`;

  useEffect(() => {
    pageOpen.update((n) => n + 1);
    const detach = runner.attach();
    return () => {
      detach();
      pageOpen.update((n) => n - 1);
    };
  }, [runner]);

  // Bring the new step into view: the cue must not appear off-screen.
  useEffect(() => {
    if (!cursor || (state.phase !== 'active' && !state.waiting)) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    stepRef.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [stepKey]); // only when the step changes, not on every state update

  useEffect(() => {
    if (confirmFinish === null) return;
    const timer = setTimeout(() => setConfirmFinish(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmFinish]);

  const copy = (text: string, what: string) =>
    void copyText(text).then((ok) =>
      controller.toast(ok ? `${what} copiado: pégalo en el chat` : `No se pudo copiar el ${what.toLowerCase()}`, ok ? 'success' : 'error'),
    );
  const report = () => carTestsReport(state, tests);
  const json = () => JSON.stringify({ carTests: compactCarTests(state), report: report() }, null, 2);

  const listed = tests
    .map((t, i) => ({ t, i, r: state.records[t.id] }))
    .filter(({ r }) => r && r.status !== 'pending' && r.status !== 'running' && r.status !== 'deciding');
  // Earlier-round tests not run again go in their own folded list.
  const results = listed.filter(({ t, r }) => !(t.archived && r.status === 'notOffered'));
  const earlier = listed.filter(({ t, r }) => t.archived && r.status === 'notOffered');

  const onFinish = () => {
    const now = Date.now();
    if (confirmFinish === null) {
      setConfirmFinish(now);
      return;
    }
    // A double tap is not a confirmation.
    if (now - confirmFinish < 600) return;
    setConfirmFinish(null);
    void runner.finish();
  };

  return (
    <>
      <p className="sr-only" role="status">
        {announcement(state, test, stage, record)}
      </p>
      {state.restored && state.phase !== 'idle' && <p className="hint">Recuperado de la sesión anterior (Bluefy se cerró o se recargó).</p>}
      {storageFailed && <p className="hint hint-error">No se pudo guardar en el navegador: copia el informe antes de cerrar la app.</p>}
      <PendingCard state={state} runner={runner} ready={ready} />

      {state.phase === 'idle' && (
        <Card title="Pruebas del coche" icon="car" subtitle="Segunda ronda: lo que el módulo puede hacer solo, sin el móvil. Unas pruebas son de día, otras de noche o conduciendo: sáltate las que no toquen y hazlas otro día.">
          <p className="exp-before">
            <strong>Antes de empezar:</strong> en el coche (mejor en un garaje o al atardecer; si es un garaje, con la puerta abierta
            cuando arranques), conectado al módulo, con <strong>Ajustes › Pantalla y brillo › Bloqueo automático</strong> en «Nunca» y el
            mando de luces en AUTO.
          </p>
          <p className="hint">
            Primero se guarda una copia de todos los ajustes (también la instalación). Cada prueba cambia lo justo y, al acabarla,
            la app lo deja como estaba y lo comprueba. Si se corta la conexión, lo restaura al volver a conectar.
          </p>
          <ol className="exp-steps">
            {tests.filter((t) => !t.archived).map((t) => (
              <li key={t.id}>
                {t.title}
                {t.advanced ? ' (avanzada)' : ''}
              </li>
            ))}
          </ol>
          {tests.some((t) => t.archived) && (
            <p className="hint">Las pruebas de la primera ronda siguen en los resultados («Hacerla ahora»), por si quieres repetir alguna.</p>
          )}
          <Toggle
            label="Pitido en cada paso y al acabar la cuenta atrás"
            description="No suena con el iPhone en silencio."
            checked={state.sound}
            onChange={(sound) => runner.setSound(sound)}
          />
          <button
            type="button"
            className="btn btn-primary btn-wide exp-done"
            disabled={!ready || busy || !!state.pendingRestore}
            onClick={() => {
              unlockAudio();
              void runner.start();
            }}
          >
            <Icon name="flag" size={18} />
            Empezar
          </button>
          {!ready && <p className="hint">Conéctate primero al módulo (botón «Conectar» arriba).</p>}
          <StatusLine state={state} />
        </Card>
      )}

      {inSession && (
        <>
          <StatusLine state={state} />
          {state.phase === 'starting' && (
            <Card title="Guardando la copia de seguridad" icon="download">
              <p className="hint">Leyendo los ajustes y la instalación del módulo. No cambia nada.</p>
            </Card>
          )}
          <SnapshotCard state={state} />
          {state.phase === 'active' && <TestDots state={state} tests={tests} />}
          <div ref={stepRef} className="ct-step-anchor">
            {state.phase === 'active' && test && record && !cursor?.stageId && record.status === 'pending' && (
              <IntroCard key={test.id} state={state} runner={runner} test={test} ready={ready} />
            )}
            {state.phase === 'active' && deciding && test && record && (
              <DecideCard key={test.id} runner={runner} test={test} record={record} busy={busy} />
            )}
            {state.phase === 'active' && test && stage && <StageCard state={state} runner={runner} test={test} stage={stage} ready={ready} />}
            {state.phase === 'active' && !cursor && (
              <Card title="Pruebas terminadas" icon="check">
                <p className="hint">Pulsa «Terminar y restaurar»: la app deja de escuchar al módulo y deja los ajustes como en la copia.</p>
                <button type="button" className="btn btn-primary btn-wide exp-done" disabled={busy} onClick={() => void runner.finish()}>
                  Terminar y restaurar
                </button>
              </Card>
            )}
          </div>
        </>
      )}

      {state.phase === 'finished' && (
        <>
          <StatusLine state={state} />
          <div ref={stepRef} className="ct-step-anchor">
            {state.waiting && deciding && test && record && <DecideCard key={test.id} runner={runner} test={test} record={record} busy={busy} />}
            {state.waiting && !deciding && test && stage && (
              <>
                <StageCard state={state} runner={runner} test={test} stage={stage} ready={ready} waiting />
                <button type="button" className="btn btn-ghost btn-wide" disabled={busy || !ready} onClick={() => void runner.discardWaiting()}>
                  Descartar esta prueba y restaurar sus ajustes
                </button>
              </>
            )}
          </div>
          <Card title="Resultado" icon="layers" subtitle="Copia el informe y pégamelo en el chat.">
            <div className="row-actions">
              <button type="button" className="btn btn-primary" onClick={() => copy(report(), 'Informe')}>
                <Icon name="copy" size={18} />
                Copiar informe
              </button>
              <button type="button" className="btn" onClick={() => copy(json(), 'JSON')}>
                <Icon name="copy" size={18} />
                Copiar JSON
              </button>
            </div>
            {state.snapshot && (
              <>
                <button type="button" className="btn btn-ghost btn-wide" disabled={busy} onClick={() => void runner.restoreAll()}>
                  <Icon name="reset" size={18} />
                  Restaurar todo ahora
                </button>
                <p className="hint">
                  Vuelve exactamente a la copia de antes de las pruebas (también deshace lo que elegiste dejar).
                  {!ready && ' Sin conexión: quedará pendiente y se aplicará al conectar.'}
                </p>
              </>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-wide"
              disabled={busy || !!state.waiting || !!state.pendingRestore}
              onClick={() => runner.reset()}
            >
              Nueva sesión de pruebas
            </button>
          </Card>
        </>
      )}

      {results.length > 0 && (
        <Card title={state.phase === 'finished' ? 'Pruebas' : 'Pruebas hechas'} icon="layers">
          <ol className="exp-results">
            {results.map(({ t, i, r }) => (
              <ResultRow
                key={t.id}
                index={i}
                test={t}
                record={r}
                canRedo={state.phase === 'active' && !somethingOpen && !busy && r.status !== 'waiting'}
                onRedo={() => void runner.redoTest(t.id)}
              />
            ))}
          </ol>
        </Card>
      )}

      {earlier.length > 0 && state.phase === 'active' && (
        <details className="card ct-earlier">
          <summary>Pruebas de la primera ronda ({earlier.length})</summary>
          <ol className="exp-results">
            {earlier.map(({ t, i, r }) => (
              <ResultRow
                key={t.id}
                index={i}
                test={t}
                record={r}
                canRedo={!somethingOpen && !busy}
                onRedo={() => void runner.redoTest(t.id)}
              />
            ))}
          </ol>
        </details>
      )}

      {inSession && state.phase !== 'starting' && (
        // Last on the page and sticky: always on screen, above the tab bar.
        <div className="row-actions ct-bar">
          <button type="button" className="btn" disabled={busy} onClick={() => void runner.restoreAll()}>
            <Icon name="reset" size={18} />
            Restaurar todo ahora
          </button>
          <button
            type="button"
            className={confirmFinish !== null ? 'btn btn-danger' : 'btn btn-ghost'}
            disabled={busy || state.phase !== 'active'}
            onClick={onFinish}
          >
            {confirmFinish !== null ? '¿Terminar? Toca otra vez' : 'Terminar'}
          </button>
          {!ready && <span className="hint ct-bar-hint">Sin conexión: «Restaurar todo» quedará pendiente hasta conectar.</span>}
        </div>
      )}
    </>
  );
}
