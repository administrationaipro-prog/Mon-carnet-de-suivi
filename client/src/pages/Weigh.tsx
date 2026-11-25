import { useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../state';
import { Card, Notice, useLoad, ErrorMsg, Loading } from '../components/ui';
import { WeighingForm } from '../components/WeighingForm';
import { Icon, Sheep } from '../components/Icon';
import { readQueue, subscribe, discard, flush } from '../offline';
import { ApiError } from '../api';

function daysFromToday(iso: string) {
  const d = new Date(iso + 'T12:00:00Z').getTime(), n = new Date(); return Math.round((d - Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), 12)) / 86400000);
}

/** Tournée de pesée : les animaux en retard ou à peser aujourd’hui s’enchaînent, « Enregistrer et suivant ». */
function WeighTour() {
  const { t, farm, num, d } = useApp();
  const nav = useNavigate();
  const alerts = useLoad<any[]>(farm ? `/farms/${farm.id}/alerts` : null);
  const list = useLoad<any[]>(farm ? `/farms/${farm.id}/animals` : null);
  const [idx, setIdx] = useState(0);
  const [saved, setSaved] = useState(0);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  // Liste figée au démarrage : une pesée enregistrée ne doit pas faire sauter l’ordre de la tournée
  const ids = useMemo(() => [...new Set((alerts.data ?? []).filter((a) => a.type === 'weighing_overdue' || (a.type === 'weighing_due' && daysFromToday(a.due_date) <= 0)).map((a) => a.animal_id as string))], [alerts.data]);
  if (!farm) return null;
  if ((alerts.loading && !alerts.data) || (list.loading && !list.data)) return <Loading />;
  const err = alerts.error || list.error;
  if (err) return <ErrorMsg error={err} />;
  const total = ids.length;
  const done = idx >= total;
  const animal = done ? null : list.data?.find((a) => a.id === ids[idx]) ?? null;
  const due = animal ? (alerts.data ?? []).filter((a) => a.animal_id === animal.id && a.type.startsWith('weighing')) : [];
  return (
    <div className="stack">
      <div className="tour-top">
        <button className="icon-btn" onClick={() => nav('/')} aria-label={t('v3_quit')}><Icon name="x" /></button>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(idx, total)} aria-label={t('v3_tour')}><i style={{ width: `${total ? (Math.min(idx, total) / total) * 100 : 100}%` }} /></div>
        <b className="num">{Math.min(idx + 1, total)} / {total}</b>
      </div>
      <h1 className="sr-only">{t('v3_tour')}</h1>
      {lastSaved && !done && <Notice kind="ok">{t('weighing_saved')} — {lastSaved}</Notice>}
      {total === 0 ? <Notice>{t('v3_tour_empty')} <Link to="/weigh">{t('nav_weigh')} →</Link></Notice> : done ? (
        <Card>
          <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
            <span className="avatar sm" style={{ width: 64, height: 64 }}><Icon name="check" size={32} /></span>
            <h2>{t('v3_tour_done', { n: saved })}</h2>
            <div className="row"><Link className="btn primary" to="/">{t('nav_home')}</Link><button className="btn" onClick={() => { setIdx(total - 1); setLastSaved(null); }}>{t('v3_prev')}</button></div>
          </div>
        </Card>
      ) : animal ? (
        <>
          <Card>
            <div className="tour-animal">
              <span className="avatar sm" style={{ width: 60, height: 60 }}><Sheep size={40} wool="var(--primary)" /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ fontSize: '1.25rem' }}>{animal.name ?? animal.internal_id}</h2>
                <div className="small muted">{animal.internal_id}{animal.official_id ? ` · ${animal.official_id}` : ''} · {t(`sex.${animal.sex}`)}</div>
                <div className="row" style={{ marginTop: '.35rem', gap: '.3rem' }}>
                  {due.length > 0 && <span className={`chip ${due.some((a) => a.type === 'weighing_overdue') ? 'err' : 'warn'}`}>{due.length > 1 ? `J${due[0].day} → J${due[due.length - 1].day}` : `J${due[0].day} · ${d(due[0].due_date)}`}</span>}
                  {animal.last_weight !== null && <span className="chip">{num(animal.last_weight, 2)} kg · {d(animal.last_weighing)}</span>}
                </div>
              </div>
            </div>
          </Card>
          <WeighingForm key={animal.id} animal={animal} last={animal.last_weighing ? { date: animal.last_weighing, weight_kg: animal.last_weight } : null} submitLabel={idx + 1 < total ? t('v3_save_next') : t('save_weighing')}
            onSaved={() => { setSaved((n) => n + 1); setLastSaved(animal.name ?? animal.internal_id); setIdx((i) => i + 1); }} />
          <div className="tour-nav">
            <button className="btn ghost" disabled={idx === 0} onClick={() => { setIdx(idx - 1); setLastSaved(null); }}><Icon name="back" size={18} />{t('v3_prev')}</button>
            <button className="btn ghost" onClick={() => { setIdx(idx + 1); setLastSaved(null); }}>{t('v3_skip')}<Icon name="chev" size={18} /></button>
          </div>
        </>
      ) : <Notice kind="warn">{t('not_available')}</Notice>}
    </div>
  );
}

