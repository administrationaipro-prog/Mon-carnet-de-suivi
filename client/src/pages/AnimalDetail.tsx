import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { del, put, todayIso } from '../api';
import { Icon, Sheep } from '../components/Icon';
import { InbreedingGauge, levelChip } from '../components/InbreedingGauge';
import { useApp } from '../state';
import { Badge, Card, ErrorMsg, Field, Loading, Modal, Notice, numOrNull, useLoad, useSubmit } from '../components/ui';
import { WeighingForm } from '../components/WeighingForm';
import { useBreeds } from './Herd';
import { ShareForBreeding } from './Breeding';

function daysBetween(a: string, b: string) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

export function AnimalDetail() {
  const { t, farm, d, dt, num, pct } = useApp();
  const { id } = useParams();
  const nav = useNavigate();
  const a = useLoad<any>(farm && id ? `/farms/${farm.id}/animals/${id}` : null, [id]);
  const hist = useLoad<any[]>(farm && id ? `/farms/${farm.id}/history?record=${id}` : null, [id]);
  const { label } = useBreeds();
  const [weighOpen, setWeighOpen] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const [tab, setTab] = useState<'growth' | 'health' | 'family' | 'repro'>('growth');
  const canWrite = farm?.role === 'owner' || farm?.role === 'collaborator';
  const remove = useSubmit(async () => {
    const reason = window.prompt(t('delete_reason'));
    if (!reason) return;
    await del(`/farms/${farm!.id}/animals/${id}?reason=${encodeURIComponent(reason)}`); nav('/herd');
  });
  if (!farm) return null;
  if (a.loading && !a.data) return <Loading />;
  if (a.error) return <ErrorMsg error={a.error} />;
  const x = a.data;
  const g = x.growth;
  const chart = x.birth_date ? x.weighings.map((w: any) => ({ age: daysBetween(x.birth_date, w.date), weight: w.weight_kg, date: w.date })) : x.weighings.map((w: any, i: number) => ({ age: i, weight: w.weight_kg, date: w.date }));
  const nm = (p: any) => (p ? <Link to={`/herd/${p.id}`}>{p.internal_id}{p.name ? ` — ${p.name}` : ''}</Link> : null);
  return (
    <div className="stack">
      <section className="hero animal-hero">
        <div className="row between">
          <button className="icon-btn" style={{ background: 'rgba(255,255,255,.16)', borderColor: 'transparent', color: '#fff' }} onClick={() => nav(-1)} aria-label={t('back')}><Icon name="back" /></button>
          <span className="chip">● {t(`astatus.${x.status}`)}</span>
        </div>
        <div className="animal-id" style={{ marginTop: '.9rem' }}>
          <span className="avatar"><Sheep size={48} wool="var(--primary)" /></span>
          <div style={{ minWidth: 0 }}>
            <h1>{x.name ?? x.internal_id}</h1>
            <div className="hero-sub">{x.internal_id}{x.official_id ? ` · ${x.official_id}` : ''} · {label(x.breed_code)}</div>
            <div className="hero-sub">{t(`sex.${x.sex}`)}{x.birth_date ? ` · ${t('born_on', { date: d(x.birth_date) })} · ${t('age_n_days', { n: daysBetween(x.birth_date, x.exit_date ?? todayIso()) })}` : ''}</div>
          </div>
        </div>
        <div className="animal-tags">
          {x.lot?.name && <span className="chip">{t('lot')} · {x.lot.name}</span>}
          {x.objective && <span className="chip">{t(`objective.${x.objective}`)}</span>}
          {x.inbreeding?.computable && <span className="chip">{t('inbreeding')} {num(x.inbreeding.coefficient_percent, 1)} %</span>}
          {g.schedule.overdue.length > 0 && <span className="chip" style={{ background: 'var(--danger)' }}>{t('overdue_weighings')} · {g.schedule.overdue.length}</span>}
        </div>
      </section>
      <div className="kpis">
        <div className="stat"><div className="stat-label">{t('last_weight')}</div><div className="stat-value">{g.last ? num(g.last.weight_kg, 2) : '—'}<small className="muted" style={{ fontSize: '.75rem' }}> kg</small></div></div>
        <div className="stat accent"><div className="stat-label">{t('gmq_overall')}</div><div className="stat-value">{g.overall !== null ? num(g.overall, 0) : '—'}<small className="muted" style={{ fontSize: '.75rem' }}> {t('gmq_unit')}</small></div></div>
        <div className="stat mango" title={t('next_weighing')}><div className="stat-label">{t('next_short')}</div><div className="stat-value">{g.schedule.next ? `J${g.schedule.next.day}` : '—'}</div>{g.schedule.next && <div className="stat-sub">{d(g.schedule.next.date)}</div>}</div>
        <div className="stat hide-mobile"><div className="stat-label">{t('weighings_n')}</div><div className="stat-value">{g.count}</div></div>
      </div>
      {canWrite && <div className="row wrap">
        <button className="btn primary" onClick={() => setWeighOpen(true)}><Icon name="scale" />{t('nav_weigh')}</button>
        <Link className="btn" to={`/herd/${x.id}/edit`}><Icon name="edit" size={18} />{t('edit')}</Link>
        {farm.role === 'owner' && <button className="btn danger" onClick={() => remove.run()}><Icon name="trash" size={18} />{t('delete')}</button>}
      </div>}
      <ErrorMsg error={remove.error} />
      <div className="seg-tabs" role="tablist" aria-label={t('identity')}>
        {(['growth', 'health', 'family', ...((x.sex === 'F' || x.repro.length > 0) ? ['repro'] : [])] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k as typeof tab)}>{t(`v3_tab_${k}`)}</button>
        ))}
      </div>
      {tab === 'family' && <>
      <div className="grid2">
        <Card title={t('identity')}>
          <dl className="dl">
            <dt>{t('official_id')}</dt><dd>{x.official_id ?? <span className="muted">{t('missing')}</span>}</dd>
            <dt>{t('sex')}</dt><dd>{t(`sex.${x.sex}`)}</dd>
            <dt>{t('birth_date')}</dt><dd>{x.birth_date ? d(x.birth_date) : <span className="muted">{t('missing')}</span>}</dd>
            <dt>{t('breed')}</dt><dd>{label(x.breed_code)}{x.breed_declared ? ` (« ${x.breed_declared} »)` : ''}</dd>
            <dt>{t('objective')}</dt><dd>{x.objective ? t(`objective.${x.objective}`) : '—'}</dd>
            <dt>{t('lot')}</dt><dd>{x.lot?.name ?? '—'}</dd>
            {x.status !== 'active' && <><dt>{t('exit_date')}</dt><dd>{d(x.exit_date)} {x.exit_reason ? `— ${x.exit_reason}` : ''}</dd></>}
            <dt>{t('completeness')}</dt><dd>{pct(x.completeness)}</dd>
          </dl>
          {x.notes && <p className="small">{x.notes}</p>}
        </Card>
        <Card title={t('genealogy')}>
          <dl className="dl">
            <dt>{t('sire')}</dt><dd>{nm(x.sire) ?? x.sire_external ?? <span className="muted">{t('unknown')}</span>}</dd>
            <dt>{t('dam')}</dt><dd>{nm(x.dam) ?? x.dam_external ?? <span className="muted">{t('unknown')}</span>}</dd>
            <dt>{t('parentage_source')}</dt><dd>{x.parentage_source ? t(`psrc.${x.parentage_source}`) : '—'} · {x.parentage_certainty ? t(`pcert.${x.parentage_certainty}`) : '—'}</dd>
            <dt>{t('grandparents')}</dt><dd>{x.grandparents.length ? x.grandparents.map((p: any) => <span key={p.id}>{nm(p)} </span>) : '—'}</dd>
            <dt>{t('offspring')}</dt><dd>{x.offspring.length ? x.offspring.map((p: any) => <span key={p.id}>{nm(p)} </span>) : '—'}</dd>
          </dl>
          {x.birth && <>
            <h3>{t('birth_record')}</h3>
            <dl className="dl">
              <dt>{t('litter_size')}</dt><dd>{x.birth.litter_size ?? '—'}</dd>
              <dt>{t('birth_weight')}</dt><dd>{num(x.birth.birth_weight_kg, 2)}</dd>
              <dt>{t('vitality')}</dt><dd>{x.birth.vitality ? t(`vital.${x.birth.vitality}`) : '—'}</dd>
              <dt>{t('colostrum')}</dt><dd>{x.birth.colostrum ? t(`colo.${x.birth.colostrum}`) : '—'}</dd>
              <dt>{t('assistance')}</dt><dd>{x.birth.assistance ? t(`assist.${x.birth.assistance}`) : '—'}</dd>
            </dl>
          </>}
        </Card>
      </div>

      {x.inbreeding && (
        <Card title={t('inbreeding')} actions={farm.role !== 'referent' && farm.role !== 'vet' && <Link className="btn small" to={`/simulateur?${x.sex === 'M' ? 'ram' : 'ewe'}=${x.id}`}><Icon name="dna" size={16} />{t('sim_open')}</Link>}>
          {x.inbreeding.computable ? (
            <div className="stack-sm">
              <div className="row between wrap">
                <div><div className="small muted" style={{ fontWeight: 700 }}>{t('inb_coef')}</div><div className="stat-value num" style={{ fontSize: '2.2rem' }}>{num(x.inbreeding.coefficient_percent, 2)} %</div></div>
                <span className={`chip ${levelChip(x.inbreeding.level)}`}>{t(`inb_level.${x.inbreeding.level}`)}</span>
              </div>
              <InbreedingGauge percent={x.inbreeding.coefficient_percent} warn={x.inbreeding.warn_percent} max={x.inbreeding.limit_percent} />
              <p className="small muted" style={{ margin: 0 }}>{t('inb_generations', { n: x.inbreeding.generations_known })} · {t('inb_completeness', { pct: pct(x.inbreeding.completeness) })}</p>
              <p className="small muted" style={{ margin: 0 }}>{t('inb_min_note')}</p>
            </div>
          ) : <p className="muted" style={{ margin: 0 }}>{t('inb_not_computable')}</p>}
        </Card>
      )}

      {farm.role !== 'referent' && farm.role !== 'vet' && <ShareForBreeding animal={x} />}
      </>}
      {tab === 'growth' && <>
      <Card title={t('growth_curve')}>
        {g.schedule.overdue.length > 0 && <Notice kind="warn">{t('overdue_weighings')} : {g.schedule.overdue.map((o: any) => `J${o.day} (${d(o.date)})`).join(', ')}</Notice>}
        {chart.length > 0 && (
          <div className="chart" role="img" aria-label={t('growth_curve')}>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chart} margin={{ top: 12, right: 14, bottom: 4, left: 0 }}>
                <defs><linearGradient id="growthFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--primary-bright)" stopOpacity={0.35} /><stop offset="1" stopColor="var(--primary-bright)" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="age" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => (x.birth_date ? `J${v}` : '')} stroke="var(--muted)" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis width={52} tickFormatter={(v: number) => `${num(v, 1)}`} stroke="var(--muted)" domain={['auto', 'auto']} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip formatter={(v: any) => [`${num(Number(v), 2)} kg`, t('weight_kg')]} labelFormatter={(_l: any, p: any) => (p?.[0] ? d(p[0].payload.date) : '')}
                  contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }} />
                <Area type="monotone" dataKey="weight" stroke="var(--primary)" strokeWidth={3} fill="url(#growthFill)" dot={{ r: 5, fill: 'var(--surface)', stroke: 'var(--primary)', strokeWidth: 3 }} activeDot={{ r: 7 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="grid2">
          <div>
            <h3>{t('gmq_periods')}</h3>
            {g.periods.length === 0 ? <p className="muted small">{t('missing_data')}</p> : (
              <div className="period-cards">{g.periods.map((p: any) => (
                <div className="stat" key={p.from}><div className="stat-label">{d(p.from).slice(0, 5)} → {d(p.to).slice(0, 5)} · {p.days} j</div><div className="stat-value" style={{ color: p.gmq < 0 ? 'var(--danger)' : undefined }}>{num(p.gmq, 0)} <small className="muted" style={{ fontSize: '.72rem' }}>{t('gmq_unit')}</small></div></div>
              ))}</div>
            )}
          </div>
          <div>
            <h3>{t('standard_weights')}</h3>
            <table className="table compact"><tbody>{['j30', 'j60', 'j90', 'j120'].map((k) => <tr key={k}><td>{k.toUpperCase()}</td><td className="num">{g.standard_weights[k] !== null ? `${num(g.standard_weights[k], 2)} kg` : <span className="muted">{t('not_available')}</span>}</td></tr>)}</tbody></table>
          </div>
        </div>
      </Card>

      <Card title={t('weighing_history')}>
        {x.weighings.length === 0 ? <p className="muted">{t('missing_data')}</p> : (
          <>
            {canWrite && <p className="small muted" style={{ margin: '0 0 .6rem' }}>{t('weighing_tap_hint')}</p>}
            <div className="table-wrap"><table className="table">
              <thead><tr>{canWrite && <th aria-label={t('correct')} />}<th>{t('date')}</th><th className="num">{t('weight_kg')}</th><th className="num">{t('height_cm')}</th><th className="num">{t('length_cm')}</th><th>{t('operator')}</th><th>{t('note')}</th></tr></thead>
              <tbody>{x.weighings.map((w: any) => (
                <tr key={w.id} className={canWrite ? 'row-action' : ''} onClick={canWrite ? () => setEdit(w) : undefined}>
                  {canWrite && <td style={{ width: 52 }}><button type="button" className="icon-btn small" aria-label={`${t('correct')} ${d(w.date)}`} onClick={(e) => { e.stopPropagation(); setEdit(w); }}><Icon name="edit" size={18} /></button></td>}
                  <td>{d(w.date)}</td><td className="num"><b>{num(w.weight_kg, 2)}</b></td><td className="num">{num(w.height_cm)}</td><td className="num">{num(w.length_cm)}</td><td>{w.operator_name ?? '—'}{w.source === 'offline_sync' ? ' ⇅' : ''}</td><td>{w.note ?? ''}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </>
        )}
      </Card>

      {!!hist.data?.length && (
        <Card title={t('history_corrections')}>
          <ul className="list small">{hist.data.map((h) => <li key={h.id}>{dt(h.at)} · {h.actor_name} · {h.action}{h.reason ? ` · ${h.reason}` : ''}</li>)}</ul>
        </Card>
      )}
      </>}
      {tab === 'health' && <div className="grid2">
        <Card title={t('health_title')} actions={canWrite && <Link className="btn small" to={`/health?animal=${x.id}`}>＋</Link>}>
          {x.health.length === 0 ? <p className="muted">—</p> : <ul className="list small">{x.health.map((h: any) => (
            <li key={h.id}>{d(h.date)} · <strong>{t(`htype.${h.type}`)}</strong>{h.symptoms ? ` · ${h.symptoms}` : ''}{h.diagnosis ? ` · ${t(`dstatus.${h.diagnosis_status}`)} : ${h.diagnosis}` : ''}{h.treatment || h.product ? ` · ${h.treatment ?? ''} ${h.product ?? ''}` : ''}{h.analysis_result ? ` · ${h.analysis_type ?? ''} ${h.analysis_result}` : ''}</li>
          ))}</ul>}
        </Card>
        <Card title={t('feeding_title')}>
          {x.feeding.length === 0 ? <p className="muted">—</p> : <ul className="list small">{x.feeding.map((f: any) => (
            <li key={f.id}>{d(f.start_date)}{f.end_date ? ` → ${d(f.end_date)}` : ''} · {f.feed} · {num(f.quantity_kg, 2)} kg ({t(`basis.${f.basis}`)}, {t(`fkind.${f.kind}`)}){f.lot_id ? ` · ${t('lot')}` : ''}</li>
          ))}</ul>}
        </Card>
      </div>}
      {tab === 'repro' && (
        <Card title={t('repro_title')} actions={canWrite && x.sex === 'F' && <Link className="btn small" to={`/repro?ewe=${x.id}`}>＋</Link>}>
          {x.repro.length === 0 ? <p className="muted">—</p> : <ul className="list small">{x.repro.map((r: any) => (
            <li key={r.id}>{d(r.date)} · {t(`rtype.${r.type}`)}{r.ram_internal_id ? ` · ${t('ram')} ${r.ram_internal_id}` : ''}{r.born_alive !== null ? ` · ${t('born_alive')} ${r.born_alive}` : ''}{r.born_dead ? ` · ${t('born_dead')} ${r.born_dead}` : ''}{r.weaned !== null ? ` · ${t('weaned')} ${r.weaned}` : ''}{r.result ? ` · ${r.result}` : ''}</li>
          ))}</ul>}
        </Card>
      )}

      {weighOpen && <Modal title={`${t('nav_weigh')} — ${x.internal_id}`} onClose={() => setWeighOpen(false)}><WeighingForm animal={x} last={g.last} onSaved={() => { a.reload(); }} /></Modal>}
      {edit && <EditWeighing w={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); a.reload(); hist.reload(); }} />}
    </div>
  );
}

