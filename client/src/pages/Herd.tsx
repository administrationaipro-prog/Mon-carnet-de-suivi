import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { post, put, todayIso } from '../api';
import { useApp } from '../state';
import { Badge, Card, ErrorMsg, Field, Loading, Notice, numOrNull, strOrNull, useLoad, useSubmit, downloadUrl } from '../components/ui';

export function useBreeds() {
  const { lang } = useApp();
  const b = useLoad<any[]>('/ref/breeds');
  const label = (code?: string | null) => { const x = b.data?.find((y) => y.code === code); return x ? (lang === 'fr' ? x.label_fr : x.label_en) : '—'; };
  return { breeds: b.data ?? [], label };
}

export function Herd() {
  const { t, farm, d, num } = useApp();
  const [q, setQ] = useState(''); const [sex, setSex] = useState(''); const [breed, setBreed] = useState(''); const [status, setStatus] = useState('');
  const [lot, setLot] = useState('');
  const params = new URLSearchParams({ ...(q && { q }), ...(sex && { sex }), ...(breed && { breed }), ...(status && { status }), ...(lot && { lot }) }).toString();
  const list = useLoad<any[]>(farm ? `/farms/${farm.id}/animals?${params}` : null);
  const lots = useLoad<any[]>(farm ? `/farms/${farm.id}/lots` : null);
  const { breeds, label } = useBreeds();
  if (!farm) return null;
  return (
    <div className="stack">
      <div className="row between wrap">
        <h1>{t('herd_title')}</h1>
        <div className="row">
          <button className="btn" onClick={() => downloadUrl(`/api/farms/${farm.id}/export/animals.csv`)}>{t('export_csv')}</button>
          {farm.role !== 'referent' && <Link className="btn primary" to="/herd/new">＋ {t('add_animal')}</Link>}
        </div>
      </div>
      <Card>
        <div className="filters">
          <input type="search" placeholder={`${t('search')} (${t('internal_id')}, ${t('official_id')}, ${t('animal_name')})`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('search')} />
          <select value={sex} onChange={(e) => setSex(e.target.value)} aria-label={t('sex')}><option value="">{t('sex')} : {t('all')}</option><option value="F">{t('sex.F')}</option><option value="M">{t('sex.M')}</option></select>
          <select value={breed} onChange={(e) => setBreed(e.target.value)} aria-label={t('breed')}><option value="">{t('breed')} : {t('all')}</option>{breeds.map((b) => <option key={b.code} value={b.code}>{label(b.code)}</option>)}</select>
          <select value={lot} onChange={(e) => setLot(e.target.value)} aria-label={t('lot')}><option value="">{t('lot')} : {t('all')}</option>{(lots.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('animal_status')}>
            <option value="">{t('astatus.active')}</option><option value="all">{t('all')}</option>
            {['sold', 'dead', 'culled'].map((s) => <option key={s} value={s}>{t(`astatus.${s}`)}</option>)}
          </select>
        </div>
      </Card>
      <ErrorMsg error={list.error} />
      {list.loading && !list.data ? <Loading /> : list.data && list.data.length === 0 ? <p className="muted">{t('no_animals')}</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('internal_id')}</th><th>{t('animal_name')}</th><th>{t('sex')}</th><th>{t('breed')}</th><th>{t('birth_date')}</th><th>{t('lot')}</th><th className="num">{t('weighings_n')}</th><th className="num">{t('last_weight')}</th><th className="num">{t('gmq_overall')} ({t('gmq_unit')})</th></tr></thead>
            <tbody>
              {list.data?.map((a) => (
                <tr key={a.id}>
                  <td><Link to={`/herd/${a.id}`}>{a.internal_id}</Link>{a.status !== 'active' && <> <Badge kind="warn">{t(`astatus.${a.status}`)}</Badge></>}</td>
                  <td>{a.name ?? '—'}</td><td>{t(`sex.${a.sex}`)}</td><td>{label(a.breed_code)}</td><td>{d(a.birth_date)}</td><td>{a.lot_name ?? '—'}</td>
                  <td className="num">{a.weighings_count}</td><td className="num">{a.last_weight !== null ? `${num(a.last_weight, 2)} kg` : '—'}</td><td className="num">{num(a.gmq_overall, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const blank = {
  internal_id: '', official_id: '', name: '', sex: 'F', birth_date: '', breed_code: '', breed_declared: '', objective: '', status: 'active', exit_date: '', exit_reason: '',
  sire_id: '', dam_id: '', sire_external: '', dam_external: '', parentage_source: '', parentage_certainty: '', lot_id: '', notes: '',
  litter_size: '', birth_weight_kg: '', vitality: '', colostrum: '', assistance: '', reason: '',
};

export function AnimalForm() {
  const { t, farm, num } = useApp();
  const { id } = useParams();
  const nav = useNavigate();
  const editing = !!id;
  const existing = useLoad<any>(farm && id ? `/farms/${farm.id}/animals/${id}` : null);
  const all = useLoad<any[]>(farm ? `/farms/${farm.id}/animals?status=all` : null);
  const lots = useLoad<any[]>(farm ? `/farms/${farm.id}/lots` : null);
  const { breeds, label } = useBreeds();
  const [f, setF] = useState<typeof blank | null>(editing ? null : blank);
  if (editing && existing.data && !f) {
    const a = existing.data;
    const s = (v: any) => (v === null || v === undefined ? '' : String(v));
    setF({ ...blank, ...Object.fromEntries(Object.keys(blank).map((k) => [k, s(a[k])])), litter_size: s(a.birth?.litter_size), birth_weight_kg: s(a.birth?.birth_weight_kg),
      vitality: s(a.birth?.vitality), colostrum: s(a.birth?.colostrum), assistance: s(a.birth?.assistance), reason: '' });
  }
  const s = useSubmit(async () => {
    if (!f || !farm) return;
    const n = (v: string) => strOrNull(v);
    const hasBirth = f.litter_size || f.birth_weight_kg || f.vitality || f.colostrum || f.assistance;
    const body = {
      internal_id: f.internal_id.trim(), official_id: n(f.official_id), name: n(f.name), sex: f.sex, birth_date: n(f.birth_date), breed_code: n(f.breed_code),
      breed_declared: n(f.breed_declared), objective: n(f.objective), status: f.status, exit_date: f.status === 'active' ? null : n(f.exit_date), exit_reason: f.status === 'active' ? null : n(f.exit_reason),
      sire_id: n(f.sire_id), dam_id: n(f.dam_id), sire_external: f.sire_id ? null : n(f.sire_external), dam_external: f.dam_id ? null : n(f.dam_external),
      parentage_source: n(f.parentage_source), parentage_certainty: n(f.parentage_certainty), lot_id: n(f.lot_id), notes: n(f.notes), reason: n(f.reason),
      birth: hasBirth ? { litter_size: numOrNull(f.litter_size), birth_weight_kg: numOrNull(f.birth_weight_kg), vitality: n(f.vitality), colostrum: n(f.colostrum), assistance: n(f.assistance) } : null,
    };
    const r = editing ? await put(`/farms/${farm.id}/animals/${id}`, body) : await post(`/farms/${farm.id}/animals`, body);
    nav(`/herd/${r.id}`);
  });
  const pair = f?.sire_id && f?.dam_id && farm ? `/farms/${farm.id}/mating-simulator?ram=${f.sire_id}&ewe=${f.dam_id}` : null;
  const prev = useLoad<any>(pair, [pair]);
  if (!farm || !f) return <Loading />;
  const parentsChanged = !editing || existing.data?.sire_id !== (f.sire_id || null) || existing.data?.dam_id !== (f.dam_id || null);
  const pv = pair && prev.data && prev.data.ram.id === f.sire_id && prev.data.ewe.id === f.dam_id ? prev.data.inbreeding : null;
  const blocked = !!pv?.would_be_refused && parentsChanged;
  const up = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const others = (all.data ?? []).filter((a) => a.id !== id);
  const opt = (arr: string[], prefix: string) => [<option key="" value="">—</option>, ...arr.map((v) => <option key={v} value={v}>{t(`${prefix}.${v}`)}</option>)];
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }}>
      <h1>{editing ? `${t('edit')} — ${existing.data?.internal_id}` : t('add_animal')}</h1>
      <Card title={t('identity')}>
        <div className="grid3">
          <Field label={t('internal_id')} required><input required maxLength={50} value={f.internal_id} onChange={up('internal_id')} /></Field>
          <Field label={t('official_id')}><input maxLength={50} value={f.official_id} onChange={up('official_id')} /></Field>
          <Field label={t('animal_name')}><input maxLength={100} value={f.name} onChange={up('name')} /></Field>
          <Field label={t('sex')} required><select value={f.sex} onChange={up('sex')}><option value="F">{t('sex.F')}</option><option value="M">{t('sex.M')}</option></select></Field>
          <Field label={t('birth_date')}><input type="date" max={todayIso()} value={f.birth_date} onChange={up('birth_date')} /></Field>
          <Field label={t('breed')}><select value={f.breed_code} onChange={up('breed_code')}><option value="">—</option>{breeds.map((b) => <option key={b.code} value={b.code}>{label(b.code)}</option>)}</select></Field>
          <Field label={t('breed_declared')}><input value={f.breed_declared} onChange={up('breed_declared')} /></Field>
          <Field label={t('objective')}><select value={f.objective} onChange={up('objective')}>{opt(['meat', 'reproduction'], 'objective')}</select></Field>
          <Field label={t('lot')}><select value={f.lot_id} onChange={up('lot_id')}><option value="">{t('no_lot')}</option>{(lots.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label={t('animal_status')}><select value={f.status} onChange={up('status')}>{['active', 'sold', 'dead', 'culled'].map((v) => <option key={v} value={v}>{t(`astatus.${v}`)}</option>)}</select></Field>
          {f.status !== 'active' && <>
            <Field label={t('exit_date')} required><input type="date" required value={f.exit_date} onChange={up('exit_date')} /></Field>
            <Field label={t('exit_reason')}><input value={f.exit_reason} onChange={up('exit_reason')} /></Field>
          </>}
        </div>
      </Card>
      <Card title={t('genealogy')}>
        <div className="grid3">
          <Field label={t('sire')}><select value={f.sire_id} onChange={up('sire_id')}><option value="">—</option>{others.filter((a) => a.sex === 'M').map((a) => <option key={a.id} value={a.id}>{a.internal_id}{a.name ? ` — ${a.name}` : ''}</option>)}</select></Field>
          {!f.sire_id && <Field label={t('sire_external')}><input value={f.sire_external} onChange={up('sire_external')} /></Field>}
          <Field label={t('dam')}><select value={f.dam_id} onChange={up('dam_id')}><option value="">—</option>{others.filter((a) => a.sex === 'F').map((a) => <option key={a.id} value={a.id}>{a.internal_id}{a.name ? ` — ${a.name}` : ''}</option>)}</select></Field>
          {!f.dam_id && <Field label={t('dam_external')}><input value={f.dam_external} onChange={up('dam_external')} /></Field>}
          <Field label={t('parentage_source')}><select value={f.parentage_source} onChange={up('parentage_source')}>{opt(['observed', 'declared', 'dna', 'unknown'], 'psrc')}</select></Field>
          <Field label={t('parentage_certainty')}><select value={f.parentage_certainty} onChange={up('parentage_certainty')}>{opt(['certain', 'probable', 'uncertain'], 'pcert')}</select></Field>
        </div>
      </Card>
      {pv && (
        <Notice kind={blocked ? 'error' : pv.level === 'warning' ? 'warn' : 'ok'}>
          <b>{t('inb_form_preview', { pct: num(pv.coefficient_percent, 2) })}</b>
          {blocked && <div>{t('inb_form_blocked', { pct: num(pv.coefficient_percent, 2), max: num(pv.limit_percent, 2) })}</div>}
          {!blocked && <div className="small">{t(`inb_level.${pv.level}`)} · {t('inb_limit_line', { warn: num(pv.warn_percent, 2), max: num(pv.limit_percent, 2) })}</div>}
        </Notice>
      )}
      <Card title={t('birth_record')}>
        <div className="grid3">
          <Field label={t('litter_size')}><input type="number" min={1} max={6} value={f.litter_size} onChange={up('litter_size')} /></Field>
          <Field label={t('birth_weight')}><input type="number" step="0.01" min={0.1} max={15} inputMode="decimal" value={f.birth_weight_kg} onChange={up('birth_weight_kg')} /></Field>
          <Field label={t('vitality')}><select value={f.vitality} onChange={up('vitality')}>{opt(['good', 'weak', 'assisted_survival'], 'vital')}</select></Field>
          <Field label={t('colostrum')}><select value={f.colostrum} onChange={up('colostrum')}>{opt(['yes', 'no', 'unknown'], 'colo')}</select></Field>
          <Field label={t('assistance')}><select value={f.assistance} onChange={up('assistance')}>{opt(['none', 'light', 'heavy', 'vet'], 'assist')}</select></Field>
        </div>
      </Card>
      <Card>
        <Field label={t('notes')}><textarea value={f.notes} onChange={up('notes')} /></Field>
        {editing && <Field label={t('change_reason')}><input value={f.reason} onChange={up('reason')} /></Field>}
      </Card>
      <ErrorMsg error={s.error} />
      <div className="row"><button className="btn primary" disabled={s.busy || blocked}>{t('save')}</button><button type="button" className="btn" onClick={() => nav(-1)}>{t('cancel')}</button></div>
    </form>
  );
}
