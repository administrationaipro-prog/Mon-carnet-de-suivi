import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { del, post, put, todayIso } from '../api';
import { useApp } from '../state';
import { Card, ErrorMsg, Field, Notice, numOrNull, strOrNull, useLoad, useSubmit, downloadUrl, Badge } from '../components/ui';

function AnimalSelect({ value, onChange, sex, required, label }: { value: string; onChange: (v: string) => void; sex?: 'M' | 'F'; required?: boolean; label: string }) {
  const { farm } = useApp();
  const list = useLoad<any[]>(farm ? `/farms/${farm.id}/animals` : null);
  return (
    <Field label={label} required={required}>
      <select value={value} required={required} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(list.data ?? []).filter((a) => !sex || a.sex === sex).map((a) => <option key={a.id} value={a.id}>{a.internal_id}{a.name ? ` — ${a.name}` : ''}</option>)}
      </select>
    </Field>
  );
}

const canWrite = (role?: string) => role === 'owner' || role === 'collaborator';

// ---------------- Alimentation ----------------
export function Feeding() {
  const { t, farm, d, num } = useApp();
  const list = useLoad<any[]>(farm ? `/farms/${farm.id}/feeding` : null);
  const lots = useLoad<any[]>(farm ? `/farms/${farm.id}/lots` : null);
  const init = { target: 'lot', animal_id: '', lot_id: '', feed: '', quantity_kg: '', basis: 'fresh', kind: 'distributed', frequency: '', water: '', start_date: todayIso(), end_date: '', cost_eur: '', note: '' };
  const [f, setF] = useState(init);
  const s = useSubmit(async () => {
    await post(`/farms/${farm!.id}/feeding`, {
      animal_id: f.target === 'animal' ? f.animal_id || null : null, lot_id: f.target === 'lot' ? f.lot_id || null : null, feed: f.feed, quantity_kg: numOrNull(f.quantity_kg),
      basis: f.basis, kind: f.kind, frequency: strOrNull(f.frequency), water: strOrNull(f.water), start_date: f.start_date, end_date: strOrNull(f.end_date), cost_eur: numOrNull(f.cost_eur), note: strOrNull(f.note),
    });
    setF({ ...init, target: f.target, lot_id: f.lot_id, animal_id: f.animal_id }); list.reload();
  });
  const rm = useSubmit(async (id: string) => { await del(`/farms/${farm!.id}/feeding/${id}`); list.reload(); });
  if (!farm) return null;
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="stack">
      <div className="row between wrap"><h1>{t('feeding_title')}</h1><button className="btn" onClick={() => downloadUrl(`/api/farms/${farm.id}/export/feeding.csv`)}>{t('export_csv')}</button></div>
      {canWrite(farm.role) && (
        <Card>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }}>
            <div className="grid3">
              <Field label={t('target')}><select value={f.target} onChange={up('target')}><option value="lot">{t('target_lot')}</option><option value="animal">{t('target_animal')}</option></select></Field>
              {f.target === 'lot' ? (
                <Field label={t('lot')} required><select required value={f.lot_id} onChange={up('lot_id')}><option value="">—</option>{(lots.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
              ) : <AnimalSelect label={t('select_animal')} required value={f.animal_id} onChange={(v) => setF({ ...f, animal_id: v })} />}
              <Field label={t('feed')} required><input required value={f.feed} onChange={up('feed')} list="feeds" /></Field>
              <Field label={t('quantity_kg')} required><input required type="number" step="0.001" min="0" inputMode="decimal" value={f.quantity_kg} onChange={up('quantity_kg')} /></Field>
              <Field label={t('basis')}><select value={f.basis} onChange={up('basis')}><option value="fresh">{t('basis.fresh')}</option><option value="dm">{t('basis.dm')}</option></select></Field>
              <Field label={t('feeding_kind')}><select value={f.kind} onChange={up('kind')}><option value="distributed">{t('fkind.distributed')}</option><option value="consumed">{t('fkind.consumed')}</option></select></Field>
              <Field label={t('frequency')}><input value={f.frequency} onChange={up('frequency')} /></Field>
              <Field label={t('water')}><input value={f.water} onChange={up('water')} /></Field>
              <Field label={t('cost_eur')}><input type="number" step="0.01" min="0" inputMode="decimal" value={f.cost_eur} onChange={up('cost_eur')} /></Field>
              <Field label={t('start_date')} required><input type="date" required value={f.start_date} onChange={up('start_date')} /></Field>
              <Field label={t('end_date')}><input type="date" min={f.start_date} value={f.end_date} onChange={up('end_date')} /></Field>
              <Field label={t('note')}><input value={f.note} onChange={up('note')} /></Field>
            </div>
            <datalist id="feeds">{['Herbe pâturée', 'Foin', 'Granulé', 'Maïs', 'Tourteau de soja', 'Bagasse', 'Feuilles de glyricidia', 'Pierre à lécher'].map((x) => <option key={x} value={x} />)}</datalist>
            <p className="small muted">{t('feeding_hint')}</p>
            {!lots.data?.length && f.target === 'lot' && <Notice><Link to="/parcels">{t('lots')} →</Link></Notice>}
            <ErrorMsg error={s.error} />
            <button className="btn primary" disabled={s.busy}>{t('add')}</button>
          </form>
        </Card>
      )}
      <ErrorMsg error={rm.error || list.error} />
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{t('period')}</th><th>{t('target')}</th><th>{t('feed')}</th><th className="num">{t('quantity_kg')}</th><th>{t('basis')}</th><th>{t('feeding_kind')}</th><th>{t('frequency')}</th><th className="num">{t('cost_eur')}</th>{canWrite(farm.role) && <th />}</tr></thead>
        <tbody>{(list.data ?? []).map((x) => (
          <tr key={x.id}><td>{d(x.start_date)}{x.end_date ? ` → ${d(x.end_date)}` : ''}</td><td>{x.lot_name ? `${t('lot')} ${x.lot_name}` : x.internal_id}</td><td>{x.feed}</td><td className="num">{num(x.quantity_kg, 2)}</td>
            <td>{t(`basis.${x.basis}`)}</td><td>{t(`fkind.${x.kind}`)}</td><td>{x.frequency ?? ''}</td><td className="num">{num(x.cost_eur, 2)}</td>
            {canWrite(farm.role) && <td><button className="btn small ghost" onClick={() => window.confirm(t('delete') + ' ?') && rm.run(x.id)}>✕</button></td>}</tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

// ---------------- Santé ----------------
export function Health() {
  const { t, farm, d } = useApp();
  const [params] = useSearchParams();
  const list = useLoad<any[]>(farm ? `/farms/${farm.id}/health` : null);
  const init = { animal_id: params.get('animal') ?? '', date: todayIso(), type: 'observation', symptoms: '', diagnosis_status: 'none', diagnosis: '', analysis_type: '', analysis_result: '',
    famacha: '', body_condition: '', treatment: '', product: '', dose: '', withdrawal_days: '', followup_date: '', note: '' };
  const [f, setF] = useState(init);
  const s = useSubmit(async () => {
    const n = strOrNull;
    await post(`/farms/${farm!.id}/health`, {
      animal_id: f.animal_id, date: f.date, type: f.type, symptoms: n(f.symptoms), diagnosis_status: f.diagnosis_status, diagnosis: n(f.diagnosis), analysis_type: n(f.analysis_type),
      analysis_result: n(f.analysis_result), famacha: numOrNull(f.famacha), body_condition: numOrNull(f.body_condition), treatment: n(f.treatment), product: n(f.product), dose: n(f.dose),
      withdrawal_days: numOrNull(f.withdrawal_days), followup_date: n(f.followup_date), note: n(f.note),
    });
    setF({ ...init, animal_id: '' }); list.reload();
  });
  const rm = useSubmit(async (id: string) => { await del(`/farms/${farm!.id}/health/${id}`); list.reload(); });
  if (!farm) return null;
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="stack">
      <div className="row between wrap"><h1>{t('health_title')}</h1><button className="btn" onClick={() => downloadUrl(`/api/farms/${farm.id}/export/health.csv`)}>{t('export_csv')}</button></div>
      <Notice kind="warn">{t('health_disclaimer')}</Notice>
      {canWrite(farm.role) && (
        <Card>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }}>
            <div className="grid3">
              <AnimalSelect label={t('select_animal')} required value={f.animal_id} onChange={(v) => setF({ ...f, animal_id: v })} />
              <Field label={t('date')} required><input type="date" required max={todayIso()} value={f.date} onChange={up('date')} /></Field>
              <Field label={t('health_type')}><select value={f.type} onChange={up('type')}>{['observation', 'analysis', 'treatment', 'followup'].map((x) => <option key={x} value={x}>{t(`htype.${x}`)}</option>)}</select></Field>
            </div>
            <Field label={t('symptoms')}><textarea value={f.symptoms} onChange={up('symptoms')} /></Field>
            <div className="grid3">
              <Field label={t('famacha')}><input type="number" min={1} max={5} value={f.famacha} onChange={up('famacha')} /></Field>
              <Field label={t('body_condition')}><input type="number" min={1} max={5} step={0.5} value={f.body_condition} onChange={up('body_condition')} /></Field>
              <Field label={t('diagnosis_status')}><select value={f.diagnosis_status} onChange={up('diagnosis_status')}>{['none', 'suspected', 'confirmed'].map((x) => <option key={x} value={x}>{t(`dstatus.${x}`)}</option>)}</select></Field>
              {f.diagnosis_status !== 'none' && <Field label={t('diagnosis')} required><input required value={f.diagnosis} onChange={up('diagnosis')} /></Field>}
              {(f.type === 'analysis' || f.analysis_type) && <>
                <Field label={t('analysis_type')}><input value={f.analysis_type} onChange={up('analysis_type')} list="analyses" /></Field>
                <Field label={t('analysis_result')}><input value={f.analysis_result} onChange={up('analysis_result')} /></Field>
              </>}
              {(f.type === 'treatment' || f.treatment) && <>
                <Field label={t('treatment')}><input value={f.treatment} onChange={up('treatment')} /></Field>
                <Field label={t('product')}><input value={f.product} onChange={up('product')} /></Field>
                <Field label={t('dose')}><input value={f.dose} onChange={up('dose')} /></Field>
                <Field label={t('withdrawal_days')}><input type="number" min={0} value={f.withdrawal_days} onChange={up('withdrawal_days')} /></Field>
              </>}
              <Field label={t('followup_date')}><input type="date" min={f.date} value={f.followup_date} onChange={up('followup_date')} /></Field>
            </div>
            <datalist id="analyses">{['Coproscopie (OPG)', 'FAMACHA', 'Hématocrite', 'Autopsie', 'Sérologie'].map((x) => <option key={x} value={x} />)}</datalist>
            <Field label={t('note')}><input value={f.note} onChange={up('note')} /></Field>
            <ErrorMsg error={s.error} />
            <button className="btn primary" disabled={s.busy}>{t('add')}</button>
          </form>
        </Card>
      )}
      <ErrorMsg error={rm.error || list.error} />
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{t('date')}</th><th>{t('internal_id')}</th><th>{t('health_type')}</th><th>{t('symptoms')}</th><th>{t('diagnosis_status')}</th><th>{t('analysis_result')}</th><th>{t('treatment')}</th><th>{t('followup_date')}</th><th>{t('author')}</th>{canWrite(farm.role) && <th />}</tr></thead>
        <tbody>{(list.data ?? []).map((x) => (
          <tr key={x.id}><td>{d(x.date)}</td><td><Link to={`/herd/${x.animal_id}`}>{x.internal_id}</Link></td><td>{t(`htype.${x.type}`)}</td><td>{x.symptoms ?? ''}{x.famacha ? ` FAMACHA ${x.famacha}` : ''}{x.body_condition ? ` NEC ${x.body_condition}` : ''}</td>
            <td>{x.diagnosis_status !== 'none' ? <><Badge kind={x.diagnosis_status === 'confirmed' ? 'error' : 'warn'}>{t(`dstatus.${x.diagnosis_status}`)}</Badge> {x.diagnosis}</> : '—'}</td>
            <td>{x.analysis_type ? `${x.analysis_type} : ${x.analysis_result ?? ''}` : ''}</td><td>{[x.treatment, x.product, x.dose].filter(Boolean).join(' · ')}{x.withdrawal_days ? ` (${x.withdrawal_days} j)` : ''}</td>
            <td>{d(x.followup_date)}</td><td>{x.author_name}</td>
            {canWrite(farm.role) && <td><button className="btn small ghost" onClick={() => window.confirm(t('delete') + ' ?') && rm.run(x.id)}>✕</button></td>}</tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

// ---------------- Reproduction ----------------
export function Repro() {
  const { t, farm, d } = useApp();
  const [params] = useSearchParams();
  const list = useLoad<any[]>(farm ? `/farms/${farm.id}/repro` : null);
  const init = { ewe_id: params.get('ewe') ?? '', type: 'mating', date: todayIso(), ram_id: '', result: '', born_alive: '', born_dead: '', weaned: '', note: '' };
  const [f, setF] = useState(init);
  const s = useSubmit(async () => {
    await post(`/farms/${farm!.id}/repro`, { ewe_id: f.ewe_id, type: f.type, date: f.date, ram_id: f.type === 'mating' ? strOrNull(f.ram_id) : null, result: strOrNull(f.result),
      born_alive: f.type === 'lambing' ? numOrNull(f.born_alive) : null, born_dead: f.type === 'lambing' ? numOrNull(f.born_dead) : null, weaned: f.type === 'weaning' ? numOrNull(f.weaned) : null, note: strOrNull(f.note) });
    setF({ ...init, ewe_id: '' }); list.reload();
  });
  const rm = useSubmit(async (id: string) => { await del(`/farms/${farm!.id}/repro/${id}`); list.reload(); });
  if (!farm) return null;
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="stack">
      <div className="row between wrap"><h1>{t('repro_title')}</h1><button className="btn" onClick={() => downloadUrl(`/api/farms/${farm.id}/export/repro.csv`)}>{t('export_csv')}</button></div>
      {canWrite(farm.role) && (
        <Card>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }}>
            <div className="grid3">
              <AnimalSelect label={t('ewe')} sex="F" required value={f.ewe_id} onChange={(v) => setF({ ...f, ewe_id: v })} />
              <Field label={t('repro_type')}><select value={f.type} onChange={up('type')}>{['mating', 'pregnancy_check', 'lambing', 'weaning', 'abortion'].map((x) => <option key={x} value={x}>{t(`rtype.${x}`)}</option>)}</select></Field>
              <Field label={t('date')} required><input type="date" required max={todayIso()} value={f.date} onChange={up('date')} /></Field>
              {f.type === 'mating' && <AnimalSelect label={t('ram')} sex="M" value={f.ram_id} onChange={(v) => setF({ ...f, ram_id: v })} />}
              {f.type === 'lambing' && <>
                <Field label={t('born_alive')} required><input type="number" required min={0} max={8} value={f.born_alive} onChange={up('born_alive')} /></Field>
                <Field label={t('born_dead')}><input type="number" min={0} max={8} value={f.born_dead} onChange={up('born_dead')} /></Field>
              </>}
              {f.type === 'weaning' && <Field label={t('weaned')} required><input type="number" required min={0} max={8} value={f.weaned} onChange={up('weaned')} /></Field>}
              <Field label={t('result')}><input value={f.result} onChange={up('result')} /></Field>
              <Field label={t('note')}><input value={f.note} onChange={up('note')} /></Field>
            </div>
            <ErrorMsg error={s.error} />
            <button className="btn primary" disabled={s.busy}>{t('add')}</button>
          </form>
        </Card>
      )}
      <ErrorMsg error={rm.error || list.error} />
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{t('date')}</th><th>{t('ewe')}</th><th>{t('repro_type')}</th><th>{t('ram')}</th><th className="num">{t('born_alive')}</th><th className="num">{t('born_dead')}</th><th className="num">{t('weaned')}</th><th>{t('result')}</th>{canWrite(farm.role) && <th />}</tr></thead>
        <tbody>{(list.data ?? []).map((x) => (
          <tr key={x.id}><td>{d(x.date)}</td><td><Link to={`/herd/${x.ewe_id}`}>{x.ewe_internal_id}</Link></td><td>{t(`rtype.${x.type}`)}</td><td>{x.ram_internal_id ?? ''}</td>
            <td className="num">{x.born_alive ?? ''}</td><td className="num">{x.born_dead ?? ''}</td><td className="num">{x.weaned ?? ''}</td><td>{x.result ?? ''}</td>
            {canWrite(farm.role) && <td><button className="btn small ghost" onClick={() => window.confirm(t('delete') + ' ?') && rm.run(x.id)}>✕</button></td>}</tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

// ---------------- Lots & parcelles ----------------
export function Parcels() {
  const { t, farm, d, num } = useApp();
  const lots = useLoad<any[]>(farm ? `/farms/${farm.id}/lots` : null);
  const parcels = useLoad<any[]>(farm ? `/farms/${farm.id}/parcels` : null);
  const [lot, setLot] = useState({ name: '', conduct_system: '' });
  const pInit = { id: '', name: '', area_ha: '', occupation: 'free', rest_since: '', lot_id: '', notes: '' };
  const [p, setP] = useState(pInit);
  const sl = useSubmit(async () => { await post(`/farms/${farm!.id}/lots`, { name: lot.name, conduct_system: strOrNull(lot.conduct_system) }); setLot({ name: '', conduct_system: '' }); lots.reload(); });
  const rl = useSubmit(async (id: string) => { await del(`/farms/${farm!.id}/lots/${id}`); lots.reload(); parcels.reload(); });
  const sp = useSubmit(async () => {
    const body = { name: p.name, area_ha: numOrNull(p.area_ha), occupation: p.occupation, rest_since: p.occupation === 'rest' ? strOrNull(p.rest_since) : null, lot_id: p.occupation === 'occupied' ? strOrNull(p.lot_id) : null, notes: strOrNull(p.notes) };
    if (p.id) await put(`/farms/${farm!.id}/parcels/${p.id}`, body); else await post(`/farms/${farm!.id}/parcels`, body);
    setP(pInit); parcels.reload();
  });
  const rp = useSubmit(async (id: string) => { await del(`/farms/${farm!.id}/parcels/${id}`); parcels.reload(); });
  if (!farm) return null;
  const w = canWrite(farm.role);
  const upP = (k: keyof typeof p) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setP({ ...p, [k]: e.target.value });
  return (
    <div className="stack">
      <h1>{t('nav_parcels')}</h1>
      <div className="grid2">
        <Card title={t('lots')}>
          {w && <form className="row wrap" onSubmit={(e) => { e.preventDefault(); sl.run(); }}>
            <input required placeholder={t('lot_name')} aria-label={t('lot_name')} value={lot.name} onChange={(e) => setLot({ ...lot, name: e.target.value })} />
            <input placeholder={t('conduct_system')} aria-label={t('conduct_system')} value={lot.conduct_system} onChange={(e) => setLot({ ...lot, conduct_system: e.target.value })} />
            <button className="btn primary" disabled={sl.busy}>{t('add')}</button>
          </form>}
          <ErrorMsg error={sl.error || rl.error} />
          <ul className="list">{(lots.data ?? []).map((l) => <li key={l.id} className="row between"><span><strong>{l.name}</strong>{l.conduct_system ? ` · ${l.conduct_system}` : ''} · {l.animals} {t('animals_count').toLowerCase()}</span>{w && <button className="btn small ghost" onClick={() => window.confirm(t('delete') + ' ?') && rl.run(l.id)}>✕</button>}</li>)}</ul>
        </Card>
        {w && <Card title={p.id ? `${t('edit')} — ${p.name}` : t('parcels')}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); sp.run(); }}>
            <div className="grid2">
              <Field label={t('parcel_name')} required><input required value={p.name} onChange={upP('name')} /></Field>
              <Field label={t('area_ha')}><input type="number" step="0.001" min="0" value={p.area_ha} onChange={upP('area_ha')} /></Field>
              <Field label={t('occupation')}><select value={p.occupation} onChange={upP('occupation')}>{['free', 'occupied', 'rest'].map((x) => <option key={x} value={x}>{t(`occ.${x}`)}</option>)}</select></Field>
              {p.occupation === 'rest' && <Field label={t('rest_since')}><input type="date" value={p.rest_since} onChange={upP('rest_since')} /></Field>}
              {p.occupation === 'occupied' && <Field label={t('lot')}><select value={p.lot_id} onChange={upP('lot_id')}><option value="">—</option>{(lots.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>}
            </div>
            <Field label={t('notes')}><input value={p.notes} onChange={upP('notes')} /></Field>
            <ErrorMsg error={sp.error || rp.error} />
            <div className="row"><button className="btn primary" disabled={sp.busy}>{t('save')}</button>{p.id && <button type="button" className="btn" onClick={() => setP(pInit)}>{t('cancel')}</button>}</div>
          </form>
        </Card>}
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{t('parcel_name')}</th><th className="num">{t('area_ha')}</th><th>{t('occupation')}</th><th>{t('lot')}</th><th className="num">{t('rest_days')}</th><th>{t('notes')}</th>{w && <th />}</tr></thead>
        <tbody>{(parcels.data ?? []).map((x) => (
          <tr key={x.id}><td>{x.name}</td><td className="num">{num(x.area_ha, 2)}</td><td>{t(`occ.${x.occupation}`)}{x.rest_since ? ` (${d(x.rest_since)})` : ''}</td><td>{x.lot_name ?? ''}</td><td className="num">{x.rest_days ?? ''}</td><td>{x.notes ?? ''}</td>
            {w && <td className="row"><button className="btn small" onClick={() => setP({ id: x.id, name: x.name, area_ha: x.area_ha ?? '', occupation: x.occupation, rest_since: x.rest_since ?? '', lot_id: x.lot_id ?? '', notes: x.notes ?? '' })}>{t('edit')}</button><button className="btn small ghost" onClick={() => window.confirm(t('delete') + ' ?') && rp.run(x.id)}>✕</button></td>}</tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
