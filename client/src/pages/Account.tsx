import { useState } from 'react';
import { del, post, patch } from '../api';
import { useApp } from '../state';
import { Card, ErrorMsg, Field, Notice, useLoad, useSubmit, downloadUrl, Badge } from '../components/ui';

export function Account() {
  const { t, me, dt, refresh, logout, setLang, lang } = useApp();
  const sessions = useLoad<any[]>('/auth/sessions');
  const [p, setP] = useState({ first_name: me?.user?.first_name ?? '', last_name: me?.user?.last_name ?? '' });
  const [pw, setPw] = useState({ current: '', password: '' });
  const [delPw, setDelPw] = useState('');
  const [ok, setOk] = useState<string | null>(null);
  const sp = useSubmit(async () => { await patch('/auth/me', p); await refresh(); setOk(t('saved')); });
  const spw = useSubmit(async () => { await post('/auth/change-password', pw); setPw({ current: '', password: '' }); setOk(t('saved')); sessions.reload(); });
  const rs = useSubmit(async (id: string) => { await del(`/auth/sessions/${id}`); sessions.reload(); });
  const la = useSubmit(async () => { await post('/auth/logout-all'); await logout(); });
  const dl = useSubmit(async () => { await post('/auth/me/delete', { password: delPw }); await logout(); });
  return (
    <div className="stack">
      <h1>{t('account_title')}</h1>
      {ok && <Notice kind="ok">{ok}</Notice>}
      <div className="grid2">
        <Card title={t('profile')}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); sp.run(); }}>
            <p className="muted">{me?.user?.email} · {t(`prole.${me?.user?.platform_role}`)} {me?.user?.mfa_enabled && <Badge kind="ok">{t('mfa_enabled')}</Badge>}</p>
            <div className="grid2">
              <Field label={t('first_name')}><input value={p.first_name} onChange={(e) => setP({ ...p, first_name: e.target.value })} /></Field>
              <Field label={t('last_name')}><input value={p.last_name} onChange={(e) => setP({ ...p, last_name: e.target.value })} /></Field>
            </div>
            <Field label={t('language')}><select value={lang} onChange={(e) => setLang(e.target.value as any)}><option value="fr">Français</option><option value="en">English</option></select></Field>
            <ErrorMsg error={sp.error} />
            <button className="btn primary" disabled={sp.busy}>{t('save')}</button>
          </form>
        </Card>
        <Card title={t('change_password')}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); spw.run(); }}>
            <Field label={t('current_password')}><input type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label={t('new_password')} hint={t('password_hint')}><input type="password" autoComplete="new-password" required minLength={10} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></Field>
            <ErrorMsg error={spw.error} />
            <button className="btn primary" disabled={spw.busy}>{t('save')}</button>
          </form>
        </Card>
      </div>
      <Card title={t('sessions')} actions={<button className="btn small" onClick={() => la.run()}>{t('logout_all')}</button>}>
        <ErrorMsg error={rs.error || la.error} />
        <ul className="list small">{(sessions.data ?? []).map((s) => (
          <li key={s.id} className="row between"><span>{(s.user_agent ?? '').slice(0, 80)} · {dt(s.last_seen_at)} {s.current && <Badge kind="info">{t('current_session')}</Badge>}</span>{!s.current && <button className="btn small ghost" onClick={() => rs.run(s.id)}>✕</button>}</li>
        ))}</ul>
      </Card>
      <Card title={t('my_data')}>
        <div className="stack">
          <button className="btn" onClick={() => downloadUrl('/api/auth/me/export')}>{t('export_my_data')}</button>
          <details>
            <summary>{t('delete_account')}</summary>
            <p className="small">{t('delete_account_text')}</p>
            <form className="row wrap" onSubmit={(e) => { e.preventDefault(); if (window.confirm(t('delete_account') + ' ?')) dl.run(); }}>
              <input type="password" required placeholder={t('password')} aria-label={t('password')} value={delPw} onChange={(e) => setDelPw(e.target.value)} />
              <button className="btn danger" disabled={dl.busy}>{t('delete_account')}</button>
            </form>
            <ErrorMsg error={dl.error} />
          </details>
        </div>
      </Card>
    </div>
  );
}

export function Notifications() {
  const { t, dt, refresh } = useApp();
  const n = useLoad<any[]>('/auth/notifications');
  const mr = useSubmit(async () => { await post('/auth/notifications/read'); n.reload(); await refresh(); });
  return (
    <div className="stack">
      <div className="row between"><h1>{t('nav_notifications')}</h1><button className="btn small" onClick={() => mr.run()}>{t('mark_read')}</button></div>
      {!n.data?.length ? <p className="muted">{t('no_notifications')}</p> : (
        <ul className="list">{n.data.map((x) => (
          <li key={x.id} className={x.read_at ? 'muted' : ''}>{dt(x.created_at)} — {t(`notif.${x.kind}`, { ...x.payload, status: x.payload.status ? t(`${x.kind === 'order_status' ? 'ordst' : 'regst'}.${x.payload.status}`).toLowerCase() : '' })}{x.payload.reason ? ` (${x.payload.reason})` : ''}</li>
        ))}</ul>
      )}
    </div>
  );
}
