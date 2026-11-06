import { useEffect, useRef, useState } from 'react';
import {
  BLIND_SPOT_COLORS,
  CAR_EVENTS,
  DOOR_COLORS,
  KEY_FUNCTIONS,
  MODULE_PALETTE,
  SOUND_SOURCES,
  TURN_COLORS,
  WELCOME_MODES,
} from '../../protocol/zycela/catalog';
import type { ColorChoice } from '../../protocol/zycela/catalog';
import type { BinaryValue } from '../../protocol/zycela/commands';
import type { KeyLearnOutcome } from '../../protocol/zycela/driver';
import { isUnsupported } from '../../protocol/zycela/state';
import { useController, useDevice, useReady } from '../AppContext';
import { Card, ChipGroup, Field, Notice, Segmented, Slider, Spinner, Swatch, Toggle } from '../controls';
import { DisconnectedNotice } from '../connection';

function ColorChoices({
  label,
  choices,
  value,
  onSelect,
}: {
  label: string;
  choices: readonly ColorChoice[];
  value: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <Field label={label} value={value === null ? '–' : choices.find((c) => c.id === value)?.name}>
      <div className="swatches swatches-row">
        {choices.map((c) => (
          <Swatch key={c.id} hex={c.hex} label={`${label}: ${c.name}`} selected={value === c.id} onClick={() => onSelect(c.id)} />
        ))}
      </div>
    </Field>
  );
}

const LEARN_SECONDS = 20;

const OUTCOME_TEXT: Record<KeyLearnOutcome, string> = {
  learned: 'Botón aprendido. Ya puedes usarlo.',
  failed: 'El módulo no pudo aprender el botón. Inténtalo otra vez.',
  unsupported: 'Tu módulo o tu coche no admiten esta función.',
  timeout: 'No llegó respuesta en 20 segundos. ¿Pulsaste el botón?',
  cancelled: 'Aprendizaje cancelado.',
};

function KeyLearning({ ready }: { ready: boolean }) {
  const controller = useController();
  const [fn, setFn] = useState(1);
  const [learning, setLearning] = useState(false);
  const [remaining, setRemaining] = useState(LEARN_SECONDS);
  const [outcome, setOutcome] = useState<KeyLearnOutcome | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!learning) return;
    setRemaining(LEARN_SECONDS);
    const timer = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(timer);
  }, [learning]);

  useEffect(() => () => abort.current?.abort(), []);

  const start = () => {
    const ac = new AbortController();
    abort.current = ac;
    setOutcome(null);
    setLearning(true);
    controller.driver
      .learnKey(fn, { timeoutMs: LEARN_SECONDS * 1000, signal: ac.signal })
      .then((result) => setOutcome(result))
      .catch((error: unknown) => controller.reportError(error))
      .finally(() => {
        setLearning(false);
        abort.current = null;
      });
  };

  return (
    <>
      <p className="card-sub">
        Asigna un botón del volante o de la radio a una de estas funciones. El botón no guarda un color fijo: ejecuta la
        función (por ejemplo, «Modo / color +» pasa al siguiente color o modo).
      </p>
      <ChipGroup items={KEY_FUNCTIONS} value={fn} onSelect={setFn} disabled={learning || !ready} />
      {learning ? (
        <div className="learn-box" role="status" aria-live="assertive">
          <Spinner />
          <div>
            <strong>Pulsa ahora el botón del volante</strong>
            <span className="hint">Esperando respuesta del módulo… {remaining} s</span>
          </div>
          <button type="button" className="btn" onClick={() => abort.current?.abort()}>
            Cancelar
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary btn-wide" disabled={!ready} onClick={start}>
          Aprender «{KEY_FUNCTIONS.find((k) => k.id === fn)?.name}»
        </button>
      )}
      {outcome && !learning && (
        <Notice kind={outcome === 'learned' ? 'success' : 'warning'}>{OUTCOME_TEXT[outcome]}</Notice>
      )}
      <p className="hint">Durante el aprendizaje el módulo entra un momento en modo fábrica y sale al terminar.</p>
    </>
  );
}

export function CarTab() {
  const controller = useController();
  const device = useDevice();
  const ready = useReady();

  return (
    <>
      <DisconnectedNotice />
      <fieldset className="controls" disabled={!ready}>
        <legend className="sr-only">Funciones del coche</legend>
        <Card title="Bienvenida" icon="welcome" subtitle="Animación al abrir el coche.">
          <Toggle
            label="Bienvenida"
            checked={device.welcomeEnabled}
            onChange={(on) => controller.run((d) => d.setWelcomeEnabled(on))}
          />
          <ChipGroup
            title="Animación"
            items={WELCOME_MODES}
            value={device.welcomeMode}
            onSelect={(id) => controller.run((d) => d.setWelcomeMode(id))}
          />
          <h3 className="chip-title">Color</h3>
          <div className="swatches">
            {MODULE_PALETTE.map((color) => (
              <Swatch
                key={color.index}
                hex={color.hex}
                label={`Bienvenida en ${color.name}`}
                selected={device.welcomeSync !== true && device.welcomeColor === color.index}
                onClick={() => controller.run((d) => d.setWelcomeColor(color.index))}
              />
            ))}
          </div>
          {/* Like the mini-program: the option only exists when frame 26 says the firmware offers it. */}
          {(device.welcomeSyncAvailable === true || device.welcomeSync === true) && (
            <button
              type="button"
              className="chip chip-wide"
              aria-pressed={device.welcomeSync === true}
              onClick={() => controller.run((d) => d.syncWelcomeWithRgb())}
            >
              Sincronizar con RGB
            </button>
          )}
        </Card>

        <Card title="Avisos" icon="bell" subtitle="Las luces reaccionan a lo que pasa en el coche.">
          {CAR_EVENTS.map((event) => {
            const value = device.events[event.key];
            return (
              <Toggle
                key={event.key}
                label={event.name}
                description={event.description}
                checked={value === null ? null : value === 1}
                disabledReason={isUnsupported(value) ? 'Tu coche no lo admite' : undefined}
                onChange={(on) => controller.run((d) => d.setCarEvent(event.key, on))}
              />
            );
          })}
        </Card>

        <Card title="Colores de aviso" icon="color" subtitle="El módulo no informa de estos colores: se marca el último que elijas.">
          <ColorChoices
            label="Puerta abierta"
            choices={DOOR_COLORS}
            value={device.doorColor}
            onSelect={(id) => controller.run((d) => d.setDoorColor(id))}
          />
          <ColorChoices
            label="Intermitente"
            choices={TURN_COLORS}
            value={device.turnColor}
            onSelect={(id) => controller.run((d) => d.setTurnColor(id))}
          />
          <ColorChoices
            label="Ángulo muerto"
            choices={BLIND_SPOT_COLORS}
            value={device.blindSpotColor}
            onSelect={(id) => controller.run((d) => d.setBlindSpotColor(id))}
          />
        </Card>

        <Card title="Música" icon="music" subtitle="Para los modos de ritmo musical.">
          <Slider
            label="Sensibilidad"
            min={0}
            max={9}
            value={device.soundSensitivity}
            onChange={(v) => controller.run((d) => d.setSoundSensitivity(v))}
          />
          <Field label="Fuente del sonido">
            <Segmented<number>
              label="Fuente del sonido"
              options={SOUND_SOURCES}
              value={device.soundSource}
              onChange={(v) => controller.run((d) => d.setSoundSource(v as BinaryValue))}
            />
          </Field>
        </Card>

        <Card title="Botones del volante" icon="steering">
          <KeyLearning ready={ready} />
        </Card>
      </fieldset>
    </>
  );
}
