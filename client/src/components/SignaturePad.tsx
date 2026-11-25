import { useEffect, useRef, useState } from 'react';
import { post } from '../api';
import { useApp } from '../state';
import { ErrorMsg, Notice, useSubmit } from './ui';
import { Icon } from './Icon';

/** Zone de signature au doigt ou au stylet. Renvoie une image PNG (data URL) ou null si vide. */
export function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const { t } = useApp();
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = ref.current!; const r = c.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1D3557';
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const down = (e: React.PointerEvent) => { e.preventDefault(); ref.current!.setPointerCapture(e.pointerId); drawing.current = true; const [x, y] = pos(e); const ctx = ref.current!.getContext('2d')!; ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const [x, y] = pos(e); const ctx = ref.current!.getContext('2d')!; ctx.lineTo(x, y); ctx.stroke(); dirty.current = true; };
  const up = () => { if (!drawing.current) return; drawing.current = false; if (dirty.current) onChange(ref.current!.toDataURL('image/png')); };
  const clear = () => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); dirty.current = false; onChange(null); };
  return (
    <div className="stack-sm">
      <canvas ref={ref} className="sigpad" aria-label={t('signature')} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
      <div className="row between"><span className="small muted">{t('sign_here')}</span><button type="button" className="btn ghost small" onClick={clear}>{t('sign_clear')}</button></div>
    </div>
  );
}

/**
 * Signature complète : attestation, signature dessinée, code de confirmation (SMS ou courriel).
 * `codePath` envoie le code ; `onSign(png, code)` effectue la signature.
 */
export function SignFlow({ attestation, codePath, onSign, label }: { attestation: string; codePath: string; onSign: (png: string, code: string) => Promise<unknown>; label?: string }) {
  const { t } = useApp();
  const [png, setPng] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ channel: string; to: string } | null>(null);
  const send = useSubmit(async () => { setSent(await post(codePath)); });
  const sign = useSubmit(async () => { await onSign(png!, code.trim()); });
  return (
    <div className="stack">
      <div className="card inset" style={{ marginTop: 0 }}>{attestation}</div>
      <SignaturePad onChange={setPng} />
      {!sent ? (
        <button type="button" className="btn" disabled={!png || send.busy} onClick={() => send.run()}><Icon name="bell" size={18} />{t('sign_send_code')}</button>
      ) : (
        <>
          <Notice kind="ok">{t(sent.channel === 'sms' ? 'sign_code_sent_sms' : 'sign_code_sent_email', { to: sent.to })}</Notice>
          <label className="field"><span className="field-label">{t('sign_code')}</span>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ fontSize: '1.5rem', letterSpacing: '.4em', textAlign: 'center' }} /></label>
          <div className="row">
            <button type="button" className="btn vet" disabled={!png || code.length !== 6 || sign.busy} onClick={() => sign.run()}><Icon name="edit" size={18} />{label ?? t('sign_and_validate')}</button>
            <button type="button" className="btn ghost small" disabled={send.busy} onClick={() => send.run()}>{t('sign_resend')}</button>
          </div>
        </>
      )}
      <ErrorMsg error={send.error || sign.error} />
      <p className="small muted" style={{ margin: 0 }}>{t('sign_trace_note')}</p>
    </div>
  );
}
