import { useEffect, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ApiError, get } from '../api';
import { useApp } from '../state';

export function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    get<T>(path).then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e instanceof ApiError ? e : new ApiError(0, 'generic')); })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { data, error, loading, reload: () => setTick((x) => x + 1), setData };
}

export function ErrorMsg({ error }: { error: unknown }) {
  const { t } = useApp();
  if (!error) return null;
  const code = error instanceof ApiError ? error.code : 'generic';
  const k = `err.${code}`;
  const msg = t(k) === k ? t('err.generic') : t(k);
  return <div className="alert alert-error" role="alert">{msg}</div>;
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'ok' | 'error'; children: ReactNode }) {
  return <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Loading() { const { t } = useApp(); return <p className="muted">{t('loading')}</p>; }

type FieldProps = { label: string; hint?: string; children: ReactNode; required?: boolean };
export function Field({ label, hint, children, required }: FieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}{required && <span className="req" aria-hidden> *</span>}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} />;

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && <header className="card-head">{title && <h2>{title}</h2>}{actions && <div className="card-actions">{actions}</div>}</header>}
      {children}
    </section>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useApp();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="card-head"><h2>{title}</h2><button className="btn ghost" onClick={onClose} aria-label={t('close')}>✕</button></header>
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return <div className="stat"><div className="stat-value">{value}</div><div className="stat-label">{label}</div>{sub && <div className="stat-sub">{sub}</div>}</div>;
}

export function Badge({ kind = 'neutral', children }: { kind?: 'neutral' | 'ok' | 'warn' | 'error' | 'info'; children: ReactNode }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

/** Formulaire générique : gère soumission, erreur et état « en cours ». */
export function useSubmit<A extends unknown[]>(fn: (...a: A) => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (...a: A) => {
    setBusy(true); setError(null);
    try { await fn(...a); return true; } catch (e) { setError(e); return false; } finally { setBusy(false); }
  };
  return { busy, error, run, setError };
}

export const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
export const strOrNull = (v: string) => (v.trim() === '' ? null : v.trim());

export function downloadUrl(url: string) {
  const a = document.createElement('a'); a.href = url; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
}
