import { useState } from 'react';
import { COLOR_ZONES, MODULE_PALETTE, POWER_MODES, RGB_MODE_GROUPS } from '../../protocol/zycela/catalog';
import type { ColorZone, PowerMode } from '../../protocol/zycela/commands';
import { zoneColor } from '../../protocol/zycela/state';
import { MAX_FAVORITES } from '../../state/storage';
import { useAppData, useController, useDevice, useReady } from '../AppContext';
import { ColorWheel } from '../ColorWheel';
import { Card, ChipGroup, Segmented, Slider, Swatch } from '../controls';
import { ConnectPanel } from '../connection';
import { Icon } from '../Icon';
import { SequenceEditor } from '../SequenceEditor';

const DEFAULT_COLOR = '#ff6a00';

export function ColorTab() {
  const controller = useController();
  const device = useDevice();
  const ready = useReady();
  const [data, update] = useAppData();
  const [zone, setZone] = useState<ColorZone>(0);
  const [editFavorites, setEditFavorites] = useState(false);
  const current = zoneColor(device, zone) ?? DEFAULT_COLOR;
  const [live, setLive] = useState<string | null>(null);
  const shown = live ?? current;

  const sendColor = (hex: string) => {
    setLive(null);
    controller.run((d) => d.setColor(zone, hex));
  };

  const addFavorite = () => {
    const hex = shown.toLowerCase();
    if (data.favorites.includes(hex)) {
      controller.toast('Ese color ya está en favoritos');
      return;
    }
    if (data.favorites.length >= MAX_FAVORITES) {
      controller.toast(`Máximo ${MAX_FAVORITES} favoritos. Borra alguno primero.`, 'warning');
      return;
    }
    update((d) => ({ ...d, favorites: [...d.favorites, hex] }));
  };

  return (
    <>
      {!ready && <ConnectPanel />}
      <fieldset className="controls" disabled={!ready}>
        <legend className="sr-only">Controles de color</legend>
        <Card title="Encendido" icon="power">
          <Segmented<number>
            label="Encendido"
            options={POWER_MODES}
            value={device.power}
            onChange={(v) => controller.run((d) => d.setPower(v as PowerMode))}
          />
          <p className="hint">«Seguir luces del coche» enciende el ambiente solo con las luces del coche encendidas.</p>
        </Card>

        <Card title="Color" icon="color">
          <Segmented<number> label="Zona" options={COLOR_ZONES} value={zone} onChange={(v) => setZone(v as ColorZone)} />
          <ColorWheel
            color={current}
            disabled={!ready}
            onChange={(hex) => {
              setLive(hex);
              controller.run((d) => d.setColorLive(zone, hex));
            }}
            onCommit={(hex) => {
              controller.run((d) => {
                d.setColorLive(zone, hex);
                return d.flushColor();
              });
              setLive(null);
            }}
          />
          <h3 className="sub-title">Colores del módulo</h3>
          <div className="swatches">
            {MODULE_PALETTE.map((color) => (
              <Swatch
                key={color.index}
                hex={color.hex}
                label={color.name}
                selected={shown.toLowerCase() === color.hex}
                onClick={() => sendColor(color.hex)}
              />
            ))}
          </div>
          <div className="sub-head">
            <h3 className="sub-title">Favoritos</h3>
            {data.favorites.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                aria-pressed={editFavorites}
                onClick={() => setEditFavorites(!editFavorites)}
              >
                {editFavorites ? 'Hecho' : 'Editar'}
              </button>
            )}
          </div>
          <div className="swatches">
            {data.favorites.map((hex) => (
              <Swatch
                key={hex}
                hex={hex}
                label={editFavorites ? `Quitar ${hex} de favoritos` : `Favorito ${hex}`}
                selected={!editFavorites && shown.toLowerCase() === hex}
                onClick={() =>
                  editFavorites
                    ? update((d) => ({ ...d, favorites: d.favorites.filter((f) => f !== hex) }))
                    : sendColor(hex)
                }
                badge={editFavorites ? <span className="swatch-badge"><Icon name="close" size={14} /></span> : undefined}
              />
            ))}
            {!editFavorites && (
              <button type="button" className="swatch swatch-add" aria-label="Añadir el color actual a favoritos" onClick={addFavorite}>
                <Icon name="plus" />
              </button>
            )}
          </div>
          {data.favorites.length === 0 && <p className="hint">Toca + para guardar el color actual.</p>}
        </Card>

        <Card
          title="Modos RGB"
          icon="effects"
          subtitle={device.rgbCustomEnabled ? 'La secuencia personalizada está activa: elige un modo para volver a los modos.' : undefined}
        >
          {RGB_MODE_GROUPS.map((group) => (
            <ChipGroup
              key={group.name}
              title={group.name}
              items={group.items}
              value={device.rgbCustomEnabled ? null : device.rgbMode}
              onSelect={(id) => controller.run((d) => d.setRgbMode(id))}
            />
          ))}
          <Slider
            label="Velocidad"
            min={1}
            max={10}
            value={device.rgbSpeed}
            onChange={(v) => controller.run((d) => d.setRgbSpeed(v))}
          />
        </Card>

        <Card title="Secuencia personalizada" icon="sliders">
          <SequenceEditor
            label="la secuencia RGB"
            slots={device.rgbSequence}
            enabled={device.rgbCustomEnabled}
            disabled={!ready}
            onToggle={(on) => controller.run((d) => d.setRgbCustomEnabled(on))}
            onChange={(slots) => controller.run((d) => d.setRgbCustomSequence(slots))}
          />
        </Card>
      </fieldset>
    </>
  );
}
