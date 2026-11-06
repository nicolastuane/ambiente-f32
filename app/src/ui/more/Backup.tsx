/** «Copia de seguridad»: save the module's settings, list the copies, restore one and check it. */
import { useState, useSyncExternalStore } from 'react';
import { countKnown, hasFactory, restoreCommands } from '../../protocol/zycela/snapshot';
import type { FieldCheck, Snapshot } from '../../protocol/zycela/snapshot';
import { exportSnapshot, getBackupStore, installationChanges, missingEssentials, restoreSnapshot, takeSnapshot } from '../../state/backup';
import type { RestoreReport } from '../../state/backup';
import { copyText } from '../../util/files';
import { useController, useReady } from '../AppContext';
import { Card, Notice, Spinner, Toggle } from '../controls';
import { useConfirm } from '../feedback';
import { Icon } from '../Icon';
import { openMorePage } from '../nav';
import { carTestsFor } from './CarTests';

const SOURCE_LABEL: Record<Snapshot['source'], string> = {
  module: 'Del módulo',
  builtin: 'Incluida en la app',
  import: 'Importada',
};

export function snapshotSummary(s: Snapshot): string {
  const f = s.values.factory;
  return `${countKnown(s.values)} ajustes · ${f.carBits && f.featureBits ? `instalación ${f.carBits}/${f.featureBits}` : 'sin instalación'}`;
}

