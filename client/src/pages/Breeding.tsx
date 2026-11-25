import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { patch, post } from '../api';
import { useApp } from '../state';
import { Badge, Card, ErrorMsg, Field, Loading, Notice, useLoad, useSubmit } from '../components/ui';
import { Icon } from '../components/Icon';
import { InbreedingGauge, levelChip } from '../components/InbreedingGauge';
import { useBreeds } from './Herd';

const emoji = (a: any) => (a?.species === 'caprine' ? '🐐' : a?.sex === 'M' ? '🐏' : '🐑');
const PSTATUS: Record<string, 'warn' | 'ok' | 'error' | 'neutral'> = { pending: 'warn', accepted: 'ok', declined: 'error', cancelled: 'neutral' };
const useCanWrite = () => { const { farm } = useApp(); return !!farm && (farm.role === 'owner' || farm.role === 'collaborator'); };

function AnimalLine({ a, farm, mine }: { a: any; farm?: { name: string; locality?: string | null }; mine?: boolean }) {
  const { t } = useApp();
  const { label } = useBreeds();
  const years = a.age_days !== null && a.age_days !== undefined ? (a.age_days >= 365 ? t('br_years', { n: Math.floor(a.age_days / 365) }) : t('br_months', { n: Math.max(1, Math.floor(a.age_days / 30.4)) })) : null;
  return (
    <div className="row nowrap" style={{ alignItems: 'center', minWidth: 0 }}>
      <span className={`br-ani ${mine ? 'mine' : 'theirs'}`}>{emoji(a)}</span>
      <span style={{ minWidth: 0 }}><b>{a.name ?? a.internal_id}</b>
        <div className="small muted">{[t(`sex.${a.sex}`), label(a.breed_code), years, a.official_id].filter(Boolean).join(' · ')}</div>
        {farm && <span className={`farmtag ${mine ? 'mine' : 'theirs'}`}>{mine ? t('br_my_farm') : `${farm.name}${farm.locality ? ` · ${farm.locality}` : ''}`}</span>}</span>
    </div>
  );
}

