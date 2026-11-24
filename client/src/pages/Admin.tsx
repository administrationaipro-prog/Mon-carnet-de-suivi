import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { patch, post, put } from '../api';
import { useApp } from '../state';
import { Icon } from '../components/Icon';
import { Badge, Card, ErrorMsg, Field, Notice, Stat, useLoad, useSubmit } from '../components/ui';

const TABS = ['admin_stats', 'users', 'farms_admin', 'shop_admin', 'referentials', 'settings', 'audit', 'outbox'] as const;

export function Admin() {
  const { t } = useApp();
  const [tab, setTab] = useState<(typeof TABS)[number]>('admin_stats');
  return (
    <div className="stack">
      <h1>{t('admin_title')}</h1>
      <div className="tabs" role="tablist">{TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{t(k)}</button>)}</div>
      {tab === 'admin_stats' && <Overview />}
      {tab === 'users' && <Users />}
      {tab === 'farms_admin' && <Farms />}
      {tab === 'shop_admin' && <AdminShop />}
      {tab === 'referentials' && <Referentials />}
      {tab === 'settings' && <Settings />}
      {tab === 'audit' && <Audit />}
      {tab === 'outbox' && <Outbox />}
    </div>
  );
}

function Overview() {
  const { t } = useApp();
  const s = useLoad<any>('/admin/stats');
  const [sent, setSent] = useState(false);
  const te = useSubmit(async () => { await post('/admin/test-email'); setSent(true); });
  if (!s.data) return <ErrorMsg error={s.error} />;
  return (
    <div className="stack">
      <div className="stats"><Stat label={t('users')} value={s.data.users} /><Stat label={t('farms_admin')} value={s.data.farms} /><Stat label={t('pending_requests')} value={s.data.pending_requests} /><Stat label={t('active_consents')} value={s.data.active_consents} /></div>
      <Card title={t('mail_title')}>
        {s.data.mail_enabled ? <Notice kind="ok">{t('mail_enabled', { from: s.data.mail_from })}</Notice> : <Notice kind="warn">{t('mail_disabled')}</Notice>}
        <ErrorMsg error={te.error} />
        {sent && <Notice kind="ok">{t('mail_test_sent')}</Notice>}
        <button className="btn" disabled={te.busy || !s.data.mail_enabled} onClick={() => te.run()}>{t('mail_test')}</button>
      </Card>
    </div>
  );
}

/** État d’inscription d’un utilisateur + actions administrateur (renvoi du lien, validation manuelle tracée). */
function RegistrationState({ u, onDone }: { u: any; onDone: () => void }) {
  const { t, dt } = useApp();
  const [msg, setMsg] = useState<string | null>(null);
  const resend = useSubmit(async () => { await post(`/admin/users/${u.id}/resend-verification`); setMsg(t('verif_resent')); onDone(); });
  const verify = useSubmit(async () => {
    const reason = window.prompt(t('verify_manual_reason'));
    if (!reason || reason.trim().length < 5) return;
    await post(`/admin/users/${u.id}/verify-email`, { reason }); onDone();
  });
  let badge: React.ReactNode = null;
  if (!u.email_verified) badge = <Badge kind="warn">{t('rs.unverified')}</Badge>;
  else if (u.platform_role !== 'none' && !u.registration_status) badge = null;
  else if (!u.registration_status) badge = <Badge>{t('rs.not_started')}</Badge>;
  else if (u.registration_status === 'draft') badge = <Badge kind="info">{t('rs.draft')}</Badge>;
  else badge = <Link to={`/review/${u.registration_id}`}><Badge kind={u.registration_status === 'approved' ? 'ok' : u.registration_status === 'pending' || u.registration_status === 'info_requested' ? 'warn' : 'error'}>{t(`regst.${u.registration_status}`)} →</Badge></Link>;
  return (
    <div className="stack-sm" style={{ marginTop: '.35rem' }}>
      {badge && <div>{badge}</div>}
      {!u.email_verified && (
        <>
          <div className="small muted">{u.last_verification_sent_at ? t('verif_last_sent', { date: dt(u.last_verification_sent_at) }) : t('verif_never_sent')}</div>
          <div className="row wrap">
            <button className="btn small" disabled={resend.busy} onClick={() => resend.run()}><Icon name="download" size={16} style={{ transform: 'rotate(180deg)' }} />{t('verif_resend')}</button>
            <button className="btn small" disabled={verify.busy} onClick={() => verify.run()}><Icon name="check" size={16} />{t('verif_manual')}</button>
          </div>
        </>
      )}
      {msg && <div className="small" style={{ color: 'var(--ok)' }}>{msg}</div>}
      <ErrorMsg error={resend.error || verify.error} />
    </div>
  );
}

