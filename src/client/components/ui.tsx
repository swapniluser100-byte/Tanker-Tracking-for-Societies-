import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

// ── Buttons ─────────────────────────────────────────────────────────────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warn' | 'ok';
const variants: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-dark border-primary',
  secondary: 'bg-white text-ink border-line-strong hover:bg-page',
  ghost: 'bg-transparent text-primary border-transparent hover:bg-primary-soft',
  danger: 'bg-white text-danger border-danger/40 hover:bg-danger-soft',
  warn: 'bg-warn text-white border-warn hover:bg-[#7c2a0e]',
  ok: 'bg-ok text-white border-ok hover:bg-[#0b4a44]',
};

export function Button({
  variant = 'primary', size = 'md', icon, busy, className, children, type = 'button', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: IconName; busy?: boolean }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border font-semibold transition-colors disabled:opacity-55',
        size === 'sm' && 'min-h-9 px-3 text-sm',
        size === 'md' && 'min-h-11 px-4 text-[15px]',
        size === 'lg' && 'min-h-13 px-5 text-base',
        variants[variant],
        className,
      )}
      disabled={busy || rest.disabled}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Spinner size={16} /> : icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = 'secondary', icon, className, download }: { href: string; children: ReactNode; variant?: Variant; icon?: IconName; className?: string; download?: boolean }) {
  return (
    <a
      href={href}
      download={download || undefined}
      className={cx('inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border px-4 font-semibold transition-colors', variants[variant], className)}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </a>
  );
}

// ── Layout bits ─────────────────────────────────────────────────────────────
export function Card({ children, className, title, action, as: As = 'section' }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; as?: 'section' | 'div' }) {
  return (
    <As className={cx('card p-4 sm:p-5', className)}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </As>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone = 'default', icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'warn' | 'ok'; icon?: IconName }) {
  return (
    <div className={cx('card p-4', tone === 'warn' && 'border-warn-accent/60 bg-warn-soft')}>
      <div className="flex items-center gap-2 text-sm font-medium text-muted">
        {icon && <Icon name={icon} size={18} className={tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-primary'} />}
        {label}
      </div>
      <div className={cx('mt-1.5 font-display text-2xl font-bold num', tone === 'warn' && 'text-warn')}>{value}</div>
      {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
    </div>
  );
}

// ── Status chips ────────────────────────────────────────────────────────────
const chipTones = {
  blue: 'bg-primary-soft text-primary-dark',
  green: 'bg-ok-soft text-ok',
  orange: 'bg-warn-soft text-warn',
  red: 'bg-danger-soft text-danger',
  grey: 'bg-page text-muted border border-line',
};
export function Chip({ tone = 'grey', children }: { tone?: keyof typeof chipTones; children: ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', chipTones[tone])}>{children}</span>;
}

const statusMeta: Record<string, [string, keyof typeof chipTones]> = {
  pending_approval: ['Needs approval', 'orange'],
  confirmed: ['Confirmed', 'blue'],
  on_the_way: ['On the way', 'blue'],
  delivered: ['Delivered', 'green'],
  short: ['Short', 'orange'],
  cancelled: ['Cancelled', 'grey'],
  rejected: ['Rejected', 'red'],
  open: ['Open', 'orange'],
  in_progress: ['In progress', 'blue'],
  resolved: ['Resolved', 'green'],
};
export function StatusChip({ status, shortBy }: { status: string; shortBy?: number | null }) {
  if (status === 'delivered' && shortBy && shortBy > 0) return <Chip tone="orange">Short by {shortBy.toLocaleString('en-IN')} L</Chip>;
  const [label, tone] = statusMeta[status] ?? [status, 'grey'];
  return <Chip tone={tone}>{label}</Chip>;
}

// ── Forms ───────────────────────────────────────────────────────────────────
export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string, describedBy?: string) => ReactNode; className?: string }) {
  const id = useId();
  const hintId = hint || error ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">{label}</label>
      {children(id, hintId)}
      {(hint || error) && (
        <p id={hintId} className={cx('mt-1 text-sm', error ? 'text-danger' : 'text-muted')}>{error ?? hint}</p>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex min-h-11 items-center gap-3">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-6 w-11 rounded-full bg-line-strong transition-colors peer-checked:bg-ok peer-focus-visible:ring-2 peer-focus-visible:ring-primary after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[var(--radius-control)] border border-line-strong bg-white p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('min-h-9 rounded-lg px-3 text-sm font-semibold', value === o.value ? 'bg-primary text-white' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Feedback ────────────────────────────────────────────────────────────────
export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cx('animate-spin', className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-primary" role="status">
      <Spinner size={32} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-muted" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }: { error?: { message: string } | string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-danger">
      <Icon name="alert" />
      <span className="flex-1 font-medium">{typeof error === 'string' ? error : error.message}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Empty({ children, icon = 'list' }: { children: ReactNode; icon?: IconName }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center text-muted">
      <Icon name={icon} size={28} />
      <div>{children}</div>
    </div>
  );
}

/** Horizontal fill bar for tank levels. Orange when below the alert level. */
export function FillBar({ pct, low, label }: { pct: number | null; low?: boolean; label: string }) {
  const v = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-page ring-1 ring-line" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}>
      <div className={cx('h-full rounded-full transition-[width] duration-500', low ? 'bg-warn-accent' : 'bg-primary')} style={{ width: `${v}%` }} />
    </div>
  );
}

// ── Modal (native <dialog>: focus trap + Esc handled by the browser) ────────
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      className={cx('m-auto w-[calc(100%-2rem)] rounded-[var(--radius-card)] border border-line p-0 text-ink shadow-2xl backdrop:bg-ink/40', wide ? 'max-w-2xl' : 'max-w-lg')}
      aria-labelledby="modal-title"
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-page" aria-label="Close">
              <Icon name="x" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ── Toasts ──────────────────────────────────────────────────────────────────
type Toast = { id: number; text: string; tone: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex max-w-md items-center gap-2 rounded-xl px-4 py-3 font-medium text-white shadow-lg', t.tone === 'ok' ? 'bg-ok' : 'bg-danger')}>
            <Icon name={t.tone === 'ok' ? 'check' : 'alert'} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ── Table wrapper (scrolls horizontally inside its card on small screens) ───
export function Table({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:-mx-5" tabIndex={0} role="region" aria-label={label}>
      <table className="w-full min-w-[560px] border-collapse text-sm">{children}</table>
    </div>
  );
}