export function Weigh() {
  const [p] = useSearchParams();
  return p.get('tour') ? <WeighTour /> : <WeighOne />;
}

function WeighOne() {
  const { t, farm, d, num } = useApp();
  const [params] = useSearchParams();
  const list = useLoad<any[]>(farm ? `/farms/${farm.id}/animals` : null);
  const [animalId, setAnimalId] = useState(params.get('animal') ?? '');
  const [filter, setFilter] = useState('');
  const recent = useLoad<any[]>(farm ? `/farms/${farm.id}/weighings` : null);
  const queue = JSON.parse(useSyncExternalStore(subscribe, () => JSON.stringify(readQueue()))) as ReturnType<typeof readQueue>;
  if (!farm) return null;
  const animals = (list.data ?? []).filter((a) => !filter || `${a.internal_id} ${a.name ?? ''} ${a.official_id ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  const animal = list.data?.find((a) => a.id === animalId) ?? null;
  const conflicts = queue.filter((q) => q.conflict);
  return (
    <div className="stack">
      <div className="row between"><h1>{t('weigh_title')}</h1>{farm.role !== 'referent' && farm.role !== 'vet' && <Link className="btn" to="/weigh?tour=1"><Icon name="list" size={18} />{t('v3_tour')}</Link>}</div>
      {(farm.role === 'referent' || farm.role === 'vet') ? <ErrorMsg error={new ApiError(403, 'read_only')} /> : (
        <div className="stack">
          <Card>
            <div className="picker">
              <span className="avatar sm"><Sheep size={34} wool="var(--primary)" /></span>
              <div style={{ flex: 1, minWidth: 0 }} className="stack-sm">
                <label className="field"><span className="field-label">{t('select_animal')} *</span>
                  <select value={animalId} onChange={(e) => setAnimalId(e.target.value)} required>
                    <option value="">{t('select_animal_hint')}</option>
                    {animals.map((a) => <option key={a.id} value={a.id}>{a.internal_id}{a.name ? ` — ${a.name}` : ''}{a.last_weight ? ` (${num(a.last_weight, 2)} kg, ${d(a.last_weighing)})` : ''}</option>)}
                  </select>
                </label>
                {(list.data?.length ?? 0) > 8 && <input type="search" placeholder={t('search')} aria-label={t('search')} value={filter} onChange={(e) => setFilter(e.target.value)} />}
              </div>
            </div>
          </Card>
          {animal ? <WeighingForm key={animal.id} animal={animal} last={animal.last_weighing ? { date: animal.last_weighing, weight_kg: animal.last_weight } : null} onSaved={() => { list.reload(); recent.reload(); }} />
            : <p className="small muted center">{t('protocol_info')}</p>}
        </div>
      )}
      {conflicts.length > 0 && (
        <Card title={t('sync_conflicts')}>
          <ul className="list">
            {conflicts.map((q) => (
              <li key={q.client_uuid} className="stack-sm">
                <div><strong>{q.animalLabel}</strong> — {d(q.body.date)} — {num(q.body.weight_kg, 2)} kg</div>
                <Notice kind="warn">{q.conflict!.code === 'confirmation_required' ? t('confirm_warnings', { list: (q.conflict!.details?.warnings ?? []).map((w: string) => t(`warn.${w}`)).join(' ; ') }) : t(`err.${q.conflict!.code}`)}</Notice>
                <div className="row">
                  {q.conflict!.code === 'confirmation_required' && <button className="btn primary small" onClick={() => flush({ confirmUuid: q.client_uuid })}>{t('confirm')}</button>}
                  <button className="btn small" onClick={() => discard(q.client_uuid)}>{t('sync_discard')}</button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={t('weighing_history')}>
        {!recent.data?.length ? <Notice>{t('no_animals')}</Notice> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('date')}</th><th>{t('internal_id')}</th><th className="num">{t('weight_kg')}</th><th className="num">{t('height_cm')}</th><th className="num">{t('length_cm')}</th></tr></thead>
            <tbody>{recent.data.slice(0, 30).map((w) => <tr key={w.id}><td>{d(w.date)}</td><td>{w.internal_id}{w.name ? ` — ${w.name}` : ''}</td><td className="num">{num(w.weight_kg, 2)}</td><td className="num">{num(w.height_cm)}</td><td className="num">{num(w.length_cm)}</td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