function Users() {
  const { t, d, me } = useApp();
  const [q, setQ] = useState('');
  const u = useLoad<any[]>(`/admin/users?q=${encodeURIComponent(q)}`);
  const terr = useLoad<any[]>('/ref/territories');
  const s = useSubmit(async (id: string, body: any) => { await patch(`/admin/users/${id}`, body); u.reload(); });
  return (
    <Card>
      <input type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorMsg error={s.error || u.error} />
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{t('name')}</th><th>{t('email')}</th><th>{t('platform_role')}</th><th>{t('territories')}</th><th>{t('status')}</th><th>{t('farms_admin')}</th><th>MFA</th></tr></thead>
        <tbody>{(u.data ?? []).map((x) => (
          <tr key={x.id}>
            <td>{x.first_name} {x.last_name}<div className="small muted">{d(x.created_at)}</div></td>
            <td><div>{x.email}</div><RegistrationState u={x} onDone={() => u.reload()} /></td>
            <td><select disabled={x.id === me?.user?.id} value={x.platform_role} onChange={(e) => s.run(x.id, { platform_role: e.target.value })} aria-label={t('platform_role')}>{['none', 'validator', 'analyst', 'admin'].map((r) => <option key={r} value={r}>{t(`prole.${r}`)}</option>)}</select></td>
            <td>{x.platform_role === 'validator' ? (
              <div className="row wrap">{(terr.data ?? []).map((tt) => (
                <label key={tt.code} className="check small"><input type="checkbox" checked={x.territories.includes(tt.code)} onChange={(e) => s.run(x.id, { territories: e.target.checked ? [...x.territories, tt.code] : x.territories.filter((c: string) => c !== tt.code) })} />{tt.code}</label>
              ))}</div>) : '—'}</td>
            <td><select disabled={x.id === me?.user?.id} value={x.status} onChange={(e) => s.run(x.id, { status: e.target.value })} aria-label={t('status')}>{['active', 'suspended'].map((r) => <option key={r} value={r}>{t(`ustatus.${r}`)}</option>)}</select></td>
            <td className="num">{x.farms}</td><td>{x.mfa_enabled ? '✓' : ''}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </Card>
  );
}

function Farms() {
  const { t, d, setFarmId } = useApp();
  const f = useLoad<any[]>('/admin/farms');
  const [access, setAccess] = useState<{ id: string; name: string } | null>(null);
  const [just, setJust] = useState(''); const [hours, setHours] = useState('1');
  const [granted, setGranted] = useState<string | null>(null);
  const st = useSubmit(async (id: string, status: string) => {
    const reason = window.prompt(t('reason')); if (!reason) return;
    await post(`/admin/farms/${id}/status`, { status, reason }); f.reload();
  });
  const ga = useSubmit(async () => { await post(`/admin/farms/${access!.id}/access`, { justification: just, hours: Number(hours) }); setGranted(access!.id); setAccess(null); setJust(''); });
  return (
    <Card>
      <ErrorMsg error={f.error || st.error} />
      {granted && <Notice kind="ok">{t('justified_access')} ✓ — <a href={`/admin/farm/${granted}`} onClick={(e) => { e.preventDefault(); setFarmId(granted); window.location.assign(`/admin/farm/${granted}`); }}>{t('open_farm')}</a></Notice>}
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{t('farm_name')}</th><th>{t('territory')}</th><th>{t('owners')}</th><th>{t('sharing')}</th><th>{t('status')}</th><th>{t('actions')}</th></tr></thead>
        <tbody>{(f.data ?? []).map((x) => (
          <tr key={x.id}><td>{x.name}<div className="small muted">{x.locality} · {d(x.created_at)}</div></td><td>{x.territory_code}</td><td>{x.owners}</td><td>{x.sharing ? '✓' : ''}</td>
            <td><Badge kind={x.status === 'active' ? 'ok' : 'error'}>{t(`ustatus.${x.status}`)}</Badge></td>
            <td className="row wrap">
              {x.status === 'active' ? <button className="btn small danger" onClick={() => st.run(x.id, 'suspended')}>{t('suspend')}</button> : <button className="btn small" onClick={() => st.run(x.id, 'active')}>{t('reinstate')}</button>}
              <button className="btn small" onClick={() => setAccess({ id: x.id, name: x.name })}>{t('justified_access')}</button>
            </td></tr>
        ))}</tbody>
      </table></div>
      {access && (
        <form className="stack card inset" onSubmit={(e) => { e.preventDefault(); ga.run(); }}>
          <h3>{t('justified_access')} — {access.name}</h3>
          <Field label={t('justification')} required><textarea required minLength={15} value={just} onChange={(e) => setJust(e.target.value)} /></Field>
          <Field label={t('access_hours')}><input type="number" min={1} max={24} value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
          <ErrorMsg error={ga.error} />
          <div className="row"><button className="btn primary">{t('confirm')}</button><button type="button" className="btn" onClick={() => setAccess(null)}>{t('cancel')}</button></div>
        </form>
      )}
    </Card>
  );
}

function Referentials() {
  const { t } = useApp();
  const terr = useLoad<any[]>('/ref/territories');
  const br = useLoad<any[]>('/ref/breeds');
  const [tf, setTf] = useState({ code: '', name_fr: '', name_en: '', timezone: 'America/Martinique', language: 'fr', active: false });
  const [bf, setBf] = useState({ code: '', label_fr: '', label_en: '', synonyms: '', is_cross: false });
  const st = useSubmit(async (x: any) => { await put(`/admin/territories/${x.code}`, x); terr.reload(); });
  const sb = useSubmit(async () => { await put(`/admin/breeds/${bf.code}`, { ...bf, synonyms: bf.synonyms.split(',').map((s) => s.trim()).filter(Boolean) }); setBf({ code: '', label_fr: '', label_en: '', synonyms: '', is_cross: false }); br.reload(); });
  return (
    <div className="grid2">
      <Card title={t('territories')}>
        <ErrorMsg error={st.error} />
        <div className="table-wrap"><table className="table compact"><thead><tr><th>{t('code')}</th><th>{t('label_fr')}</th><th>{t('timezone')}</th><th>{t('active')}</th></tr></thead>
          <tbody>{(terr.data ?? []).map((x) => <tr key={x.code}><td>{x.code}</td><td>{x.name_fr} / {x.name_en}</td><td className="small">{x.timezone}</td><td><input type="checkbox" checked={x.active} onChange={(e) => st.run({ ...x, active: e.target.checked })} aria-label={t('active')} /></td></tr>)}</tbody></table></div>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); st.run(tf); }}>
          <div className="grid3">
            <Field label={t('code')}><input required pattern="[A-Za-z]{2,3}" value={tf.code} onChange={(e) => setTf({ ...tf, code: e.target.value.toUpperCase() })} /></Field>
            <Field label={t('label_fr')}><input required value={tf.name_fr} onChange={(e) => setTf({ ...tf, name_fr: e.target.value })} /></Field>
            <Field label={t('label_en')}><input required value={tf.name_en} onChange={(e) => setTf({ ...tf, name_en: e.target.value })} /></Field>
            <Field label={t('timezone')}><input required value={tf.timezone} onChange={(e) => setTf({ ...tf, timezone: e.target.value })} /></Field>
            <Field label={t('language')}><select value={tf.language} onChange={(e) => setTf({ ...tf, language: e.target.value })}><option value="fr">FR</option><option value="en">EN</option></select></Field>
          </div>
          <button className="btn">{t('add')}</button>
        </form>
      </Card>
      <Card title={t('breed')}>
        <div className="table-wrap"><table className="table compact"><thead><tr><th>{t('code')}</th><th>{t('label_fr')}</th><th>{t('label_en')}</th><th>{t('synonyms')}</th></tr></thead>
          <tbody>{(br.data ?? []).map((x) => <tr key={x.code}><td className="small">{x.code}</td><td>{x.label_fr}</td><td>{x.label_en}</td><td className="small">{x.synonyms.join(', ')}</td></tr>)}</tbody></table></div>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); sb.run(); }}>
          <div className="grid2">
            <Field label={t('code')}><input required pattern="[A-Za-z0-9_]{2,40}" value={bf.code} onChange={(e) => setBf({ ...bf, code: e.target.value.toUpperCase() })} /></Field>
            <Field label={t('label_fr')}><input required value={bf.label_fr} onChange={(e) => setBf({ ...bf, label_fr: e.target.value })} /></Field>
            <Field label={t('label_en')}><input required value={bf.label_en} onChange={(e) => setBf({ ...bf, label_en: e.target.value })} /></Field>
            <Field label={t('synonyms')}><input value={bf.synonyms} onChange={(e) => setBf({ ...bf, synonyms: e.target.value })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={bf.is_cross} onChange={(e) => setBf({ ...bf, is_cross: e.target.checked })} /> {t('is_cross')}</label>
          <ErrorMsg error={sb.error} />
          <button className="btn">{t('add')}</button>
        </form>
      </Card>
    </div>
  );
}