// ======================= Catalogue + Mes saillies =======================
export function BreedingHome() {
  const { t, farm, num } = useApp();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'mine' ? 'mine' : 'catalog';
  const [f, setF] = useState({ species: 'ovine', sex: '', compatible: false, q: '' });
  const [code, setCode] = useState('');
  const qs = new URLSearchParams({ farm: farm?.id ?? '', species: f.species, ...(f.sex && { sex: f.sex }), ...(f.compatible && { compatible: '1' }), ...(f.q.trim() && { q: f.q.trim() }) }).toString();
  const cat = useLoad<any[]>(farm && tab === 'catalog' ? `/breeding/catalog?${qs}` : null, [qs, tab]);
  const mine = useLoad<any>(farm ? `/farms/${farm.id}/breeding/mine` : null, [farm?.id, tab]);
  if (!farm) return null;
  const pending = (mine.data?.received ?? []).filter((p: any) => p.status === 'pending').length;
  return (
    <div className="stack">
      <h1><Icon name="dna" size={26} />{t('br_title')}</h1>
      <div className="seg-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'catalog'} className={tab === 'catalog' ? 'on' : ''} onClick={() => setSp({})}>{t('br_tab_catalog')}</button>
        <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => setSp({ tab: 'mine' })}>{t('br_tab_mine')}{pending > 0 ? ` (${pending})` : ''}</button>
      </div>
      {tab === 'catalog' ? (
        <>
          <p className="muted" style={{ margin: 0 }}>{t('br_intro')}</p>
          <div className="br-filters">
            <div className="segmented">{['ovine', 'caprine'].map((s) => <button key={s} type="button" className={f.species === s ? 'on' : ''} onClick={() => setF({ ...f, species: s })}>{t(`species.${s}`)}</button>)}</div>
            <div className="segmented">{[['', 'all'], ['M', 'br_males'], ['F', 'br_females']].map(([v, k]) => <button key={v} type="button" className={f.sex === v ? 'on' : ''} onClick={() => setF({ ...f, sex: v })}>{t(k)}</button>)}</div>
            <div className="segmented"><button type="button" className={f.compatible ? 'on' : ''} aria-pressed={f.compatible} onClick={() => setF({ ...f, compatible: !f.compatible })}>✓ {t('br_compatible_only')}</button></div>
            <input type="search" style={{ flex: '1 1 12rem', minHeight: 40 }} placeholder={t('br_search')} aria-label={t('br_search')} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          </div>
          <ErrorMsg error={cat.error} />
          {cat.loading && !cat.data ? <Loading /> : !cat.data?.length ? <Notice>{t('br_empty')}</Notice> : (
            <div className="br-grid">{cat.data.map((l) => (
              <div key={l.id} className="br-card">
                <div className={`br-ph ${l.animal.sex === 'M' ? 'm' : 'f'}`}><span>{emoji(l.animal)}</span>
                  <span className="chip ok br-tl">{t(`bmod.${l.modality}`)}</span><span className="chip info br-tr">{l.available_until ? t('br_until_short', { date: l.available_until.split('-').reverse().slice(0, 2).join('/') }) : t('br_no_end')}</span></div>
                <div className="br-bd">
                  <AnimalLine a={l.animal} farm={l.farm} />
                  <div className="br-kp">
                    <div><small>{t('br_gmq')}</small><b>{l.perf.gmq === null ? '—' : `${num(l.perf.gmq, 0)}`}</b></div>
                    <div><small>{t('br_progeny')}</small><b>{l.perf.progeny_n}</b></div>
                    <div><small>{l.animal.sex === 'F' ? t('br_litter') : t('br_success')}</small><b>{l.animal.sex === 'F' ? (l.perf.litter_mean === null ? '—' : num(l.perf.litter_mean, 1)) : l.perf.success_rate === null ? '—' : `${num(l.perf.success_rate * 100, 0)} %`}</b></div>
                  </div>
                  <div className={`br-compat ${l.compat.ok ? 'ok' : l.compat.warning ? 'w' : 'no'}`}>{l.compat.total === 0 ? t('br_compat_none_mates', { sex: t(l.animal.sex === 'M' ? 'br_females' : 'br_males').toLowerCase() }) : l.compat.ok === l.compat.total ? t('br_compat_all', { n: l.compat.total }) : t('br_compat_some', { ok: l.compat.ok, w: l.compat.warning, n: l.compat.total })}</div>
                  <div className="row nowrap" style={{ marginTop: 'auto' }}>
                    <Link className="btn small" style={{ flex: 1 }} to={`/saillies/annonce/${l.id}`}>{t('br_view')}</Link>
                    <Link className="btn small primary" style={{ flex: 1 }} to={`/saillies/simulation?listing=${l.id}`}><Icon name="dna" size={16} />{t('br_simulate')}</Link>
                  </div>
                </div>
              </div>
            ))}</div>
          )}
          <Card title={t('br_have_code')}>
            <form className="row" onSubmit={(e) => { e.preventDefault(); nav(`/saillies/simulation?code=${encodeURIComponent(code.trim())}`); }}>
              <input aria-label={t('br_code')} placeholder="K7M-4Q2" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ flex: '0 1 12rem', letterSpacing: '.2em', fontWeight: 800, textAlign: 'center' }} />
              <button className="btn" disabled={code.replace(/[^A-Z0-9]/gi, '').length !== 6}>{t('br_use_code')}</button>
            </form>
          </Card>
        </>
      ) : <MyBreeding data={mine.data} error={mine.error} reload={mine.reload} />}
    </div>
  );
}