/** Expected vs read back, differences first. */
export function CheckList({ checks, limit = 50 }: { checks: readonly FieldCheck[]; limit?: number }) {
  const bad = checks.filter((c) => c.status !== 'match');
  const good = checks.length - bad.length;
  return (
    <>
      <p className={bad.length ? 'hint hint-error' : 'hint'}>
        {checks.length === 0
          ? 'No había nada que comprobar.'
          : bad.length
            ? `${good} de ${checks.length} coinciden. No coinciden:`
            : `Los ${checks.length} ajustes comprobados coinciden.`}
      </p>
      {bad.length > 0 && (
        <ul className="check-list">
          {bad.slice(0, limit).map((c) => (
            <li key={c.field} className={c.status === 'unknown' ? 'check-unknown' : 'check-bad'}>
              {c.label}: esperado {c.expected}, {c.status === 'unknown' ? 'no se pudo leer' : `leído ${c.actual}`}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ReportView({ report }: { report: RestoreReport }) {
  return (
    <div className="backup-result" role="status">
      <strong className={report.ok ? 'check-ok' : 'check-bad'}>
        {report.ok ? 'Restaurado y comprobado.' : 'Restaurado, pero no todo coincide.'}
      </strong>
      {report.before && <span className="hint">Antes se guardó «{report.before.label}» para poder deshacerlo.</span>}
      <span className="hint">
        Enviados {report.sent.length} ajustes{report.factorySent.length ? ` y ${report.factorySent.length} órdenes de instalación` : ''}.
        {report.missing.length ? ` No llegaron: ${report.missing.join(', ')}.` : ''}
      </span>
      {report.dial && (
        <span className="hint">
          Códigos de modelo:{' '}
          {report.dial.changed
            ? `${report.dial.before.carBits}/${report.dial.before.featureBits} → ${report.dial.after.carBits ?? '?'}/${report.dial.after.featureBits ?? '?'} ${report.dial.verified ? '(comprobado)' : '(NO coincide)'}`
            : 'ya estaban bien'}
        </span>
      )}
      <CheckList checks={report.checks} />
    </div>
  );
}

/** The module's installation read just now, and what restoring the copy would change. */
interface InstallPreview {
  id: string;
  changes: FieldCheck[];
  moduleCar: string | null;
  copyCar: string | null;
}

export function Backup() {
  const controller = useController();
  const ready = useReady();
  const confirm = useConfirm();
  const store = getBackupStore(controller.demo);
  const list = useSyncExternalStore(store.snapshots.subscribe, store.snapshots.get);
  const tests = carTestsFor(controller);
  const testsState = useSyncExternalStore(tests.state.subscribe, tests.state.get);
  const [withInstall, setWithInstall] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [restoreInstall, setRestoreInstall] = useState(false);
  const [preview, setPreview] = useState<InstallPreview | null>(null);
  const [allowCar, setAllowCar] = useState(false);
  const [result, setResult] = useState<{ id: string; report?: RestoreReport; error?: string } | null>(null);
  const [pasted, setPasted] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  // The car tests own the module while a session, a waiting test or a pending restore exists.
  const testsBlocking =
    testsState.phase === 'active' ||
    testsState.phase === 'starting' ||
    testsState.phase === 'finishing' ||
    !!testsState.waiting ||
    !!testsState.pendingRestore ||
    !!testsState.busy;

  const close = () => {
    setOpenId(null);
    setRestoreInstall(false);
    setPreview(null);
    setAllowCar(false);
  };

  const save = async () => {
    setBusy('Leyendo el módulo…');
    try {
      const { snapshot, missing } = await takeSnapshot(controller, {
        factory: withInstall,
        label: `Copia · ${new Date().toLocaleString('es')}${controller.demo ? ' · demo' : ''}`,
      });
      if (missingEssentials(missing).length) {
        controller.toast(`El módulo no respondió del todo (faltan ${missing.join(', ')}): no se guardó la copia.`, 'error');
        return;
      }
      const stored = store.add(snapshot);
      controller.toast(
        `Copia guardada: ${snapshotSummary(stored)}${missing.length ? ` (faltan ${missing.join(', ')})` : ''}`,
        missing.length ? 'warning' : 'success',
      );
      if (store.saveFailed) controller.toast('No se pudo guardar en el navegador: copia el JSON para no perderla.', 'warning');
    } catch (error) {
      controller.reportError(error);
    } finally {
      setBusy(null);
    }
  };

  /** Reads the installation (read-only visit to factory mode) and lists what the copy would change. */
  const review = async (snapshot: Snapshot) => {
    setBusy('Leyendo la instalación del módulo…');
    setPreview(null);
    setAllowCar(false);
    try {
      const { snapshot: now, missing } = await takeSnapshot(controller, { factory: true });
      if (!now.values.factory.carBits) {
        controller.toast(`No se pudo leer la instalación (faltan ${missing.join(', ') || 'tramas'}).`, 'error');
        return;
      }
      setPreview({
        id: snapshot.id,
        changes: installationChanges(snapshot.values, now.values),
        moduleCar: now.values.factory.carBits,
        copyCar: snapshot.values.factory.carBits,
      });
    } catch (error) {
      controller.reportError(error);
    } finally {
      setBusy(null);
    }
  };

  const restore = async (snapshot: Snapshot) => {
    const includeFactory = restoreInstall && hasFactory(snapshot.values) && !!preview && preview.id === snapshot.id && preview.changes.length > 0;
    close();
    setResult(null);
    setBusy('Restaurando…');
    try {
      const report = await restoreSnapshot(controller, snapshot, {
        includeFactory,
        allowCarCodeChange: includeFactory && allowCar,
        // A copy of how the module was, to undo this restore.
        saveBefore: (before) => store.add(before),
        onProgress: setBusy,
      });
      setResult({ id: snapshot.id, report });
      controller.toast(report.ok ? 'Copia restaurada y comprobada' : 'Restaurada, pero hay diferencias', report.ok ? 'success' : 'warning');
    } catch (error) {
      const message = error instanceof Error && error.name !== 'Error' && error.message ? error.message : '';
      setResult({ id: snapshot.id, error: message || 'No se pudo restaurar.' });
      controller.reportError(error);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (snapshot: Snapshot) => {
    const ok = await confirm({
      title: 'Borrar la copia',
      message: `Se borrará «${snapshot.label}» de este navegador. No cambia nada en el módulo.`,
      confirmLabel: 'Borrar',
      danger: true,
    });
    if (ok) store.remove(snapshot.id);
  };

  const copy = (snapshot: Snapshot) =>
    void copyText(exportSnapshot(snapshot)).then((ok) =>
      controller.toast(ok ? 'JSON copiado' : 'No se pudo copiar el JSON', ok ? 'success' : 'error'),
    );

  const importPasted = () => {
    const outcome = store.importText(pasted.trim());
    if (!outcome.ok) {
      setImportError(outcome.error);
      return;
    }
    setImportError(null);
    setPasted('');
    controller.toast(`Copia importada: ${outcome.snapshot.label}`, 'success');
  };

  return (
    <>
      <Card
        title="Guardar copia ahora"
        icon="download"
        subtitle="Lee los ajustes del módulo y los guarda en este navegador. No cambia nada."
      >
        <Toggle
          label="Incluir la instalación"
          description="Entra un momento en modo fábrica para leer códigos de modelo, tiras y cableado. Solo lee."
          checked={withInstall}
          onChange={setWithInstall}
        />
        <button type="button" className="btn btn-primary btn-wide" disabled={!ready || !!busy} onClick={() => void save()}>
          {busy ? <Spinner /> : <Icon name="download" size={18} />}
          {busy ?? 'Guardar copia ahora'}
        </button>
        {!ready && <p className="hint">Conéctate al módulo para guardar o restaurar.</p>}
        {store.saveFailed && <Notice kind="warning">El navegador no deja guardar: copia el JSON de las copias que quieras conservar.</Notice>}
      </Card>

      <Card
        title="Copias"
        icon="layers"
        subtitle={`Hasta 10 copias tuyas y 5 automáticas en este navegador, más tu configuración del 6/11/2026.${controller.demo ? ' (Modo demo: copias aparte.)' : ''}`}
      >
        {testsBlocking && (
          <Notice kind="warning" title="Las pruebas del coche tienen ajustes cambiados">
            {testsState.waiting
              ? 'Hay una prueba esperando tu respuesta: restaurar una copia ahora la estropearía. Contéstala o descártala primero.'
              : testsState.pendingRestore
                ? 'Hay ajustes de las pruebas pendientes de restaurar: aplícalos o descártalos primero.'
                : 'Para volver a como estaba, usa «Restaurar todo ahora» en Pruebas del coche.'}{' '}
            <button type="button" className="btn btn-ghost" onClick={() => openMorePage('cartests')}>
              Ir a Pruebas del coche
            </button>
          </Notice>
        )}
        <ul className="backup-list">
          {list.map((snapshot) => {
            const open = openId === snapshot.id;
            const settingsCount = restoreCommands(snapshot.values).settings.length;
            const factoryCount = restoreCommands(snapshot.values, { include: 'all' }).factory.length;
            const demoCopy = !!snapshot.demo && !controller.demo;
            const shown = preview?.id === snapshot.id ? preview : null;
            const carChange = !!shown && !!shown.copyCar && shown.copyCar !== shown.moduleCar;
            const needsReview = restoreInstall && (!shown || (carChange && !allowCar));
            return (
              <li key={snapshot.id} className="backup-item">
                <div className="backup-head">
                  <span className="backup-label">{snapshot.label}</span>
                  <span className="backup-meta">
                    {SOURCE_LABEL[snapshot.source]}
                    {snapshot.auto ? ' · automática' : ''}
                    {snapshot.demo ? ' · demo' : ''}
                  </span>
                </div>
                <span className="backup-meta">
                  {new Date(snapshot.takenAt).toLocaleString('es')} · firmware {snapshot.firmware ?? '?'} · {snapshotSummary(snapshot)}
                </span>
                {!open && (
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!ready || !!busy || testsBlocking}
                      onClick={() => {
                        close();
                        setOpenId(snapshot.id);
                      }}
                    >
                      <Icon name="reset" size={18} />
                      Restaurar
                    </button>
                    <button type="button" className="btn" onClick={() => copy(snapshot)}>
                      <Icon name="copy" size={18} />
                      Copiar JSON
                    </button>
                    {snapshot.source !== 'builtin' && (
                      <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => void remove(snapshot)}>
                        <Icon name="trash" size={18} />
                        Borrar
                      </button>
                    )}
                  </div>
                )}
                {open && (
                  <div className="backup-confirm">
                    <p className="hint">
                      Primero se guarda una copia automática de cómo está el módulo ahora. Después se envían {settingsCount} ajustes de
                      uso (colores, efectos, brillos, avisos, bienvenida) con una pausa entre ellos, y se lee el módulo para comprobarlos.
                    </p>
                    {factoryCount > 0 && demoCopy && (
                      <Notice kind="warning">Esta copia es del módulo de demostración: su instalación no se puede restaurar en el tuyo.</Notice>
                    )}
                    {factoryCount > 0 && !demoCopy && (
                      <label className={restoreInstall ? 'ack ack-danger' : 'ack'}>
                        <input
                          type="checkbox"
                          checked={restoreInstall}
                          onChange={(e) => {
                            setRestoreInstall(e.target.checked);
                            setPreview(null);
                            setAllowCar(false);
                          }}
                        />
                        <span>
                          <strong>Restaurar también la instalación</strong>
                          <br />
                          Códigos de modelo, número de LEDs, cableado, parámetro de la tira y código de cliente, en modo fábrica. Un
                          valor equivocado hace que el módulo no entienda el coche: márcalo solo si la instalación se ha perdido.
                        </span>
                      </label>
                    )}
                    {restoreInstall && !shown && (
                      <button type="button" className="btn btn-wide" disabled={!ready || !!busy} onClick={() => void review(snapshot)}>
                        {busy ? <Spinner /> : null}
                        Revisar qué cambiaría en la instalación
                      </button>
                    )}
                    {restoreInstall && shown && (
                      <div className="backup-result">
                        {shown.changes.length === 0 ? (
                          <p className="hint">La instalación del módulo ya coincide con la copia: solo se restaurarán los ajustes de uso.</p>
                        ) : (
                          <>
                            <p className="hint">Se cambiará en la instalación (módulo ahora → copia):</p>
                            <ul className="check-list">
                              {shown.changes.map((c) => (
                                <li key={c.field} className="check-bad">
                                  {c.label}: {c.status === 'unknown' ? 'no se pudo leer' : c.actual} → {c.expected}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        {carChange && (
                          <label className={allowCar ? 'ack ack-danger' : 'ack'}>
                            <input type="checkbox" checked={allowCar} onChange={(e) => setAllowCar(e.target.checked)} />
                            <span>
                              <strong>
                                Sí, cambiar también el código de coche ({shown.moduleCar} → {shown.copyCar})
                              </strong>
                              <br />
                              La copia es de otro coche o de otra configuración. Sin esta casilla no se toca la instalación.
                            </span>
                          </label>
                        )}
                      </div>
                    )}
                    <div className="row-actions">
                      <button
                        type="button"
                        className={restoreInstall ? 'btn btn-danger' : 'btn btn-primary'}
                        disabled={!ready || !!busy || testsBlocking || needsReview}
                        onClick={() => void restore(snapshot)}
                      >
                        {restoreInstall ? 'Restaurar ajustes e instalación' : 'Restaurar ajustes'}
                      </button>
                      <button type="button" className="btn" onClick={close}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
                {result?.id === snapshot.id &&
                  (result.report ? <ReportView report={result.report} /> : <Notice kind="danger">{result.error}</Notice>)}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Pegar JSON" icon="upload" subtitle="Importa una copia hecha con «Copiar JSON» (por ejemplo, desde otro móvil).">
        <div className="paste-box">
          <textarea
            className="text-input"
            rows={5}
            aria-label="JSON de la copia"
            aria-invalid={!!importError}
            placeholder='{"app":"ambiente-f32-backup", …}'
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
              setImportError(null);
            }}
          />
          {importError && <p className="hint hint-error">{importError}</p>}
          <button type="button" className="btn" disabled={!pasted.trim()} onClick={importPasted}>
            <Icon name="upload" size={18} />
            Importar
          </button>
        </div>
      </Card>
    </>
  );
}
