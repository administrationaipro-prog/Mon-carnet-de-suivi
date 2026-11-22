import { useState } from 'react';
import { ApiError, post, todayIso, uuid } from '../api';
import { enqueue } from '../offline';
import { useApp } from '../state';
import { ErrorMsg, Field, Notice, numOrNull } from './ui';

type Props = { animal: { id: string; internal_id: string; name?: string | null; birth_date?: string | null } | null; onSaved?: () => void };

/** Saisie d’une pesée : validation serveur, confirmation explicite des alertes, file hors connexion. */
export function WeighingForm({ animal, onSaved }: Props) {
  const { t, farm, online } = useApp();
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

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
      <div className="grid2">
        <Field label={t('date')} required><input type="date" required max={todayIso()} min={animal?.birth_date ?? undefined} value={f.date} onChange={up('date')} /></Field>
        <Field label={t('weight_kg')} required><input className="big" type="number" step="0.01" min="0.01" inputMode="decimal" required value={f.weight_kg} onChange={up('weight_kg')} autoFocus /></Field>
        <Field label={`${t('height_cm')} (${t('optional')})`}><input type="number" step="0.1" min="1" inputMode="decimal" value={f.height_cm} onChange={up('height_cm')} /></Field>
        <Field label={`${t('length_cm')} (${t('optional')})`}><input type="number" step="0.1" min="1" inputMode="decimal" value={f.length_cm} onChange={up('length_cm')} /></Field>
      </div>
      <Field label={`${t('note')} (${t('optional')})`}><input value={f.note} onChange={up('note')} /></Field>
      <p className="small muted">{t('measure_hint')}</p>
      {warnings && (
        <Notice kind="warn">
          {t('confirm_warnings', { list: warnings.map((w) => t(`warn.${w}`)).join(' ; ') })}
          <div className="row"><button type="button" className="btn primary small" onClick={() => submit(true)} disabled={busy}>{t('confirm')}</button><button type="button" className="btn small" onClick={() => setWarnings(null)}>{t('cancel')}</button></div>
        </Notice>
      )}
      <ErrorMsg error={error} />
      {msg && <Notice kind="ok">{msg}</Notice>}
      <button className="btn primary" disabled={busy || !animal}>{t('save')}</button>
    </form>
  );
}