function MyBreeding({ data, error, reload }: { data: any; error: any; reload: () => void }) {
  const { t, farm, d, num } = useApp();
  const canWrite = useCanWrite();
  const st = useSubmit(async (id: string, status: string) => { await patch(`/farms/${farm!.id}/breeding/listings/${id}`, { status }); reload(); });
  if (!data) return error ? <ErrorMsg error={error} /> : <Loading />;
  const prop = (p: any, incoming: boolean) => (
    <li key={p.id}><Link className="task" to={`/saillies/proposition/${p.id}`}>
      <span className="br-ani theirs" style={{ width: 40, height: 40, fontSize: 20 }}>{emoji(p.theirs)}</span>
      <span className="t"><b>{p.theirs.name ?? p.theirs.internal_id} × {p.mine.name ?? p.mine.internal_id}</b>
        <small>{incoming ? p.from_farm : p.to_farm} · {d(p.created_at)} · {t('br_inb_short', { n: num(p.coefficient_percent, 2) })}</small></span>
      <Badge kind={PSTATUS[p.status]}>{t(`bpst.${p.status}`)}</Badge>
    </Link></li>
  );
  return (
    <div className="stack">
      <ErrorMsg error={st.error} />
      <Card title={t('br_my_listings')}>
        {!data.listings.length ? <p className="muted" style={{ margin: 0 }}>{t('br_no_listing')}</p> : (
          <ul className="list">{data.listings.map((l: any) => (
            <li key={l.id} className="stack-sm">
              <div className="row between"><span className="row nowrap"><span className="br-ani mine" style={{ width: 40, height: 40, fontSize: 20 }}>{emoji(l)}</span><span><Link to={`/herd/${l.animal_id}`}><b>{l.name ?? l.internal_id}</b></Link><div className="small muted">{l.available_until ? t('br_until', { date: d(l.available_until) }) : t('br_no_end')} · {t(`bmod.${l.modality}`)}</div></span></span>
                <Badge kind={l.status === 'active' ? 'ok' : 'warn'}>{t(`blst.${l.status}`)}</Badge></div>
              <div className="br-stat3"><div><b>{l.views}</b><small>{t('br_views')}</small></div><div><b>{l.simulations}</b><small>{t('br_simulations')}</small></div><div><b>{l.proposals}</b><small>{t('br_proposals')}</small></div></div>
              {canWrite && <div className="row">
                {l.status === 'active' ? <button className="btn small" onClick={() => st.run(l.id, 'paused')}>{t('br_pause')}</button> : <button className="btn small primary" onClick={() => st.run(l.id, 'active')}>{t('br_resume')}</button>}
                <button className="btn small danger" onClick={() => window.confirm(t('br_withdraw_confirm')) && st.run(l.id, 'withdrawn')}>{t('br_withdraw')}</button>
              </div>}
            </li>
          ))}</ul>
        )}
        <p className="small muted" style={{ margin: '.6rem 0 0' }}>{t('br_publish_hint')}</p>
      </Card>
      {!!data.codes.length && <Card title={t('br_codes')}><ul className="list">{data.codes.map((k: any) => <li key={k.id} className="row between"><span><b className="num" style={{ letterSpacing: '.15em' }}>{k.code}</b> · {k.name ?? k.internal_id}</span><span className="small muted">{t('br_until', { date: d(k.expires_at) })}</span></li>)}</ul></Card>}
      <Card title={t('br_received')}>{!data.received.length ? <p className="muted" style={{ margin: 0 }}>—</p> : <ul className="tasks">{data.received.map((p: any) => prop(p, true))}</ul>}</Card>
      <Card title={t('br_sent')}>{!data.sent.length ? <p className="muted" style={{ margin: 0 }}>—</p> : <ul className="tasks">{data.sent.map((p: any) => prop(p, false))}</ul>}</Card>
    </div>
  );
}

