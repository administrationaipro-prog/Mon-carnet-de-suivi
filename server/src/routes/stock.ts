import { Router } from 'express';
import { z } from 'zod';
import { h, parse, farmAccess, zDate, zOptText, today, type Ctx } from '../http.js';
import { bad, conflict, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { checkStockAlert, itemEstimate } from '../lib/stockAlerts.js';
import { sendMail, notify } from '../lib/mail.js';

/** Stocks de l'exploitation et commandes passées dans la boutique (données privées de l'exploitation). */
export const stockRouter = Router({ mergeParams: true });
const fid = (c: Ctx) => c.req.params.farmId as string;
const isUuid = (s: unknown) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
export const CATEGORIES = ['hay', 'grain', 'feed', 'mineral', 'bedding', 'health', 'other'] as const;

const zItem = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(CATEGORIES),
  unit: z.string().trim().min(1).max(30),
  consumption_qty: z.number().positive().max(100000).nullable().optional(),
  consumption_days: z.number().positive().max(3650).nullable().optional(),
  alert_units: z.number().min(0).max(100000).default(1),
  lead_days: z.number().int().min(0).max(120).default(7),
  product_id: z.string().uuid().nullable().optional(),
}).refine((v) => !!v.consumption_qty === !!v.consumption_days, { message: 'consumption_incomplete', path: ['consumption_days'] });

async function getItem(c: Ctx, id: string) {
  if (!isUuid(id)) throw notFound();
  const { rows } = await c.db.query('select * from stock_items where id = $1 and farm_id = $2 and active', [id, fid(c)]);
  if (!rows[0]) throw notFound();
  return rows[0];
}
async function checkProduct(c: Ctx, productId: string | null | undefined) {
  if (!productId) return;
  const p = await c.db.query('select 1 from products where id = $1 and active', [productId]);
  if (!p.rowCount) throw bad('unknown_product');
}
async function withEstimate(c: Ctx, item: any) {
  const product = item.product_id ? (await c.db.query(
    `select p.id, p.name, p.unit, p.price_eur, p.delivery_days, p.reserved_quantity - p.ordered_quantity as remaining, s.name as supplier
       from products p join suppliers s on s.id = p.supplier_id where p.id = $1`, [item.product_id])).rows[0] ?? null : null;
  return { ...item, estimate: await itemEstimate(c.db, item, today()), product };
}

stockRouter.get('/stock', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const { rows } = await c.db.query('select * from stock_items where farm_id = $1 and active order by name', [fid(c)]);
  const out = [];
  for (const it of rows) out.push(await withEstimate(c, it));
  const rank: Record<string, number> = { empty: 0, order: 1, ok: 2, unknown: 3 };
  return out.sort((a, b) => rank[a.estimate.status] - rank[b.estimate.status] || a.name.localeCompare(b.name));
}));

