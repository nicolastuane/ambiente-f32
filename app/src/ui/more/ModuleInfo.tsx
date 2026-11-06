import { FIRMWARE_NAMES } from '../../protocol/zycela/catalog';
import { useConnection, useController, useDevice, useReady } from '../AppContext';
import { Card, Notice } from '../controls';

export function ModuleInfo() {
  const controller = useController();
  const device = useDevice();
  const conn = useConnection();
  const ready = useReady();
  const v = device.version;

  const rows: [string, string][] = [
    ['Dispositivo', conn.device?.name ?? '–'],
    ['Firmware (variante)', device.firmware ? FIRMWARE_NAMES[device.firmware] : '–'],
    ['Versión de hardware', v?.hardware || '–'],
    ['Modelo de coche', v?.carModel || '–'],
    ['Versión de firmware', v?.firmware || '–'],
    ['Escritura', conn.withResponse === null ? '–' : conn.withResponse ? 'Con respuesta' : 'Sin respuesta'],
    ['Modo', controller.demo ? 'Demo (simulado)' : 'Bluetooth real'],
  ];

  return (
    <>
      {!ready && <Notice>Conéctate para leer la información del módulo.</Notice>}
      <Card title="Información del módulo" icon="chip">
        <dl className="kv">
          {rows.map(([key, value]) => (
            <div key={key} className="kv-row">
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {v && (
          <p className="hint mono" aria-label="Trama de versión recibida">
            {v.raw}
          </p>
        )}
        <button type="button" className="btn btn-wide" disabled={!ready} onClick={() => controller.run((d) => d.requestState())}>
          Volver a pedir el estado
        </button>
      </Card>
    </>
  );
}
