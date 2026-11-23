import { useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../state';
import { Card, Notice, useLoad, ErrorMsg } from '../components/ui';
import { WeighingForm } from '../components/WeighingForm';
import { Sheep } from '../components/Icon';
import { readQueue, subscribe, discard, flush } from '../offline';
import { ApiError } from '../api';

export function Weigh() {
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
      <h1>{t('weigh_title')}</h1>
      {farm.role === 'referent' ? <ErrorMsg error={new ApiError(403, 'read_only')} /> : (
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