stockRouter.post('/stock', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const b = parse(zItem.and(z.object({ quantity: z.number().min(0).max(1000000), date: zDate.optional() })), c.req.body);
  if (b.date && b.date > today()) throw bad('date_in_future');
  await checkProduct(c, b.product_id);
  const { rows } = await c.db.query(
    `insert into stock_items (farm_id, name, category, unit, consumption_qty, consumption_days, alert_units, lead_days, product_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [fid(c), b.name, b.category, b.unit, b.consumption_qty ?? null, b.consumption_days ?? null, b.alert_units, b.lead_days, b.product_id ?? null]);
  await c.db.query(`insert into stock_movements (farm_id, item_id, type, quantity, date, note, author_id) values ($1,$2,'count',$3,$4,$5,$6)`,
    [fid(c), rows[0].id, b.quantity, b.date ?? today(), 'Stock initial', c.user.id]);
  await audit(c.db, { actor: c.user.id, action: 'stock.item_created', resource: 'stock_item', resourceId: rows[0].id, farmId: fid(c), ip: c.ip });
  await checkStockAlert(c.db, rows[0]);
  return withEstimate(c, (await c.db.query('select * from stock_items where id = $1', [rows[0].id])).rows[0]);
}));

stockRouter.put('/stock/:id', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const it = await getItem(c, c.req.params.id as string);
  const b = parse(zItem, c.req.body);
  await checkProduct(c, b.product_id);
  const { rows } = await c.db.query(
    `update stock_items set name=$2, category=$3, unit=$4, consumption_qty=$5, consumption_days=$6, alert_units=$7, lead_days=$8, product_id=$9 where id=$1 returning *`,
    [it.id, b.name, b.category, b.unit, b.consumption_qty ?? null, b.consumption_days ?? null, b.alert_units, b.lead_days, b.product_id ?? null]);
  await checkStockAlert(c.db, rows[0]);
  return withEstimate(c, (await c.db.query('select * from stock_items where id = $1', [it.id])).rows[0]);
}));

stockRouter.delete('/stock/:id', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const it = await getItem(c, c.req.params.id as string);
  await c.db.query('update stock_items set active = false where id = $1', [it.id]);
  await audit(c.db, { actor: c.user.id, action: 'stock.item_archived', resource: 'stock_item', resourceId: it.id, farmId: fid(c), ip: c.ip });
}));

/** Mouvement : inventaire (quantité comptée), entrée (achat, livraison) ou sortie (perte, don…). */
stockRouter.post('/stock/:id/movements', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const it = await getItem(c, c.req.params.id as string);
  const b = parse(z.object({ type: z.enum(['count', 'in', 'out']), quantity: z.number().min(0).max(1000000), date: zDate.optional(), note: zOptText(300) }), c.req.body);
  const date = b.date ?? today();
  if (date > today()) throw bad('date_in_future');
  if (b.type !== 'count' && b.quantity <= 0) throw bad('quantity_not_positive');
  await c.db.query(`insert into stock_movements (farm_id, item_id, type, quantity, date, note, author_id) values ($1,$2,$3,$4,$5,$6,$7)`,
    [fid(c), it.id, b.type, b.quantity, date, b.note, c.user.id]);
  if (b.type !== 'out') await c.db.query('update stock_items set last_alert_at = null where id = $1', [it.id]); // alerte réarmée
  const fresh = (await c.db.query('select * from stock_items where id = $1', [it.id])).rows[0];
  await checkStockAlert(c.db, fresh);
  return withEstimate(c, (await c.db.query('select * from stock_items where id = $1', [it.id])).rows[0]);
}));

stockRouter.get('/stock/:id/movements', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const it = await getItem(c, c.req.params.id as string);
  const { rows } = await c.db.query(
    `select m.*, u.first_name || ' ' || u.last_name as author_name from stock_movements m left join users u on u.id = m.author_id
      where m.item_id = $1 order by m.date desc, m.created_at desc limit 200`, [it.id]);
  return rows;
}));

// ---------- Commandes de l'exploitation ----------
stockRouter.get('/orders', h(async (c) => {
  await farmAccess(c, fid(c), 'read');
  const { rows } = await c.db.query(
    `select o.*, p.name as product_name, p.unit, s.name as supplier_name from orders o join products p on p.id = o.product_id
       join suppliers s on s.id = p.supplier_id where o.farm_id = $1 order by o.created_at desc limit 200`, [fid(c)]);
  return rows;
}));

stockRouter.post('/orders', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  const b = parse(z.object({ product_id: z.string().uuid(), quantity: z.number().int().min(1).max(10000), note: zOptText(500) }), c.req.body);
  const farm = (await c.db.query('select name, territory_code from farms where id = $1', [fid(c)])).rows[0];
  // verrou sur le produit : deux commandes simultanées ne peuvent pas dépasser la réserve
  const { rows } = await c.db.query(
    `select p.*, s.name as supplier_name from products p join suppliers s on s.id = p.supplier_id
      where p.id = $1 and p.active and s.active for update of p`, [b.product_id]);
  const p = rows[0];
  if (!p || (p.territory_code && p.territory_code !== farm.territory_code)) throw notFound('product_not_found');
  const remaining = p.reserved_quantity - p.ordered_quantity;
  if (b.quantity > remaining) throw conflict('reserve_insufficient', { remaining });
  const o = (await c.db.query(
    `insert into orders (farm_id, product_id, quantity, unit_price_eur, note, requested_by) values ($1,$2,$3,$4,$5,$6) returning *`,
    [fid(c), p.id, b.quantity, p.price_eur, b.note, c.user.id])).rows[0];
  await c.db.query('update products set ordered_quantity = ordered_quantity + $2 where id = $1', [p.id, b.quantity]);
  await audit(c.db, { actor: c.user.id, action: 'shop.order_created', resource: 'order', resourceId: o.id, farmId: fid(c), details: { product: p.name, quantity: b.quantity }, ip: c.ip });
  const admins = (await c.db.query(`select id, email, lang from users where platform_role = 'admin' and status = 'active'`)).rows;
  for (const a of admins) {
    await notify(c.db, a.id, 'new_order', { farm: farm.name, product: p.name, quantity: b.quantity });
    await sendMail(c.db, a.email, a.lang, 'new_order', { farm: farm.name, product: p.name, supplier: p.supplier_name, quantity: b.quantity });
  }
  return o;
}));

stockRouter.post('/orders/:id/cancel', h(async (c) => {
  await farmAccess(c, fid(c), 'write');
  if (!isUuid(c.req.params.id)) throw notFound();
  const { rows } = await c.db.query('select * from orders where id = $1 and farm_id = $2 for update', [c.req.params.id, fid(c)]);
  const o = rows[0];
  if (!o) throw notFound();
  if (o.status !== 'requested') throw conflict('order_not_cancellable');
  await c.db.query(`update orders set status = 'cancelled', updated_at = now() where id = $1`, [o.id]);
  await c.db.query('update products set ordered_quantity = greatest(0, ordered_quantity - $2) where id = $1', [o.product_id, o.quantity]);
  await audit(c.db, { actor: c.user.id, action: 'shop.order_cancelled', resource: 'order', resourceId: o.id, farmId: fid(c), ip: c.ip });
  return { ok: true };
}));