function EditWeighing({ w, onClose, onDone }: { w: any; onClose: () => void; onDone: () => void }) {
  const { t, farm } = useApp();
  const [f, setF] = useState({ date: w.date, weight_kg: String(w.weight_kg), height_cm: w.height_cm ?? '', length_cm: w.length_cm ?? '', note: w.note ?? '', reason: '' });
  const [confirm, setConfirm] = useState(false);
  const s = useSubmit(async (mode: 'save' | 'delete') => {
    if (mode === 'delete') await del(`/farms/${farm!.id}/weighings/${w.id}?reason=${encodeURIComponent(f.reason)}`);
    else await put(`/farms/${farm!.id}/weighings/${w.id}`, { date: f.date, weight_kg: numOrNull(f.weight_kg), height_cm: numOrNull(String(f.height_cm)), length_cm: numOrNull(String(f.length_cm)), note: f.note || null, reason: f.reason, confirm });
    onDone();
  });
  const err: any = s.error;
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={t('correct')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run('save'); }}>
        <div className="grid2">
          <Field label={t('date')}><input type="date" value={f.date} onChange={up('date')} /></Field>
          <Field label={t('weight_kg')}><input type="number" step="0.01" value={f.weight_kg} onChange={up('weight_kg')} /></Field>
          <Field label={t('height_cm')}><input type="number" step="0.1" value={f.height_cm} onChange={up('height_cm')} /></Field>
          <Field label={t('length_cm')}><input type="number" step="0.1" value={f.length_cm} onChange={up('length_cm')} /></Field>
        </div>
        <Field label={t('correction_reason')} required hint={!f.reason ? t('delete_needs_reason') : undefined}><input required value={f.reason} onChange={up('reason')} /></Field>
        <div className="date-chips">{['reason_typo', 'reason_duplicate', 'reason_wrong_animal'].map((k) => <button type="button" key={k} onClick={() => setF({ ...f, reason: t(k) })}>{t(k)}</button>)}</div>
        {err?.status === 422 ? (
          <Notice kind="warn">{t('confirm_warnings', { list: (err.details?.warnings ?? []).map((x: string) => t(`warn.${x}`)).join(' ; ') })}
            <label className="check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> {t('confirm')}</label></Notice>
        ) : <ErrorMsg error={s.error} />}
        <div className="row between">
          <button className="btn primary" disabled={s.busy}>{t('save')}</button>
          <button type="button" className="btn danger" disabled={s.busy || !f.reason} onClick={() => s.run('delete')}>{t('delete')}</button>
        </div>
      </form>
    </Modal>
  );
}
