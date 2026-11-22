import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useApp } from '../state';
import { readQueue, subscribe, flush } from '../offline';

export function LangSwitch() {
  const { lang, setLang, t } = useApp();
  return (
    <div className="lang-switch" role="group" aria-label={t('language')}>
      {(['fr', 'en'] as const).map((l) => (
        <button key={l} type="button" className={lang === l ? 'active' : ''} aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
      ))}
    </div>
  );
}

function useQueue() {
  return useSyncExternalStore(subscribe, () => JSON.stringify(readQueue()));
}

export function SyncBar() {
  const { t, online } = useApp();
  const q = JSON.parse(useQueue()) as ReturnType<typeof readQueue>;
  useEffect(() => { if (online && q.some((x) => !x.conflict)) flush(); }, [online, q.length]); // eslint-disable-line
  if (online && !q.length) return null;
  const conflicts = q.filter((x) => x.conflict).length;
  return (
    <div className={`syncbar ${online ? '' : 'offline'}`} role="status">
      {!online && <span>{t('offline_banner')}</span>}
      {q.length > 0 && <span>{t('n_pending_sync', { n: q.length })}{conflicts > 0 && <> — <Link to="/weigh">{t('sync_conflicts')} ({conflicts})</Link></>}</span>}
      {online && q.some((x) => !x.conflict) && <button className="btn small" onClick={() => flush()}>{t('sync_now')}</button>}
    </div>
  );
}

const farmNav = [
  ['/', 'nav_home', '⌂'], ['/herd', 'nav_herd', '🐑'], ['/weigh', 'nav_weigh', '⚖'], ['/analytics', 'nav_analytics', '📈'],
  ['/feeding', 'nav_feeding', '🌾'], ['/health', 'nav_health', '✚'], ['/repro', 'nav_repro', '♀'], ['/parcels', 'nav_parcels', '▦'],
  ['/members', 'nav_members', '👥'], ['/collective', 'nav_collective', '◎'],
] as const;

export function Layout({ children }: { children: ReactNode }) {
  const { t, me, farm, setFarmId, logout } = useApp();
  const [menu, setMenu] = useState(false);
  const role = me?.user?.platform_role;
  const hasFarm = !!farm;
  const links: (readonly [string, string, string])[] = [
    ...(hasFarm ? farmNav : [['/', 'nav_home', '⌂'] as const]),
    ...(!hasFarm && role === 'analyst' ? [['/collective', 'nav_collective', '◎'] as const] : []),
    ...(role === 'admin' || role === 'validator' ? [['/review', 'nav_review', '✓'] as const] : []),
    ...(role === 'admin' ? [['/admin', 'nav_admin', '⚙'] as const] : []),
    ['/notifications', 'nav_notifications', '🔔'], ['/account', 'nav_account', '👤'],
  ];
  const mobileMain = hasFarm ? ['/', '/herd', '/weigh', '/analytics'] : ['/', '/notifications', '/account'];
  return (
    <div className="app">
      <header className="topbar">
        <button className="btn ghost menu-btn" aria-label={t('nav_more')} aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>
        <Link to="/" className="brand"><img src="/icon.svg" alt="" width={28} height={28} /><span>{t('app_name')}</span></Link>
        {me?.farms && me.farms.length > 1 ? (
          <select className="farm-select" aria-label={t('switch_farm')} value={farm?.id ?? ''} onChange={(e) => setFarmId(e.target.value)}>
            {me.farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        ) : farm ? <span className="farm-name" title={t('farm')}>{farm.name}</span> : <span />}
        <div className="topbar-right">
          <LangSwitch />
          <Link to="/notifications" className="notif" aria-label={t('nav_notifications')}>🔔{!!me?.unread_notifications && <span className="dot">{me.unread_notifications}</span>}</Link>
          <button className="btn ghost small hide-mobile" onClick={logout}>{t('logout')}</button>
        </div>
      </header>
      <SyncBar />
      <div className="body">
        <nav className={`sidebar ${menu ? 'open' : ''}`} onClick={() => setMenu(false)} aria-label="Navigation">
          {links.map(([to, k, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}><span className="ico" aria-hidden>{icon}</span>{t(k)}</NavLink>
          ))}
          <button className="btn ghost nav-logout" onClick={logout}>{t('logout')}</button>
        </nav>
        <main className="main">{children}</main>
      </div>
      <nav className="tabbar" aria-label="Navigation mobile">
        {links.filter(([to]) => mobileMain.includes(to)).map(([to, k, icon]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}><span aria-hidden>{icon}</span><small>{t(k)}</small></NavLink>
        ))}
        <button onClick={() => setMenu(!menu)}><span aria-hidden>☰</span><small>{t('nav_more')}</small></button>
      </nav>
    </div>
  );
}
