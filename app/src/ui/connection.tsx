/** Connection UI: header pill, connect panel, "no Web Bluetooth" banner. */
import { useState } from 'react';
import { hasWebBluetooth } from '../ble/adapter';
import type { ConnStatus } from '../ble/session';
import { copyText } from '../util/files';
import { useAppData, useConnection, useController } from './AppContext';
import { Notice, Spinner } from './controls';
import { Icon } from './Icon';

const BUSY_LABEL: Partial<Record<ConnStatus, string>> = {
  requesting: 'Buscando…',
  connecting: 'Conectando…',
  discovering: 'Preparando…',
};

export function ConnectionPill() {
  const controller = useController();
  const conn = useConnection();
  const busy = BUSY_LABEL[conn.status];

  if (conn.status === 'ready') {
    const name = conn.device?.name ?? 'el módulo';
    return (
      <div className="pill-group">
        <span className="pill pill-ok" title={name} role="status" aria-label={`Conectado a ${name}${controller.demo ? ' (demo)' : ''}`}>
          <span className="dot" aria-hidden="true" />
          <span className="pill-text" aria-hidden="true">
            {controller.demo ? 'Demo' : 'Conectado'}
          </span>
        </span>
        {/* Bluetooth-off icon, not a power icon: this drops the link, it does not switch the lights off. */}
        <button
          type="button"
          className="btn btn-ghost btn-disconnect"
          aria-label="Desconectar el Bluetooth"
          title="Desconectar el Bluetooth"
          onClick={() => void controller.disconnect()}
        >
          <Icon name="bluetoothOff" />
          <span className="btn-disconnect-label" aria-hidden="true">
            Desconectar
          </span>
        </button>
      </div>
    );
  }

  if (busy || conn.status === 'reconnecting') {
    return (
      <div className="pill-group">
        <span className="pill pill-busy" role="status">
          <Spinner />
          <span className="pill-text">
            {conn.status === 'reconnecting' ? `Reconectando ${conn.attempt}/${conn.maxAttempts}` : busy}
          </span>
        </span>
        <button
          type="button"
          className="btn btn-icon btn-ghost"
          aria-label="Cancelar la conexión"
          title="Cancelar"
          onClick={() => void controller.disconnect()}
        >
          <Icon name="close" />
        </button>
      </div>
    );
  }

  return (
    <button type="button" className="btn btn-primary btn-small" onClick={() => void controller.connect(false)}>
      <Icon name="bluetooth" size={18} />
      Conectar
    </button>
  );
}

/** Large connect card shown on the Color tab while disconnected. */
export function ConnectPanel() {
  const controller = useController();
  const conn = useConnection();
  const [data] = useAppData();
  const [knownFailed, setKnownFailed] = useState(false);
  const busy = conn.status !== 'idle' && conn.status !== 'disconnected' && conn.status !== 'error';
  // Only when this browser can list permitted devices (navigator.bluetooth.getDevices).
  const canUseKnown =
    !controller.demo && !!data.lastDevice?.id && !!controller.adapter.canListKnownDevices?.() && !knownFailed;

  return (
    <section className="card connect-card" aria-label="Conexión">
      <div className="connect-hero" aria-hidden="true">
        <Icon name="bluetooth" size={30} />
      </div>
      <h2 className="connect-title">{controller.demo ? 'Modo demo' : 'Conecta con el módulo'}</h2>
      <p className="card-sub">
        {controller.demo
          ? 'Se simula un módulo ZYCL-FWD: puedes probar todos los controles sin el coche.'
          : 'El módulo aparece en la lista como «ZYCL-FWD…». Arranca el coche (o enciende el contacto) para que tenga corriente.'}
      </p>
      {conn.status === 'error' && conn.error && (
        <Notice kind="danger" title="No se pudo conectar">
          {conn.error}
        </Notice>
      )}
      <div className="connect-actions">
        <button type="button" className="btn btn-primary btn-wide" disabled={busy} onClick={() => void controller.connect(false)}>
          {busy ? <Spinner /> : <Icon name="bluetooth" size={20} />}
          {busy ? (BUSY_LABEL[conn.status] ?? 'Conectando…') : 'Conectar'}
        </button>
        {canUseKnown && (
          <button
            type="button"
            className="btn btn-wide"
            disabled={busy}
            onClick={() => {
              controller
                .connectKnown()
                .then((ok) => {
                  if (!ok) {
                    setKnownFailed(true);
                    controller.toast('Este navegador no recuerda el módulo: usa «Conectar».', 'info');
                  }
                })
                .catch((error: unknown) => controller.reportError(error, 'connect'));
            }}
          >
            Reconectar a {data.lastDevice?.name ?? 'el último módulo'}
          </button>
        )}
        {!controller.demo && (
          <button type="button" className="btn btn-ghost btn-wide" disabled={busy} onClick={() => void controller.connect(true)}>
            Mostrar todos los dispositivos
          </button>
        )}
      </div>
      {!controller.demo && (
        <Notice kind="warning" title="Antes de conectar">
          Cierra el mini-programa de WeChat (en el móvil y en el PC). El módulo solo acepta una conexión a la vez y, si
          WeChat está conectado, esta app no lo encontrará.
        </Notice>
      )}
      {!controller.demo && data.lastDevice?.name && (
        <p className="hint">Último módulo usado: {data.lastDevice.name}</p>
      )}
    </section>
  );
}

/** Compact notice for the other control tabs. */
export function DisconnectedNotice() {
  const controller = useController();
  const conn = useConnection();
  if (conn.status === 'ready') return null;
  const busy = conn.status !== 'idle' && conn.status !== 'disconnected' && conn.status !== 'error';
  return (
    <div className="offline-bar" role="status">
      <span>{busy ? 'Conectando con el módulo…' : 'Sin conexión: los controles están desactivados.'}</span>
      {!busy && (
        <button type="button" className="btn btn-primary btn-small" onClick={() => void controller.connect(false)}>
          Conectar
        </button>
      )}
    </div>
  );
}

/** Shown when the browser has no Web Bluetooth (e.g. Safari on iPhone). */
export function NoBluetoothBanner() {
  const [data, update] = useAppData();
  const controller = useController();
  if (hasWebBluetooth() || data.demo) return null;
  const insecure = typeof window !== 'undefined' && window.isSecureContext === false;
  const url = typeof location !== 'undefined' ? location.href : '';
  return (
    <section className="banner" aria-label="Bluetooth no disponible">
      <h2>
        <Icon name="warning" size={20} />
        Este navegador no puede usar Bluetooth
      </h2>
      {insecure ? (
        <p>
          La página se ha abierto sin HTTPS. El Bluetooth web solo funciona en páginas seguras (https://) o en
          http://localhost.
        </p>
      ) : (
        <p>
          En iPhone, Safari y Chrome no pueden conectar con Bluetooth desde una página web. Instala la app gratuita{' '}
          <strong>Bluefy</strong> desde la App Store y abre esta misma dirección dentro de Bluefy. En el ordenador, usa
          Chrome o Edge.
        </p>
      )}
      <div className="row-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            void copyText(url).then((ok) =>
              controller.toast(ok ? 'Dirección copiada' : 'No se pudo copiar la dirección', ok ? 'success' : 'warning'),
            );
          }}
        >
          <Icon name="copy" size={18} />
          Copiar dirección
        </button>
        <button type="button" className="btn btn-primary" onClick={() => update((d) => ({ ...d, demo: true }))}>
          Probar modo demo
        </button>
      </div>
    </section>
  );
}
