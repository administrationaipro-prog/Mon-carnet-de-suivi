import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, del, post, put, todayIso } from '../api';
import { useApp } from '../state';
import { Badge, Card, ErrorMsg, Field, Loading, Notice, useLoad, useSubmit } from '../components/ui';
import { Icon } from '../components/Icon';
import { SignFlow } from '../components/SignaturePad';
import { decide, DEFAULT_SETTINGS, type ParasiteSettings, type Species } from '../parasite';

const DEC_CHIP: Record<string, string> = { treat: 'err', watch: 'warn', none: 'ok' };
const FAM_BG = ['#C8323A', '#E0646A', '#F2A7A7', '#F6D2D0', '#FBF0EF'];
const FAM_FG = ['#fff', '#fff', '#3b1212', '#3b1212', '#6b5555'];
const BCS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

/** Éleveur en écriture, ou vétérinaire en consultation avec la portée santé. */
export function useParasiteRights() {
  const { farm, me } = useApp();
  const isVet = farm?.role === 'vet';
  const scopes: string[] = (me?.farms?.find((f) => f.id === farm?.id) as any)?.scopes ?? [];
  const canEdit = !!farm && (isVet ? scopes.includes('health') : farm.role === 'owner' || farm.role === 'collaborator');
  return { isVet, canEdit, scopes };
}

function Reasons({ reasons }: { reasons: string[] }) {
  const { t } = useApp();
  if (!reasons?.length) return null;
  return <>{reasons.map((r) => t(`preason.${r}`)).join(' + ')}</>;
}

function SettingsBanner({ s, species }: { s: any; species: Species }) {
  const { t, d } = useApp();
  const { isVet } = useParasiteRights();
  return s.validated ? (
    <Notice kind="ok"><span className="row between" style={{ alignItems: 'center' }}><span><b>{t('ps_validated', { species: t(`species.${species}`) })}</b> — {s.vet_name} (n° {s.vet_ordinal}), {d(s.validated_at)}</span>
      <Link className="btn small" to={`/parasitisme/seuils/${species}`}>{isVet ? t('ps_give_opinion') : t('ps_view')}</Link></span></Notice>
  ) : (
    <Notice kind="warn"><span className="row between" style={{ alignItems: 'center' }}><span><b>{t('ps_not_validated', { species: t(`species.${species}`) })}</b> {t('ps_not_validated_sub')}</span>
      <Link className={`btn small ${isVet ? 'vet' : ''}`} to={`/parasitisme/seuils/${species}`}>{isVet ? t('ps_give_opinion') : t('ps_view')}</Link></span></Notice>
  );
}

