import { DIRECTIONS, FIRMWARE_NAMES, effectGroups } from '../../protocol/zycela/catalog';
import type { BinaryValue } from '../../protocol/zycela/commands';
import { useController, useDevice, useReady } from '../AppContext';
import { Card, ChipGroup, Field, Segmented, Slider } from '../controls';
import { DisconnectedNotice } from '../connection';
import { SequenceEditor } from '../SequenceEditor';

const VARIANTS = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: String(id) }));

export function EffectsTab() {
  const controller = useController();
  const device = useDevice();
  const ready = useReady();
  const groups = effectGroups(device.firmware);
  const customOn = device.effectCustomEnabled === true;

  return (
    <>
      <DisconnectedNotice />
      <fieldset className="controls" disabled={!ready}>
        <legend className="sr-only">Efectos dinámicos</legend>
        <Card
          title="Efectos dinámicos"
          icon="effects"
          subtitle={
            device.firmware
              ? `Firmware: ${FIRMWARE_NAMES[device.firmware]}.`
              : 'Para las tiras de efectos («流水»). La lista depende del firmware del módulo.'
          }
        >
          {groups.map((group) => (
            <ChipGroup
              key={group.name}
              title={group.name}
              items={group.items}
              value={customOn ? null : device.effect}
              onSelect={(id) => controller.run((d) => d.setEffect(id))}
            />
          ))}
        </Card>

        <Card title="Ajustes del efecto" icon="sliders">
          <Field label="Variante" value={device.effectVariant ?? '–'}>
            <Segmented<number>
              label="Variante del efecto"
              options={VARIANTS}
              value={customOn ? null : device.effectVariant}
              onChange={(v) => controller.run((d) => d.setEffectVariant(v))}
              compact
            />
          </Field>
          <p className="hint">El módulo no informa de la variante: se marca la última que elijas.</p>
          <Slider
            label="Velocidad"
            min={1}
            max={5}
            value={device.effectSpeed}
            onChange={(v) => controller.run((d) => d.setEffectSpeed(v))}
          />
          <Field label="Dirección">
            <Segmented<number>
              label="Dirección"
              options={DIRECTIONS}
              value={device.effectDirection}
              onChange={(v) => controller.run((d) => d.setEffectDirection(v as BinaryValue))}
            />
          </Field>
        </Card>

        <Card title="Secuencia personalizada" icon="sliders">
          <SequenceEditor
            label="la secuencia de efectos"
            slots={device.effectSequence}
            enabled={device.effectCustomEnabled}
            disabled={!ready}
            onToggle={(on) => controller.run((d) => d.setEffectCustomEnabled(on))}
            onChange={(slots) => controller.run((d) => d.setEffectCustomSequence(slots))}
          >
            <Slider
              label="Longitud del segmento"
              min={1}
              max={9}
              value={device.effectCustomLength}
              disabled={!customOn}
              onChange={(v) => controller.run((d) => d.setEffectCustomLength(v))}
            />
            <Slider
              label="Separación entre segmentos"
              min={1}
              max={9}
              value={device.effectCustomGap}
              disabled={!customOn}
              onChange={(v) => controller.run((d) => d.setEffectCustomGap(v))}
            />
          </SequenceEditor>
        </Card>
      </fieldset>
    </>
  );
}
