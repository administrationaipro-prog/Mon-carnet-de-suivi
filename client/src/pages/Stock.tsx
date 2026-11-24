import { useState } from 'react';
import { Link } from 'react-router-dom';
import { del, post, put, todayIso } from '../api';
import { useApp } from '../state';
import { Card, ErrorMsg, Field, Loading, Modal, Notice, numOrNull, strOrNull, useLoad, useSubmit } from '../components/ui';
import { Icon } from '../components/Icon';

export const PRODUCT_CATEGORIES = ['hay', 'grain', 'feed', 'mineral', 'bedding', 'health', 'other'] as const;
const STATUS_CHIP: Record<string, string> = { ok: 'ok', order: 'warn', empty: 'err', unknown: '' };

/** Formulaire d'article de stock (création ou modification). */
function ItemForm({ initial, products, onDone, onCancel }: { initial?: any; products: any[]; onDone: () => void; onCancel: () => void }) {
  const { t, farm } = useApp();
  const editing = !!initial;
  const s0 = (v: any) => (v === null || v === undefined ? '' : String(v));
  const [f, setF] = useState({
    name: s0(initial?.name), category: initial?.category ?? 'hay', unit: s0(initial?.unit), quantity: '', date: todayIso(),
    consumption_qty: s0(initial?.consumption_qty), consumption_days: s0(initial?.consumption_days),
    alert_units: s0(initial?.alert_units ?? 1), lead_days: s0(initial?.lead_days ?? 7), product_id: s0(initial?.product_id),
  });
  const s = useSubmit(async () => {
    const body: any = {
      name: f.name.trim(), category: f.category, unit: f.unit.trim(), consumption_qty: numOrNull(f.consumption_qty), consumption_days: numOrNull(f.consumption_days),
      alert_units: numOrNull(f.alert_units) ?? 1, lead_days: Math.round(numOrNull(f.lead_days) ?? 7), product_id: strOrNull(f.product_id),
    };
    if (editing) await put(`/farms/${farm!.id}/stock/${initial.id}`, body);
    else await post(`/farms/${farm!.id}/stock`, { ...body, quantity: numOrNull(f.quantity) ?? 0, date: f.date });
    onDone();
  });
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const pickProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    setF({ ...f, product_id: id, ...(p ? { unit: f.unit || p.unit, category: p.category, name: f.name || p.name, lead_days: String(p.delivery_days) } : {}) });
  };
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }}>
      <div className="grid2">
        <Field label={t('stock_name')} required><input required maxLength={120} value={f.name} onChange={up('name')} list="stock-names" /></Field>
        <Field label={t('category')}><select value={f.category} onChange={up('category')}>{PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`pcat.${c}`)}</option>)}</select></Field>
        <Field label={t('stock_unit')} required><input required maxLength={30} value={f.unit} onChange={up('unit')} list="stock-units" /></Field>
        {!editing && <Field label={t('stock_quantity')} required><input required type="number" min={0} step="0.5" inputMode="decimal" value={f.quantity} onChange={up('quantity')} /></Field>}
        {!editing && <Field label={t('stock_count_date')}><input type="date" max={todayIso()} value={f.date} onChange={up('date')} /></Field>}
      </div>
      <fieldset>
        <legend>{t('stock_consumption')}</legend>
        <div className="grid2">
          <Field label={t('stock_cons_qty')}><input type="number" min={0} step="0.5" inputMode="decimal" value={f.consumption_qty} onChange={up('consumption_qty')} /></Field>
          <Field label={t('stock_cons_days')}><input type="number" min={0} step="1" inputMode="numeric" value={f.consumption_days} onChange={up('consumption_days')} /></Field>
        </div>
        <p className="small muted" style={{ margin: '.4rem 0 0' }}>{t('stock_consumption_hint')}</p>
      </fieldset>
      <div className="grid2">
        <Field label={t('stock_alert_units')}><input type="number" min={0} step="0.5" value={f.alert_units} onChange={up('alert_units')} /></Field>
        <Field label={t('stock_lead_days')}><input type="number" min={0} max={120} value={f.lead_days} onChange={up('lead_days')} /></Field>
      </div>
      {products.length > 0 && (
        <Field label={t('stock_product')}>
          <select value={f.product_id} onChange={(e) => pickProduct(e.target.value)}>
            <option value="">—</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.supplier_name}</option>)}
          </select>
        </Field>
      )}
      <datalist id="stock-names">{['Foin', 'Grains', 'Granulés', 'Maïs', 'Tourteau', 'Pierre à lécher', 'Litière'].map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="stock-units">{['botte', 'sac', 'kg', 'balle ronde', 'bloc'].map((x) => <option key={x} value={x} />)}</datalist>
      <ErrorMsg error={s.error} />
      <div className="row"><button className="btn primary" disabled={s.busy}>{t('save')}</button><button type="button" className="btn" onClick={onCancel}>{t('cancel')}</button></div>
    </form>
  );
}

