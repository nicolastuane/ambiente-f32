/**
 * Installer settings (the mini-program's "factory settings" page). Entering
 * sends [2101]; leaving (back, tab change, unmount) sends [2100].
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LED_STRIPS, WIRING, carModelForBits } from '../../protocol/zycela/catalog';
import type { BinaryValue } from '../../protocol/zycela/commands';
import { dialCodes } from '../../protocol/zycela/commands';
import { acquireLock, enterFactoryModeMarked, leaveFactoryMode, lockHolder, onLockChange } from '../../state/backup';
import { useAppData, useConnection, useController, useDevice, useReady } from '../AppContext';
import { Card, Field, Notice, Segmented, Spinner, Stepper } from '../controls';
import { useConfirm } from '../feedback';
import { Icon } from '../Icon';
import { FINAL_CONFIRM_ARM_MS } from '../safety';

const EMPTY_BITS = '00000000';

function BitEditor({ label, bits, onChange, disabled }: { label: string; bits: string; onChange: (bits: string) => void; disabled?: boolean }) {
  return (
    <div className="bits" role="group" aria-label={label}>
      {bits.split('').map((bit, index) => (
        <button
          key={index}
          type="button"
          className="bit"
          aria-pressed={bit === '1'}
          aria-label={`${label}, interruptor ${index + 1}: ${bit === '1' ? 'activado' : 'desactivado'}`}
          disabled={disabled}
          onClick={() => onChange(bits.slice(0, index) + (bit === '1' ? '0' : '1') + bits.slice(index + 1))}
        >
          <span className="bit-num">{index + 1}</span>
          <span className="bit-val">{bit}</span>
        </button>
      ))}
    </div>
  );
}

const SUPPORT_LABELS = ['seguir luces', 'puerta abierta', 'radar', 'velocidad', 'intermitentes', 'aire acondicionado', 'ángulo muerto'];

/** Names the car-model code using the vendor table (BMW rows only). */
function CarModelHint({ bits }: { bits: string }) {
  const code = carModelForBits(bits);
  if (!code) {
    return <p className="hint">Este código no está entre los BMW de la tabla del fabricante. El que reconoce bien tu F32 es 01000010 (serie F).</p>;
  }
  const missing = SUPPORT_LABELS.filter((_, i) => !code.supports[i]);
  return (
    <p className="hint">
      Según la tabla del fabricante: <strong>{code.brand} · {code.model}</strong> (control desde {code.control}).
      {missing.length > 0 && ` Sin: ${missing.join(', ')}.`}
    </p>
  );
}

