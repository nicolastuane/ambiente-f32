/** Raw command console and timestamped TX/RX log (export = lab JSON contract). */
import { useMemo, useState } from 'react';
import { MockAdapter } from '../../ble/mockAdapter';
import { fromBytes } from '../../protocol/zycela/commands';
import { describeCommand } from '../../protocol/zycela/describe';
import { parseConsoleInput } from '../../state/lab';
import type { ConsoleMode, LogEntry } from '../../state/lab';
import { copyText, downloadText, timestampForFile } from '../../util/files';
import { useAppData, useController, useLog, useReady } from '../AppContext';
import { Card, Field, Segmented, Toggle } from '../controls';
import { useConfirm } from '../feedback';
import { Icon } from '../Icon';
import { FINAL_CONFIRM_ARM_MS, commandRisk } from '../safety';

const MODES = [
  { id: 'command' as ConsoleMode, name: 'Comando' },
  { id: 'bytes' as ConsoleMode, name: 'Bytes hex' },
];

const KIND_LABEL: Record<LogEntry['kind'], string> = {
  tx: 'TX',
  rx: 'RX',
  marker: 'MARCA',
  info: 'INFO',
  error: 'ERROR',
};

function time(iso: string): string {
  const d = new Date(iso);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function Lab() {
  const controller = useController();
  const ready = useReady();
  const log = useLog();
  const confirm = useConfirm();
  const [data] = useAppData();
  const [mode, setMode] = useState<ConsoleMode>('command');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showHex, setShowHex] = useState(false);
  const [marker, setMarker] = useState('');
  const entries = useMemo(() => [...log].reverse().slice(0, 300), [log]);

  /** The console goes through the same gates as Instalación and Restaurar. */
  const allowed = async (text: string): Promise<boolean> => {
    const risk = commandRisk(text);
    if (risk === 'none') return true;
    if (risk === 'confirm') {
      return confirm({
        title: 'Orden delicada',
        message: (
          <p>
            <code>{text}</code>: {describeCommand(text)}. ¿Enviarla al módulo?
          </p>
        ),
        confirmLabel: 'Enviar',
        danger: true,
      });
    }
    if (!data.showDangerous) {
      controller.toast('[4100] está bloqueado. Actívalo en Más › Ajustes › «Mostrar opciones peligrosas».', 'warning');
      return false;
    }
    const first = await confirm({
      title: 'Activar el menú de ambiente original',
      message: (
        <p>
          <code>{text}</code> intenta activar el menú de luz ambiente del propio coche. Puede reprogramar algo del coche y
          no sabemos deshacerlo desde esta app.
        </p>
      ),
      acknowledge: 'Entiendo que puede modificar la programación del coche y que lo hago bajo mi responsabilidad.',
      confirmLabel: 'Continuar',
      danger: true,
    });
    if (!first) return false;
    return confirm({
      title: '¿Seguro?',
      message: `Última confirmación. Se enviará ${text} al módulo ahora.`,
      confirmLabel: `Enviar ${text}`,
      danger: true,
      armDelayMs: FINAL_CONFIRM_ARM_MS,
    });
  };

  const send = async () => {
    const parsed = parseConsoleInput(input, mode);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    const payload = parsed.text ?? parsed.bytes;
    if (!(await allowed(parsed.text ?? fromBytes(parsed.bytes)))) return;
    controller.run((d) => d.sendRaw(payload));
  };

  const exportLog = () => {
    const text = JSON.stringify(controller.exportLab(), null, 2);
    // A download can fail silently (e.g. in iOS WebViews such as Bluefy): say where to look and offer the copy.
    const ok = downloadText(`laboratorio-ambiente-f32-${timestampForFile()}.json`, text);
    controller.toast(
      ok ? 'Descarga iniciada. Si no aparece el archivo, usa «Copiar JSON».' : 'No se pudo descargar: usa «Copiar JSON».',
      ok ? 'info' : 'warning',
    );
  };

  const copyLog = () => {
    const text = JSON.stringify(controller.exportLab(), null, 2);
    void copyText(text).then((copied) =>
      controller.toast(copied ? 'JSON copiado al portapapeles' : 'No se pudo copiar el JSON', copied ? 'success' : 'error'),
    );
  };

  return (
    <>
      <Card title="Consola" icon="flask" subtitle="Envía comandos tal cual. Úsala solo si sabes lo que haces.">
        <Segmented<ConsoleMode> label="Formato de entrada" options={MODES} value={mode} onChange={setMode} />
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <input
            className="text-input mono"
            aria-label="Comando a enviar"
            aria-invalid={!!error}
            aria-describedby="lab-help"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder={mode === 'command' ? '0A01  o  [0A01]' : '5B 30 41 30 31 5D'}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setError(null);
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={!ready}>
            <Icon name="send" size={18} />
            Enviar
          </button>
        </form>
        <p id="lab-help" className={error ? 'hint hint-error' : 'hint'}>
          {error ??
            (mode === 'command'
              ? 'Pares hexadecimales como 0A01 (se envía [0A01], como la consola original) o la trama completa [0A01].'
              : 'Bytes en hexadecimal, separados o no por espacios.')}
        </p>
        <div className="row-actions">
          <button type="button" className="btn" disabled={!ready} onClick={() => controller.run((d) => d.requestState())}>
            Pedir estado [0A01]
          </button>
          <button type="button" className="btn" disabled={!ready} onClick={() => controller.run((d) => d.startDebug())}>
            Depuración [3702]
          </button>
          <button type="button" className="btn" disabled={!ready} onClick={() => controller.run((d) => d.stopDebug())}>
            Parar [3700]
          </button>
        </div>
        {controller.adapter instanceof MockAdapter && (
          <button
            type="button"
            className="btn btn-ghost btn-wide"
            disabled={!ready}
            onClick={() => (controller.adapter as MockAdapter).simulateDrop()}
          >
            Simular un corte de conexión (demo)
          </button>
        )}
      </Card>

      <Card
        title="Registro"
        icon="layers"
        subtitle={`${log.length} eventos. Lo más reciente arriba.`}
        actions={
          <button type="button" className="btn btn-ghost btn-small" disabled={!log.length} onClick={() => controller.clearLog()}>
            Borrar
          </button>
        }
      >
        <Field label="Marca">
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              controller.addMarker(marker);
              setMarker('');
            }}
          >
            <input
              className="text-input"
              aria-label="Texto de la marca"
              placeholder="Ej.: abro la puerta del conductor"
              value={marker}
              onChange={(event) => setMarker(event.target.value)}
            />
            <button type="submit" className="btn">
              <Icon name="flag" size={18} />
              Marcar
            </button>
          </form>
        </Field>
        <Toggle label="Mostrar bytes en hexadecimal" checked={showHex} onChange={setShowHex} />
        <div className="row-actions">
          <button type="button" className="btn" disabled={!log.length} onClick={exportLog}>
            <Icon name="download" size={18} />
            Exportar JSON
          </button>
          <button type="button" className="btn" disabled={!log.length} onClick={copyLog}>
            <Icon name="copy" size={18} />
            Copiar JSON
          </button>
        </div>
        <ol className="log" aria-label="Registro de comunicación">
          {entries.map((entry) => (
            <li key={entry.id} className={`log-entry log-${entry.kind}`}>
              <div className="log-head">
                <span className="log-kind">{KIND_LABEL[entry.kind]}</span>
                <time dateTime={entry.t}>{time(entry.t)}</time>
                {entry.kind === 'tx' && entry.withResponse === false && <span className="log-flag">sin respuesta</span>}
              </div>
              {entry.text !== undefined && <div className="log-text mono">{entry.text}</div>}
              {showHex && entry.hex && <div className="log-hex mono">{entry.hex}</div>}
              {entry.note && <div className="log-note">{entry.note}</div>}
              {entry.meanings?.map((meaning, i) => (
                <div key={i} className="log-meaning">
                  {meaning}
                </div>
              ))}
            </li>
          ))}
        </ol>
        {log.length === 0 && <p className="hint">Todavía no hay tráfico. Conéctate o envía un comando.</p>}
      </Card>
    </>
  );
}
