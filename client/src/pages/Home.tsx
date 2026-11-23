import { Link } from 'react-router-dom';
import { post } from '../api';
import { useState } from 'react';
import { Field } from '../components/ui';
import { InstallButton } from '../components/Install';
import { Icon } from '../components/Icon';
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
  const { t, d } = useApp();
  if (!alerts.length) return <p className="muted">{t('home_no_alerts')}</p>;
  return (
    <ul className="todo">
      {alerts.slice(0, limit).map((a, i) => {
        const n = daysFromToday(a.due_date);
        const chip = n < 0 ? <span className="chip err">{t('late_days', { n: -n })}</span> : n === 0 ? <span className="chip warn">{t('today_lbl')}</span> : <span className={`chip ${a.type === 'weighing_due' ? 'ok' : a.type === 'health_followup' ? 'info' : 'warn'}`}>{t('in_days', { n })}</span>;
        return (
          <li key={i} className={a.type}>
            <Link to={`/herd/${a.animal_id}`} className="t-main">
              <div className="t-title">{t(`alert_t.${a.type}`, { day: a.day, product: a.product ?? '' })}</div>
              <div className="t-sub">{a.animal} · {d(a.due_date)}</div>
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

export function Home() {
  const { t, me, farm, d, num } = useApp();
  const dash = useLoad<any>(farm ? `/farms/${farm.id}/dashboard` : null, [farm?.id]);
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
  return (
    <div className="stack">
      <div className="greeting">
        <small>{farm.name} · <Badge>{t(`mrole.${farm.role}`)}</Badge></small>
        <h1>{t('hello_name', { name: me?.user?.first_name ?? '' })}</h1>
      </div>
      <Invitations />
      {dash.loading && !dash.data && <Loading />}
      <ErrorMsg error={dash.error} />
      {dash.data && (
        <>
          <section className="hero" aria-label={t('home_herd')}>
            <div className="hero-row">
              <div>
                <div className="hero-label">{t('home_herd')}</div>
                <div className="hero-big num">{dash.data.animals.active}</div>
                <div className="hero-sub">{dash.data.animals.females} {t('females')} · {dash.data.animals.males} {t('males')}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="hero-label">{t('gmq_mean')}</div>
                <div className="hero-mid num">{g?.mean_overall ?? '—'} <span style={{ fontSize: '.9rem', opacity: .8 }}>{t('gmq_unit')}</span></div>
                {g?.trend !== null && g?.trend !== undefined ? (
                  <span className="chip">{g.trend >= 0 ? '▲' : '▼'} {t('trend_vs', { n: `${g.trend >= 0 ? '+' : ''}${g.trend}` })}</span>
                ) : <div className="hero-sub">{g?.animals_measured ? t('animals_measured', { n: g.animals_measured }) : t('gmq_no_data')}</div>}
              </div>
            </div>
            {g && <Sparkline points={g.weekly.map((w: any) => w.gmq)} />}
          </section>

          <div className="tiles">
            {canWrite && <Link className="tile" to="/weigh"><span className="ti"><Icon name="scale" /></span>{t('tile_weigh')}</Link>}
            {canWrite && <Link className="tile mango" to="/herd/new"><span className="ti"><Icon name="plus" /></span>{t('tile_new_animal')}</Link>}
            <Link className="tile sky" to="/health"><span className="ti"><Icon name="health" /></span>{t('nav_health')}</Link>
            <Link className="tile" to="/herd"><span className="ti"><Icon name="list" /></span>{t('nav_herd')}</Link>
            <Link className="tile" to="/analytics"><span className="ti"><Icon name="chart" /></span>{t('nav_analytics')}</Link>
          </div>

          <div className="grid2">
            <section className="stack-sm">
              <div className="row between"><h2>{t('home_todo')}</h2><span className="chip">{dash.data.alerts.length}</span></div>
              <AlertList alerts={dash.data.alerts} limit={8} />
            </section>
            <section className="stack-sm">
              <div className="row between"><h2>{t('home_last_obs')}</h2><span className="chip" title={t('home_weighings_30')}>{t('n_weighings_30d', { n: dash.data.weighings.last_30_days })}</span></div>
              <Card>
                {dash.data.recent.length === 0 ? <p className="muted">—</p> : (
                  <ul className="list">
                    {dash.data.recent.map((r: any, i: number) => (
                      <li key={i} className="row between">
                        <span className="row"><span className="avatar sm"><Icon name={r.kind === 'weighing' ? 'scale' : 'health'} size={20} /></span><span><Link to={`/herd/${r.animal_id}`}><b>{r.animal}</b></Link><div className="small muted">{d(r.date)}</div></span></span>
                        <b className="num">{r.kind === 'weighing' ? `${num(Number(r.value), 2)} kg` : t(`htype.${r.value}`)}</b>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <div className="row"><InstallButton small /></div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
