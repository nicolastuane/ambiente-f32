import { CONTROL_METHODS, ZONINGS, brightnessLabels } from '../../protocol/zycela/catalog';
import type { BinaryValue } from '../../protocol/zycela/commands';
import { useController, useDevice, useReady } from '../AppContext';
import { Card, Field, Segmented, Slider, Toggle } from '../controls';
import { DisconnectedNotice } from '../connection';

export function BrightnessTab() {
  const controller = useController();
  const device = useDevice();
  const ready = useReady();
  const [label1, label2, label3] = brightnessLabels(device.zoning);

  return (
    <>
      <DisconnectedNotice />
      <fieldset className="controls" disabled={!ready}>
        <legend className="sr-only">Brillo</legend>
        <Card title="Brillo" icon="brightness" subtitle="0 = apagado, 9 = máximo.">
          <Slider
            label={label1}
            min={0}
            max={9}
            value={device.brightness.b1}
            onChange={(v) => controller.run((d) => d.setBrightness(1, v))}
          />
          <Slider
            label={label2}
            min={0}
            max={9}
            value={device.brightness.b2}
            onChange={(v) => controller.run((d) => d.setBrightness(2, v))}
          />
          <Slider
            label={label3}
            min={0}
            max={9}
            value={device.brightness.b3}
            onChange={(v) => controller.run((d) => d.setBrightness(3, v))}
          />
        </Card>

        <Card
          title="Zonas de brillo"
          icon="sliders"
          subtitle="Cómo se agrupan las tiras en los dos primeros deslizadores: «Arriba / abajo» (Global y Contorno) o «Delante / detrás» (Consola central y Puertas)."
        >
          <Segmented<number>
            label="Zonas de brillo"
            options={ZONINGS}
            value={device.zoning}
            onChange={(v) => controller.run((d) => d.setZoning(v as BinaryValue))}
          />
        </Card>

        <Card title="De noche" icon="brightness">
          <Toggle
            label="Consola central a mitad de brillo"
            description="Al circular de noche, la consola central baja a la mitad para no deslumbrar."
            checked={device.nightHalf}
            onChange={(on) => controller.run((d) => d.setNightHalf(on))}
          />
        </Card>

        <Card title="Control" icon="steering">
          <Field label="Quién manda en las luces">
            <Segmented<number>
              label="Método de control"
              options={CONTROL_METHODS}
              value={device.controlMethod}
              onChange={(v) => controller.run((d) => d.setControlMethod(v as BinaryValue))}
            />
          </Field>
          <p className="hint">
            «Coche + móvil»: el coche y la app pueden cambiar las luces. «Solo móvil»: manda solo la app.
            {device.firmware === '1F' && ' Tu firmware no informa de este ajuste: se marca el último elegido.'}
          </p>
        </Card>
      </fieldset>
    </>
  );
}