// ======================= Accueil du module =======================
export function ParasiteHome() {
  const { t, farm, d } = useApp();
  const nav = useNavigate();
  const { isVet, canEdit } = useParasiteRights();
  const [date, setDate] = useState<string | null>(null);
  const settings = useLoad<any>(farm ? `/farms/${farm.id}/parasite/settings` : null, [farm?.id]);
  const summary = useLoad<any>(farm ? `/farms/${farm.id}/parasite/summary${date ? `?date=${date}` : ''}` : null, [farm?.id, date]);
  const reports = useLoad<any[]>(farm ? `/farms/${farm.id}/copro` : null, [farm?.id]);
  const [creating, setCreating] = useState(false);
  if (!farm) return null;
  const sm = summary.data;
  const herdAlert = sm?.herd && (sm.herd.ovine?.alert || sm.herd.caprine?.alert);
  return (
    <div className="stack">
      <div className="row between"><h1><Icon name="shield" size={26} />{t('nav_parasite')}</h1>
        {canEdit && <Link className="btn primary" to="/parasitisme/tournee"><Icon name="list" size={18} />{t('pt_start')}</Link>}</div>
      {isVet && <Notice><b>{t('vet_consult_banner', { farm: farm.name })}</b></Notice>}
      <p className="muted" style={{ margin: 0 }}>{t('par_intro')}</p>
      {settings.data && <SettingsBanner s={settings.data.ovine} species="ovine" />}
      {settings.data?.caprine?.validated && <SettingsBanner s={settings.data.caprine} species="caprine" />}
      {settings.data && !settings.data.caprine.validated && <Link className="small" to="/parasitisme/seuils/caprine">{t('ps_caprine_link')} →</Link>}

      <Card title={t('pb_title')} actions={sm?.dates?.length > 1 && (
        <select aria-label={t('date')} value={sm.date} onChange={(e) => setDate(e.target.value)} style={{ width: 'auto', minHeight: 38 }}>{sm.dates.map((x: any) => <option key={x.date} value={x.date}>{d(x.date)} ({x.n})</option>)}</select>)}>
        <ErrorMsg error={summary.error} />
        {summary.loading && !sm ? <Loading /> : !sm?.date ? <p className="muted" style={{ margin: 0 }}>{t('pb_none')}</p> : (
          <div className="stack">
            <div className="sum3">
              <div className="sum-c err"><b>{sm.counts.treat}</b><small>{t('pdec.treat')}</small></div>
              <div className="sum-c warn"><b>{sm.counts.watch}</b><small>{t('pdec.watch')}</small></div>
              <div className="sum-c ok"><b>{sm.counts.none}</b><small>{t('pdec.none')}</small></div>
            </div>
            {herdAlert && <Notice kind="error"><b>{t('pb_herd_alert', { pct: sm.herd.ovine?.alert ? sm.herd.ovine.pct : sm.herd.caprine.pct })}</b> {t('pb_herd_alert_sub')}</Notice>}
            <ul className="list">{sm.exams.map((e: any) => (
              <li key={e.id} className="row between nowrap">
                <span className="row nowrap" style={{ minWidth: 0 }}>
                  <span className="fam-dot" style={{ background: e.famacha ? FAM_BG[e.famacha - 1] : 'var(--surface-2)', color: e.famacha ? FAM_FG[e.famacha - 1] : 'var(--muted)' }}>{e.famacha ?? '–'}</span>
                  <span style={{ minWidth: 0 }}><Link to={`/herd/${e.animal_id}`}><b>{e.name ?? e.internal_id}</b></Link>
                    <div className="small muted">{e.bcs !== null ? `${t('bcs_short')} ${String(e.bcs).replace('.', ',')}` : ''}{e.dag ? ` · ${t('dag_short')} ${e.dag}` : ''}{e.jaw_edema ? ` · ${t('jaw_short')}` : ''}{e.reasons?.length ? ' · ' : ''}<Reasons reasons={e.reasons} /></div></span>
                </span>
                <span className={`chip ${DEC_CHIP[e.decision]}`}>{t(`pdec.${e.decision}`)}</span>
              </li>
            ))}</ul>
            <p className="small muted" style={{ margin: 0 }}>{t('pb_next', { date: d(sm.next_date) })} · {t('pb_not_prescription')}</p>
            {canEdit && <div className="row">
              <button className="btn" onClick={() => setCreating(true)}><Icon name="file" size={18} />{t('copro_prepare')}</button>
              {!isVet && sm.counts.treat > 0 && <Link className="btn" to="/health"><Icon name="health" size={18} />{t('pb_record_treatment')}</Link>}
            </div>}
          </div>
        )}
      </Card>

      {creating && <NewCopro summary={sm} reports={reports.data ?? []} onDone={(id) => { setCreating(false); nav(`/parasitisme/copro/${id}`); }} onCancel={() => setCreating(false)} />}

      <Card title={t('copro_reports')} actions={canEdit && !creating && <button className="btn small" onClick={() => setCreating(true)}>＋ {t('copro_new')}</button>}>
        <ErrorMsg error={reports.error} />
        {!reports.data?.length ? <p className="muted" style={{ margin: 0 }}>{t('copro_none')}</p> : (
          <ul className="tasks">{reports.data.map((r) => (
            <li key={r.id}><Link className="task" to={`/parasitisme/copro/${r.id}`}>
              <span className={`ic ${r.status === 'signed' ? '' : 'gold'}`}><Icon name="file" /></span>
              <span className="t"><b>{r.number} · {t(`cphase.${r.phase}`)}</b><small>{d(r.sample_date)} · {t('copro_n_animals', { n: r.n })}{r.mean_epg !== null ? ` · ${t('copro_mean', { n: r.mean_epg })}` : ''}{r.signed_vet_name ? ` · ${r.signed_vet_name}` : ''}</small></span>
              <span className={`chip ${r.status === 'signed' ? 'ok' : 'warn'}`}>{t(`cstatus.${r.status}`)}</span>
            </Link></li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}

function NewCopro({ summary, reports, onDone, onCancel }: { summary: any; reports: any[]; onDone: (id: string) => void; onCancel: () => void }) {
  const { t, farm, d } = useApp();
  const ctx = useLoad<any>(farm ? `/farms/${farm.id}/parasite/context` : null);
  const parents = reports.filter((r) => r.phase === 'J0' && r.status === 'signed');
  const [f, setF] = useState({ phase: 'J0', parent_id: '', species: 'ovine', sample_date: todayIso(), reason: '' });
  const [sel, setSel] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (sel || !ctx.data) return;
    const flagged = (summary?.exams ?? []).filter((e: any) => e.decision !== 'none').map((e: any) => e.animal_id);
    setSel(new Set(flagged.length ? flagged : []));
  }, [ctx.data]); // eslint-disable-line
  const s = useSubmit(async () => {
    const r = await post(`/farms/${farm!.id}/copro`, { ...f, parent_id: f.phase === 'J14' ? f.parent_id || null : null, reason: f.reason || null, animal_ids: f.phase === 'J14' && f.parent_id ? [] : [...(sel ?? [])] });
    onDone(r.id);
  });
  const animals = (ctx.data?.animals ?? []).filter((a: any) => a.species === f.species);
  const toggle = (id: string) => { const n = new Set(sel ?? []); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  return (
    <Card title={t('copro_new')}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }}>
        <div className="grid3">
          <Field label={t('copro_phase')}><select value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value })}>{['J0', 'J14', 'other'].map((p) => <option key={p} value={p}>{t(`cphase.${p}`)}</option>)}</select></Field>
          {f.phase === 'J14' && <Field label={t('copro_parent')} required><select required value={f.parent_id} onChange={(e) => setF({ ...f, parent_id: e.target.value })}><option value="">—</option>{parents.map((p) => <option key={p.id} value={p.id}>{p.number} · {d(p.sample_date)}</option>)}</select></Field>}
          <Field label={t('species')}><select value={f.species} onChange={(e) => { setF({ ...f, species: e.target.value }); setSel(new Set()); }}><option value="ovine">{t('species.ovine')}</option><option value="caprine">{t('species.caprine')}</option></select></Field>
          <Field label={t('copro_sample_date')} required><input type="date" required max={todayIso()} value={f.sample_date} onChange={(e) => setF({ ...f, sample_date: e.target.value })} /></Field>
          <Field label={t('copro_reason')}><input maxLength={300} value={f.reason} placeholder={t('copro_reason_ph')} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </div>
        {!(f.phase === 'J14' && f.parent_id) && (
          <div>
            <div className="row between"><span className="field-label">{t('copro_animals', { n: sel?.size ?? 0 })}</span>
              <span className="row"><button type="button" className="btn ghost small" onClick={() => setSel(new Set(animals.map((a: any) => a.id)))}>{t('all')}</button><button type="button" className="btn ghost small" onClick={() => setSel(new Set())}>{t('none_lbl')}</button></span></div>
            <div className="pick-grid">{animals.map((a: any) => (
              <label key={a.id} className={`pick ${sel?.has(a.id) ? 'on' : ''}`}><input type="checkbox" checked={!!sel?.has(a.id)} onChange={() => toggle(a.id)} />{a.name ?? a.internal_id}<small>{a.official_id ?? a.internal_id}</small></label>
            ))}</div>
          </div>
        )}
        <p className="small muted" style={{ margin: 0 }}>{t('copro_prefill_note')}</p>
        <ErrorMsg error={s.error || ctx.error} />
        <div className="row"><button className="btn primary" disabled={s.busy || (f.phase === 'J14' ? !f.parent_id : !(sel?.size))}>{t('copro_create')}</button><button type="button" className="btn" onClick={onCancel}>{t('cancel')}</button></div>
      </form>
    </Card>
  );
}