function Settings() {
  const { t } = useApp();
  const s = useLoad<any>('/admin/settings');
  const [f, setF] = useState<any>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => { if (s.data) setF({ ...s.data, weighing_protocol_days: s.data.weighing_protocol_days.join(', ') }); }, [s.data]);
  const sv = useSubmit(async () => {
    await put('/admin/settings', {
      aggregation_min_farms: Number(f.aggregation_min_farms), consent_policy_version: String(f.consent_policy_version),
      weighing_protocol_days: String(f.weighing_protocol_days).split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)),
      weighing_tolerance_days: Number(f.weighing_tolerance_days), interpolation_max_gap_days: Number(f.interpolation_max_gap_days),
      inbreeding_warn_percent: Number(String(f.inbreeding_warn_percent).replace(',', '.')), inbreeding_max_percent: Number(String(f.inbreeding_max_percent).replace(',', '.')),
    });
    setOk(true); s.reload();
  });
  if (!f) return <ErrorMsg error={s.error} />;
  return (
    <Card>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); sv.run(); }}>
        <div className="grid2">
          <Field label={t('min_farms_setting')}><input type="number" min={3} max={50} value={f.aggregation_min_farms} onChange={(e) => setF({ ...f, aggregation_min_farms: e.target.value })} /></Field>
          <Field label={t('consent_version')}><input value={f.consent_policy_version} onChange={(e) => setF({ ...f, consent_policy_version: e.target.value })} /></Field>
          <Field label={t('protocol_days')}><input value={f.weighing_protocol_days} onChange={(e) => setF({ ...f, weighing_protocol_days: e.target.value })} /></Field>
          <Field label={t('tolerance_days')}><input type="number" min={0} max={15} value={f.weighing_tolerance_days} onChange={(e) => setF({ ...f, weighing_tolerance_days: e.target.value })} /></Field>
          <Field label={t('inb_warn_setting')}><input type="number" step="0.25" min={1} max={25} value={f.inbreeding_warn_percent ?? ''} onChange={(e) => setF({ ...f, inbreeding_warn_percent: e.target.value })} /></Field>
          <Field label={t('inb_max_setting')}><input type="number" step="0.25" min={3} max={25} value={f.inbreeding_max_percent ?? ''} onChange={(e) => setF({ ...f, inbreeding_max_percent: e.target.value })} /></Field>
          <Field label={t('interp_gap')}><input type="number" min={7} max={90} value={f.interpolation_max_gap_days} onChange={(e) => setF({ ...f, interpolation_max_gap_days: e.target.value })} /></Field>
        </div>
        <p className="small muted" style={{ margin: 0 }}>{t('inb_settings_hint')}</p>
        <ErrorMsg error={sv.error} />
        {ok && <Notice kind="ok">{t('saved')}</Notice>}
        <button className="btn primary">{t('save')}</button>
      </form>
    </Card>
  );
}

