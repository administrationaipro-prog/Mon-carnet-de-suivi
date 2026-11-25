import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../api';
import { useApp } from '../state';
import { Badge, Card, ErrorMsg, Field, Loading, Notice, useLoad, useSubmit } from '../components/ui';
import { Icon } from '../components/Icon';

export const VET_SCOPES = ['herd', 'health', 'repro', 'feeding'] as const;
const DURATIONS = [24, 168, 720];
const STATUS_KIND: Record<string, 'ok' | 'warn' | 'error' | 'info'> = { verified: 'ok', pending: 'warn', rejected: 'error', suspended: 'error' };

/** Formulaire du profil vétérinaire (création ou mise à jour). */
export function VetProfileForm({ onDone }: { onDone?: () => void }) {
  const { t, me, lang, refresh } = useApp();
  const terr = useLoad<any[]>('/ref/territories');
  const cur = me?.vet;
  const [f, setF] = useState({ ordinal_number: cur?.ordinal_number ?? '', clinic: cur?.clinic ?? '', territory_code: cur?.territory_code ?? 'MQ', phone: cur?.phone ?? '' });
  const s = useSubmit(async () => { await post('/vet/profile', { ...f, phone: f.phone || null }); await refresh(); onDone?.(); });
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }}>
      <div className="grid2">
        <Field label={t('vet_ordinal')} required hint={t('vet_ordinal_hint')}><input required minLength={3} maxLength={20} inputMode="numeric" value={f.ordinal_number} onChange={up('ordinal_number')} /></Field>
        <Field label={t('vet_clinic')} required><input required minLength={2} maxLength={150} value={f.clinic} onChange={up('clinic')} /></Field>
        <Field label={t('territory')}><select value={f.territory_code} onChange={up('territory_code')}>{(terr.data ?? []).filter((x) => x.active).map((x) => <option key={x.code} value={x.code}>{lang === 'fr' ? x.name_fr : x.name_en}</option>)}</select></Field>
        <Field label={t('vet_phone')} hint={t('vet_phone_hint')}><input type="tel" maxLength={30} value={f.phone} onChange={up('phone')} /></Field>
      </div>
      <ErrorMsg error={s.error} />
      <button className="btn primary" disabled={s.busy}>{cur ? t('save') : t('vet_submit')}</button>
    </form>
  );
}

function VetStatus() {
  const { t, me } = useApp();
  const v = me?.vet;
  if (!v) return null;
  return (
    <div className="steps-v">
      <div className="row"><span className="step-dot ok">✓</span><b>{t('vet_step_email')}</b></div>
      <div className="row"><span className={`step-dot ${v.status === 'verified' ? 'ok' : v.status === 'pending' ? 'wait' : 'err'}`}>{v.status === 'verified' ? '✓' : v.status === 'pending' ? '…' : '!'}</span>
        <span><b>{t('vet_step_ordinal')}</b> <Badge kind={STATUS_KIND[v.status]}>{t(`vetst.${v.status}`)}</Badge>{v.decision_note && <div className="small muted">« {v.decision_note} »</div>}</span></div>
      <div className="row"><span className={`step-dot ${v.status === 'verified' ? 'ok' : ''}`}>{v.status === 'verified' ? '✓' : '3'}</span><span><b>{t('vet_step_sign')}</b><div className="small muted">{t('vet_step_sign_sub')}</div></span></div>
    </div>
  );
}

