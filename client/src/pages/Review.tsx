import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { post } from '../api';
import { useApp } from '../state';
import { Badge, Card, ErrorMsg, Field, Loading, useLoad, useSubmit } from '../components/ui';

const kind = (s: string) => (s === 'approved' ? 'ok' : s === 'rejected' || s === 'suspended' ? 'error' : s === 'pending' ? 'warn' : 'info') as any;

export function ReviewList() {
  const { t, d } = useApp();
  const [status, setStatus] = useState('pending');
  const list = useLoad<any[]>(`/registration/review${status ? `?status=${status}` : ''}`);
  return (
    <div className="stack">
      <h1>{t('review_title')}</h1>
      <div className="row wrap">{['pending', 'info_requested', 'approved', 'rejected', 'suspended', ''].map((s) => (
        <button key={s} className={`btn small ${status === s ? 'primary' : ''}`} onClick={() => setStatus(s)}>{s ? t(`regst.${s}`) : t('all')}</button>
      ))}</div>
      <ErrorMsg error={list.error} />
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('applicant')}</th><th>{t('farm_name')}</th><th>{t('territory')}</th><th>{t('production_type')}</th><th>{t('submitted_at')}</th><th>{t('status')}</th><th>{t('assigned_to')}</th></tr></thead>
          <tbody>{(list.data ?? []).map((r) => (
            <tr key={r.id}><td><Link to={`/review/${r.id}`}>{r.first_name} {r.last_name}</Link><div className="small muted">{r.email} {!r.email_verified && <Badge kind="warn">✉?</Badge>}</div></td>
              <td>{r.farm_name}<div className="small muted">{r.locality}</div></td><td>{r.territory_code}</td><td>{t(`prod.${r.production_type}`)}</td><td>{d(r.submitted_at)}</td>
              <td><Badge kind={kind(r.status)}>{t(`regst.${r.status}`)}</Badge></td><td>{r.assigned_name ?? '—'}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

export function ReviewDetail() {
  const { t, d, dt, me } = useApp();
  const { id } = useParams();
  const r = useLoad<any>(`/registration/review/${id}`, [id]);
  const reviewers = useLoad<any[]>(me?.user?.platform_role === 'admin' ? '/admin/users' : null);
  const [reason, setReason] = useState('');
  const s = useSubmit(async (action: string) => { await post(`/registration/review/${id}/decision`, { action, reason: reason || undefined }); setReason(''); r.reload(); });
  const as = useSubmit(async (user_id: string) => { await post(`/registration/review/${id}/assign`, { user_id }); r.reload(); });
  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <ErrorMsg error={r.error} />;
  const x = r.data;
  const actions: Record<string, string[]> = { pending: ['approve', 'request_info', 'reject'], info_requested: ['reject'], approved: ['suspend'], suspended: ['reinstate'] };
  return (
    <div className="stack">
      <Link to="/review">← {t('back')}</Link>
      <h1>{x.farm_name} <Badge kind={kind(x.status)}>{t(`regst.${x.status}`)}</Badge></h1>
      <div className="grid2">
        <Card title={t('applicant')}>
          <dl className="dl">
            <dt>{t('name')}</dt><dd>{x.applicant.first_name} {x.applicant.last_name}</dd>
            <dt>{t('email')}</dt><dd>{x.applicant.email} {x.applicant.email_verified_at ? <Badge kind="ok">{t('email_verified')}</Badge> : <Badge kind="warn">{t('err.email_not_verified')}</Badge>}</dd>
            <dt>{t('language')}</dt><dd>{x.applicant.lang.toUpperCase()}</dd>
          </dl>
        </Card>
        <Card title={t('reg_title')}>
          <dl className="dl">
            <dt>{t('territory')}</dt><dd>{x.territory_code}</dd><dt>{t('locality')}</dt><dd>{x.locality}</dd>
            <dt>{t('production_type')}</dt><dd>{t(`prod.${x.production_type}`)}</dd><dt>{t('herd_size')}</dt><dd>{x.herd_size ?? '—'}</dd>
            <dt>{t('accept_terms')}</dt><dd>{x.accepted_terms ? '✓' : '✗'}</dd><dt>{t('truthful')}</dt><dd>{x.truthful_declaration ? '✓' : '✗'}</dd>
            <dt>{t('submitted_at')}</dt><dd>{d(x.submitted_at)}</dd>
          </dl>
          {x.message && <blockquote>{x.message}</blockquote>}
        </Card>
      </div>
      {actions[x.status] && (
        <Card title={t('decision')}>
          <Field label={t('decision_reason')}><textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <ErrorMsg error={s.error} />
          <div className="row wrap">{actions[x.status].map((a) => (
            <button key={a} className={`btn ${a === 'approve' || a === 'reinstate' ? 'primary' : a === 'reject' || a === 'suspend' ? 'danger' : ''}`} disabled={s.busy} onClick={() => s.run(a)}>{t(a)}</button>
          ))}</div>
        </Card>
      )}
      {me?.user?.platform_role === 'admin' && reviewers.data && (
        <Card title={t('assigned_to')}>
          <select value={x.assigned_to ?? ''} onChange={(e) => as.run(e.target.value)} aria-label={t('assigned_to')}>
            <option value="" disabled>—</option>
            {reviewers.data.filter((u) => u.platform_role === 'admin' || u.platform_role === 'validator').map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({t(`prole.${u.platform_role}`)}{u.territories.length ? ` ${u.territories.join(',')}` : ''})</option>)}
          </select>
          <ErrorMsg error={as.error} />
        </Card>
      )}
      <Card title={t('reg_history')}>
        <ul className="list small">{x.history.map((h: any, i: number) => <li key={i}>{dt(h.at)} — {h.actor ?? '—'} — {h.from_status ? `${t(`regst.${h.from_status}`)} → ` : ''}{t(`regst.${h.to_status}`)}{h.reason ? ` · ${h.reason}` : ''}</li>)}</ul>
      </Card>
    </div>
  );
}