// ======================= Tournée d'examen « 5 points » =======================
export function ExamTour() {
  const { t, farm, num } = useApp();
  const nav = useNavigate();
  const { canEdit } = useParasiteRights();
  const ctx = useLoad<any>(farm ? `/farms/${farm.id}/parasite/context` : null);
  const [species, setSpecies] = useState<Species>('ovine');
  const [idx, setIdx] = useState(0);
  const [date, setDate] = useState(todayIso());
  const [done, setDone] = useState<Record<string, any>>({});
  const blank = { famacha: null as number | null, bcs: null as number | null, dag: 0 as number | null, jaw_edema: false, nasal: false };
  const [e, setE] = useState(blank);
  const animals = useMemo(() => (ctx.data?.animals ?? []).filter((a: any) => a.species === species), [ctx.data, species]);
  const a = animals[idx];
  useEffect(() => { setE(done[a?.id] ? { famacha: done[a.id].famacha, bcs: done[a.id].bcs, dag: done[a.id].dag, jaw_edema: done[a.id].jaw_edema, nasal: done[a.id].nasal } : blank); }, [a?.id]); // eslint-disable-line
  const save = useSubmit(async () => {
    const r = await post(`/farms/${farm!.id}/parasite/exams`, { animal_id: a.id, date, ...e });
    setDone({ ...done, [a.id]: r }); setIdx(idx + 1);
  });
  if (!farm) return null;
  if (!canEdit) return <Notice kind="warn">{t('err.read_only')}</Notice>;
  if (ctx.loading && !ctx.data) return <Loading />;
  const s: ParasiteSettings = ctx.data?.settings?.[species] ?? DEFAULT_SETTINGS;
  const total = animals.length;
  const young = a && a.age_days !== null && a.age_days < s.famacha_min_age_months * 30.4;
  const live = a ? decide(e, a, s, !!ctx.data?.herd?.[species]?.alert) : null;
  const hasCaprine = (ctx.data?.animals ?? []).some((x: any) => x.species === 'caprine');
  return (
    <div className="stack">
      <div className="tour-top">
        <button className="icon-btn" onClick={() => nav('/parasitisme')} aria-label={t('v3_quit')}><Icon name="x" /></button>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(idx, total)} aria-label={t('pt_title')}><i style={{ width: `${total ? (Math.min(idx, total) / total) * 100 : 100}%` }} /></div>
        <b className="num">{Math.min(idx + 1, total)} / {total}</b>
      </div>
      <div className="row between"><h1 style={{ fontSize: '1.3rem' }}>{t('pt_title')}</h1>
        <span className="row">{hasCaprine && <div className="segmented">{(['ovine', 'caprine'] as const).map((sp) => <button key={sp} type="button" className={species === sp ? 'on' : ''} onClick={() => { setSpecies(sp); setIdx(0); }}>{t(`species.${sp}`)}</button>)}</div>}
          <input type="date" aria-label={t('date')} max={todayIso()} value={date} onChange={(ev) => setDate(ev.target.value)} style={{ width: 'auto', minHeight: 40 }} /></span></div>
      <ErrorMsg error={ctx.error} />
      {!total ? <Notice>{t('no_animals')}</Notice> : idx >= total ? (
        <Card><div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <span className="avatar sm" style={{ width: 64, height: 64 }}><Icon name="check" size={32} /></span>
          <h2>{t('pt_done', { n: Object.keys(done).length })}</h2>
          <div className="row"><Link className="btn primary" to="/parasitisme">{t('pt_see_summary')}</Link><button className="btn" onClick={() => setIdx(total - 1)}>{t('v3_prev')}</button></div>
        </div></Card>
      ) : (
        <>
          <Card><div className="tour-animal">
            <span className="avatar sm" style={{ width: 56, height: 56 }}><Icon name="shield" size={28} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 style={{ fontSize: '1.2rem' }}>{a.name ?? a.internal_id}</h2>
              <div className="small muted">{a.official_id ?? a.internal_id} · {t(`sex.${a.sex}`)}{a.age_days !== null ? ` · ${t('age_n_days', { n: a.age_days })}` : ''}{a.gmq !== null ? ` · ${num(a.gmq, 0)} ${t('gmq_unit')}` : ''}</div>
              <div className="row" style={{ marginTop: '.35rem', gap: '.3rem' }}>
                {a.pregnant_or_lactating && <span className="chip info">{t('pt_pl')}</span>}
                {young && <span className="chip warn">{t('pt_young', { m: s.famacha_min_age_months })}</span>}
                {a.previous_famacha && <span className="chip">{t('pt_last_famacha', { n: a.previous_famacha })}</span>}
              </div>
            </div>
          </div></Card>
          <div className="exam-lbl">{t('pt_eye')} <span>{t('pt_eye_sub')}</span></div>
          <div className="fam">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-pressed={e.famacha === n} className={e.famacha === n ? 'sel' : ''} style={{ background: FAM_BG[n - 1], color: FAM_FG[n - 1] }} onClick={() => setE({ ...e, famacha: e.famacha === n ? null : n })}>{n}</button>)}</div>
          <div className="exam-lbl">{t('pt_back')} <span>{t('pt_back_sub')}</span></div>
          <div className="seg-row">{BCS.map((n) => <button key={n} type="button" aria-pressed={e.bcs === n} className={e.bcs === n ? 'on' : ''} onClick={() => setE({ ...e, bcs: e.bcs === n ? null : n })}>{String(n).replace('.', ',')}</button>)}</div>
          <div className="exam-lbl">{t('pt_tail')} <span>{t('pt_tail_sub')}</span></div>
          <div className="seg-row">{[0, 1, 2, 3].map((n) => <button key={n} type="button" aria-pressed={e.dag === n} className={e.dag === n ? 'on' : ''} onClick={() => setE({ ...e, dag: n })}>{n}</button>)}</div>
          <label className="tog"><span>{t('pt_jaw')}</span><input type="checkbox" className="switch" checked={e.jaw_edema} onChange={(ev) => setE({ ...e, jaw_edema: ev.target.checked })} /></label>
          <label className="tog"><span>{t('pt_nose')}</span><input type="checkbox" className="switch" checked={e.nasal} onChange={(ev) => setE({ ...e, nasal: ev.target.checked })} /></label>
          {live && (e.famacha !== null || e.bcs !== null || e.jaw_edema || e.nasal || (e.dag ?? 0) > 0) && (
            <div className={`decision ${live.decision}`}><b>{t(`pdec_long.${live.decision}`)}</b><small><Reasons reasons={live.reasons} />{live.decision !== 'none' ? ` — ${t('pb_not_prescription')}` : ''}</small></div>
          )}
          <ErrorMsg error={save.error} />
          <button className="btn primary block xl" disabled={save.busy} onClick={() => save.run()}>{idx + 1 < total ? t('v3_save_next') : t('save')}<Icon name="chev" /></button>
          <div className="tour-nav">
            <button className="btn ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}><Icon name="back" size={18} />{t('v3_prev')}</button>
            <button className="btn ghost" onClick={() => setIdx(idx + 1)}>{t('v3_skip')}<Icon name="chev" size={18} /></button>
          </div>
        </>
      )}
    </div>
  );
}

