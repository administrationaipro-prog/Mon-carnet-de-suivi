import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useApp } from '../state';
import { readQueue, subscribe, flush } from '../offline';
import { InstallButton } from './Install';
import { Icon, type IconName } from './Icon';
import { ActionSheet } from './ActionSheet';

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

const farmNav: [string, string, IconName][] = [
  ['/', 'nav_home', 'home'], ['/herd', 'nav_herd', 'list'], ['/weigh', 'nav_weigh', 'scale'], ['/analytics', 'nav_analytics', 'chart'],
  ['/feeding', 'nav_feeding', 'wheat'], ['/stock', 'nav_stock', 'box'], ['/boutique', 'nav_shop', 'cart'], ['/health', 'nav_health', 'health'], ['/parasitisme', 'nav_parasite', 'shield'], ['/repro', 'nav_repro', 'repro'], ['/simulateur', 'nav_simulator', 'dna'], ['/saillies', 'nav_breeding', 'users'], ['/parcels', 'nav_parcels', 'grid'],
  ['/members', 'nav_members', 'users'], ['/veterinaire', 'nav_vet_access', 'health'], ['/collective', 'nav_collective', 'globe'],
];
/** Pages visibles d'un vétérinaire en consultation, selon les portées accordées par l'éleveur. */
const vetNav: [string, string, IconName, string][] = [
  ['/parasitisme', 'nav_parasite', 'shield', 'health'], ['/herd', 'nav_herd', 'list', 'herd'], ['/analytics', 'nav_analytics', 'chart', 'herd'],
  ['/health', 'nav_health', 'health', 'health'], ['/repro', 'nav_repro', 'repro', 'repro'], ['/feeding', 'nav_feeding', 'wheat', 'feeding'],
];

export function Layout({ children }: { children: ReactNode }) {
  const { t, me, farm, setFarmId, logout } = useApp();
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(false);
  const canWrite = !!farm && farm.role !== 'referent' && farm.role !== 'vet';
  const role = me?.user?.platform_role;
  const hasFarm = !!farm;
  const isVet = farm?.role === 'vet';
  const scopes = farm?.scopes ?? [];
  const links: [string, string, IconName][] = [
    ...(me?.vet ? [['/veto', 'nav_vet_space', 'health'] as [string, string, IconName]] : []),
    ...(isVet ? vetNav.filter((x) => scopes.includes(x[3])).map((x) => [x[0], x[1], x[2]] as [string, string, IconName])
      : hasFarm ? farmNav.filter((x) => x[0] !== '/veterinaire' || farm?.role === 'owner') : [['/', 'nav_home', 'home'] as [string, string, IconName]]),
    ...(!hasFarm && role === 'analyst' ? [['/collective', 'nav_collective', 'globe'] as [string, string, IconName]] : []),
    ...(role === 'admin' || role === 'validator' ? [['/review', 'nav_review', 'shield'] as [string, string, IconName]] : []),
    ...(role === 'admin' ? [['/admin', 'nav_admin', 'gear'] as [string, string, IconName]] : []),
    ['/notifications', 'nav_notifications', 'bell'], ['/account', 'nav_account', 'user'],
  ];
  const tab = (to: string, k: string, icon: IconName) => (
    <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}><span className="tab-ic"><Icon name={icon} /></span><small>{t(k)}</small></NavLink>
  );
  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn menu-btn" aria-label={t('nav_more')} aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name={menu ? 'x' : 'menu'} /></button>
        <Link to="/" className="brand"><img src="/icon.svg" alt="" width={34} height={34} /><span>{t('app_name')}</span></Link>
        {me?.farms && me.farms.length > 1 ? (
          <select className="farm-select" aria-label={t('switch_farm')} value={farm?.id ?? ''} onChange={(e) => setFarmId(e.target.value)}>
            {me.farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        ) : farm ? <span className="farm-name hide-mobile" title={t('farm')}>{farm.name}</span> : <span />}
        <div className="topbar-right">
          {canWrite && <button className="btn accent small add-btn" onClick={() => setSheet(true)}><Icon name="plus" size={18} stroke={2.4} />{t('v3_add')}</button>}
          <LangSwitch />
          <Link to="/notifications" className="icon-btn" aria-label={t('nav_notifications')}><Icon name="bell" />{!!me?.unread_notifications && <span className="dot">{me.unread_notifications}</span>}</Link>
          <button className="btn ghost small hide-mobile" onClick={logout}><Icon name="logout" size={18} />{t('logout')}</button>
        </div>
      </header>
      <SyncBar />
      <div className="body">
        <nav className={`sidebar ${menu ? 'open' : ''}`} onClick={() => setMenu(false)} aria-label="Navigation">
          {links.map(([to, k, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}><Icon name={icon} />{t(k)}</NavLink>
          ))}
          <div className="nav-install"><InstallButton block small /></div>
          <button className="btn ghost nav-logout" onClick={logout}><Icon name="logout" />{t('logout')}</button>
        </nav>
        <main className="main">{children}</main>
      </div>
      <nav className="tabbar" aria-label="Navigation mobile">
        {isVet ? (
          <>
            {tab('/veto', 'nav_vet_space', 'health')}
            {scopes.includes('health') && tab('/parasitisme', 'nav_parasite', 'shield')}
            {scopes.includes('herd') && tab('/herd', 'nav_herd', 'list')}
          </>
        ) : hasFarm ? (
          <>
            {tab('/', 'nav_home', 'home')}
            {tab('/herd', 'nav_herd', 'list')}
            {canWrite && <button className="fab" aria-label={t('v3_add')} aria-haspopup="dialog" aria-expanded={sheet} onClick={() => { setMenu(false); setSheet(true); }}><Icon name="plus" size={28} stroke={2.6} /></button>}
            {tab('/analytics', 'nav_analytics', 'chart')}
          </>
        ) : (
          <>
            {tab('/', 'nav_home', 'home')}
            {tab('/notifications', 'nav_notifications', 'bell')}
            {tab('/account', 'nav_account', 'user')}
          </>
        )}
        <button onClick={() => setMenu(!menu)} aria-expanded={menu}><span className="tab-ic"><Icon name={menu ? 'x' : 'menu'} /></span><small>{t('nav_more')}</small></button>
      </nav>
      {sheet && <ActionSheet onClose={() => setSheet(false)} />}
    </div>
  );
}
