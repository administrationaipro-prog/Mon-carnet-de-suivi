import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get, patch, post } from './api';
import { translate, type Lang, fmtDate, fmtNum, fmtPct, fmtDateTime } from './i18n';
import { clearQueue } from './offline';

export type Me = {
  user: null | { id: string; email: string; first_name: string; last_name: string; lang: Lang; platform_role: 'none' | 'admin' | 'validator' | 'analyst'; email_verified: boolean; mfa_enabled: boolean };
  mfa_verified?: boolean;
  farms?: { id: string; name: string; status: string; territory_code: string; role: 'owner' | 'collaborator' | 'referent' | 'vet'; scopes?: string[]; expires_at?: string }[];
  vet?: { ordinal_number: string; clinic: string; territory_code: string | null; phone: string | null; status: 'pending' | 'verified' | 'rejected' | 'suspended'; decision_note: string | null } | null;
  registration?: { id: string; status: string } | null;
  invitations?: { id: string; role: string; farm_name: string }[];
  unread_notifications?: number;
};

type Ctx = {
  me: Me | null; refresh: () => Promise<void>; lang: Lang; setLang: (l: Lang) => void;
  t: (k: string, v?: Record<string, any>) => string; d: (iso?: string | null) => string; dt: (iso?: string | null) => string;
  num: (v?: number | null, digits?: number) => string; pct: (v?: number | null) => string;
  farmId: string | null; setFarmId: (id: string) => void; farm: NonNullable<Me['farms']>[number] | null;
  logout: () => Promise<void>; online: boolean;
};

const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

const storedLang = (): Lang => {
  try { const l = localStorage.getItem('carnet.lang'); if (l === 'en' || l === 'fr') return l; } catch { /* */ }
  return 'fr'; // français par défaut (pilote Martinique, §23)
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [lang, setLangState] = useState<Lang>(storedLang);
  const [farmId, setFarmIdState] = useState<string | null>(() => { try { return localStorage.getItem('carnet.farm'); } catch { return null; } });
  const [online, setOnline] = useState(navigator.onLine);

  const refresh = useCallback(async () => {
    try {
      const m = await get<Me>('/auth/me');
      setMe(m);
      if (m.user && m.user.lang !== lang) setLangState(m.user.lang);
    } catch { setMe((prev) => prev ?? { user: null }); }
  }, [lang]);

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setLang = useCallback((l: Lang) => {
    // Le changement de langue ne recharge pas la page : la saisie en cours est conservée.
    setLangState(l);
    try { localStorage.setItem('carnet.lang', l); } catch { /* */ }
    if (me?.user) patch('/auth/me', { lang: l }).catch(() => {});
  }, [me]);

  const setFarmId = useCallback((id: string) => { setFarmIdState(id); try { localStorage.setItem('carnet.farm', id); } catch { /* */ } }, []);
  const farm = useMemo(() => {
    const farms = me?.farms ?? [];
    return farms.find((f) => f.id === farmId) ?? farms[0] ?? null;
  }, [me, farmId]);

  const logout = useCallback(async () => {
    await post('/auth/logout').catch(() => {});
    clearQueue();
    navigator.serviceWorker?.controller?.postMessage('logout');
    try { localStorage.removeItem('carnet.farm'); } catch { /* */ }
    setMe({ user: null });
  }, []);

  const value = useMemo<Ctx>(() => ({
    me, refresh, lang, setLang, t: (k, v) => translate(lang, k, v), d: (iso) => fmtDate(lang, iso), dt: (iso) => fmtDateTime(lang, iso),
    num: (v, dg) => fmtNum(lang, v, dg), pct: (v) => fmtPct(lang, v),
    farmId: farm?.id ?? null, setFarmId, farm, logout, online,
  }), [me, refresh, lang, setLang, farm, setFarmId, logout, online]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