function FactoryPanel() {
  const controller = useController();
  const device = useDevice();
  const ready = useReady();
  const confirm = useConfirm();
  const [data] = useAppData();
  const factory = device.factory;
  const [carDraft, setCarDraft] = useState<string | null>(null);
  const [featureDraft, setFeatureDraft] = useState<string | null>(null);
  const [showThird, setShowThird] = useState(false);
  const [customer, setCustomer] = useState('');
  const customerTouched = useRef(false);

  // Factory mode belongs to this page while it is open: it holds the factory
  // lock, so no backup, restore or car test can send [2100] under it (they
  // wait). It enters with [2101] (and again after a reconnection) and leaves
  // with [2100] on unmount, which also happens when the user switches tabs;
  // if the link is down then, [2100] goes out on the next connection.
  const [held, setHeld] = useState(false);
  const holder = useSyncExternalStore(
    (listener) => onLockChange(controller, 'factory', listener),
    () => lockHolder(controller, 'factory'),
  );
  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | null = null;
    void acquireLock(controller, 'factory', 'Instalación').then((free) => {
      if (cancelled) {
        free();
        return;
      }
      release = free;
      setHeld(true);
    });
    return () => {
      cancelled = true;
      const free = release;
      release = null;
      if (free) void leaveFactoryMode(controller).finally(free);
    };
  }, [controller]);
  useEffect(() => {
    if (ready && held) controller.run(() => enterFactoryModeMarked(controller));
  }, [controller, ready, held]);

  useEffect(() => {
    if (!customerTouched.current && factory.customerCode !== null) setCustomer(String(factory.customerCode));
  }, [factory.customerCode]);

  const carBits = carDraft ?? factory.carBits ?? EMPTY_BITS;
  const featureBits = featureDraft ?? factory.featureBits ?? EMPTY_BITS;
  const dirty = (carDraft !== null && carDraft !== factory.carBits) || (featureDraft !== null && featureDraft !== factory.featureBits);
  const third = factory.thirdRow || showThird;
  const received = factory.received;

  const sendCodes = async () => {
    const command = dialCodes(carBits, featureBits);
    const ok = await confirm({
      title: 'Enviar códigos de modelo',
      message: (
        <>
          <p>
            Coche: <strong className="mono">{carBits}</strong>
            <br />
            Funciones: <strong className="mono">{featureBits}</strong>
          </p>
          <p>
            Se enviará <code>{command}</code>. Un código equivocado hace que el módulo no entienda las señales del coche
            (puertas, botones, velocidad…).
          </p>
        </>
      ),
      confirmLabel: 'Enviar',
      danger: true,
    });
    if (!ok) return;
    controller.run(async (d) => {
      await d.setDialCodes(carBits, featureBits);
      setCarDraft(null);
      setFeatureDraft(null);
    });
  };

  const sendCustomer = () => {
    const n = Number(customer);
    if (!/^\d{1,4}$/.test(customer.trim()) || !Number.isInteger(n) || n < 0 || n > 9999) {
      controller.toast('El código de cliente debe ser un número de 0 a 9999', 'warning');
      return;
    }
    customerTouched.current = false;
    controller.run((d) => d.setCustomerCode(n));
  };

  const activateOriginal = async () => {
    const first = await confirm({
      title: 'Activar el menú de ambiente original',
      message: (
        <>
          <p>
            Esta orden (<code>[4100]</code>) intenta activar el menú de luz ambiente del propio coche («刷机»: programar).
            Puede reprogramar algo del coche y no sabemos deshacerlo desde esta app.
          </p>
          <p>No la uses si no sabes exactamente qué hace en tu coche.</p>
        </>
      ),
      acknowledge: 'Entiendo que puede modificar la programación del coche y que lo hago bajo mi responsabilidad.',
      confirmLabel: 'Continuar',
      danger: true,
    });
    if (!first) return;
    // Same place on screen as "Continuar": the button only arms after 2 s, so
    // a double tap on the first dialog cannot confirm this one.
    const second = await confirm({
      title: '¿Seguro?',
      message: 'Última confirmación. Se enviará [4100] al módulo ahora.',
      confirmLabel: 'Enviar [4100]',
      danger: true,
      armDelayMs: FINAL_CONFIRM_ARM_MS,
    });
    if (second) controller.run((d) => d.activateOriginalMenu());
  };

  return (
    <>
      <div className="factory-bar" role="status">
        {held ? <Icon name="wrench" size={18} /> : <Spinner />}
        <span>
          {!held
            ? `Esperando a que termine otra operación del módulo${holder ? ` (${holder})` : ''}…`
            : `Modo fábrica ${ready ? 'activo' : 'sin conexión'}`}
          {held && received.length > 0 && <span className="hint"> · recibido: {received.join(', ')}</span>}
        </span>
      </div>

      <fieldset className="controls" disabled={!ready || !held}>
        <legend className="sr-only">Instalación</legend>
        <Card
          title="Códigos de modelo"
          icon="chip"
          subtitle="8 interruptores de «código de coche» y 8 de «funciones». Consulta el manual del kit para tu coche. Nada se envía hasta pulsar «Enviar códigos»."
        >
          <Field label="Código de coche" value={<span className="mono">{factory.carBits ?? '–'}</span>}>
            <BitEditor label="Código de coche" bits={carBits} onChange={setCarDraft} />
          </Field>
          <CarModelHint bits={carBits} />

          <Field label="Funciones" value={<span className="mono">{factory.featureBits ?? '–'}</span>}>
            <BitEditor label="Funciones" bits={featureBits} onChange={setFeatureDraft} />
          </Field>
          <div className="row-actions">
            <button type="button" className="btn btn-danger" disabled={!dirty} onClick={() => void sendCodes()}>
              <Icon name="send" size={18} />
              Enviar códigos
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!dirty}
              onClick={() => {
                setCarDraft(null);
                setFeatureDraft(null);
              }}
            >
              Deshacer cambios
            </button>
          </div>
          {dirty && <p className="hint">Hay cambios sin enviar (el valor actual del módulo está a la derecha).</p>}
        </Card>

        <Card title="Tiras de LED" icon="sliders" subtitle="Número de LEDs de cada tira. Cada cambio se envía al momento.">
          {LED_STRIPS.filter((strip) => !strip.thirdRowOnly || third).map((strip) => (
            <Stepper
              key={strip.key}
              label={strip.name}
              min={strip.min}
              max={strip.max}
              value={factory.leds[strip.key]}
              onChange={(n) => controller.run((d) => d.setLedCount(strip.key, n))}
            />
          ))}
          {!factory.thirdRow && (
            <button type="button" className="btn btn-ghost btn-wide" aria-pressed={showThird} onClick={() => setShowThird(!showThird)}>
              {showThird ? 'Ocultar la tercera fila' : 'Mostrar la tercera fila (monovolúmenes)'}
            </button>
          )}
        </Card>

        <Card title="Cableado y montaje" icon="wrench" subtitle="Por dónde sale el cable de cada tira. Cada cambio se envía al momento.">
          {WIRING.filter((w) => !w.thirdRowOnly || third).map((w) => (
            <Field key={w.key} label={w.name}>
              <Segmented<number>
                label={w.name}
                options={w.options}
                value={factory.wiring[w.key]}
                onChange={(v) => controller.run((d) => d.setWiring(w.key, v as BinaryValue))}
              />
            </Field>
          ))}
        </Card>

        <Card title="Código de cliente" icon="chip" subtitle="Número de 0 a 9999.">
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              sendCustomer();
            }}
          >
            <input
              className="text-input"
              inputMode="numeric"
              aria-label="Código de cliente"
              placeholder={factory.customerCode === null ? '–' : String(factory.customerCode)}
              value={customer}
              maxLength={4}
              onChange={(event) => {
                customerTouched.current = true;
                setCustomer(event.target.value.replace(/[^0-9]/g, ''));
              }}
            />
            <button type="submit" className="btn btn-primary">
              Enviar
            </button>
          </form>
        </Card>

        {data.showDangerous ? (
          <details className="danger-zone">
            <summary>
              <Icon name="warning" size={18} />
              Opciones peligrosas
            </summary>
            <p>
              <strong>Activar el menú de ambiente original del coche</strong> ([4100], «原车氛围灯界面开通»). Puede
              reprogramar algo del coche. El módulo responde con un resultado (no admitido / hecho / fallo).
            </p>
            <button type="button" className="btn btn-danger btn-wide" onClick={() => void activateOriginal()}>
              Activar el menú original…
            </button>
          </details>
        ) : (
          <p className="hint">Las opciones peligrosas están ocultas. Puedes mostrarlas en Más › Ajustes de la app.</p>
        )}
      </fieldset>
    </>
  );
}