function Audit() {
  const { t, dt } = useApp();
  const [action, setAction] = useState('');
  const a = useLoad<any[]>(`/admin/audit?action=${encodeURIComponent(action)}`);
  return (
    <Card>
      <select value={action} onChange={(e) => setAction(e.target.value)} aria-label={t('action')}>
        <option value="">{t('all')}</option>{['auth', 'registration', 'admin', 'export', 'consent', 'farm', 'weighing', 'animal', 'rgpd', 'collective'].map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <div className="table-wrap"><table className="table compact">
        <thead><tr><th>{t('at')}</th><th>{t('actor')}</th><th>{t('action')}</th><th>{t('resource')}</th><th>{t('result_col')}</th><th>IP</th></tr></thead>
        <tbody>{(a.data ?? []).map((x) => <tr key={x.id}><td className="small">{dt(x.at)}</td><td className="small">{x.actor_email ?? '—'}</td><td>{x.action}</td><td className="small">{x.resource} {x.resource_id ? x.resource_id.slice(0, 8) : ''}</td><td>{x.result}</td><td className="small">{x.ip}</td></tr>)}</tbody>
      </table></div>
    </Card>
  );
}

const MAIL_KIND: Record<string, 'ok' | 'warn' | 'error' | 'neutral'> = { sent: 'ok', pending: 'warn', failed: 'error', logged: 'neutral' };
function Outbox() {
  const { t, dt } = useApp();
  const o = useLoad<any[]>('/admin/outbox');
  const rt = useSubmit(async (id: number) => { await post(`/admin/outbox/${id}/retry`); o.reload(); });
  return (
    <Card actions={<button className="btn small" onClick={() => o.reload()}>↻</button>}>
      <ErrorMsg error={rt.error} />
      <ul className="list small">{(o.data ?? []).map((m) => (
        <li key={m.id}>
          <div className="row between wrap">
            <span><strong>{dt(m.created_at)} → {m.to_email}</strong> — {m.subject}</span>
            <span className="row"><Badge kind={MAIL_KIND[m.status] ?? 'neutral'}>{t(`mailst.${m.status}`)}</Badge>
              {m.status === 'failed' && <button className="btn small" onClick={() => rt.run(m.id)}>{t('mail_retry')}</button>}</span>
          </div>
          {m.last_error && <div className="alert alert-error small">{m.last_error}</div>}
          <pre className="mail">{m.body}</pre>
        </li>
      ))}</ul>
    </Card>
  );
}

/** Consultation administrateur en lecture seule, après accès justifié et tracé. */
export function AdminFarmView({ id }: { id: string }) {
  const { t, d, num } = useApp();
  const f = useLoad<any>(`/farms/${id}`);
  const a = useLoad<any[]>(`/farms/${id}/animals?status=all`);
  return (
    <div className="stack">
      <Notice kind="warn">{t('mrole.admin_grant')} — {t('err.read_only')}</Notice>
      <ErrorMsg error={f.error || a.error} />
      {f.data && <h1>{f.data.name}</h1>}
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{t('internal_id')}</th><th>{t('sex')}</th><th>{t('birth_date')}</th><th>{t('animal_status')}</th><th className="num">{t('weighings_n')}</th><th className="num">{t('last_weight')}</th><th className="num">{t('gmq_overall')}</th></tr></thead>
        <tbody>{(a.data ?? []).map((x) => <tr key={x.id}><td>{x.internal_id}</td><td>{t(`sex.${x.sex}`)}</td><td>{d(x.birth_date)}</td><td>{t(`astatus.${x.status}`)}</td><td className="num">{x.weighings_count}</td><td className="num">{num(x.last_weight, 2)}</td><td className="num">{num(x.gmq_overall, 0)}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}

const ORDER_CHIP: Record<string, 'info' | 'warn' | 'ok' | 'neutral'> = { requested: 'info', confirmed: 'warn', delivered: 'ok', cancelled: 'neutral' };

/** Boutique : commandes à traiter, produits négociés (réserve) et fournisseurs. */
function AdminShop() {
  const { t, d, num, lang } = useApp();
  const orders = useLoad<any[]>('/admin/shop/orders');
  const products = useLoad<any[]>('/admin/shop/products');
  const suppliers = useLoad<any[]>('/admin/shop/suppliers');
  const terr = useLoad<any[]>('/ref/territories');
  const st = useSubmit(async (id: string, status: string) => {
    const note = window.prompt(t('order_note_prompt')) ?? undefined;
    await post(`/admin/shop/orders/${id}/status`, { status, note: note || undefined });
    orders.reload(); products.reload();
  });
  const emptyP = { id: '', supplier_id: '', name: '', category: 'hay', unit: 'botte', unit_weight_kg: '', price_eur: '', reserved_quantity: '', delivery_days: '7', territory_code: 'MQ', description: '', active: true };
  const [p, setP] = useState<any>(emptyP);
  const sp = useSubmit(async () => {
    const body = { ...p, unit_weight_kg: p.unit_weight_kg === '' ? null : Number(p.unit_weight_kg), price_eur: p.price_eur === '' ? null : Number(String(p.price_eur).replace(',', '.')),
      reserved_quantity: Number(p.reserved_quantity || 0), delivery_days: Number(p.delivery_days || 7), territory_code: p.territory_code || null, description: p.description || null };
    delete body.id; delete body.remaining; delete body.ordered_quantity; delete body.supplier_name; delete body.created_at;
    if (p.id) await put(`/admin/shop/products/${p.id}`, body); else await post('/admin/shop/products', body);
    setP(emptyP); products.reload(); suppliers.reload();
  });
  const [sup, setSup] = useState({ name: '', contact_name: '', phone: '', email: '', territory_code: 'MQ' });
  const ss = useSubmit(async () => { await post('/admin/shop/suppliers', { ...sup, territory_code: sup.territory_code || null }); setSup({ name: '', contact_name: '', phone: '', email: '', territory_code: 'MQ' }); suppliers.reload(); });
  const upP = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setP({ ...p, [k]: e.target.value });
  const terrOpts = (<><option value="">{t('any_territory')}</option>{(terr.data ?? []).filter((x) => x.active).map((x) => <option key={x.code} value={x.code}>{lang === 'fr' ? x.name_fr : x.name_en}</option>)}</>);
  return (
    <div className="stack">
      <Card title={t('orders')}>
        <p className="small muted" style={{ margin: '0 0 .6rem' }}>{t('shop_admin_hint')}</p>
        <ErrorMsg error={orders.error || st.error} />
        {!orders.data?.length ? <p className="muted">{t('shop_no_orders')}</p> : (
          <ul className="list">{orders.data.map((o) => (
            <li key={o.id} className="stack-sm">
              <div className="row between"><b>{o.quantity} × {o.product_name}</b><Badge kind={ORDER_CHIP[o.status]}>{t(`ordst.${o.status}`)}</Badge></div>
              <div className="small muted">{o.farm_name} ({o.locality ?? o.territory_code}) · {o.requested_by_name ?? '—'} · {d(o.created_at)} · {o.supplier_name}{o.unit_price_eur !== null ? ` · ${num(o.quantity * o.unit_price_eur, 2)} €` : ''}</div>
              {o.note && <div className="small">« {o.note} »</div>}
              <div className="row">
                {o.status === 'requested' && <button className="btn small primary" disabled={st.busy} onClick={() => st.run(o.id, 'confirmed')}>{t('order_confirm')}</button>}
                {o.status === 'confirmed' && <button className="btn small primary" disabled={st.busy} onClick={() => st.run(o.id, 'delivered')}>{t('order_deliver')}</button>}
                {(o.status === 'requested' || o.status === 'confirmed') && <button className="btn small danger" disabled={st.busy} onClick={() => st.run(o.id, 'cancelled')}>{t('order_cancel')}</button>}
              </div>
            </li>
          ))}</ul>
        )}
      </Card>
      <Card title={t('products')}>
        <ErrorMsg error={products.error} />
        <div className="table-wrap"><table className="table compact">
          <thead><tr><th>{t('name')}</th><th>{t('supplier')}</th><th className="num">{t('reserved')}</th><th className="num">{t('ordered')}</th><th className="num">{t('remaining')}</th><th className="num">€</th><th /></tr></thead>
          <tbody>{(products.data ?? []).map((x) => (
            <tr key={x.id} style={{ opacity: x.active ? 1 : .5 }}><td>{x.name}<div className="small muted">{t(`pcat.${x.category}`)} · {x.unit} · {x.territory_code ?? t('any_territory')}</div></td><td>{x.supplier_name}</td>
              <td className="num">{x.reserved_quantity}</td><td className="num">{x.ordered_quantity}</td><td className="num"><b>{x.remaining}</b></td><td className="num">{num(x.price_eur, 2)}</td>
              <td><button className="icon-btn small" aria-label={t('edit')} onClick={() => setP({ ...x, unit_weight_kg: x.unit_weight_kg ?? '', price_eur: x.price_eur ?? '', territory_code: x.territory_code ?? '', description: x.description ?? '' })}><Icon name="edit" size={16} /></button></td></tr>
          ))}</tbody>
        </table></div>
        {!!suppliers.data?.length && (
          <form className="stack card inset" onSubmit={(e) => { e.preventDefault(); sp.run(); }}>
            <h3 style={{ marginTop: 0 }}>{p.id ? `${t('edit')} — ${p.name}` : t('new_product')}</h3>
            <div className="grid3">
              <Field label={t('supplier')} required><select required value={p.supplier_id} onChange={upP('supplier_id')}><option value="">—</option>{suppliers.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label={t('name')} required><input required value={p.name} onChange={upP('name')} /></Field>
              <Field label={t('category')}><select value={p.category} onChange={upP('category')}>{['hay', 'grain', 'feed', 'mineral', 'bedding', 'health', 'other'].map((c) => <option key={c} value={c}>{t(`pcat.${c}`)}</option>)}</select></Field>
              <Field label={t('stock_unit')} required><input required value={p.unit} onChange={upP('unit')} /></Field>
              <Field label={t('unit_weight')}><input type="number" min={0} step="0.1" value={p.unit_weight_kg} onChange={upP('unit_weight_kg')} /></Field>
              <Field label={t('price_eur')}><input type="number" min={0} step="0.01" value={p.price_eur} onChange={upP('price_eur')} /></Field>
              <Field label={t('reserved')} required><input required type="number" min={0} step={1} value={p.reserved_quantity} onChange={upP('reserved_quantity')} /></Field>
              <Field label={t('delivery_days')}><input type="number" min={0} max={120} value={p.delivery_days} onChange={upP('delivery_days')} /></Field>
              <Field label={t('territory')}><select value={p.territory_code ?? ''} onChange={upP('territory_code')}>{terrOpts}</select></Field>
            </div>
            <Field label={t('description')}><input value={p.description} onChange={upP('description')} /></Field>
            <label className="check"><input type="checkbox" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} /> {t('active')}</label>
            <ErrorMsg error={sp.error} />
            <div className="row"><button className="btn primary" disabled={sp.busy}>{t('save')}</button>{p.id && <button type="button" className="btn" onClick={() => setP(emptyP)}>{t('cancel')}</button>}</div>
          </form>
        )}
      </Card>
      <Card title={t('suppliers')}>
        <ul className="list">{(suppliers.data ?? []).map((s) => <li key={s.id}><b>{s.name}</b><div className="small muted">{[s.contact_name, s.phone, s.email, s.territory_code].filter(Boolean).join(' · ')} · {s.products} {t('products').toLowerCase()}</div></li>)}</ul>
        <form className="stack card inset" onSubmit={(e) => { e.preventDefault(); ss.run(); }}>
          <h3 style={{ marginTop: 0 }}>{t('new_supplier')}</h3>
          <div className="grid3">
            <Field label={t('name')} required><input required minLength={2} value={sup.name} onChange={(e) => setSup({ ...sup, name: e.target.value })} /></Field>
            <Field label={t('contact')}><input value={sup.contact_name} onChange={(e) => setSup({ ...sup, contact_name: e.target.value })} /></Field>
            <Field label={t('phone')}><input type="tel" value={sup.phone} onChange={(e) => setSup({ ...sup, phone: e.target.value })} /></Field>
            <Field label={t('email')}><input type="email" value={sup.email} onChange={(e) => setSup({ ...sup, email: e.target.value })} /></Field>
            <Field label={t('territory')}><select value={sup.territory_code} onChange={(e) => setSup({ ...sup, territory_code: e.target.value })}>{terrOpts}</select></Field>
          </div>
          <ErrorMsg error={ss.error} />
          <button className="btn primary" disabled={ss.busy}>{t('add')}</button>
        </form>
      </Card>
    </div>
  );
}
