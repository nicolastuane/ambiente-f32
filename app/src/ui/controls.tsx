/** Reusable form controls: all touch targets are at least 44 px. */
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Option } from '../protocol/zycela/catalog';
import { readableOn } from '../util/color';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export function Card({
  title,
  icon,
  subtitle,
  actions,
  children,
  className,
}: {
  title: string;
  icon?: IconName;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section className={className ? `card ${className}` : 'card'} aria-labelledby={id}>
      <div className="card-head">
        <h2 id={id}>
          {icon && <Icon name={icon} size={20} />}
          {title}
        </h2>
        {actions && <div className="card-actions">{actions}</div>}
      </div>
      {subtitle && <p className="card-sub">{subtitle}</p>}
      {children}
    </section>
  );
}

export function Field({ label, value, children }: { label: string; value?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">
        <span>{label}</span>
        {value !== undefined && <span className="field-value">{value}</span>}
      </div>
      {children}
    </div>
  );
}

export function Segmented<T extends number | string>({
  label,
  options,
  value,
  onChange,
  disabled,
  compact,
}: {
  label: string;
  options: readonly Option<T>[];
  value: T | null | undefined;
  onChange: (value: T) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'seg seg-compact' : 'seg'} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const checked = option.id === value;
        return (
          <button
            key={String(option.id)}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(option.id)}
          >
            {option.name}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
  disabledReason,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean | null | undefined;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const off = disabled || !!disabledReason;
  const labelId = useId();
  const descId = useId();
  const hasDesc = !!disabledReason || !!description;
  return (
    <button
      type="button"
      role="switch"
      className="switch-row"
      aria-checked={!!checked}
      aria-labelledby={labelId}
      aria-describedby={hasDesc ? descId : undefined}
      disabled={off}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-text">
        <span className="switch-label" id={labelId}>
          {label}
        </span>
        {disabledReason ? (
          <span className="switch-desc switch-reason" id={descId}>
            {disabledReason}
          </span>
        ) : (
          description && (
            <span className="switch-desc" id={descId}>
              {description}
            </span>
          )
        )}
      </span>
      <span className={checked === null || checked === undefined ? 'switch unknown' : 'switch'} aria-hidden="true" />
    </button>
  );
}

/**
 * Range slider that reports every integer step. While the user drags, the
 * local value wins over the device value so late frames do not make the
 * thumb jump back.
 */
export function Slider({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
  format,
}: {
  label: string;
  value: number | null | undefined;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  format?: (value: number) => string;
}) {
  const id = useId();
  const [local, setLocal] = useState<number | null>(null);
  const release = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef<number | null>(null);

  useEffect(() => () => {
    if (release.current) clearTimeout(release.current);
  }, []);

  const known = value !== null && value !== undefined;
  const shown = local ?? (known ? value : null);
  const position = shown ?? min;
  const pct = max > min ? ((position - min) / (max - min)) * 100 : 0;

  const settle = () => {
    if (release.current) clearTimeout(release.current);
    release.current = setTimeout(() => {
      setLocal(null);
      last.current = null;
    }, 900);
  };

  return (
    <div className="field">
      <div className="field-label">
        <label htmlFor={id}>{label}</label>
        <span className="field-value" aria-hidden="true">
          {shown === null ? '–' : format ? format(shown) : shown}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={position}
        disabled={disabled}
        className={known || local !== null ? undefined : 'unknown'}
        style={{ ['--pct' as string]: `${pct}%` }}
        aria-valuetext={shown === null ? 'Desconocido' : format ? format(shown) : String(shown)}
        onChange={(event) => {
          const next = Number(event.target.value);
          setLocal(next);
          if (next !== last.current && next !== value) {
            last.current = next;
            onChange(next);
          } else {
            last.current = next;
          }
          settle();
        }}
        onPointerUp={settle}
        onBlur={settle}
      />
    </div>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string;
  value: number | null | undefined;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string>('');
  const known = value !== null && value !== undefined;
  useEffect(() => setDraft(known ? String(value) : ''), [value, known]);

  const commit = (next: number) => {
    if (!known) return; // never write a guess: the module has not reported its value yet
    const clamped = Math.max(min, Math.min(max, Math.round(next)));
    if (!Number.isFinite(clamped)) return;
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };
  // Until the module reports the current value, a "+1" would really send `min`.
  const off = disabled || !known;
  const hintId = useId();

  return (
    <div className="stepper">
      <label htmlFor={id} className="stepper-label">
        {label}
        <span className="stepper-range">
          {min}–{max}
        </span>
        {!known && !disabled && (
          <span className="stepper-range" id={hintId}>
            Esperando el valor del módulo…
          </span>
        )}
      </label>
      <div className="stepper-controls">
        <button
          type="button"
          className="btn btn-icon"
          aria-label={`Restar 1 a ${label}`}
          disabled={off || (known && value <= min)}
          onClick={() => known && commit(value - 1)}
        >
          −
        </button>
        <input
          id={id}
          className="stepper-input"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft}
          placeholder="–"
          disabled={off}
          aria-describedby={!known && !disabled ? hintId : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft.trim() === '') return setDraft(known ? String(value) : '');
            const n = Number(draft);
            if (Number.isFinite(n)) commit(n);
            else setDraft(known ? String(value) : '');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
        />
        <button
          type="button"
          className="btn btn-icon"
          aria-label={`Sumar 1 a ${label}`}
          disabled={off || (known && value >= max)}
          onClick={() => known && commit(value + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function ChipGroup({
  title,
  items,
  value,
  onSelect,
  disabled,
}: {
  title?: string;
  items: readonly Option[];
  value: number | null | undefined;
  onSelect: (id: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="chip-group" role="group" aria-labelledby={title ? id : undefined}>
      {title && (
        <h3 className="chip-title" id={id}>
          {title}
        </h3>
      )}
      <div className="chips">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="chip"
            aria-pressed={item.id === value}
            disabled={disabled}
            onClick={() => onSelect(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Swatch({
  hex,
  label,
  selected,
  onClick,
  disabled,
  badge,
}: {
  hex: string;
  label: string;
  selected?: boolean;
  onClick: () => void;
  disabled?: boolean;
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="swatch"
      style={{ background: hex, color: readableOn(hex) }}
      aria-label={label}
      title={label}
      aria-pressed={!!selected}
      disabled={disabled}
      onClick={onClick}
    >
      {selected && <Icon name="check" size={18} />}
      {badge}
    </button>
  );
}

export function Notice({
  kind = 'info',
  children,
  title,
}: {
  kind?: 'info' | 'warning' | 'danger' | 'success';
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'danger' ? 'alert' : undefined}>
      <Icon name={kind === 'info' || kind === 'success' ? 'info' : 'warning'} size={20} />
      <div>
        {title && <strong className="notice-title">{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'status' : undefined} aria-label={label} />;
}