// ======================= Seuils et avis vétérinaire =======================
type FieldDef = { k: keyof ParasiteSettings; type: 'int' | 'num' | 'bool' | 'numnull'; unit?: string; min?: number; max?: number; step?: number; group: string; ref: boolean };
const FIELDS: FieldDef[] = [
  { k: 'famacha_treat_from', type: 'int', min: 2, max: 5, group: 'famacha', ref: true },
  { k: 'famacha_conditional', type: 'int', min: 1, max: 4, group: 'famacha', ref: true },
  { k: 'cond_young', type: 'bool', group: 'famacha', ref: true },
  { k: 'cond_pregnant_lactating', type: 'bool', group: 'famacha', ref: true },
  { k: 'cond_bcs_max', type: 'numnull', min: 1, max: 5, step: 0.5, group: 'famacha', ref: true },
  { k: 'cond_rising', type: 'bool', group: 'famacha', ref: true },
  { k: 'herd_alert_pct', type: 'num', unit: '%', min: 1, max: 100, group: 'famacha', ref: true },
  { k: 'exam_interval_days', type: 'int', unit: 'j', min: 3, max: 90, group: 'exams', ref: true },
  { k: 'recheck_days', type: 'int', unit: 'j', min: 1, max: 60, group: 'exams', ref: true },
  { k: 'famacha_min_age_months', type: 'num', unit: 'mois', min: 0, max: 24, group: 'exams', ref: true },
  { k: 'young_min_gmq', type: 'numnull', unit: 'g/j', min: 0, max: 1000, group: 'exams', ref: false },
  { k: 'copro_treat_epg', type: 'numnull', unit: 'OPG', min: 0, max: 100000, group: 'copro', ref: false },
  { k: 'dag_flag_from', type: 'int', min: 1, max: 3, group: 'copro', ref: true },
  { k: 'jaw_edema_treat', type: 'bool', group: 'copro', ref: true },
  { k: 'fecrt_interval_days', type: 'int', unit: 'j', min: 7, max: 28, group: 'fecrt', ref: true },
  { k: 'fecrt_efficacy_pct', type: 'num', unit: '%', min: 50, max: 100, group: 'fecrt', ref: true },
  { k: 'fecrt_min_animals', type: 'int', min: 1, max: 100, group: 'fecrt', ref: true },
];

