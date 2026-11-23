import { useState } from 'react';
import { ApiError, post, todayIso, uuid } from '../api';
import { enqueue } from '../offline';
import { useApp } from '../state';
import { ErrorMsg, Field, Notice, numOrNull } from './ui';
import { Icon } from './Icon';

type Props = {
  animal: { id: string; internal_id: string; name?: string | null; birth_date?: string | null } | null;
  last?: { date: string; weight_kg: number } | null;
  onSaved?: () => void;
};

const addDaysIso = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const coarse = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/** Saisie d’une pesée : validation serveur, confirmation explicite des alertes, file hors connexion. */
export function WeighingForm({ animal, last, onSaved }: Props) {
  const { t, farm, online, num } = useApp();
  const [f, setF] = useState({ date: todayIso(), weight_kg: '', height_cm: '', length_cm: '', note: '' });
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (confirm = false) => {
    if (!animal || !farm) return;
    setBusy(true); setError(null); setMsg(null);
    const body = { date: f.date, weight_kg: numOrNull(f.weight_kg) ?? NaN, height_cm: numOrNull(f.height_cm), length_cm: numOrNull(f.length_cm), note: f.note || null };
    if (!(body.weight_kg > 0)) { setError(new ApiError(400, 'weight_not_positive')); setBusy(false); return; }
    if (animal.birth_date && body.date < animal.birth_date) { setError(new ApiError(400, 'date_before_birth')); setBusy(false); return; }
    const client_uuid = uuid();
    try {
      if (!online) throw new ApiError(0, 'network');
      await post(`/farms/${farm.id}/animals/${animal.id}/weighings`, { ...body, confirm, client_uuid });
      setMsg(t('weighing_saved')); setWarnings(null);
      setF({ ...f, weight_kg: '', height_cm: '', length_cm: '', note: '' });
      onSaved?.();
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setWarnings(e.details?.warnings ?? []);
      else if (e instanceof ApiError && e.status === 0) {
        enqueue({ client_uuid, farmId: farm.id, animalId: animal.id, animalLabel: animal.name ?? animal.internal_id, body, queued_at: new Date().toISOString() });
        setMsg(t('weighing_queued')); setF({ ...f, weight_kg: '', height_cm: '', length_cm: '', note: '' });
      } else setError(e);
    } finally { setBusy(false); }
  };
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => { setF({ ...f, [k]: e.target.value }); setWarnings(null); };
  const today = todayIso(), yesterday = addDaysIso(today, -1);
  // Pavé numérique : chiffres, virgule (2 décimales max), effacement
  const key = (k: string) => {
    setWarnings(null); setMsg(null);
    setF((cur) => {
      let v = cur.weight_kg.replace('.', ',');
      if (k === 'del') v = v.slice(0, -1);
      else if (k === ',') { if (!v.includes(',')) v = (v || '0') + ','; }
      else if (!(v.includes(',') && v.split(',')[1].length >= 2) && v.replace(',', '').length < 5) v = v === '0' ? k : v + k;
      return { ...cur, weight_kg: v };
    });
  };
  const w = numOrNull(f.weight_kg);
  const days = last && f.date > last.date ? Math.round((Date.parse(f.date) - Date.parse(last.date)) / 86400000) : 0;
  const estGmq = w && last && days > 0 ? Math.round(((w - last.weight_kg) * 1000) / days) : null;

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
      <div className="date-chips">
        <button type="button" className={f.date === today ? 'on' : ''} onClick={() => setF({ ...f, date: today })}>{t('today_cap')}</button>
        <button type="button" className={f.date === yesterday ? 'on' : ''} onClick={() => setF({ ...f, date: yesterday })}>{t('yesterday_cap')}</button>
        <input type="date" aria-label={t('date')} required max={today} min={animal?.birth_date ?? undefined} value={f.date} onChange={up('date')} />
      </div>
      <div className="weight-box">
        <label htmlFor="weight-input">{t('weight_kg')}</label>
        <div className="weight-input">
          <span className="autosize"><span aria-hidden="true">{f.weight_kg || '0,0'}</span><input id="weight-input" size={1} aria-label={t('weight_kg')} inputMode={coarse() ? 'none' : 'decimal'} autoComplete="off" placeholder="0,0" required
            value={f.weight_kg} onChange={(e) => { setF({ ...f, weight_kg: e.target.value.replace(/[^0-9.,]/g, '') }); setWarnings(null); }} autoFocus /></span>
          <span className="unit">kg</span>
        </div>
        <div className="row wrap" style={{ gap: '.4rem', minHeight: 26 }}>
          {estGmq !== null && <span className={`chip ${estGmq < 0 ? 'err' : 'ok'}`}>{t('gmq_estimated')} : {estGmq} {t('gmq_unit')}</span>}
          {w && last ? <span className="chip">{w - last.weight_kg >= 0 ? '+' : ''}{num(w - last.weight_kg, 2)} kg</span> : null}
          {last && <span className="small muted">{t('last_weighing')} : {num(last.weight_kg, 2)} kg</span>}
        </div>
      </div>
      <div className="keypad" aria-hidden="true">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0'].map((k) => <button type="button" tabIndex={-1} key={k} onClick={() => key(k)}>{k}</button>)}
        <button type="button" tabIndex={-1} onClick={() => key('del')} aria-label="⌫"><Icon name="del" size={26} /></button>
      </div>
      <details className="more">
        <summary>＋ {t('more_measures')}</summary>
        <div className="grid2" style={{ marginTop: '.7rem' }}>
          <Field label={`${t('height_cm')} (${t('optional')})`}><input type="number" step="0.1" min="1" inputMode="decimal" value={f.height_cm} onChange={up('height_cm')} /></Field>
          <Field label={`${t('length_cm')} (${t('optional')})`}><input type="number" step="0.1" min="1" inputMode="decimal" value={f.length_cm} onChange={up('length_cm')} /></Field>
        </div>
        <Field label={`${t('note')} (${t('optional')})`}><input value={f.note} onChange={up('note')} /></Field>
        <p className="small muted">{t('measure_hint')}</p>
      </details>
      {warnings && (
        <Notice kind="warn">
          {t('confirm_warnings', { list: warnings.map((x) => t(`warn.${x}`)).join(' ; ') })}
          <div className="row"><button type="button" className="btn primary small" onClick={() => submit(true)} disabled={busy}>{t('confirm')}</button><button type="button" className="btn small" onClick={() => setWarnings(null)}>{t('cancel')}</button></div>
        </Notice>
      )}
      <ErrorMsg error={error} />
      {msg && <Notice kind="ok">{msg}</Notice>}
      <button className="btn primary block xl" disabled={busy || !animal}><Icon name="check" />{t('save_weighing')}</button>
    </form>
  );
}
