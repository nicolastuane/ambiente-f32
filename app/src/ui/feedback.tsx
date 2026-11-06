/** Toasts and confirmation dialogs. */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useController, useToasts } from './AppContext';
import { Icon } from './Icon';
import { DANGER_ARM_MS } from './safety';

export function Toasts() {
  const toasts = useToasts();
  const controller = useController();
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          <span>{toast.text}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="Cerrar aviso"
            onClick={() => controller.dismissToast(toast.id)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** When set, the confirm button stays disabled until this checkbox is ticked. */
  acknowledge?: string;
  /**
   * The confirm button stays disabled this long after the dialog opens, so a
   * double tap on the button underneath cannot confirm it. Default: 500 ms
   * for danger dialogs, 0 otherwise.
   */
  armDelayMs?: number;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return fn;
}

interface Pending extends ConfirmOptions {
  id: number;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const seq = useRef(0);
  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, id: ++seq.current, resolve });
      }),
    [],
  );
  const close = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {/* Keyed: a follow-up confirmation is a fresh dialog (checkbox, focus and arming reset). */}
      {pending && <ConfirmDialog key={pending.id} options={pending} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: (value: boolean) => void }) {
  const titleId = useId();
  const [checked, setChecked] = useState(false);
  const armMs = options.armDelayMs ?? (options.danger ? DANGER_ARM_MS : 0);
  const [armedIn, setArmedIn] = useState(armMs);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Counts down in whole seconds (visible for long delays), then arms the button.
  useEffect(() => {
    if (armedIn <= 0) return;
    const step = Math.min(armedIn, 1000);
    const timer = setTimeout(() => setArmedIn((ms) => Math.max(0, ms - step)), step);
    return () => clearTimeout(timer);
  }, [armedIn]);
  const armed = armedIn <= 0;
  const countdown = !armed && armMs >= 1000 ? ` (${Math.ceil(armedIn / 1000)})` : '';

  return (
    <div className="dialog-backdrop" onClick={() => onClose(false)}>
      <div
        className={options.danger ? 'dialog dialog-danger' : 'dialog'}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>
          {options.danger && <Icon name="warning" size={22} />}
          {options.title}
        </h2>
        <div className="dialog-body">{options.message}</div>
        {options.acknowledge && (
          <label className="ack">
            <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
            <span>{options.acknowledge}</span>
          </label>
        )}
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={() => onClose(false)}>
            {options.cancelLabel ?? 'Cancelar'}
          </button>
          <button
            type="button"
            className={options.danger ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={!armed || (!!options.acknowledge && !checked)}
            onClick={() => onClose(true)}
          >
            {(options.confirmLabel ?? 'Aceptar') + countdown}
          </button>
        </div>
      </div>
    </div>
  );
}
