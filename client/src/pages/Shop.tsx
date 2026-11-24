import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { post } from '../api';
import { useApp } from '../state';
import { Card, ErrorMsg, Loading, Notice, useLoad, useSubmit } from '../components/ui';
import { Icon } from '../components/Icon';
import { PRODUCT_CATEGORIES } from './Stock';

const ORDER_CHIP: Record<string, string> = { requested: 'info', confirmed: 'warn', delivered: 'ok', cancelled: '' };

function ProductCard({ p, highlighted, canWrite, onOrdered }: { p: any; highlighted: boolean; canWrite: boolean; onOrdered: () => void }) {
  const { t, farm, num } = useApp();
  const [qty, setQty] = useState('1');
  const [ok, setOk] = useState(false);
  const s = useSubmit(async () => {
    await post(`/farms/${farm!.id}/orders`, { product_id: p.id, quantity: Math.max(1, Math.round(Number(qty) || 1)) });
    setOk(true); onOrdered();
  });
  const n = Math.max(1, Math.round(Number(qty) || 1));
  return (
    <Card className={highlighted ? 'highlight' : ''}>
      <div id={`p-${p.id}`} className="row between" style={{ alignItems: 'flex-start' }}>
        <div><h2>{p.name}</h2><div className="small muted">{p.supplier_name} · {t(`pcat.${p.category}`)}</div></div>
        {p.remaining > 0 ? <span className="chip ok">{t('shop_reserved', { n: p.remaining })}</span> : <span className="chip err">{t('shop_sold_out')}</span>}
      </div>
      <div className="row" style={{ alignItems: 'baseline', gap: '.35rem', marginTop: '.5rem' }}>
        {p.price_eur !== null && <span className="stat-value num" style={{ fontSize: '1.6rem' }}>{num(p.price_eur, 2)} €</span>}
        <span className="muted" style={{ fontWeight: 700 }}>/ {p.unit}{p.unit_weight_kg ? ` (${num(p.unit_weight_kg, 1)} kg)` : ''}</span>
      </div>
      <p className="small muted" style={{ margin: '.2rem 0 0' }}>{t('shop_delivery', { n: p.delivery_days })}</p>
      {p.description && <p className="small" style={{ margin: '.5rem 0 0' }}>{p.description}</p>}
      {canWrite && p.remaining > 0 && (
        <form className="row" style={{ marginTop: '.8rem' }} onSubmit={(e) => { e.preventDefault(); setOk(false); s.run(); }}>
          <label className="field inline" style={{ flex: '0 1 9rem' }}><span className="sr-only">{t('shop_qty')}</span>
            <input type="number" min={1} max={p.remaining} step={1} inputMode="numeric" aria-label={t('shop_qty')} value={qty} onChange={(e) => setQty(e.target.value)} /></label>
          <button className="btn primary" disabled={s.busy}><Icon name="cart" size={18} />{t('shop_order')}</button>
          {p.price_eur !== null && <span className="small muted">{t('shop_total', { total: num(n * p.price_eur, 2) })}</span>}
        </form>
      )}
      <ErrorMsg error={s.error} />
      {ok && <Notice kind="ok">{t('shop_ordered')}</Notice>}
    </Card>
  );
}

export function Shop() {
  const { t, farm, d, num } = useApp();
  const [params] = useSearchParams();
  const highlight = params.get('product');
  const [cat, setCat] = useState(params.get('category') ?? '');
  const products = useLoad<any[]>(farm ? `/shop/products?farm=${farm.id}` : null);
  const orders = useLoad<any[]>(farm ? `/farms/${farm.id}/orders` : null);
  const cancel = useSubmit(async (id: string) => { await post(`/farms/${farm!.id}/orders/${id}/cancel`); orders.reload(); products.reload(); });
  useEffect(() => { if (highlight && products.data) document.getElementById(`p-${highlight}`)?.scrollIntoView({ block: 'center' }); }, [highlight, products.data]);
  if (!farm) return null;
  const canWrite = farm.role !== 'referent';
  const all = products.data ?? [];
  const cats = PRODUCT_CATEGORIES.filter((c) => all.some((p) => p.category === c));
  const shown = all.filter((p) => !cat || p.category === cat || p.id === highlight);
  return (
    <div className="stack">
      <h1><Icon name="cart" size={26} />{t('shop_title')}</h1>
      <p className="muted" style={{ margin: 0 }}>{t('shop_intro')}</p>
      <Notice><span className="row" style={{ alignItems: 'flex-start' }}><Icon name="info" size={20} /><span>{t('shop_payment_note')}</span></span></Notice>
      {cats.length > 1 && (
        <div className="segmented" role="group" aria-label={t('category')}>
          <button type="button" className={!cat ? 'on' : ''} onClick={() => setCat('')}>{t('all')}</button>
          {cats.map((c) => <button key={c} type="button" className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{t(`pcat.${c}`)}</button>)}
        </div>
      )}
      <ErrorMsg error={products.error} />
      {products.loading && !products.data ? <Loading /> : !shown.length ? <Notice kind="warn">{t('shop_empty')}</Notice> : (
        <div className="grid2">{shown.map((p) => <ProductCard key={p.id} p={p} highlighted={p.id === highlight} canWrite={canWrite} onOrdered={() => { orders.reload(); products.reload(); }} />)}</div>
      )}
      <Card title={t('shop_my_orders')}>
        <ErrorMsg error={orders.error || cancel.error} />
        {!orders.data?.length ? <p className="muted" style={{ margin: 0 }}>{t('shop_no_orders')}</p> : (
          <ul className="list">{orders.data.map((o) => (
            <li key={o.id} className="row between">
              <span><b>{o.quantity} × {o.product_name}</b><div className="small muted">{d(o.created_at)} · {o.supplier_name}{o.unit_price_eur !== null ? ` · ${num(o.quantity * o.unit_price_eur, 2)} €` : ''}{o.decision_note ? ` · « ${o.decision_note} »` : ''}{o.delivery_date ? ` · ${d(o.delivery_date)}` : ''}</div></span>
              <span className="row"><span className={`chip ${ORDER_CHIP[o.status]}`}>{t(`ordst.${o.status}`)}</span>
                {canWrite && o.status === 'requested' && <button className="btn small ghost" onClick={() => window.confirm(`${t('shop_cancel')} ?`) && cancel.run(o.id)}>{t('shop_cancel')}</button>}</span>
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}
