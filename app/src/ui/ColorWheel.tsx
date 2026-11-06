/**
 * Touch-friendly colour picker: a hue ring (drag anywhere on it) plus a
 * saturation slider, with a live preview in the centre. Brightness is not
 * part of the colour: the module has its own brightness sliders.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { hexToHsv, hsvToHex, readableOn } from '../util/color';

interface Props {
  color: string;
  /** Called continuously while dragging. */
  onChange: (hex: string) => void;
  /** Called when the gesture ends (send the final value now). */
  onCommit: (hex: string) => void;
  disabled?: boolean;
}

const RING_RATIO = 0.17; // ring thickness relative to the wheel size

function drawRing(canvas: HTMLCanvasElement) {
  const size = canvas.clientWidth || 280;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const c = size / 2;
  const thickness = size * RING_RATIO;
  const radius = c - thickness / 2 - 1;
  ctx.lineWidth = thickness;
  for (let deg = 0; deg < 360; deg++) {
    const a0 = ((deg - 90 - 0.6) * Math.PI) / 180;
    const a1 = ((deg - 90 + 0.6) * Math.PI) / 180;
    ctx.beginPath();
    ctx.strokeStyle = `hsl(${deg}, 100%, 50%)`;
    ctx.arc(c, c, radius, a0, a1);
    ctx.stroke();
  }
}

export function ColorWheel({ color, onChange, onCommit, disabled }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const [hue, setHue] = useState(() => hexToHsv(color)?.h ?? 25);
  const [sat, setSat] = useState(() => hexToHsv(color)?.s ?? 1);
  const hex = hsvToHex({ h: hue, s: sat, v: 1 });
  const hexRef = useRef(hex);
  hexRef.current = hex;

  // Follow the device colour when the user is not interacting.
  useEffect(() => {
    if (dragging.current) return;
    const hsv = hexToHsv(color);
    if (!hsv || color.toLowerCase() === hexRef.current) return;
    if (hsv.s > 0.02) setHue(hsv.h);
    setSat(hsv.s);
  }, [color]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawRing(canvas);
    const redraw = () => drawRing(canvas);
    window.addEventListener('resize', redraw);
    return () => window.removeEventListener('resize', redraw);
  }, []);

  const hueFromPointer = useCallback((event: PointerEvent<HTMLDivElement>): number | null => {
    const el = wrapRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return (deg + 360) % 360;
  }, []);

  const update = (h: number, s: number) => {
    setHue(h);
    setSat(s);
    onChange(hsvToHex({ h, s, v: 1 }));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dist = Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
    if (dist < rect.width * 0.24) return; // the centre is the preview, not the ring
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    dragging.current = true;
    const h = hueFromPointer(event);
    if (h !== null) update(h, sat < 0.05 ? 1 : sat);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const h = hueFromPointer(event);
    if (h !== null) update(h, sat);
  };

  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      wrapRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
    onCommit(hexRef.current);
  };

  /** End of a saturation drag, however it ends; commits only once. */
  const endSatDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onCommit(hexRef.current);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? 15 : 5;
    let h = hue;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') h = (hue + step) % 360;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') h = (hue - step + 360) % 360;
    else return;
    event.preventDefault();
    update(h, sat);
    onCommit(hsvToHex({ h, s: sat, v: 1 }));
  };

  const angle = ((hue - 90) * Math.PI) / 180;
  const ringMid = 0.5 - RING_RATIO / 2;
  const thumbX = 50 + ringMid * 100 * Math.cos(angle);
  const thumbY = 50 + ringMid * 100 * Math.sin(angle);
  const pureHue = hsvToHex({ h: hue, s: 1, v: 1 });

  return (
    <div className="wheel-block">
      <div
        ref={wrapRef}
        className={disabled ? 'wheel disabled' : 'wheel'}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Tono del color"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(hue)}
        aria-valuetext={`Tono ${Math.round(hue)} grados, ${hex}`}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
      >
        <canvas ref={canvasRef} aria-hidden="true" />
        <span className="wheel-thumb" style={{ left: `${thumbX}%`, top: `${thumbY}%`, background: pureHue }} />
        <span className="wheel-center" style={{ background: hex, color: readableOn(hex), ['--c' as string]: hex }}>
          <span className="wheel-hex">{hex.toUpperCase()}</span>
        </span>
      </div>
      <div className="field">
        <div className="field-label">
          <label htmlFor="wheel-sat">Saturación</label>
          <span className="field-value">{Math.round(sat * 100)}%</span>
        </div>
        <input
          id="wheel-sat"
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(sat * 100)}
          disabled={disabled}
          className="sat-range"
          style={{ ['--hue' as string]: pureHue, ['--pct' as string]: `${Math.round(sat * 100)}%` }}
          onPointerDown={() => {
            dragging.current = true;
          }}
          onChange={(event) => update(hue, Number(event.target.value) / 100)}
          onPointerUp={endSatDrag}
          // A vertical swipe that starts on the slider scrolls the page
          // (touch-action: pan-y) and ends with pointercancel, not pointerup.
          onPointerCancel={endSatDrag}
          onLostPointerCapture={endSatDrag}
          onTouchEnd={endSatDrag}
          onTouchCancel={endSatDrag}
          onKeyUp={() => onCommit(hexRef.current)}
          onBlur={() => {
            dragging.current = false;
          }}
        />
      </div>
    </div>
  );
}