/** Saisie d'un mouvement : inventaire, entrée ou sortie. */
function MovementForm({ item, type, onDone }: { item: any; type: 'count' | 'in' | 'out'; onDone: () => void }) {
  const { t, farm } = useApp();
  const [f, setF] = useState({ quantity: '', date: todayIso(), note: '' });
  const s = useSubmit(async () => {
    await post(`/farms/${farm!.id}/stock/${item.id}/movements`, { type, quantity: numOrNull(f.quantity) ?? 0, date: f.date, note: strOrNull(f.note) });
    onDone();
  });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }}>
      <p className="small muted" style={{ margin: 0 }}>{t(`mvt_hint.${type}`)}</p>
      <div className="grid2">
        <Field label={`${t('shop_qty')} (${item.unit})`} required><input required autoFocus type="number" min={0} step="0.5" inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        <Field label={t('date')}><input type="date" max={todayIso()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </div>
      <Field label={`${t('note')} (${t('optional')})`}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <ErrorMsg error={s.error} />
      <button className="btn primary block" disabled={s.busy}>{t('save')}</button>
    </form>
  );
}

function History({ item }: { item: any }) {
  const { t, farm, d, num } = useApp();
  const h = useLoad<any[]>(`/farms/${farm!.id}/stock/${item.id}/movements`);
  if (!h.data) return <Loading />;
  return (
    <ul className="list small">{h.data.map((m) => (
      <li key={m.id} className="row between"><span>{d(m.date)} · <b>{t(`mvt.${m.type}`)}</b>{m.note ? ` · ${m.note}` : ''}<span className="muted"> · {m.author_name ?? '—'}</span></span><b className="num">{m.type === 'out' ? '−' : m.type === 'in' ? '+' : '='}{num(m.quantity, 2)}</b></li>
    ))}</ul>
  );
}

