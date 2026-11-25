import { useState } from 'react';
import { patch, post, del, ApiError } from '../api';
import { useApp } from '../state';
import { Badge, Card, ErrorMsg, Field, Notice, useLoad, useSubmit, Loading, downloadUrl } from '../components/ui';

export function Members() {
  const { t, farm, me, d, refresh } = useApp();
  const m = useLoad<any>(farm ? `/farms/${farm.id}/members` : null);
  const info = useLoad<any>(farm ? `/farms/${farm.id}` : null);
  const [inv, setInv] = useState({ email: '', role: 'collaborator' });
  const [fs, setFs] = useState<any | null>(null);
  const si = useSubmit(async () => { await post(`/farms/${farm!.id}/invitations`, inv); setInv({ email: '', role: inv.role }); m.reload(); });
  const sm = useSubmit(async (uid: string, body: any) => { await patch(`/farms/${farm!.id}/members/${uid}`, body); m.reload(); });
  const ci = useSubmit(async (id: string) => { await del(`/farms/${farm!.id}/invitations/${id}`); m.reload(); });
  const sf = useSubmit(async () => { await patch(`/farms/${farm!.id}`, fs); setFs(null); info.reload(); await refresh(); });
  if (!farm) return null;
  const owner = farm.role === 'owner';
  return (
    <div className="stack">
      <h1>{t('members_title')}</h1>
      {info.data && (
        <Card title={t('farm_settings')} actions={owner && !fs && <button className="btn small" onClick={() => setFs({ name: info.data.name, locality: info.data.locality ?? '', objective: info.data.objective, conduct_system: info.data.conduct_system ?? '', ede_number: info.data.ede_number ?? '' })}>{t('edit')}</button>}>
          {!fs ? (
            <dl className="dl">
              <dt>{t('farm_name')}</dt><dd>{info.data.name}</dd>
              <dt>{t('territory')}</dt><dd>{info.data.territory_fr} ({info.data.timezone})</dd>
              <dt>{t('locality')}</dt><dd>{info.data.locality ?? '—'}</dd>
              <dt>{t('objective')}</dt><dd>{t(`objective.${info.data.objective}`)}</dd>
              <dt>{t('conduct_system')}</dt><dd>{info.data.conduct_system ?? '—'}</dd>
              <dt>{t('ede_number')}</dt><dd>{info.data.ede_number ?? <span className="muted">{t('missing')}</span>}</dd>
            </dl>
          ) : (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); sf.run(); }}>
              <div className="grid2">
                <Field label={t('farm_name')}><input value={fs.name} onChange={(e) => setFs({ ...fs, name: e.target.value })} /></Field>
                <Field label={t('locality')}><input value={fs.locality} onChange={(e) => setFs({ ...fs, locality: e.target.value })} /></Field>
                <Field label={t('objective')}><select value={fs.objective} onChange={(e) => setFs({ ...fs, objective: e.target.value })}>{['meat', 'reproduction', 'mixed'].map((o) => <option key={o} value={o}>{t(`objective.${o}`)}</option>)}</select></Field>
                <Field label={t('conduct_system')}><input value={fs.conduct_system} onChange={(e) => setFs({ ...fs, conduct_system: e.target.value })} /></Field>
                <Field label={t('ede_number')} hint={t('ede_hint')}><input maxLength={30} value={fs.ede_number} onChange={(e) => setFs({ ...fs, ede_number: e.target.value })} /></Field>
              </div>
              <ErrorMsg error={sf.error} />
              <div className="row"><button className="btn primary">{t('save')}</button><button type="button" className="btn" onClick={() => setFs(null)}>{t('cancel')}</button></div>
            </form>
          )}
        </Card>
      )}
      {owner && (
        <Card title={t('invite')}>
          <form className="row wrap" onSubmit={(e) => { e.preventDefault(); si.run(); }}>
            <input type="email" required placeholder={t('invite_email')} aria-label={t('invite_email')} value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />
            <select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })} aria-label={t('role')}><option value="collaborator">{t('mrole.collaborator')}</option><option value="referent">{t('mrole.referent')}</option></select>
            <button className="btn primary" disabled={si.busy}>{t('invite')}</button>
          </form>
          <ErrorMsg error={si.error} />
        </Card>
      )}
      <ErrorMsg error={m.error || sm.error || ci.error} />
      {m.loading && !m.data ? <Loading /> : m.data && (
        <>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('name')}</th><th>{t('email')}</th><th>{t('role')}</th><th>{t('status')}</th>{owner && <th>{t('actions')}</th>}</tr></thead>
            <tbody>{m.data.members.map((x: any) => (
              <tr key={x.user_id}><td>{x.first_name} {x.last_name}</td><td>{x.email}</td>
                <td>{owner && x.user_id !== me?.user?.id && x.status === 'active' ? (
                  <select value={x.role} onChange={(e) => sm.run(x.user_id, { role: e.target.value })} aria-label={t('role')}>{['owner', 'collaborator', 'referent'].map((r) => <option key={r} value={r}>{t(`mrole.${r}`)}</option>)}</select>
                ) : t(`mrole.${x.role}`)}</td>
                <td><Badge kind={x.status === 'active' ? 'ok' : 'neutral'}>{t(`mstatus.${x.status}`)}</Badge></td>
                {owner && <td>{x.user_id !== me?.user?.id && (x.status === 'active'
                  ? <button className="btn small danger" onClick={() => sm.run(x.user_id, { status: 'revoked' })}>{t('revoke')}</button>
                  : <button className="btn small" onClick={() => sm.run(x.user_id, { status: 'active' })}>{t('reinstate')}</button>)}</td>}</tr>
            ))}</tbody>
          </table></div>
          {m.data.invitations.length > 0 && (
            <Card title={t('pending_invitations')}>
              <ul className="list">{m.data.invitations.map((i: any) => <li key={i.id} className="row between"><span>{i.email} — {t(`mrole.${i.role}`)} — {d(i.created_at)}</span>{owner && <button className="btn small ghost" onClick={() => ci.run(i.id)}>✕</button>}</li>)}</ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export function Collective() {
  const { t, farm, lang, d } = useApp();
  const c = useLoad<any>(farm ? `/farms/${farm.id}/consents` : null);
  const terr = useLoad<any[]>('/ref/territories');
  const [territory, setTerritory] = useState(farm?.territory_code ?? '');
  const stats = useLoad<any>(`/collective/stats${territory ? `?territory=${territory}` : ''}`);
  const [f, setF] = useState({ categories: ['growth'] as string[], scope: 'territory', duration: '', ack: false });
  const g = useSubmit(async () => {
    await post(`/farms/${farm!.id}/consents`, { purpose: 'collective_stats', categories: f.categories, scope: f.scope, duration_months: f.duration ? Number(f.duration) : null, acknowledged: f.ack || undefined });
    c.reload(); stats.reload();
  });
  const r = useSubmit(async (id: string) => { await post(`/farms/${farm!.id}/consents/${id}/revoke`); c.reload(); stats.reload(); });
  const active = c.data?.consents.find((x: any) => !x.revoked_at && (!x.expires_at || x.expires_at > new Date().toISOString()));
  const min = stats.data?.min_farms ?? c.data?.min_farms ?? 5;
  return (
    <div className="stack">
      <h1>{t('collective_title')}</h1>
      {farm && c.data && (
        <Card title={t('consent_title')}>
          <p>{t('consent_info', { min })}</p>
          {active ? (
            <div className="stack-sm">
              <p><Badge kind="ok">{t('consent_active')}</Badge> {d(active.granted_at)} · {active.categories.map((k: string) => t(`cat.${k}`)).join(', ')} · {t(`scope.${active.scope}`)} · {t('policy_version')} {active.policy_version}{active.expires_at ? ` · → ${d(active.expires_at)}` : ''}</p>
              {farm.role === 'owner' && <button className="btn danger" onClick={() => window.confirm(t('withdraw') + ' ?') && r.run(active.id)}>{t('withdraw')}</button>}
            </div>
          ) : farm.role === 'owner' ? (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); g.run(); }}>
              <fieldset><legend>{t('categories')}</legend>
                {['growth', 'health', 'feeding', 'reproduction'].map((k) => (
                  <label key={k} className="check"><input type="checkbox" checked={f.categories.includes(k)} onChange={(e) => setF({ ...f, categories: e.target.checked ? [...f.categories, k] : f.categories.filter((x) => x !== k) })} /> {t(`cat.${k}`)}</label>
                ))}
              </fieldset>
              <div className="grid2">
                <Field label={t('scope')}><select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}><option value="territory">{t('scope.territory')}</option><option value="all">{t('scope.all')}</option></select></Field>
                <Field label={t('duration')}><select value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })}><option value="">{t('duration_unlimited')}</option>{[6, 12, 24, 36].map((m) => <option key={m} value={m}>{m} {t('months')}</option>)}</select></Field>
              </div>
              <label className="check"><input type="checkbox" checked={f.ack} onChange={(e) => setF({ ...f, ack: e.target.checked })} /> {t('consent_ack')}</label>
              <ErrorMsg error={g.error} />
              <button className="btn primary" disabled={!f.ack || !f.categories.length || g.busy}>{t('grant_consent')}</button>
            </form>
          ) : <ErrorMsg error={new ApiError(403, 'owner_only')} />}
          <ErrorMsg error={r.error} />
          {c.data.consents.filter((x: any) => x.revoked_at).length > 0 && (
            <details><summary className="small">{t('reg_history')}</summary><ul className="list small">{c.data.consents.filter((x: any) => x.revoked_at).map((x: any) => <li key={x.id}>{d(x.granted_at)} → {t('consent_revoked', { date: d(x.revoked_at) })} · {x.categories.map((k: string) => t(`cat.${k}`)).join(', ')}</li>)}</ul></details>
          )}
        </Card>
      )}
      <Card title={t('collective_stats')} actions={<button className="btn small" onClick={() => downloadUrl(`/api/collective/stats.csv${territory ? `?territory=${territory}` : ''}`)}>{t('export_csv')}</button>}>
        <label className="field inline"><span className="field-label">{t('territory')}</span>
          <select value={territory} onChange={(e) => setTerritory(e.target.value)}>
            <option value="">{t('all_territories')}</option>
            {(terr.data ?? []).filter((x) => x.active).map((x) => <option key={x.code} value={x.code}>{lang === 'fr' ? x.name_fr : x.name_en}</option>)}
          </select>
        </label>
        <Notice kind="warn">{t('no_causal')}</Notice>
        <ErrorMsg error={stats.error} />
        {stats.data && (
          <>
            <p className="small muted">{t('participating_farms')} : {stats.data.participating_farms ?? `< ${min}`}</p>
            {stats.data.groups.length === 0 ? <p className="muted">{t('missing_data')}</p> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>{t('breed')}</th><th className="num">{t('farms')}</th><th className="num">{t('animals')}</th><th className="num">{t('gmq')} n</th><th className="num">{t('gmq')} {t('mean')}</th><th className="num">{t('median')}</th><th className="num">{t('missing_data')}</th><th className="num">{t('weight_j30')}</th><th className="num">{t('weight_j60')}</th></tr></thead>
                <tbody>{stats.data.groups.map((g: any) => g.suppressed ? (
                  <tr key={g.breed_code}><td>{lang === 'fr' ? g.label_fr : g.label_en}</td><td colSpan={8} className="muted">{t('suppressed', { min })}</td></tr>
                ) : (
                  <tr key={g.breed_code}><td>{lang === 'fr' ? g.label_fr : g.label_en}</td><td className="num">{g.farms}</td><td className="num">{g.animals}</td><td className="num">{g.gmq.n}</td><td className="num">{g.gmq.mean ?? '—'}</td><td className="num">{g.gmq.median ?? '—'}</td><td className="num">{g.gmq.missing}</td>
                    <td className="num">{g.weight_j30.n ? `${g.weight_j30.mean} (n=${g.weight_j30.n})` : '—'}</td><td className="num">{g.weight_j60.n ? `${g.weight_j60.mean} (n=${g.weight_j60.n})` : '—'}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