// ======================= Fiche d'annonce =======================
export function ListingPage() {
  const { t, farm, d, num } = useApp();
  const nav = useNavigate();
  const { id } = useParams();
  const r = useLoad<any>(farm && id ? `/breeding/listings/${id}?farm=${farm.id}` : null, [id]);
  if (!farm) return null;
  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <ErrorMsg error={r.error} />;
  const x = r.data, p = x.perf;
  return (
    <div className="stack">
      <div className="row nowrap"><button className="icon-btn" onClick={() => nav('/saillies')} aria-label={t('back')}><Icon name="back" /></button><h1 style={{ fontSize: '1.4rem' }}>{t('br_listing')}</h1></div>
      <Card>
        <div className={`br-ph big ${x.animal.sex === 'M' ? 'm' : 'f'}`}><span>{emoji(x.animal)}</span></div>
        <div style={{ marginTop: '.8rem' }}><AnimalLine a={x.animal} farm={x.farm} /></div>
        <div className="row" style={{ marginTop: '.5rem' }}><span className="chip ok">{t(`bmod.${x.modality}`)}</span><span className="chip info">{x.available_until ? t('br_until', { date: d(x.available_until) }) : t('br_no_end')}</span></div>
        {x.conditions && <p className="small" style={{ marginBottom: 0 }}><b>{t('br_conditions')} :</b> {x.conditions}</p>}
      </Card>
      <div className="br-stat3">
        <div><b>{p.gmq === null ? '—' : num(p.gmq, 0)}</b><small>{t('br_gmq')}</small></div>
        <div><b>{p.progeny.n}</b><small>{t('br_progeny')}</small></div>
        <div><b>{x.animal.sex === 'F' ? (p.litter.mean === null ? '—' : num(p.litter.mean, 1)) : p.success.rate === null ? '—' : `${num(p.success.rate * 100, 0)} %`}</b><small>{x.animal.sex === 'F' ? t('br_litter') : t('br_success')}</small></div>
      </div>
      <Card title={t(x.animal.sex === 'M' ? 'br_compat_females' : 'br_compat_males')}>
        {!x.mates.length ? <p className="muted" style={{ margin: 0 }}>{t('br_no_mates')}</p> : (
          <ul className="list">{x.mates.map((m: any) => (
            <li key={m.id} className="row between nowrap">
              <span><b>{m.name ?? m.internal_id}</b></span>
              <span className="row nowrap"><span className={`chip ${levelChip(m.level)}`}>{num(m.coefficient_percent, 2)} % · {t(`inb_level.${m.level}`)}</span>
                {m.level !== 'refused' && <Link className="btn small primary" to={`/saillies/simulation?listing=${x.id}&my=${m.id}`}>{t('br_simulate')}</Link>}</span>
            </li>
          ))}</ul>
        )}
        <p className="small muted" style={{ margin: '.6rem 0 0' }}>{t('br_compat_note')}</p>
      </Card>
    </div>
  );
}