export function Stock() {
  const { t, farm, d, num } = useApp();
  const list = useLoad<any[]>(farm ? `/farms/${farm.id}/stock` : null);
  const products = useLoad<any[]>(farm ? `/shop/products?farm=${farm.id}` : null);
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const [mv, setMv] = useState<{ item: any; type: 'count' | 'in' | 'out' } | null>(null);
  const [hist, setHist] = useState<any | null>(null);
  const archive = useSubmit(async (id: string) => { await del(`/farms/${farm!.id}/stock/${id}`); list.reload(); });
  if (!farm) return null;
  const canWrite = farm.role !== 'referent';
  const prods = products.data ?? [];
  return (
    <div className="stack">
      <div className="row between"><h1><Icon name="box" size={26} />{t('stock_title')}</h1>{canWrite && !adding && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />{t('stock_add')}</button>}</div>
      <p className="muted" style={{ margin: 0 }}>{t('stock_intro')}</p>
      {adding && <Card title={t('stock_add')}><ItemForm products={prods} onDone={() => { setAdding(false); list.reload(); }} onCancel={() => setAdding(false)} /></Card>}
      <ErrorMsg error={list.error || archive.error} />
      {list.loading && !list.data ? <Loading /> : !list.data?.length ? (!adding && <Notice>{t('stock_empty_list')}</Notice>) : (
        <div className="grid2">
          {list.data.map((it) => {
            const e = it.estimate;
            const horizon = Math.max(30, it.lead_days * 3);
            return (
              <Card key={it.id} className={e.status === 'order' || e.status === 'empty' ? 'highlight-warn' : ''}>
                <div className="row between" style={{ alignItems: 'flex-start' }}>
                  <div><h2>{it.name}</h2><div className="small muted">{t(`pcat.${it.category}`)}{it.product ? ` · ${it.product.supplier}` : ''}</div></div>
                  <span className={`chip ${STATUS_CHIP[e.status]}`}>{t(`stst.${e.status}`)}</span>
                </div>
                <div className="row" style={{ alignItems: 'baseline', gap: '.4rem', marginTop: '.6rem' }}>
                  <span className="stat-value num" style={{ fontSize: '2.4rem' }}>{e.estimated === null ? '—' : num(e.estimated, 1)}</span><span className="muted" style={{ fontWeight: 700 }}>{it.unit}</span>
                </div>
                {e.days_left !== null ? (
                  <>
                    <div className="meter" style={{ background: 'var(--primary-softer)' }}><span style={{ width: `${Math.min(100, (e.days_left / horizon) * 100)}%`, background: e.status === 'ok' ? 'var(--primary-bright)' : e.status === 'order' ? 'var(--mango)' : 'var(--danger)' }} /></div>
                    <p className="small" style={{ margin: '.5rem 0 0' }}><b>{t('stock_days_left', { n: num(e.days_left, 0) })}</b> · {t('stock_rupture', { date: d(e.rupture_date) })}</p>
                    {e.status !== 'empty' && <p className="small muted" style={{ margin: 0 }}>{t('stock_order_by', { date: d(e.order_by) })} · {t('stock_consumption_line', { qty: num(it.consumption_qty, 2), unit: it.unit, days: num(it.consumption_days, 0) })}</p>}
                  </>
                ) : <p className="small muted" style={{ margin: '.4rem 0 0' }}>{t('stock_no_rate')}</p>}
                {canWrite && (
                  <div className="row" style={{ marginTop: '.8rem' }}>
                    {(['count', 'in', 'out'] as const).map((ty) => <button key={ty} className="btn small" onClick={() => setMv({ item: it, type: ty })}>{t(`mvt.${ty}`)}</button>)}
                    <Link className={`btn small ${e.status === 'ok' ? '' : 'primary'}`} to={it.product_id ? `/boutique?product=${it.product_id}` : `/boutique?category=${it.category}`}><Icon name="cart" size={16} />{t('stock_order_btn')}</Link>
                    <button className="icon-btn small" aria-label={t('edit')} onClick={() => setEdit(it)}><Icon name="edit" size={16} /></button>
                    <button className="icon-btn small" aria-label={t('stock_history')} onClick={() => setHist(it)}><Icon name="list" size={16} /></button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {mv && <Modal title={`${t(`mvt.${mv.type}`)} — ${mv.item.name}`} onClose={() => setMv(null)}><MovementForm item={mv.item} type={mv.type} onDone={() => { setMv(null); list.reload(); }} /></Modal>}
      {edit && (
        <Modal title={`${t('edit')} — ${edit.name}`} onClose={() => setEdit(null)}>
          <ItemForm initial={edit} products={prods} onDone={() => { setEdit(null); list.reload(); }} onCancel={() => setEdit(null)} />
          <button className="btn danger small" style={{ marginTop: '1rem' }} onClick={() => { if (window.confirm(`${t('stock_archive')} ?`)) { archive.run(edit.id); setEdit(null); } }}><Icon name="trash" size={16} />{t('stock_archive')}</button>
        </Modal>
      )}
      {hist && <Modal title={`${t('stock_history')} — ${hist.name}`} onClose={() => setHist(null)}><History item={hist} /></Modal>}
    </div>
  );
}
