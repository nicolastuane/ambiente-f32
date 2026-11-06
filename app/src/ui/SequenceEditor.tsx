/** Editor for the 8-slot custom colour sequences ([2A]/[3A]). */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { MODULE_PALETTE } from '../protocol/zycela/catalog';
import { SEQUENCE_LENGTH } from '../protocol/zycela/commands';
import type { Slot } from '../protocol/zycela/commands';
import { Swatch, Toggle } from './controls';
import { Icon } from './Icon';

const EMPTY: Slot[] = new Array<Slot>(SEQUENCE_LENGTH).fill(null);

export function SequenceEditor({
  label,
  slots,
  enabled,
  onToggle,
  onChange,
  disabled,
  children,
}: {
  label: string;
  slots: Slot[] | null;
  enabled: boolean | null;
  onToggle: (on: boolean) => void;
  onChange: (slots: Slot[]) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const [selected, setSelected] = useState(0);
  // "Borrar todo" only clears the screen, like the mini-program: it never
  // sends an all-empty sequence (untested on the module). The cleared view is
  // sent with the first colour assigned afterwards.
  const [cleared, setCleared] = useState(false);
  const fromDevice = slots && slots.length === SEQUENCE_LENGTH ? slots : EMPTY;
  const current = cleared ? EMPTY : fromDevice;
  const editable = !disabled && enabled === true;

  const assign = (value: Slot) => {
    const next = [...current];
    next[selected] = value;
    if (next.every((slot) => slot === null)) {
      setCleared(true); // emptying the last slot: same as "Borrar todo"
      return;
    }
    onChange(next);
    setCleared(false);
    if (value !== null) setSelected((selected + 1) % SEQUENCE_LENGTH);
  };

  return (
    <div className="sequence">
      <Toggle
        label={`Usar ${label}`}
        description="Las luces recorren los colores de las casillas en orden."
        checked={enabled}
        onChange={onToggle}
        disabled={disabled}
      />
      <div className="slots" role="group" aria-label={`Casillas de ${label}`}>
        {current.map((slot, index) => {
          const color = slot === null ? undefined : MODULE_PALETTE[slot];
          return (
            <button
              key={index}
              type="button"
              className={color ? 'slot' : 'slot empty'}
              style={color ? { background: color.hex } : undefined}
              aria-pressed={selected === index}
              aria-label={`Casilla ${index + 1}: ${color ? color.name : 'vacía'}`}
              disabled={!editable}
              onClick={() => setSelected(index)}
            >
              <span className="slot-num">{index + 1}</span>
            </button>
          );
        })}
      </div>
      {!editable && !disabled && <p className="hint">Activa la secuencia para editar las casillas.</p>}
      <p className="hint">Toca una casilla y después un color. La casilla seleccionada avanza sola.</p>
      <div className="swatches swatches-small">
        {MODULE_PALETTE.map((color) => (
          <Swatch
            key={color.index}
            hex={color.hex}
            label={`Poner ${color.name} en la casilla ${selected + 1}`}
            disabled={!editable}
            onClick={() => assign(color.index)}
          />
        ))}
      </div>
      <div className="row-actions">
        <button type="button" className="btn" disabled={!editable} onClick={() => assign(null)}>
          Vaciar casilla {selected + 1}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!editable}
          onClick={() => {
            setCleared(true);
            setSelected(0);
          }}
        >
          <Icon name="trash" size={18} />
          Borrar todo
        </button>
      </div>
      {cleared && (
        <p className="hint">
          Casillas vaciadas solo en pantalla: el módulo sigue con la secuencia anterior hasta que pongas el primer color.
        </p>
      )}
      {children}
    </div>
  );
}