// ======================= Résultat de simulation (partagé) =======================
export function BreedingResult({ r }: { r: any }) {
  const { t, num, d } = useApp();
  const inb = r.inbreeding, lamb = r.lamb;
  const ram = r.male === 'mine' ? r.mine : r.theirs, ewe = r.male === 'mine' ? r.theirs : r.mine;
  const n = (v: number | null | undefined, dg = 0, u = '') => (v === null || v === undefined ? '—' : `${num(v, dg)}${u}`);
  const row = (label: string, a: string, b: string, c: string) => (<><div className="l">{label}</div><div className="v">{a}</div><div className="v">{b}</div><div className="v est">{c}</div></>);
  return (
    <div className="stack">
      <Card>
        <div className="br-pair">
          <AnimalLine a={ram.animal} farm={ram.farm} mine={ram === r.mine} />
          <span className="br-x">×</span>
          <AnimalLine a={ewe.animal} farm={ewe.farm} mine={ewe === r.mine} />
        </div>
      </Card>
      <div className="grid2">
        <Card title={t('sim_f_label')} actions={<span className={`chip ${levelChip(inb.level)}`}>{t(`sim_verdict.${inb.level}`)}</span>}>
          <div className="stat-value num" style={{ fontSize: '2.2rem' }}>{num(inb.coefficient_percent, 2)} %</div>
          <InbreedingGauge percent={inb.coefficient_percent} warn={inb.warn_percent} max={inb.limit_percent} />
          {inb.common_ancestors.length ? (
            <><b className="small">{t('br_common')}</b>
              <div className="row" style={{ gap: '.3rem', marginTop: '.3rem' }}>{inb.common_ancestors.map((c: any, i: number) => <span key={i} className="chip">{c.label}{c.official ? ` · ${c.official}` : ''}</span>)}</div></>
          ) : <p className="small muted" style={{ margin: 0 }}>{t('br_no_common')}</p>}
          <p className="small muted" style={{ margin: '.5rem 0 0' }}>{t('br_ped_note', { a: num(inb.pedigree.a_completeness * 100, 0), b: num(inb.pedigree.b_completeness * 100, 0) })}</p>
        </Card>
        <div className="stack">
          <Card title={t('br_perf')}>
            <div className="compare br-cmp">
              <div className="h" /><div className="h v">{ram.animal.name ?? ram.animal.internal_id}</div><div className="h v">{ewe.animal.name ?? ewe.animal.internal_id}</div><div className="h v">{t('br_lamb')}</div>
              {row(t('br_w30'), n(ram.perf.weight_j30, 1, ' kg'), n(ewe.perf.weight_j30, 1, ' kg'), lamb.weight_j30 === null ? '—' : `≈ ${num(lamb.weight_j30, 1)} kg`)}
              {row(t('br_w90'), n(ram.perf.weight_j90, 1, ' kg'), n(ewe.perf.weight_j90, 1, ' kg'), lamb.weight_j90 === null ? '—' : `≈ ${num(lamb.weight_j90, 1)} kg`)}
              {row(t('gmq_overall'), n(ram.perf.gmq, 0, ' g/j'), n(ewe.perf.gmq, 0, ' g/j'), lamb.gmq === null ? '—' : `≈ ${num(lamb.gmq, 0)} g/j`)}
              {row(t('br_progeny'), String(ram.perf.progeny.gmq_n), String(ewe.perf.progeny.gmq_n), '—')}
              {row(t('br_progeny_gmq'), n(ram.perf.progeny.gmq_mean, 0, ' g/j'), n(ewe.perf.progeny.gmq_mean, 0, ' g/j'), lamb.gmq_range ? `${lamb.gmq_range.low}–${lamb.gmq_range.high}` : '—')}
            </div>
          </Card>
          <div className="br-pred">
            <div className="row between"><b>{t('br_lamb_title')}</b><span className="chip warn">{t('br_indicative')}</span></div>
            <div className="br-stat3" style={{ marginTop: '.6rem' }}>
              <div><b>{lamb.gmq === null ? '—' : `≈ ${num(lamb.gmq, 0)}`}</b><small>{t('br_gmq_expected')}</small></div>
              <div><b>{lamb.weight_j90 === null ? '—' : `≈ ${num(lamb.weight_j90, 1)}`}</b><small>{t('br_w90')} (kg)</small></div>
              <div><b>{lamb.litter === null ? '—' : `≈ ${num(lamb.litter, 1)}`}</b><small>{t('br_litter')}</small></div>
            </div>
            <p className="small" style={{ margin: '.6rem 0 0' }}>{t('br_lamb_note', { rel: t(`brel.${lamb.reliability}`), n: lamb.progeny_weighed })}</p>
          </div>
        </div>
      </div>
      <Card>
        <p className="small" style={{ margin: 0 }}><b>{t('br_success_rates')}</b> {ram.animal.name ?? ram.animal.internal_id} : {ram.perf.success.n ? t('br_success_line', { k: ram.perf.success.k, n: ram.perf.success.n }) : t('br_success_none')} · {ewe.animal.name ?? ewe.animal.internal_id} : {ewe.perf.litter.n ? t('br_litter_line', { n: ewe.perf.litter.n, m: num(ewe.perf.litter.mean, 1) }) : t('br_success_none')}</p>
        {r.listing?.conditions && <p className="small" style={{ margin: '.4rem 0 0' }}><b>{t('br_conditions')} :</b> {r.listing.conditions} · {t(`bmod.${r.listing.modality}`)}{r.listing.available_until ? ` · ${t('br_until', { date: d(r.listing.available_until) })}` : ''}</p>}
      </Card>
    </div>
  );
}

