import { Link, useNavigate } from 'react-router-dom';
import { post } from '../api';
import { Fragment, useState, type ReactNode } from 'react';
import { Field } from '../components/ui';
import { InstallButton } from '../components/Install';
import { Icon, type IconName } from '../components/Icon';
import { useApp } from '../state';
import { Card, ErrorMsg, Loading, Notice, Stat, useLoad, useSubmit, Badge } from '../components/ui';
import { Registration } from './Registration';

export function Invitations() {
  const { t, me, refresh } = useApp();
  const s = useSubmit(async (id: string, accept: boolean) => { await post(`/invitations/${id}/${accept ? 'accept' : 'decline'}`); await refresh(); });
  if (!me?.invitations?.length) return null;
  return (
    <Card title={t('invitations_pending')}>
      <ErrorMsg error={s.error} />
      <ul className="list">
        {me.invitations.map((i) => (
          <li key={i.id} className="row between">
            <span><strong>{i.farm_name}</strong> — {t(`mrole.${i.role}`)}</span>
            <span className="row"><button className="btn primary small" onClick={() => s.run(i.id, true)}>{t('accept')}</button><button className="btn small" onClick={() => s.run(i.id, false)}>{t('decline')}</button></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function daysFromToday(iso: string) {
  const d = new Date(iso + 'T12:00:00Z').getTime(), n = new Date(); const t = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), 12);
  return Math.round((d - t) / 86400000);
}

/** Liste « à faire » : une carte par alerte, bordure colorée + libellé texte (accessibilité). */
export function AlertList({ alerts, limit = 30 }: { alerts: any[]; limit?: number }) {
  const { t, d, num } = useApp();
  if (!alerts.length) return <p className="muted">{t('home_no_alerts')}</p>;
  return (
    <ul className="todo">
      {alerts.slice(0, limit).map((a, i) => {
        const n = daysFromToday(a.due_date);
        const chip = n < 0 ? <span className="chip err">{t('late_days', { n: -n })}</span> : n === 0 ? <span className="chip warn">{t('today_lbl')}</span> : <span className={`chip ${a.type === 'weighing_due' ? 'ok' : a.type === 'health_followup' ? 'info' : 'warn'}`}>{t('in_days', { n })}</span>;
        return (
          <li key={i} className={a.type.startsWith('stock') ? 'stock_alert' : a.type}>
            <Link to={a.type.startsWith('stock') ? '/stock' : `/herd/${a.animal_id}`} className="t-main">
              <div className="t-title">{t(`alert_t.${a.type}`, { day: a.day, product: a.product ?? '' })}{a.type.startsWith('stock') ? ` : ${a.animal}` : ''}</div>
              <div className="t-sub">{a.type.startsWith('stock') ? `${t('stock_left', { qty: num(a.qty, 1), unit: a.unit })} · ${t('stock_rupture', { date: d(a.due_date) })}` : `${a.animal} · ${d(a.due_date)}`}</div>
            </Link>
            {chip}
          </li>
        );
      })}
    </ul>
  );
}

function Sparkline({ points }: { points: (number | null)[] }) {
  const vals = points.filter((v): v is number => v !== null);
  if (vals.length < 3) return null; // pas de tendance affichée avec moins de 3 semaines mesurées
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1, W = 320, H = 56;
  const xy = points.map((v, i) => (v === null ? null : [(i / (points.length - 1)) * W, H - 6 - ((v - min) / span) * (H - 14)] as const)).filter(Boolean) as (readonly [number, number])[];
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden="true" style={{ marginTop: '.6rem', overflow: 'visible' }}>
      <defs><linearGradient id="spark" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".35" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${last[0]} ${H} L${xy[0][0]} ${H}Z`} fill="url(#spark)" />
      <path d={line} fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="4.5" fill="#fff" />
    </svg>
  );
}

/** Création directe de sa propre exploitation par un administrateur (tracée dans le journal d’audit). */
export function CreateOwnFarm() {
  const { t, lang, refresh, setFarmId } = useApp();
  const terr = useLoad<any[]>('/ref/territories');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ territory_code: 'MQ', name: '', locality: '', objective: 'meat' });
  const s = useSubmit(async () => {
    const r = await post('/admin/my-farm', f);
    setFarmId(r.farm_id); setOpen(false); await refresh();
  });
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title={t('create_own_farm')}>
      <p className="small muted">{t('create_own_farm_text')}</p>
      {!open ? <button className="btn primary" onClick={() => setOpen(true)}>＋ {t('create_own_farm')}</button> : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }}>
          <div className="grid2">
            <Field label={t('farm_name')} required><input required minLength={2} value={f.name} onChange={up('name')} /></Field>
            <Field label={t('locality')} required><input required value={f.locality} onChange={up('locality')} /></Field>
            <Field label={t('territory')} required>
              <select value={f.territory_code} onChange={up('territory_code')}>
                {(terr.data ?? []).filter((x) => x.active).map((x) => <option key={x.code} value={x.code}>{lang === 'fr' ? x.name_fr : x.name_en}</option>)}
              </select>
            </Field>
            <Field label={t('objective')}><select value={f.objective} onChange={up('objective')}>{['meat', 'reproduction', 'mixed'].map((o) => <option key={o} value={o}>{t(`objective.${o}`)}</option>)}</select></Field>
          </div>
          <ErrorMsg error={s.error} />
          <div className="row"><button className="btn primary" disabled={s.busy}>{t('create_own_farm')}</button><button type="button" className="btn" onClick={() => setOpen(false)}>{t('cancel')}</button></div>
        </form>
      )}
    </Card>
  );
}

type Task = { key: string; to: string; icon: IconName; color: string; title: string; sub: string; chip?: ReactNode; action?: string };

/** Regroupe les alertes : toutes les pesées en retard = une seule carte « Lancer la tournée ». */
function useTasks(alerts: any[]): Task[] {
  const { t, d, num } = useApp();
  const chipFor = (iso: string) => {
    const n = daysFromToday(iso);
    return n < 0 ? <span className="chip err">{t('late_days', { n: -n })}</span> : n === 0 ? <span className="chip warn">{t('today_lbl')}</span> : <span className="chip info">{t('in_days', { n })}</span>;
  };
  const names = (xs: any[]) => [...new Set(xs.map((a) => a.animal))];
  const overdue = alerts.filter((a) => a.type === 'weighing_overdue' || (a.type === 'weighing_due' && daysFromToday(a.due_date) <= 0));
  const soon = alerts.filter((a) => a.type === 'weighing_due' && daysFromToday(a.due_date) > 0);
  const out: Task[] = [];
  if (overdue.length) {
    const n = names(overdue);
    out.push({ key: 'overdue', to: '/weigh?tour=1', icon: 'scale', color: 'red', title: t('v3_overdue_group', { n: n.length }), sub: `${t('overdue_weighings')} : ${overdue.length} · ` + n.slice(0, 4).join(', ') + (n.length > 4 ? '…' : ''), action: t('v3_start') });
  }
  for (const a of alerts.filter((x) => x.type.startsWith('stock'))) {
    out.push({ key: `s${a.item_id}`, to: '/stock', icon: 'box', color: 'gold', title: `${t(`alert_t.${a.type}`)} : ${a.animal}`, sub: `${t('stock_left', { qty: num(a.qty, 1), unit: a.unit })} · ${t('stock_rupture', { date: d(a.due_date) })}`, chip: chipFor(a.due_date) });
  }
  for (const a of alerts.filter((x) => !x.type.startsWith('stock') && !x.type.startsWith('weighing'))) {
    const icon: IconName = a.type === 'lambing_expected' ? 'repro' : 'health';
    out.push({ key: `${a.type}${a.animal_id}${a.due_date}`, to: `/herd/${a.animal_id}`, icon, color: a.type === 'lambing_expected' ? 'gold' : 'blue', title: t(`alert_t.${a.type}`, { product: a.product ?? '' }), sub: `${a.animal} · ${d(a.due_date)}`, chip: chipFor(a.due_date) });
  }
  if (soon.length) {
    const n = names(soon);
    out.push({ key: 'soon', to: `/weigh`, icon: 'scale', color: '', title: t('v3_due_group', { n: soon.length }), sub: n.slice(0, 5).join(', ') + (n.length > 5 ? '…' : ''), chip: chipFor(soon.map((a) => a.due_date).sort()[0]) });
  }
  return out;
}

function TaskList({ tasks, limit }: { tasks: Task[]; limit: number }) {
  const { t } = useApp();
  if (!tasks.length) return <p className="muted" style={{ margin: 0 }}>{t('home_no_alerts')}</p>;
  return (
    <ul className="tasks">
      {tasks.slice(0, limit).map((x) => (
        <li key={x.key}>
          <Link to={x.to} className="task">
            <span className={`ic ${x.color}`}><Icon name={x.icon} /></span>
            <span className="t"><b>{x.title}</b><small>{x.sub}</small></span>
            {x.action ? <span className="btn primary small">{x.action}</span> : x.chip}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function HomeSearch() {
  const { t } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  return (
    <form role="search" className="searchbar" onSubmit={(e) => { e.preventDefault(); nav(`/herd${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`); }}>
      <Icon name="search" size={20} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('v3_search')} aria-label={t('v3_search')} />
    </form>
  );
}

export function Home() {
  const { t, me, farm, d, num, lang } = useApp();
  const dash = useLoad<any>(farm ? `/farms/${farm.id}/dashboard` : null, [farm?.id]);
  const stock = useLoad<any[]>(farm ? `/farms/${farm.id}/stock` : null, [farm?.id]);
  const animals = useLoad<any[]>(farm ? `/farms/${farm.id}/animals` : null, [farm?.id]);
  const [all, setAll] = useState(false);
  const tasks = useTasks(dash.data?.alerts ?? []);
  const role = me?.user?.platform_role;

  if (!farm) {
    return (
      <div className="stack">
        <Invitations />
        {(role === 'admin' || role === 'validator') && <Notice>{t('no_farm')} <Link to="/review">{t('review_title')} →</Link></Notice>}
        {role === 'admin' && <CreateOwnFarm />}
        {role === 'analyst' && <Notice><Link to="/collective">{t('collective_stats')} →</Link></Notice>}
        {role === 'none' && <Registration />}
      </div>
    );
  }
  const canWrite = farm.role !== 'referent';
  const g = dash.data?.growth;
  const today = new Date().toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const lambings = (dash.data?.alerts ?? []).filter((a: any) => a.type === 'lambing_expected').length;
  const lots = Object.values((animals.data ?? []).filter((a) => a.status === 'active').reduce((m: Record<string, { name: string; n: number; gmq: number[] }>, a) => {
    const k = a.lot_name ?? ''; m[k] ??= { name: a.lot_name ?? t('v3_no_lot'), n: 0, gmq: [] }; m[k].n++; if (a.gmq_overall !== null) m[k].gmq.push(Number(a.gmq_overall)); return m;
  }, {})).sort((a, b) => b.n - a.n);
  const maxLot = Math.max(1, ...lots.map((l) => l.n));
  const weighings = (dash.data?.recent ?? []).filter((r: any) => r.kind === 'weighing').slice(0, 5);
  const LIMIT = 4;
  return (
    <div className="stack">
      <div className="greet">
        <h1>{t('hello_name', { name: me?.user?.first_name ?? '' })}</h1>
        <p>{today.charAt(0).toUpperCase() + today.slice(1)} · {farm.name} · <Badge>{t(`mrole.${farm.role}`)}</Badge></p>
      </div>
      <HomeSearch />
      <Invitations />
      {dash.loading && !dash.data && <Loading />}
      <ErrorMsg error={dash.error} />
      {dash.data && (
        <div className="home-grid">
          <div className="home-col">
            <section className="hero" aria-label={t('home_herd')}>
              <div className="hero-kpis">
                <div className="k"><small>{t('v3_herd')}</small><b className="num">{dash.data.animals.active}</b><i>{dash.data.animals.females} ♀ · {dash.data.animals.males} ♂</i></div>
                <div className="k"><small>{t('gmq_mean')}</small><b className="num">{g?.mean_overall ?? '—'}<em>{t('gmq_unit')}</em></b>
                  <i>{g?.trend !== null && g?.trend !== undefined ? `${g.trend >= 0 ? '▲' : '▼'} ${t('trend_vs', { n: `${g.trend >= 0 ? '+' : ''}${g.trend}` })}` : g?.animals_measured ? t('animals_measured', { n: g.animals_measured }) : t('gmq_no_data')}</i></div>
                <div className="k"><small>{t('v3_lambings')}</small><b className="num">{lambings}</b><i>{t('v3_within_10')}</i></div>
                <div className="k wide"><small>{t('v3_weighings')}</small><b className="num">{dash.data.weighings.last_30_days}</b><i>{t('v3_30d')}</i></div>
              </div>
              {g && <Sparkline points={g.weekly.map((w: any) => w.gmq)} />}
            </section>

            {canWrite && (
              <nav className="qa-row" aria-label={t('v3_add')}>
                <Link className="qa" to="/weigh"><span className="ic"><Icon name="scale" size={18} /></span>{t('tile_weigh')}</Link>
                <Link className="qa" to="/health"><span className="ic blue"><Icon name="health" size={18} /></span>{t('v3_act_health')}</Link>
                <Link className="qa" to="/repro"><span className="ic gold"><Icon name="repro" size={18} /></span>{t('v3_act_repro')}</Link>
                <Link className="qa" to="/stock"><span className="ic grey"><Icon name="box" size={18} /></span>{t('v3_act_stock')}</Link>
                <Link className="qa" to="/herd/new"><span className="ic grey"><Icon name="plus" size={18} /></span>{t('tile_new_animal')}</Link>
              </nav>
            )}

            <section className="stack-sm">
              <div className="sec-head"><h2>{t('v3_today_tasks')}</h2>{tasks.length > LIMIT && <button className="btn ghost small" onClick={() => setAll(!all)}>{all ? t('close') : t('v3_more_tasks', { n: tasks.length - LIMIT })}</button>}</div>
              <TaskList tasks={tasks} limit={all ? 100 : LIMIT} />
            </section>

            {lots.length > 0 && (
              <Card>
                <div className="sec-head" style={{ marginBottom: '.8rem' }}><h2>{t('v3_lots')}</h2><Link to="/herd">{t('v3_open_herd')}</Link></div>
                <div>
                  {lots.slice(0, 6).map((l, i) => (
                    <div className="lot-row" key={l.name}>
                      <div className="row between nowrap"><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</b>
                        <span className="small num" style={{ whiteSpace: 'nowrap' }}>{t('v3_heads', { n: l.n })}{l.gmq.length ? <> · <b>{num(l.gmq.reduce((s, x) => s + x, 0) / l.gmq.length, 0)} {t('gmq_unit')}</b></> : null}</span></div>
                      <div className="meter"><span style={{ width: `${(l.n / maxLot) * 100}%`, background: ['var(--primary-bright)', 'var(--info)', 'var(--accent)', '#8A3FA8'][i % 4] }} /></div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>

          <div className="home-col">
            {!!stock.data?.length && (
              <Card>
                <div className="sec-head" style={{ marginBottom: '.8rem' }}><h2>{t('v3_stocks')}</h2><Link to="/stock">{t('v3_manage')}</Link></div>
                {stock.data.slice(0, 4).map((it) => {
                  const e = it.estimate; const horizon = Math.max(30, it.lead_days * 3);
                  return (
                    <div className="stock-line" key={it.id}>
                      <div className="row between nowrap"><b>{it.name}</b><span className={`chip ${{ ok: 'ok', order: 'warn', empty: 'err', unknown: '' }[e.status as string]}`}>{t(`stst.${e.status}`)}</span></div>
                      {e.days_left !== null && <div className="meter"><span style={{ width: `${Math.max(3, Math.min(100, (e.days_left / horizon) * 100))}%`, background: e.status === 'ok' ? 'var(--primary-bright)' : e.status === 'order' ? 'var(--accent)' : 'var(--danger)' }} /></div>}
                      <div className="small muted">{e.estimated === null ? '—' : `${num(e.estimated, 1)} ${it.unit}`}{e.days_left !== null ? ` · ${t('stock_days_left', { n: num(e.days_left, 0) })}` : ''}</div>
                    </div>
                  );
                })}
                {canWrite && stock.data.some((it) => it.estimate.status === 'order' || it.estimate.status === 'empty') && (
                  <Link className="btn accent block" style={{ marginTop: '1rem' }} to="/boutique"><Icon name="cart" size={18} />{t('stock_order_btn')}</Link>
                )}
              </Card>
            )}
            <Card>
              <div className="sec-head" style={{ marginBottom: '.8rem' }}><h2>{t('v3_last_weighings')}</h2><span className="chip" title={t('home_weighings_30')}>{t('n_weighings_30d', { n: dash.data.weighings.last_30_days })}</span></div>
              {weighings.length === 0 ? <p className="muted" style={{ margin: 0 }}>—</p> : (
                <div className="mini-table">
                  {weighings.map((r: any, i: number) => (
                    <Fragment key={i}><Link to={`/herd/${r.animal_id}`}>{r.animal}</Link><span className="small muted">{d(r.date)}</span><b className="num">{num(Number(r.value), 2)} kg</b></Fragment>
                  ))}
                </div>
              )}
            </Card>
            <div className="row"><InstallButton small /></div>
          </div>
        </div>
      )}
    </div>
  );
}
