import { Router } from 'express';
import { z } from 'zod';
import { h, parse, farmAccess, requirePlatform, zDate, zOptText, today, type Ctx } from '../http.js';
import { bad, conflict, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { sendMail, notify } from '../lib/mail.js';
import { CATEGORIES } from './stock.js';

// ---------- Catalogue visible par les éleveurs ----------
export const shopRouter = Router();

shopRouter.get('/products', h(async (c) => {
  const farmId = typeof c.req.query.farm === 'string' ? c.req.query.farm : '';
  await farmAccess(c, farmId, 'read');
  const farm = (await c.db.query('select territory_code from farms where id = $1', [farmId])).rows[0];
  const { rows } = await c.db.query(
    `select p.id, p.name, p.category, p.unit, p.unit_weight_kg, p.price_eur, p.delivery_days, p.description, p.territory_code,
            p.reserved_quantity, greatest(0, p.reserved_quantity - p.ordered_quantity) as remaining, s.name as supplier_name
       from products p join suppliers s on s.id = p.supplier_id
      where p.active and s.active and (p.territory_code is null or p.territory_code = $1)
      order by p.category, p.name`, [farm.territory_code]);
  return rows;
}));

// ---------- Administration : fournisseurs, produits, commandes ----------
export const adminShopRouter = Router();

const zSupplier = z.object({
  name: z.string().trim().min(2).max(150), contact_name: zOptText(150), phone: zOptText(40), email: z.string().trim().email().max(254).nullable().optional().or(z.literal('').transform(() => null)),
  territory_code: z.string().min(2).max(3).nullable().optional(), notes: zOptText(1000), active: z.boolean().default(true),
});
const zProduct = z.object({
  supplier_id: z.string().uuid(), name: z.string().trim().min(2).max(150), category: z.enum(CATEGORIES), unit: z.string().trim().min(1).max(30),
  unit_weight_kg: z.number().positive().max(10000).nullable().optional(), price_eur: z.number().min(0).max(100000).nullable().optional(),
  reserved_quantity: z.number().int().min(0).max(1000000), delivery_days: z.number().int().min(0).max(120).default(7),
  territory_code: z.string().min(2).max(3).nullable().optional(), description: zOptText(1000), active: z.boolean().default(true),
});

adminShopRouter.get('/suppliers', h(async (c) => {
  requirePlatform(c, 'admin');
  return (await c.db.query(`select s.*, (select count(*)::int from products p where p.supplier_id = s.id and p.active) as products from suppliers s order by s.active desc, s.name`)).rows;
}));
adminShopRouter.post('/suppliers', h(async (c) => {
  requirePlatform(c, 'admin');
  const b = parse(zSupplier, c.req.body);
  const { rows } = await c.db.query(
    `insert into suppliers (name, contact_name, phone, email, territory_code, notes, active) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [b.name, b.contact_name, b.phone, b.email ?? null, b.territory_code ?? null, b.notes, b.active]);
  await audit(c.db, { actor: c.user.id, action: 'shop.supplier_created', resource: 'supplier', resourceId: rows[0].id, ip: c.ip });
  return rows[0];
}));
adminShopRouter.put('/suppliers/:id', h(async (c) => {
  requirePlatform(c, 'admin');
  const b = parse(zSupplier, c.req.body);
  const { rows } = await c.db.query(
    `update suppliers set name=$2, contact_name=$3, phone=$4, email=$5, territory_code=$6, notes=$7, active=$8 where id=$1 returning *`,
    [c.req.params.id, b.name, b.contact_name, b.phone, b.email ?? null, b.territory_code ?? null, b.notes, b.active]);
  if (!rows[0]) throw notFound();
  await audit(c.db, { actor: c.user.id, action: 'shop.supplier_updated', resource: 'supplier', resourceId: rows[0].id, ip: c.ip });
  return rows[0];
}));

adminShopRouter.get('/products', h(async (c) => {
  requirePlatform(c, 'admin');
  return (await c.db.query(
    `select p.*, greatest(0, p.reserved_quantity - p.ordered_quantity) as remaining, s.name as supplier_name
       from products p join suppliers s on s.id = p.supplier_id order by p.active desc, p.category, p.name`)).rows;
}));
adminShopRouter.post('/products', h(async (c) => {
  requirePlatform(c, 'admin');
  const b = parse(zProduct, c.req.body);
  const { rows } = await c.db.query(
    `insert into products (supplier_id, name, category, unit, unit_weight_kg, price_eur, reserved_quantity, delivery_days, territory_code, description, active)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [b.supplier_id, b.name, b.category, b.unit, b.unit_weight_kg ?? null, b.price_eur ?? null, b.reserved_quantity, b.delivery_days, b.territory_code ?? null, b.description, b.active]);
  await audit(c.db, { actor: c.user.id, action: 'shop.product_created', resource: 'product', resourceId: rows[0].id, details: { reserved: b.reserved_quantity }, ip: c.ip });
  return rows[0];
}));
adminShopRouter.put('/products/:id', h(async (c) => {
  requirePlatform(c, 'admin');
  const b = parse(zProduct, c.req.body);
  const cur = (await c.db.query('select * from products where id = $1 for update', [c.req.params.id])).rows[0];
  if (!cur) throw notFound();
  if (b.reserved_quantity < cur.ordered_quantity) throw bad('reserve_below_ordered', { ordered: cur.ordered_quantity });
  const { rows } = await c.db.query(
    `update products set supplier_id=$2, name=$3, category=$4, unit=$5, unit_weight_kg=$6, price_eur=$7, reserved_quantity=$8, delivery_days=$9,
       territory_code=$10, description=$11, active=$12 where id=$1 returning *`,
    [cur.id, b.supplier_id, b.name, b.category, b.unit, b.unit_weight_kg ?? null, b.price_eur ?? null, b.reserved_quantity, b.delivery_days, b.territory_code ?? null, b.description, b.active]);
  await audit(c.db, { actor: c.user.id, action: 'shop.product_updated', resource: 'product', resourceId: cur.id, details: { reserved: b.reserved_quantity }, ip: c.ip });
  return rows[0];
}));

adminShopRouter.get('/orders', h(async (c) => {
  requirePlatform(c, 'admin');
  const status = typeof c.req.query.status === 'string' && c.req.query.status ? c.req.query.status : null;
  const { rows } = await c.db.query(
    `select o.*, f.name as farm_name, f.locality, f.territory_code, p.name as product_name, p.unit, s.name as supplier_name,
            u.first_name || ' ' || u.last_name as requested_by_name
       from orders o join farms f on f.id = o.farm_id join products p on p.id = o.product_id join suppliers s on s.id = p.supplier_id
       left join users u on u.id = o.requested_by
      ${status ? 'where o.status = $1' : ''} order by o.created_at desc limit 500`, status ? [status] : []);
  return rows;
}));

const NEXT: Record<string, string[]> = { requested: ['confirmed', 'cancelled'], confirmed: ['delivered', 'cancelled'] };
const LABEL: Record<string, [string, string]> = { confirmed: ['confirmée', 'confirmed'], delivered: ['livrée', 'delivered'], cancelled: ['annulée', 'cancelled'] };

/** Traitement d'une commande ; à la livraison, le stock de l'exploitation est crédité automatiquement. */
adminShopRouter.post('/orders/:id/status', h(async (c) => {
  requirePlatform(c, 'admin');
  const b = parse(z.object({ status: z.enum(['confirmed', 'delivered', 'cancelled']), note: zOptText(500), delivery_date: zDate.nullable().optional() }), c.req.body);
  const o = (await c.db.query('select * from orders where id = $1 for update', [c.req.params.id])).rows[0];
  if (!o) throw notFound();
  if (!NEXT[o.status]?.includes(b.status)) throw conflict('invalid_transition', { from: o.status, to: b.status });
  if (b.status === 'delivered' && b.delivery_date && b.delivery_date > today()) throw bad('date_in_future');
  const p = (await c.db.query('select * from products where id = $1 for update', [o.product_id])).rows[0];
  await c.db.query(
    `update orders set status = $2, decision_note = coalesce($3, decision_note), delivery_date = coalesce($4, delivery_date), handled_by = $5, updated_at = now() where id = $1`,
    [o.id, b.status, b.note, b.delivery_date ?? (b.status === 'delivered' ? today() : null), c.user.id]);
  if (b.status === 'cancelled') await c.db.query('update products set ordered_quantity = greatest(0, ordered_quantity - $2) where id = $1', [p.id, o.quantity]);
  if (b.status === 'delivered') {
    // crédite le stock de l'exploitation (article lié au produit, créé au besoin)
    let item = (await c.db.query('select * from stock_items where farm_id = $1 and product_id = $2 and active order by created_at limit 1', [o.farm_id, p.id])).rows[0];
    if (!item) item = (await c.db.query(
      `insert into stock_items (farm_id, name, category, unit, product_id, lead_days) values ($1,$2,$3,$4,$5,$6) returning *`,
      [o.farm_id, p.name, p.category, p.unit, p.id, p.delivery_days])).rows[0];
    await c.db.query(`insert into stock_movements (farm_id, item_id, type, quantity, date, note, order_id, author_id) values ($1,$2,'in',$3,$4,$5,$6,$7)`,
      [o.farm_id, item.id, o.quantity, b.delivery_date ?? today(), `Livraison commande ${o.id.slice(0, 8)}`, o.id, c.user.id]);
    await c.db.query('update stock_items set last_alert_at = null where id = $1', [item.id]);
  }
  await audit(c.db, { actor: c.user.id, action: `shop.order_${b.status}`, resource: 'order', resourceId: o.id, farmId: o.farm_id, details: { note: b.note ?? null }, ip: c.ip });
  const owners = (await c.db.query(
    `select u.id, u.email, u.lang from memberships m join users u on u.id = m.user_id where m.farm_id = $1 and m.role = 'owner' and m.status = 'active' and u.status = 'active'`, [o.farm_id])).rows;
  for (const u of owners) {
    await notify(c.db, u.id, 'order_status', { product: p.name, quantity: o.quantity, status: b.status });
    await sendMail(c.db, u.email, u.lang, 'order_status', { product: p.name, quantity: o.quantity, statusFr: LABEL[b.status][0], statusEn: LABEL[b.status][1], note: b.note, delivery_date: b.status === 'delivered' ? (b.delivery_date ?? today()) : null });
  }
  return { ok: true, status: b.status };
}, { ctx: 'stock_service' }));

export type { Ctx };
