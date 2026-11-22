import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../api';
import { useApp } from '../state';
import { ErrorMsg, Field, Notice, useSubmit } from '../components/ui';
import { LangSwitch } from '../components/Layout';

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useApp();
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand"><img src="/icon.svg" alt="" width={44} height={44} /><div><strong>{t('app_name')}</strong><div className="muted small">{t('app_tagline')}</div></div><LangSwitch /></div>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const { t, refresh } = useApp();
  const nav = useNavigate();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const s = useSubmit(async () => { await post('/auth/login', { email, password }); await refresh(); nav('/'); });
  return (
    <AuthShell title={t('login_title')}>
      <form onSubmit={(e) => { e.preventDefault(); s.run(); }} className="stack">
        <Field label={t('email')}><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={t('password')}><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ErrorMsg error={s.error} />
        <button className="btn primary block" disabled={s.busy}>{t('login')}</button>
      </form>
      <p className="center small"><Link to="/forgot-password">{t('forgot_password')}</Link></p>
      <p className="center small">{t('no_account')} <Link to="/register">{t('register')}</Link></p>
    </AuthShell>
  );
}

export function Register() {
  const { t, lang, refresh } = useApp();
  const [f, setF] = useState({ first_name: '', last_name: '', email: '', password: '' });
  const [done, setDone] = useState(false);
  const s = useSubmit(async () => { await post('/auth/register', { ...f, lang }); setDone(true); await refresh(); });
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <AuthShell title={t('register_title')}>
      {done ? <><Notice kind="ok">{t('register_done')}</Notice><Link className="btn primary block" to="/">{t('back')}</Link></> : (
        <form onSubmit={(e) => { e.preventDefault(); s.run(); }} className="stack">
          <div className="grid2">
            <Field label={t('first_name')} required><input required autoComplete="given-name" value={f.first_name} onChange={up('first_name')} /></Field>
            <Field label={t('last_name')} required><input required autoComplete="family-name" value={f.last_name} onChange={up('last_name')} /></Field>
          </div>
          <Field label={t('email')} required><input type="email" required autoComplete="email" value={f.email} onChange={up('email')} /></Field>
          <Field label={t('password')} hint={t('password_hint')} required><input type="password" required minLength={10} autoComplete="new-password" value={f.password} onChange={up('password')} /></Field>
          <ErrorMsg error={s.error} />
          <button className="btn primary block" disabled={s.busy}>{t('register')}</button>
        </form>
      )}
      <p className="center small">{t('have_account')} <Link to="/login">{t('login')}</Link></p>
    </AuthShell>
  );
}

export function VerifyEmail() {
  const { t, refresh } = useApp();
  const [params] = useSearchParams();
  const [state, setState] = useState<'idle' | 'ok'>('idle');
  const nav = useNavigate();
  // La session n’est rafraîchie qu’au clic sur « Continuer » pour que le message reste affiché.
  const s = useSubmit(async () => { await post('/auth/verify-email', { token: params.get('token') ?? '' }); setState('ok'); });
  return (
    <AuthShell title={t('verify_title')}>
      {state === 'ok' ? <><Notice kind="ok">{t('verify_ok')}</Notice><button className="btn primary block" onClick={async () => { await refresh(); nav('/'); }}>{t('nav_home')}</button></> : (
        <>
          <ErrorMsg error={s.error} />
          <button className="btn primary block" onClick={() => s.run()} disabled={s.busy}>{t('confirm')}</button>
        </>
      )}
    </AuthShell>
  );
}

export function ForgotPassword() {
  const { t } = useApp();
  const [email, setEmail] = useState(''); const [done, setDone] = useState(false);
  const s = useSubmit(async () => { await post('/auth/forgot-password', { email }); setDone(true); });
  return (
    <AuthShell title={t('forgot_password')}>
      {done ? <Notice kind="ok">{t('reset_sent')}</Notice> : (
        <form onSubmit={(e) => { e.preventDefault(); s.run(); }} className="stack">
          <Field label={t('email')}><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <ErrorMsg error={s.error} />
          <button className="btn primary block" disabled={s.busy}>{t('send_reset')}</button>
        </form>
      )}
      <p className="center small"><Link to="/login">{t('login')}</Link></p>
    </AuthShell>
  );
}

export function ResetPassword() {
  const { t } = useApp();
  const [params] = useSearchParams();
  const [password, setPassword] = useState(''); const [done, setDone] = useState(false);
  const s = useSubmit(async () => { await post('/auth/reset-password', { token: params.get('token') ?? '', password }); setDone(true); });
  return (
    <AuthShell title={t('reset_title')}>
      {done ? <><Notice kind="ok">{t('reset_done')}</Notice><Link className="btn primary block" to="/login">{t('login')}</Link></> : (
        <form onSubmit={(e) => { e.preventDefault(); s.run(); }} className="stack">
          <Field label={t('new_password')} hint={t('password_hint')}><input type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <ErrorMsg error={s.error} />
          <button className="btn primary block" disabled={s.busy}>{t('save')}</button>
        </form>
      )}
    </AuthShell>
  );
}

export function VerifyPending() {
  const { t, me, logout } = useApp();
  const [sent, setSent] = useState(false);
  const s = useSubmit(async () => { await post('/auth/resend-verification'); setSent(true); });
  return (
    <AuthShell title={t('verify_pending')}>
      <p>{t('verify_pending_text', { email: me?.user?.email })}</p>
      {sent && <Notice kind="ok">{t('resent')}</Notice>}
      <ErrorMsg error={s.error} />
      <div className="row">
        <button className="btn" onClick={() => s.run()} disabled={s.busy}>{t('resend')}</button>
        <button className="btn ghost" onClick={logout}>{t('logout')}</button>
      </div>
    </AuthShell>
  );
}

export function Mfa() {
  const { t, me, refresh, logout } = useApp();
  const [secret, setSecret] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState('');
  const setup = !me?.user?.mfa_enabled;
  const gen = useSubmit(async () => setSecret(await post('/auth/mfa/setup')));
  const s = useSubmit(async () => { await post(setup ? '/auth/mfa/enable' : '/auth/mfa/verify', { code }); await refresh(); });
  return (
    <AuthShell title={t('mfa_title')}>
      <p>{setup ? t('mfa_setup_text') : t('mfa_verify_text')}</p>
      {setup && !secret && <button className="btn" onClick={() => gen.run()} disabled={gen.busy}>{t('mfa_start')}</button>}
      {setup && secret && (
        <div className="stack">
          <Field label={t('mfa_secret')}><code className="secret" data-testid="mfa-secret">{secret.secret}</code></Field>
          <a className="small" href={secret.otpauth}>{t('mfa_link')}</a>
        </div>
      )}
      {(!setup || secret) && (
        <form onSubmit={(e) => { e.preventDefault(); s.run(); }} className="stack">
          <Field label={t('mfa_code')}><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <ErrorMsg error={s.error || gen.error} />
          <button className="btn primary block" disabled={s.busy}>{t('confirm')}</button>
        </form>
      )}
      <button className="btn ghost block" onClick={logout}>{t('logout')}</button>
    </AuthShell>
  );
}