/** Espace vétérinaire : profil, code de consultation, clients, rapports signés. */
export function VetSpace() {
  const { t, me, d, dt, setFarmId, refresh } = useApp();
  const nav = useNavigate();
  const v = me?.vet;
  const clients = useLoad<any[]>(v?.status === 'verified' ? '/vet/clients' : null, [v?.status]);
  const reports = useLoad<any[]>(v?.status === 'verified' ? '/vet/reports' : null, [v?.status]);
  const [code, setCode] = useState('');
  const [editing, setEditing] = useState(false);
  const redeem = useSubmit(async () => {
    const g = await post('/vet/redeem', { code });
    setCode(''); await refresh(); setFarmId(g.farm_id); nav('/parasitisme');
  });
  const open = (farmId: string) => { setFarmId(farmId); nav('/parasitisme'); };
  return (
    <div className="stack">
      <h1><Icon name="health" size={26} />{t('vet_space')}</h1>
      {!v ? (
        <Card title={t('vet_create_title')}><p className="small muted" style={{ marginTop: 0 }}>{t('vet_create_intro')}</p><VetProfileForm /></Card>
      ) : (
        <Card title={`Dr ${me?.user?.first_name} ${me?.user?.last_name}`} actions={!editing && <button className="btn small" onClick={() => setEditing(true)}><Icon name="edit" size={16} />{t('edit')}</button>}>
          <p className="small muted" style={{ marginTop: 0 }}>{t('vet_ordinal')} : <b>{v.ordinal_number}</b> · {v.clinic}</p>
          {editing ? <VetProfileForm onDone={() => setEditing(false)} /> : <VetStatus />}
        </Card>
      )}
      {v?.status === 'verified' && (
        <>
          <Card title={t('vet_redeem_title')}>
            <p className="small muted" style={{ marginTop: 0 }}>{t('vet_redeem_intro')}</p>
            <form className="row" onSubmit={(e) => { e.preventDefault(); redeem.run(); }}>
              <input aria-label={t('vet_code')} inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                style={{ flex: '0 1 12rem', fontSize: '1.4rem', letterSpacing: '.35em', textAlign: 'center' }} />
              <button className="btn vet" disabled={code.length !== 6 || redeem.busy}>{t('vet_redeem_btn')}</button>
            </form>
            <ErrorMsg error={redeem.error} />
          </Card>
          <Card title={t('vet_clients')}>
            <ErrorMsg error={clients.error} />
            {!clients.data?.length ? <p className="muted" style={{ margin: 0 }}>{t('vet_no_clients')}</p> : (
              <ul className="tasks">{clients.data.map((c) => (
                <li key={c.id}><button className="task" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => open(c.farm_id)}>
                  <span className="ic blue"><Icon name="home" /></span>
                  <span className="t"><b>{c.farm_name}</b><small>{c.owner_name ?? '—'} · {t('vet_until', { date: dt(c.expires_at) })} · {c.scopes.map((s: string) => t(`vscope.${s}`)).join(', ')}</small></span>
                  {c.drafts > 0 ? <span className="chip warn">{t('vet_drafts', { n: c.drafts })}</span> : <Icon name="chev" />}
                </button></li>
              ))}</ul>
            )}
          </Card>
          <Card title={t('vet_signed_reports')}>
            {!reports.data?.length ? <p className="muted" style={{ margin: 0 }}>—</p> : (
              <ul className="list">{reports.data.map((r) => <li key={r.id} className="row between"><span><b>{r.number}</b> · {r.farm_name}</span><span className="small muted">{d(r.signed_at)}</span></li>)}</ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/** Côté éleveur : donner, voir et retirer l'accès d'un vétérinaire. */
export function FarmVetAccess() {
  const { t, farm, dt } = useApp();
  const list = useLoad<any[]>(farm ? `/farms/${farm.id}/vet-access` : null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<any[] | null>(null);
  const [scopes, setScopes] = useState<string[]>(['herd', 'health', 'repro']);
  const [hours, setHours] = useState(168);
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const search = useSubmit(async () => { setFound(await get(`/vet/search?q=${encodeURIComponent(q)}`)); });
  const grant = useSubmit(async (vetId: string) => { await post(`/farms/${farm!.id}/vet-access`, { vet_id: vetId, scopes, hours }); setFound(null); setQ(''); list.reload(); });
  const mkCode = useSubmit(async () => { setCode(await post(`/farms/${farm!.id}/vet-access/code`, { scopes, hours })); });
  const revoke = useSubmit(async (id: string) => { await post(`/farms/${farm!.id}/vet-access/${id}/revoke`); list.reload(); });
  if (!farm) return null;
  if (farm.role !== 'owner') return <Notice kind="warn">{t('err.owner_only')}</Notice>;
  const toggle = (s: string) => setScopes(scopes.includes(s) ? scopes.filter((x) => x !== s) : [...scopes, s]);
  return (
    <div className="stack">
      <h1><Icon name="health" size={26} />{t('vet_access_title')}</h1>
      <p className="muted" style={{ margin: 0 }}>{t('vet_access_intro')}</p>
      <Card title={t('vet_new_consult')}>
        <div className="stack">
          <div>
            <div className="field-label" style={{ marginBottom: '.4rem' }}>{t('vet_scopes')}</div>
            {VET_SCOPES.map((s) => <label key={s} className="check" style={{ padding: '.25rem 0' }}><input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} /> {t(`vscope_long.${s}`)}</label>)}
          </div>
          <div>
            <div className="field-label" style={{ marginBottom: '.4rem' }}>{t('vet_duration')}</div>
            <div className="segmented">{DURATIONS.map((h) => <button type="button" key={h} className={hours === h ? 'on' : ''} onClick={() => setHours(h)}>{t(`vdur.${h}`)}</button>)}</div>
          </div>
          <form className="row" onSubmit={(e) => { e.preventDefault(); search.run(); }}>
            <input type="search" style={{ flex: '1 1 14rem' }} placeholder={t('vet_search_ph')} aria-label={t('vet_search_ph')} value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn" disabled={search.busy}><Icon name="search" size={18} />{t('search')}</button>
          </form>
          {found && (!found.length ? <p className="small muted" style={{ margin: 0 }}>{t('vet_none_found')}</p> : (
            <ul className="list">{found.map((v) => (
              <li key={v.id} className="row between">
                <span><b>Dr {v.first_name} {v.last_name}</b> <Badge kind="info">✓ {t('vetst.verified')}</Badge><div className="small muted">{v.clinic} · n° {v.ordinal_number}</div></span>
                <button className="btn primary small" disabled={!scopes.length || grant.busy} onClick={() => grant.run(v.id)}>{t('vet_give_access')}</button>
              </li>
            ))}</ul>
          ))}
          <div className="card inset" style={{ textAlign: 'center' }}>
            <div className="small muted" style={{ fontWeight: 700 }}>{t('vet_code_onsite')}</div>
            {code ? (<><div className="code-big num">{code.code}</div><div className="small muted">{t('vet_code_valid', { time: dt(code.expires_at) })}</div></>)
              : <button className="btn" style={{ marginTop: '.6rem' }} disabled={!scopes.length || mkCode.busy} onClick={() => mkCode.run()}>{t('vet_code_make')}</button>}
          </div>
          <ErrorMsg error={search.error || grant.error || mkCode.error} />
        </div>
      </Card>
      <Card title={t('vet_access_list')}>
        <ErrorMsg error={list.error || revoke.error} />
        {!list.data?.length ? <p className="muted" style={{ margin: 0 }}>{t('vet_no_access')}</p> : (
          <ul className="list">{list.data.map((g) => (
            <li key={g.id} className="row between" style={{ opacity: g.active ? 1 : .55 }}>
              <span><b>Dr {g.first_name} {g.last_name}</b> <span className="small muted">· n° {g.ordinal_number}</span>
                <div className="small muted">{g.scopes.map((s: string) => t(`vscope.${s}`)).join(', ')} · {g.active ? t('vet_until', { date: dt(g.expires_at) }) : g.revoked_at ? t('vet_revoked') : t('vet_expired')}</div></span>
              {g.active && <button className="btn small danger" disabled={revoke.busy} onClick={() => window.confirm(t('vet_revoke_confirm')) && revoke.run(g.id)}>{t('vet_revoke')}</button>}
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}

/** Vérification publique d'un rapport signé (QR code du PDF). */
export function VerifyPage() {
  const { t, dt, d } = useApp();
  const { number } = useParams();
  const r = useLoad<any>(number ? `/public/verify/${encodeURIComponent(number)}` : null);
  if (r.loading) return <Loading />;
  return (
    <div className="stack" style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1><Icon name="shield" size={26} />{t('verify_doc_title')}</h1>
      <ErrorMsg error={r.error} />
      {r.data && (r.data.valid ? (
        <Card>
          <Notice kind="ok"><b>{t('verify_valid', { number: r.data.number })}</b></Notice>
          <dl className="dl" style={{ marginTop: '.8rem' }}>
            <dt>{t('farm')}</dt><dd>{r.data.farm_name}</dd>
            <dt>{t('copro_sample_date')}</dt><dd>{d(r.data.sample_date)}</dd>
            <dt>{t('vet')}</dt><dd>{r.data.signed_vet_name} · n° {r.data.signed_vet_ordinal}<div className="small muted">{r.data.signed_clinic}</div></dd>
            <dt>{t('signed_on')}</dt><dd>{dt(r.data.signed_at)}</dd>
            <dt>{t('content_hash')}</dt><dd className="small" style={{ fontFamily: 'monospace' }}>{r.data.content_hash}</dd>
          </dl>
          <p className="small muted">{t('verify_hint')}</p>
        </Card>
      ) : <Notice kind="error">{t('verify_invalid', { number: r.data.number })}</Notice>)}
      <Link to="/">{t('nav_home')} →</Link>
    </div>
  );
}

/** Administration : vérification des vétérinaires (n° d'inscription à l'Ordre). */
export function AdminVets() {
  const { t, dt } = useApp();
  const list = useLoad<any[]>('/admin/vets');
  const s = useSubmit(async (id: string, status: string) => {
    const note = status === 'verified' ? null : window.prompt(t('reason'));
    if (status !== 'verified' && !note) return;
    await post(`/admin/vets/${id}/decision`, { status, note }); list.reload();
  });
  return (
    <Card title={t('admin_vets')}>
      <p className="small muted" style={{ marginTop: 0 }}>{t('admin_vets_hint')}</p>
      <ErrorMsg error={list.error || s.error} />
      {!list.data?.length ? <p className="muted">—</p> : (
        <ul className="list">{list.data.map((v) => (
          <li key={v.user_id} className="stack-sm">
            <div className="row between"><span><b>Dr {v.first_name} {v.last_name}</b> · {v.email}</span><Badge kind={STATUS_KIND[v.status]}>{t(`vetst.${v.status}`)}</Badge></div>
            <div className="small muted">{t('vet_ordinal')} : <b>{v.ordinal_number}</b> · {v.clinic} · {v.territory_code ?? '—'} · {v.phone ?? '—'} · {dt(v.created_at)} · {t('vet_active_clients', { n: v.active_clients })}</div>
            <div className="row">
              {v.status !== 'verified' && <button className="btn small primary" disabled={s.busy} onClick={() => s.run(v.user_id, 'verified')}>{t('vet_verify')}</button>}
              {v.status === 'pending' && <button className="btn small danger" disabled={s.busy} onClick={() => s.run(v.user_id, 'rejected')}>{t('reject')}</button>}
              {v.status === 'verified' && <button className="btn small danger" disabled={s.busy} onClick={() => s.run(v.user_id, 'suspended')}>{t('suspend')}</button>}
            </div>
          </li>
        ))}</ul>
      )}
    </Card>
  );
}
