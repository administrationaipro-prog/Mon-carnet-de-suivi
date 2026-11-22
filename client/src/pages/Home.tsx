import { Link } from 'react-router-dom';
import { post } from '../api';
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

export function AlertList({ alerts }: { alerts: any[] }) {
  const { t, d } = useApp();
  if (!alerts.length) return <p className="muted">{t('home_no_alerts')}</p>;
  return (
    <ul className="list alerts">
      {alerts.slice(0, 30).map((a, i) => (
        <li key={i} className={`alert-item ${a.type}`}>
          <Link to={`/herd/${a.animal_id}`}><strong>{a.animal}</strong></Link> — {t(`alert.${a.type}`, { day: a.day, date: d(a.due_date), product: a.product ?? '' })}
        </li>
      ))}
    </ul>
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
        {role === 'analyst' && <Notice><Link to="/collective">{t('collective_stats')} →</Link></Notice>}
        {role === 'none' && <Registration />}
      </div>
    );
  }
  return (
    <div className="stack">
      <h1>{farm.name} <Badge>{t(`mrole.${farm.role}`)}</Badge></h1>
      <Invitations />
      {dash.loading && !dash.data && <Loading />}
      <ErrorMsg error={dash.error} />
      {dash.data && (
        <>
          <div className="stats">
            <Stat label={t('home_herd')} value={dash.data.animals.active} sub={`${dash.data.animals.females} ${t('females')} · ${dash.data.animals.males} ${t('males')}`} />
            <Stat label={t('home_weighings')} value={dash.data.weighings.total} sub={dash.data.weighings.last_date ? `${t('last_weighing')} : ${d(dash.data.weighings.last_date)}` : undefined} />
            <Stat label={t('home_weighings_30')} value={dash.data.weighings.last_30_days} />
            <Stat label={t('home_alerts')} value={dash.data.alerts.length} />
          </div>
          <div className="grid2">
            <Card title={t('home_alerts')}><AlertList alerts={dash.data.alerts} /></Card>
            <Card title={t('home_last_obs')}>
              {dash.data.recent.length === 0 ? <p className="muted">—</p> : (
                <ul className="list">
                  {dash.data.recent.map((r: any, i: number) => (
                    <li key={i}>{d(r.date)} · <Link to={`/herd/${r.animal_id}`}>{r.animal}</Link> · {r.kind === 'weighing' ? `${num(Number(r.value), 2)} kg` : t(`htype.${r.value}`)}</li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <Card title={t('home_shortcuts')}>
            <div className="shortcuts">
              {farm.role !== 'referent' && <Link className="btn primary" to="/weigh">⚖ {t('nav_weigh')}</Link>}
              {farm.role !== 'referent' && <Link className="btn" to="/herd/new">＋ {t('add_animal')}</Link>}
              <Link className="btn" to="/herd">🐑 {t('nav_herd')}</Link>
              <Link className="btn" to="/analytics">📈 {t('nav_analytics')}</Link>
              <Link className="btn" to="/health">✚ {t('nav_health')}</Link>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