export function ParasiteSettingsPage() {
  const { t, farm, d, dt, refresh } = useApp();
  const nav = useNavigate();
  const sp = (useParams().species === 'caprine' ? 'caprine' : 'ovine') as Species;
  const { isVet, canEdit } = useParasiteRights();
  const data = useLoad<any>(farm ? `/farms/${farm.id}/parasite/settings` : null, [farm?.id]);
  const hist = useLoad<any[]>(farm ? `/farms/${farm.id}/parasite/settings/history` : null, [farm?.id]);
  const [v, setV] = useState<Record<string, any> | null>(null);
  const [comment, setComment] = useState('');
  const cur = data.data?.[sp];
  useEffect(() => { if (cur && !v) { setV({ ...cur.vals }); setComment(cur.comment ?? ''); } }, [cur]); // eslint-disable-line
  if (!farm) return null;
  if (data.loading && !data.data) return <Loading />;
  const vetEdit = isVet && canEdit;
  const defs = data.data?.defaults ?? DEFAULT_SETTINGS;
  const shown = v ?? cur?.vals ?? {};
  const field = (f: FieldDef) => {
    const val = shown[f.k];
    const changed = cur && JSON.stringify(val) !== JSON.stringify(defs[f.k]);
    const input = !vetEdit ? <b className={`set-val ${changed ? 'changed' : ''}`}>{f.type === 'bool' ? t(val ? 'yes' : 'no') : val === null ? t('ps_to_define') : `${String(val).replace('.', ',')}${f.unit ? ` ${f.unit}` : ''}`}</b>
      : f.type === 'bool' ? <input type="checkbox" className="switch" checked={!!val} onChange={(e) => setV({ ...shown, [f.k]: e.target.checked })} aria-label={t(`psf.${f.k}`)} />
      : <span className="row nowrap" style={{ gap: '.3rem' }}><input type="number" className="set-input" min={f.min} max={f.max} step={f.step ?? (f.type === 'int' ? 1 : 0.5)} value={val ?? ''} placeholder={t('ps_to_define')}
          aria-label={t(`psf.${f.k}`)} onChange={(e) => setV({ ...shown, [f.k]: e.target.value === '' ? (f.type === 'numnull' ? null : val) : Number(e.target.value) })} />{f.unit && <span className="small muted">{f.unit}</span>}</span>;
    return (
      <div key={f.k} className="set-row">
        <div style={{ minWidth: 0 }}>{t(`psf.${f.k}`)}<small>{t('ps_default')} : {defs[f.k] === null ? t('ps_to_define') : f.type === 'bool' ? t(defs[f.k] ? 'yes' : 'no') : String(defs[f.k]).replace('.', ',')}{!f.ref ? ` · ${t('ps_vet_required')}` : ''}</small></div>
        {input}
      </div>
    );
  };
  return (
    <div className="stack">
      <div className="row"><button className="icon-btn" onClick={() => nav('/parasitisme')} aria-label={t('back')}><Icon name="back" /></button><h1>{t('ps_title')} — {t(`species.${sp}`)}</h1></div>
      {cur?.validated ? <Notice kind="ok"><b>{t('ps_validated', { species: t(`species.${sp}`) })}</b> — {cur.vet_name} (n° {cur.vet_ordinal}), {dt(cur.validated_at)}{cur.comment && <div style={{ marginTop: '.3rem' }}>« {cur.comment} »</div>}</Notice>
        : <Notice kind="warn"><b>{t('ps_not_validated', { species: t(`species.${sp}`) })}</b> {t(isVet ? 'ps_vet_hint' : 'ps_farmer_hint')}</Notice>}
      <div className="grid2">
        {['famacha', 'exams', 'copro', 'fecrt'].map((g) => (
          <Card key={g} title={t(`psg.${g}`)}>{FIELDS.filter((f) => f.group === g).map(field)}<p className="small muted" style={{ margin: '.5rem 0 0' }}>{t(`psg_src.${g}`)}</p></Card>
        ))}
      </div>
      {vetEdit && v && (
        <Card title={t('ps_sign_title')}>
          <Field label={t('ps_comment')}><textarea maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
          <SignFlow key={cur?.version ?? 0} attestation={t('ps_attest', { name: '' })} codePath={`/farms/${farm.id}/parasite/settings/${sp}/sign-code`}
            onSign={async (png, code) => { await post(`/farms/${farm.id}/parasite/settings/${sp}`, { vals: v, comment: comment || null, signature_png: png, code }); data.reload(); hist.reload(); await refresh(); }} label={t('ps_sign_btn')} />
        </Card>
      )}
      {!!hist.data?.filter((h) => h.species === sp).length && (
        <Card title={t('ps_history')}>
          <ul className="list">{hist.data.filter((h) => h.species === sp).map((h) => <li key={h.id} className="small">v{h.version} · {d(h.validated_at)} · {h.vet_name} (n° {h.vet_ordinal}){h.comment ? ` · « ${h.comment} »` : ''}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}

// ======================= Rapport de coproscopie =======================
const fileUrl = (farmId: string, id: string, fileId: string, dl = false) => `/api/farms/${farmId}/copro/${id}/files/${fileId}${dl ? '?download=1' : ''}`;

export function CoproPage() {
  const { t, farm, d, dt, num } = useApp();
  const nav = useNavigate();
  const { id } = useParams();
  const { isVet, canEdit } = useParasiteRights();
  const rep = useLoad<any>(farm && id ? `/farms/${farm.id}/copro/${id}` : null, [id]);
  const ctx = useLoad<any>(farm && isVet ? `/farms/${farm.id}/parasite/context` : null, [farm?.id]);
  const [form, setForm] = useState<any | null>(null);
  const [imp, setImp] = useState<any | null>(null);
  const r = rep.data;
  useEffect(() => { if (r && r.status === 'draft' && isVet) setForm(toForm(r)); }, [r?.id, r?.updated_at]); // eslint-disable-line
  const save = useSubmit(async () => { const x = await put(`/farms/${farm!.id}/copro/${id}`, fromForm(form)); rep.setData(x); setForm(toForm(x)); });
  const upload = useSubmit(async (file: File) => {
    if (file.size > 20 * 1024 * 1024) throw new ApiError(400, 'file_too_large');
    const b64 = await new Promise<string>((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = ko; fr.readAsDataURL(file); });
    const x = await post(`/farms/${farm!.id}/copro/${id}/import`, { name: file.name, mime: file.type || 'application/pdf', data_base64: b64 });
    setImp(x.import_summary); rep.setData(x); setForm(toForm(x));
  });
  const ack = useSubmit(async () => { rep.setData(await post(`/farms/${farm!.id}/copro/${id}/ack`)); });
  const remove = useSubmit(async () => { if (!window.confirm(t('copro_delete_confirm'))) return; await del(`/farms/${farm!.id}/copro/${id}`); nav('/parasitisme'); });
  if (!farm) return null;
  if (rep.loading && !r) return <Loading />;
  if (rep.error) return <ErrorMsg error={rep.error} />;
  const vetDraft = isVet && r.status === 'draft' && r.can_edit_as_vet && form;
  const animals = ctx.data?.animals ?? [];
  const thr = r.settings?.copro_treat_epg;
  const dirty = form && JSON.stringify(fromForm(form)) !== JSON.stringify(fromForm(toForm(r)));
  return (
    <div className="stack">
      <div className="row between">
        <div className="row nowrap"><button className="icon-btn" onClick={() => nav('/parasitisme')} aria-label={t('back')}><Icon name="back" /></button>
          <div><h1 style={{ fontSize: '1.35rem' }}>{r.number} · {t(`cphase.${r.phase}`)}</h1><div className="small muted">{t(`species.${r.species}`)} · {t('copro_sampled', { date: d(r.sample_date) })}{r.parent_number ? ` · J0 : ${r.parent_number}` : ''}</div></div></div>
        <Badge kind={r.status === 'signed' ? 'ok' : 'warn'}>{t(`cstatus.${r.status}`)}</Badge>
      </div>
      {r.status === 'signed' ? (
        <Notice kind="ok"><b>{t('copro_signed_by', { vet: r.signed_vet_name, n: r.signed_vet_ordinal, date: dt(r.signed_at) })}</b>
          <div className="row" style={{ marginTop: '.5rem' }}>
            <a className="btn small primary" href={fileUrl(farm.id, r.id, r.pdf_file_id)} target="_blank" rel="noreferrer"><Icon name="file" size={16} />{t('copro_open_pdf')}</a>
            <a className="btn small" href={fileUrl(farm.id, r.id, r.pdf_file_id, true)}><Icon name="download" size={16} />{t('copro_download_pdf')}</a>
            <Link className="btn small ghost" to={`/verifier/${r.number}`}><Icon name="shield" size={16} />{t('verify_doc_title')}</Link>
          </div></Notice>
      ) : isVet ? <Notice>{t('copro_vet_todo')}</Notice> : <Notice kind="warn">{t('copro_waiting_vet')}</Notice>}
      {r.status === 'signed' && !isVet && !r.farmer_ack_at && canEdit && <div className="row"><button className="btn primary" disabled={ack.busy} onClick={() => ack.run()}><Icon name="check" size={18} />{t('copro_ack')}</button></div>}
      {r.farmer_ack_at && <p className="small muted" style={{ margin: 0 }}>{t('copro_acked', { date: dt(r.farmer_ack_at) })}</p>}
      {r.fecrt && (
        <Card title={t('fecrt_title')}>
          <div className="row between"><span>J0 : <b>{num(r.fecrt.mean_before, 0)}</b> OPG → J14 : <b>{num(r.fecrt.mean_after, 0)}</b> OPG · {t('copro_n_animals', { n: r.fecrt.n })}</span>
            <span className={`chip ${r.fecrt.status === 'effective' ? 'ok' : 'warn'}`}>{r.fecrt.reduction === null ? '—' : `${num(r.fecrt.reduction, 1)} %`} · {t(`fecrt.${r.fecrt.status}`)}</span></div>
          <div className="meter" style={{ background: 'var(--surface-2)', height: 10 }}><span style={{ width: `${Math.max(0, Math.min(100, r.fecrt.reduction ?? 0))}%`, background: r.fecrt.status === 'effective' ? 'var(--primary-bright)' : 'var(--accent)' }} /></div>
          <p className="small muted" style={{ margin: '.4rem 0 0' }}>{t('fecrt_note', { pct: r.settings.fecrt_efficacy_pct, n: r.settings.fecrt_min_animals })}{!r.fecrt.enough_animals ? ` ${t('fecrt_few')}` : ''}</p>
        </Card>
      )}

      {vetDraft ? (
        <>
          <Card title={t('imp_title')}>
            {!r.ai_available && <Notice kind="warn">{t('imp_ai_off')}</Notice>}
            <p className="small muted" style={{ marginTop: 0 }}>{t('imp_intro')}</p>
            <div className="row">
              <label className="btn vet"><Icon name="download" size={18} />{t('imp_choose')}<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && upload.run(e.target.files[0])} /></label>
              <label className="btn"><Icon name="scale" size={18} />{t('imp_photo')}<input type="file" hidden accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && upload.run(e.target.files[0])} /></label>
            </div>
            {upload.busy && <Notice>{t('imp_reading')}</Notice>}
            <ErrorMsg error={upload.error} />
            {imp && <Notice kind={imp.unmatched ? 'warn' : 'ok'}>{t('imp_summary', { n: imp.results, m: imp.matched })}{imp.unmatched ? ` ${t('imp_unmatched', { n: imp.unmatched })}` : ''}{imp.warnings?.length ? <ul style={{ margin: '.3rem 0 0', paddingLeft: '1.1rem' }}>{imp.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul> : null}</Notice>}
          </Card>
          <div className="split2">
            {r.source_file_id && (
              <div className="viewer">
                <div className="row between"><b className="small" style={{ color: '#e8ece9' }}>{r.source_name}</b><a className="btn small" href={fileUrl(farm.id, r.id, r.source_file_id)} target="_blank" rel="noreferrer">{t('copro_open_source')}</a></div>
                {r.source_mime?.startsWith('image/') ? <img src={fileUrl(farm.id, r.id, r.source_file_id)} alt={r.source_name} /> : <iframe title={r.source_name} src={fileUrl(farm.id, r.id, r.source_file_id)} />}
              </div>
            )}
            <Card title={t('copro_form_title')} actions={<span className="vet-chip">{t('vet_only')}</span>}>
              <div className="stack">
                <div className="grid2">
                  <Field label={t('copro_lab')}><input value={form.lab_name} onChange={(e) => setForm({ ...form, lab_name: e.target.value })} /></Field>
                  <Field label={t('copro_lab_ref')}><input value={form.lab_ref} onChange={(e) => setForm({ ...form, lab_ref: e.target.value })} /></Field>
                  <Field label={t('copro_method')}><input value={form.method} placeholder="McMaster" onChange={(e) => setForm({ ...form, method: e.target.value })} /></Field>
                  <Field label={t('copro_limit')}><input type="number" min={0} value={form.detection_limit} onChange={(e) => setForm({ ...form, detection_limit: e.target.value })} /></Field>
                </div>
                <div className="table-wrap"><table className="table compact res-table">
                  <thead><tr><th>{t('copro_animal')}</th><th>FAM.</th><th className="num">{t('copro_strongyles')}</th><th className="num">{t('copro_nemat')}</th><th>{t('copro_cocc')}</th><th /></tr></thead>
                  <tbody>{form.results.map((x: any, i: number) => {
                    const setX = (o: any) => { const rs = [...form.results]; rs[i] = { ...x, ...o, corrected: true }; setForm({ ...form, results: rs }); };
                    return (
                      <tr key={x.key} className={!x.animal_id ? 'warnrow' : ''}>
                        <td><span className={`conf c-${x.confidence ?? 'none'}`} title={x.confidence ? t(`conf.${x.confidence}`) : ''} />
                          {x.raw_label && <span className="small muted">« {x.raw_label} » → </span>}
                          <select aria-label={t('copro_animal')} value={x.animal_id ?? ''} onChange={(e) => setX({ animal_id: e.target.value || null })} style={{ width: 'auto', minHeight: 34, padding: '.2rem .4rem' }}>
                            <option value="">{t('copro_pick_animal')}</option>{animals.filter((a: any) => a.species === r.species).map((a: any) => <option key={a.id} value={a.id}>{a.name ?? a.internal_id} · {a.official_id ?? a.internal_id}</option>)}</select></td>
                        <td>{x.famacha ?? '—'}</td>
                        <td className="num"><input type="number" min={0} className={`cell-in ${thr !== null && Number(x.strongyles_epg) >= thr ? 'over' : ''}`} value={x.strongyles_epg} onChange={(e) => setX({ strongyles_epg: e.target.value })} aria-label={t('copro_strongyles')} /></td>
                        <td className="num"><input type="number" min={0} className="cell-in" value={x.nematodirus_epg} onChange={(e) => setX({ nematodirus_epg: e.target.value })} aria-label={t('copro_nemat')} /></td>
                        <td><input className="cell-in" style={{ width: '3.4rem' }} maxLength={20} value={x.coccidia} onChange={(e) => setX({ coccidia: e.target.value })} aria-label={t('copro_cocc')} /></td>
                        <td><button type="button" className="icon-btn small" aria-label={t('delete')} onClick={() => setForm({ ...form, results: form.results.filter((_: any, j: number) => j !== i) })}><Icon name="trash" size={15} /></button></td>
                      </tr>
                    );
                  })}</tbody>
                </table></div>
                <div className="row between">
                  <button type="button" className="btn small" onClick={() => setForm({ ...form, results: [...form.results, { key: Math.random(), animal_id: null, raw_label: '', strongyles_epg: '', nematodirus_epg: '', coccidia: '', confidence: null }] })}>＋ {t('copro_add_row')}</button>
                  <span className="small muted"><span className="conf c-high" />{t('conf.high')} <span className="conf c-medium" />{t('conf.medium')} <span className="conf c-low" />{t('conf.low')}</span>
                </div>
                {thr !== null && <p className="small muted" style={{ margin: 0 }}>{t('copro_thr_note', { n: thr })}</p>}
                <Field label={t('copro_lab_comment')}><textarea value={form.lab_comment} onChange={(e) => setForm({ ...form, lab_comment: e.target.value })} /></Field>
                <Field label={t('copro_interpretation')} required><textarea rows={4} value={form.interpretation} placeholder={t('copro_interpretation_ph')} onChange={(e) => setForm({ ...form, interpretation: e.target.value })} /></Field>
                <ErrorMsg error={save.error} />
                <div className="row"><button className="btn vet" disabled={save.busy || !dirty} onClick={() => save.run()}>{t('save')}</button>{dirty && <span className="small muted">{t('copro_unsaved')}</span>}</div>
              </div>
            </Card>
          </div>
          <Card title={t('copro_sign_title')}>
            {dirty ? <Notice kind="warn">{t('copro_save_first')}</Notice> : (
              <SignFlow attestation={t('copro_attest')} codePath={`/farms/${farm.id}/copro/${id}/sign-code`}
                onSign={async (png, code) => { const x = await post(`/farms/${farm.id}/copro/${id}/sign`, { signature_png: png, code }); rep.setData(x); setForm(null); }} />
            )}
          </Card>
        </>
      ) : (
        <Card title={t('copro_results')}>
          <div className="table-wrap"><table className="table compact">
            <thead><tr><th>{t('copro_animal')}</th><th>{t('official_id')}</th><th className="num">FAMACHA</th><th className="num">{t('bcs_short')}</th><th className="num">{t('copro_strongyles')}</th><th className="num">{t('copro_nemat')}</th><th>{t('copro_cocc')}</th></tr></thead>
            <tbody>{r.results.map((x: any) => (
              <tr key={x.id}><td>{x.animal_id ? <Link to={`/herd/${x.animal_id}`}>{x.name ?? x.internal_id}</Link> : <span className="muted">« {x.raw_label} »</span>}</td><td>{x.official_id ?? '—'}</td>
                <td className="num">{x.famacha ?? '—'}</td><td className="num">{x.bcs === null ? '—' : String(x.bcs).replace('.', ',')}</td>
                <td className="num"><b style={{ color: thr !== null && x.strongyles_epg >= thr ? 'var(--danger)' : undefined }}>{x.strongyles_epg === null ? '—' : num(x.strongyles_epg, 0)}</b></td>
                <td className="num">{x.nematodirus_epg === null ? '—' : num(x.nematodirus_epg, 0)}</td><td>{x.coccidia ?? '—'}</td></tr>
            ))}</tbody>
          </table></div>
          {r.method && <p className="small muted">{t('copro_method')} : {r.method}{r.detection_limit ? ` · ${t('copro_limit')} ${r.detection_limit}` : ''}{r.lab_name ? ` · ${r.lab_name}` : ''}</p>}
          {r.interpretation && <div className="card inset"><b>{t('copro_interpretation')}</b><p style={{ margin: '.3rem 0 0', whiteSpace: 'pre-wrap' }}>{r.interpretation}</p></div>}
          {r.source_file_id && <p className="small" style={{ marginBottom: 0 }}><a href={fileUrl(farm.id, r.id, r.source_file_id)} target="_blank" rel="noreferrer">{t('copro_source_link', { name: r.source_name })}</a> <span className="muted">· SHA-256 {r.source_sha256?.slice(0, 12)}…</span></p>}
        </Card>
      )}
      {r.status === 'draft' && canEdit && <div className="row"><button className="btn danger small" disabled={remove.busy} onClick={() => remove.run()}><Icon name="trash" size={16} />{t('copro_delete')}</button></div>}
      <ErrorMsg error={ack.error || remove.error} />
    </div>
  );
}

const s0 = (v: any) => (v === null || v === undefined ? '' : String(v));
function toForm(r: any) {
  return {
    lab_name: s0(r.lab_name), lab_ref: s0(r.lab_ref), method: s0(r.method), detection_limit: s0(r.detection_limit), lab_comment: s0(r.lab_comment), interpretation: s0(r.interpretation),
    received_date: r.received_date ?? null,
    results: r.results.map((x: any) => ({ key: x.id, id: x.id, animal_id: x.animal_id, raw_label: s0(x.raw_label), famacha: x.famacha, strongyles_epg: s0(x.strongyles_epg), nematodirus_epg: s0(x.nematodirus_epg), coccidia: s0(x.coccidia), confidence: x.confidence, corrected: false })),
  };
}
function fromForm(f: any) {
  const n = (v: string) => (v === '' || v === null || v === undefined ? null : Math.round(Number(v)));
  const s = (v: string) => (v?.trim() ? v.trim() : null);
  return {
    lab_name: s(f.lab_name), lab_ref: s(f.lab_ref), method: s(f.method), detection_limit: n(f.detection_limit), lab_comment: s(f.lab_comment), interpretation: s(f.interpretation),
    received_date: f.received_date,
    results: f.results.map((x: any) => ({ id: x.id ?? null, animal_id: x.animal_id || null, raw_label: s(x.raw_label), strongyles_epg: n(x.strongyles_epg), nematodirus_epg: n(x.nematodirus_epg), coccidia: s(x.coccidia), confidence: x.confidence ?? null, corrected: !!x.corrected })),
  };
}
