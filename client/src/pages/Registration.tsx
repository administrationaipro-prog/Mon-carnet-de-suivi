import { useEffect, useState } from 'react';
import { put } from '../api';
import { useApp } from '../state';
import { Card, ErrorMsg, Field, Loading, Notice, useLoad, useSubmit, Badge } from '../components/ui';

const PROD = ['sheep_meat', 'sheep_breeding', 'sheep_mixed', 'goat', 'other'];
const empty = { territory_code: 'MQ', farm_name: '', locality: '', production_type: 'sheep_meat', herd_size: '', message: '', accepted_terms: false, truthful_declaration: false };

export function Registration() {
  const { t, lang, d, refresh } = useApp();
  const mine = useLoad<any>('/registration/mine');
  const terr = useLoad<any[]>('/ref/territories');
  const [f, setF] = useState(empty);
  const [newReq, setNewReq] = useState(false);
  const r = mine.data;
  useEffect(() => {
    if (r) setF({ territory_code: r.territory_code, farm_name: r.farm_name, locality: r.locality, production_type: r.production_type, herd_size: r.herd_size ?? '',
      message: r.message ?? '', accepted_terms: r.accepted_terms, truthful_declaration: r.truthful_declaration });
  }, [r]);
  const save = useSubmit(async (submit: boolean) => {
    await put(`/registration/mine${submit ? '?submit=1' : ''}`, { ...f, herd_size: f.herd_size === '' ? null : Number(f.herd_size), message: f.message || null });
    setNewReq(false); mine.reload(); await refresh();
  });
  if (mine.loading && !mine.data) return <Loading />;
  const editable = !r || ['draft', 'info_requested'].includes(r.status) || (r.status === 'rejected' && newReq);
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  return (
    <div className="stack">
      <h1>{t('reg_title')}</h1>
      <Notice>{t('reg_intro')}</Notice>
      {r && r.status !== 'draft' && (
        <Card title={t('reg_status')}>
          <p><Badge kind={r.status === 'approved' ? 'ok' : r.status === 'rejected' || r.status === 'suspended' ? 'error' : 'warn'}>{t(`regst.${r.status}`)}</Badge></p>
          <p>{t(`regst_desc.${r.status}`)}</p>
          {r.decision_reason && <p><strong>{t('reason')} :</strong> {r.decision_reason}</p>}
          <details><summary>{t('reg_history')}</summary>
            <ul className="list small">{r.history.map((h: any, i: number) => <li key={i}>{d(h.at)} — {t(`regst.${h.to_status}`)}{h.reason ? ` (${h.reason})` : ''}</li>)}</ul>
          </details>
          {r.status === 'rejected' && !newReq && <button className="btn" onClick={() => setNewReq(true)}>{t('reg_reexamine')}</button>}
        </Card>
      )}
      {editable && (
        <Card>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); save.run(true); }}>
            <div className="grid2">
              <Field label={t('territory')} required>
                <select value={f.territory_code} onChange={up('territory_code')}>
                  {(terr.data ?? []).map((x) => <option key={x.code} value={x.code} disabled={!x.active}>{lang === 'fr' ? x.name_fr : x.name_en}{!x.active ? ` ${t('territory_closed')}` : ''}</option>)}
                </select>
              </Field>
              <Field label={t('production_type')} required>
                <select value={f.production_type} onChange={up('production_type')}>{PROD.map((p) => <option key={p} value={p}>{t(`prod.${p}`)}</option>)}</select>
              </Field>
              <Field label={t('farm_name')} required><input required minLength={2} value={f.farm_name} onChange={up('farm_name')} /></Field>
              <Field label={t('locality')} required><input required value={f.locality} onChange={up('locality')} /></Field>
              <Field label={`${t('herd_size')} (${t('optional')})`}><input type="number" min={0} value={f.herd_size} onChange={up('herd_size')} /></Field>
            </div>
            <Field label={`${t('message_reviewer')} (${t('optional')})`} hint={t('reg_no_id_docs')}><textarea value={f.message} onChange={up('message')} /></Field>
            <label className="check"><input type="checkbox" checked={f.accepted_terms} onChange={up('accepted_terms')} /> {t('accept_terms')}</label>
            <label className="check"><input type="checkbox" checked={f.truthful_declaration} onChange={up('truthful_declaration')} /> {t('truthful')}</label>
            <ErrorMsg error={save.error} />
            <div className="row">
              <button type="button" className="btn" disabled={save.busy || !f.farm_name || !f.locality} onClick={() => save.run(false)}>{t('save_draft')}</button>
              <button className="btn primary" disabled={save.busy}>{t('submit_request')}</button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