export function Installation({ onExit }: { onExit: () => void }) {
  const ready = useReady();
  const conn = useConnection();
  const [entered, setEntered] = useState(false);

  if (!entered) {
    return (
      <Card title="Antes de entrar" icon="warning" className="card-warn">
        <div className="prose">
          <p>
            Estos ajustes cambian cómo el módulo interpreta las señales del coche y cómo maneja las tiras de LED. Un
            valor equivocado puede hacer que las luces no respondan a las puertas o a los botones, o que las tiras se
            vean mal.
          </p>
          <p>
            Al entrar, el módulo pasa a <strong>modo fábrica</strong> ([2101]) y la app muestra sus valores actuales.
            Apúntalos antes de cambiar nada. Al salir de esta pantalla se envía [2100].
          </p>
        </div>
        {!ready && <Notice>Conéctate al módulo para entrar.</Notice>}
        <div className="row-actions">
          <button type="button" className="btn btn-danger" disabled={!ready} onClick={() => setEntered(true)}>
            {conn.status === 'connecting' ? <Spinner /> : <Icon name="wrench" size={18} />}
            Entiendo, entrar
          </button>
          <button type="button" className="btn" onClick={onExit}>
            Volver
          </button>
        </div>
      </Card>
    );
  }

  return <FactoryPanel />;
}