// ======================= Simulation à deux =======================
export function BreedingSimulation() {
  const { t, farm } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const listing = sp.get('listing'), code = sp.get('code');
  const target = useLoad<any>(farm && (listing || code) ? `/farms/${farm.id}/breeding/resolve?${listing ? `listing=${listing}` : `code=${encodeURIComponent(code!)}`}` : null, [listing, code]);
  const animals = useLoad<any[]>(farm ? `/farms/${farm.id}/animals` : null, [farm?.id]);
  const [my, setMy] = useState(sp.get('my') ?? '');
  const [msg, setMsg] = useState('');
  const sim = useLoad<any>(farm && my && (listing || code) ? `/farms/${farm.id}/breeding/simulate?my=${my}&${listing ? `listing=${listing}` : `code=${encodeURIComponent(code!)}`}` : null, [my, listing, code]);
  const send = useSubmit(async () => { await post(`/farms/${farm!.id}/breeding/proposals`, { my_animal_id: my, listing_id: listing, code, message: msg || null }); nav('/saillies?tab=mine'); });
  const canWrite = useCanWrite();
  const other = target.data?.animal;
  const mates = (animals.data ?? []).filter((a) => a.status === 'active' && other && a.sex !== other.sex && (a.species ?? 'ovine') === (other.species ?? 'ovine'));
  useEffect(() => { if (!my && mates.length === 1) setMy(mates[0].id); }, [mates.length]); // eslint-disable-line
  if (!farm) return null;
  return (
    <div className="stack">
      <div className="row nowrap"><button className="icon-btn" onClick={() => nav(-1)} aria-label={t('back')}><Icon name="back" /></button><h1 style={{ fontSize: '1.4rem' }}>{t('br_sim_title')}</h1></div>
      <ErrorMsg error={target.error} />
      {target.loading && !target.data ? <Loading /> : other && (
        <Card>
          <AnimalLine a={other} farm={target.data.farm} />
          <div className="br-x" style={{ textAlign: 'center', margin: '.4rem 0' }}>×</div>
          <Field label={t(other.sex === 'M' ? 'br_my_female' : 'br_my_male')} required>
            <select value={my} onChange={(e) => setMy(e.target.value)}><option value="">{t('sim_pick')}</option>{mates.map((a) => <option key={a.id} value={a.id}>{a.name ?? a.internal_id}{a.official_id ? ` · ${a.official_id}` : ''}</option>)}</select>
          </Field>
          {animals.data && !mates.length && <Notice kind="warn">{t('br_no_mates')}</Notice>}
        </Card>
      )}
      <ErrorMsg error={sim.error} />
      {sim.loading && my && !sim.data ? <Loading /> : sim.data && sim.data.mine.animal.id === my && (
        <>
          <BreedingResult r={sim.data} />
          {canWrite && (
            <Card title={t('br_send_title', { farm: sim.data.theirs.farm.name })}>
              <p className="small muted" style={{ marginTop: 0 }}>{t('br_send_note')}</p>
              <Field label={t('br_message')}><textarea maxLength={1000} value={msg} placeholder={t('br_message_ph')} onChange={(e) => setMsg(e.target.value)} /></Field>
              <ErrorMsg error={send.error} />
              <button className="btn primary" disabled={send.busy || sim.data.inbreeding.would_be_refused} onClick={() => send.run()}><Icon name="users" size={18} />{t('br_send')}</button>
              {sim.data.inbreeding.would_be_refused && <p className="small" style={{ color: 'var(--danger)' }}>{t('br_refused_note')}</p>}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ======================= Proposition =======================
export function ProposalPage() {
  const { t, farm, dt } = useApp();
  const nav = useNavigate();
  const { id } = useParams();
  const p = useLoad<any>(farm && id ? `/farms/${farm.id}/breeding/proposals/${id}` : null, [id]);
  const [msg, setMsg] = useState('');
  const canWrite = useCanWrite();
  const respond = useSubmit(async (accept: boolean) => { p.setData(await post(`/farms/${farm!.id}/breeding/proposals/${id}/respond`, { accept, message: msg || null })); });
  const cancel = useSubmit(async () => { p.setData(await post(`/farms/${farm!.id}/breeding/proposals/${id}/cancel`)); });
  if (!farm) return null;
  if (p.loading && !p.data) return <Loading />;
  if (p.error) return <ErrorMsg error={p.error} />;
  const x = p.data;
  return (
    <div className="stack">
      <div className="row between"><div className="row nowrap"><button className="icon-btn" onClick={() => nav('/saillies?tab=mine')} aria-label={t('back')}><Icon name="back" /></button>
        <div><h1 style={{ fontSize: '1.35rem' }}>{t('br_proposal')}</h1><div className="small muted">{x.incoming ? t('br_from', { farm: x.from_farm }) : t('br_to', { farm: x.to_farm })} · {dt(x.created_at)}</div></div></div>
        <Badge kind={PSTATUS[x.status]}>{t(`bpst.${x.status}`)}</Badge></div>
      {x.message && <Card><b className="small">{t('br_message')}</b><p style={{ margin: '.3rem 0 0' }}>« {x.message} »</p></Card>}
      {x.response_message && <Card><b className="small">{t('br_response')}</b><p style={{ margin: '.3rem 0 0' }}>« {x.response_message} »</p></Card>}
      <BreedingResult r={x.result} />
      {x.status === 'pending' && canWrite && (x.incoming ? (
        <Card title={t('br_answer')}>
          <Field label={t('br_message')}><textarea maxLength={1000} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t('br_answer_ph')} /></Field>
          <ErrorMsg error={respond.error} />
          <div className="row"><button className="btn" disabled={respond.busy} onClick={() => respond.run(false)}>{t('br_decline')}</button><button className="btn primary" disabled={respond.busy} onClick={() => respond.run(true)}>{t('br_accept')}</button></div>
          <p className="small muted" style={{ margin: '.5rem 0 0' }}>{t('br_accept_note')}</p>
        </Card>
      ) : <div className="row"><button className="btn danger small" disabled={cancel.busy} onClick={() => cancel.run()}>{t('br_cancel')}</button><ErrorMsg error={cancel.error} /></div>)}
      <p className="small muted">{t('br_snapshot_note', { date: dt(x.result.simulated_at) })}</p>
    </div>
  );
}

// ======================= Partage depuis la fiche animale =======================
export function ShareForBreeding({ animal }: { animal: any }) {
  const { t, farm, d } = useApp();
  const cur = useLoad<any>(farm ? `/farms/${farm.id}/breeding/animal/${animal.id}` : null, [animal.id]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ months: 3 as number | null, locality: '', modality: 'onsite', conditions: '' });
  const [code, setCode] = useState<any>(null);
  const canWrite = useCanWrite();
  const pub = useSubmit(async () => { await post(`/farms/${farm!.id}/breeding/listings`, { animal_id: animal.id, ...f, locality: f.locality || null, conditions: f.conditions || null }); setOpen(false); cur.reload(); });
  const mk = useSubmit(async () => { setCode(await post(`/farms/${farm!.id}/breeding/codes`, { animal_id: animal.id })); cur.reload(); });
  const st = useSubmit(async (status: string) => { await patch(`/farms/${farm!.id}/breeding/listings/${cur.data.listing.id}`, { status }); cur.reload(); });
  const l = cur.data?.listing;
  useEffect(() => { if (l && !open) setF({ months: 3, locality: l.locality ?? '', modality: l.modality, conditions: l.conditions ?? '' }); }, [l?.id]); // eslint-disable-line
  if (!farm || animal.status !== 'active') return null;
  return (
    <Card title={t('br_card_title')}>
      <div className="stack-sm">
        <Link className="task" to={`/simulateur?${animal.sex === 'M' ? 'ram' : 'ewe'}=${animal.id}`}><span className="ic"><Icon name="dna" /></span><span className="t"><b>{t('br_sim_mine')}</b><small>{t(animal.sex === 'M' ? 'br_sim_mine_sub_f' : 'br_sim_mine_sub_m')}</small></span><Icon name="chev" /></Link>
        {l ? (
          <div className="card inset" style={{ marginTop: 0 }}>
            <div className="row between"><b>{t('br_in_catalog')}</b><Badge kind={l.status === 'active' ? 'ok' : 'warn'}>{t(`blst.${l.status}`)}</Badge></div>
            <div className="small muted">{l.available_until ? t('br_until', { date: d(l.available_until) }) : t('br_no_end')} · {t(`bmod.${l.modality}`)} · {t('br_views_n', { n: l.views })}</div>
            {canWrite && <div className="row" style={{ marginTop: '.5rem' }}>
              <button className="btn small" onClick={() => setOpen(!open)}>{t('edit')}</button>
              {l.status === 'active' ? <button className="btn small" onClick={() => st.run('paused')}>{t('br_pause')}</button> : <button className="btn small primary" onClick={() => st.run('active')}>{t('br_resume')}</button>}
              <button className="btn small danger" onClick={() => window.confirm(t('br_withdraw_confirm')) && st.run('withdrawn')}>{t('br_withdraw')}</button>
            </div>}
          </div>
        ) : canWrite && !open && (
          <button className="task br-share" onClick={() => setOpen(true)}><span className="ic plum"><Icon name="users" /></span><span className="t" style={{ textAlign: 'left' }}><b>{t('br_share')}</b><small>{t('br_share_sub')}</small></span><Icon name="chev" /></button>
        )}
        {open && canWrite && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); pub.run(); }}>
            <div><div className="field-label">{t('br_available')}</div>
              <div className="segmented">{[1, 3, 6, null].map((m) => <button type="button" key={String(m)} className={f.months === m ? 'on' : ''} onClick={() => setF({ ...f, months: m })}>{m ? t('br_n_months', { n: m }) : t('br_no_end')}</button>)}</div></div>
            <Field label={t('br_locality')}><input maxLength={120} value={f.locality} placeholder={t('br_locality_ph')} onChange={(e) => setF({ ...f, locality: e.target.value })} /></Field>
            <div><div className="field-label">{t('br_modality')}</div>
              <div className="segmented">{['onsite', 'travel', 'both'].map((m) => <button type="button" key={m} className={f.modality === m ? 'on' : ''} onClick={() => setF({ ...f, modality: m })}>{t(`bmod.${m}`)}</button>)}</div></div>
            <Field label={t('br_conditions_opt')}><textarea maxLength={1000} value={f.conditions} placeholder={t('br_conditions_ph')} onChange={(e) => setF({ ...f, conditions: e.target.value })} /></Field>
            <Notice>{t('br_visible_note')}</Notice>
            <ErrorMsg error={pub.error} />
            <div className="row"><button className="btn primary" disabled={pub.busy}>{l ? t('save') : t('br_publish')}</button><button type="button" className="btn" onClick={() => setOpen(false)}>{t('cancel')}</button></div>
          </form>
        )}
        {canWrite && (
          <div className="card inset" style={{ marginTop: 0 }}>
            <div className="row between"><span><b>{t('br_private_code')}</b><div className="small muted">{t('br_private_code_sub')}</div></span>
              {!code && <button className="btn small" disabled={mk.busy} onClick={() => mk.run()}>{t('br_make_code')}</button>}</div>
            {code && <div style={{ textAlign: 'center' }}><div className="code-big num">{code.code}</div><div className="small muted">{t('br_until', { date: d(code.expires_at) })}</div></div>}
            {!code && !!cur.data?.codes?.length && <div className="small muted">{t('br_active_codes')} : {cur.data.codes.map((k: any) => k.code).join(', ')}</div>}
          </div>
        )}
        <ErrorMsg error={mk.error || st.error} />
      </div>
    </Card>
  );
}
