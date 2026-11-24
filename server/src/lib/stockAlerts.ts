import type pg from 'pg';
import { withTx, type Db } from '../db.js';
import { estimateStock, type StockEstimate } from './stock.js';
import { sendMail, notify } from './mail.js';

const todayIso = () => new Date().toISOString().slice(0, 10);

export async function itemEstimate(db: Db, item: any, today = todayIso()): Promise<StockEstimate> {
  const { rows } = await db.query('select type, quantity, date, created_at from stock_movements where item_id = $1', [item.id]);
  return estimateStock(item, rows, today);
}

/**
 * Envoie l'alerte « il faut passer commande » aux responsables de l'exploitation (notification + courriel),
 * une seule fois par cycle : l'alerte est réarmée à chaque entrée ou inventaire.
 */
export async function checkStockAlert(db: Db, item: any): Promise<boolean> {
  if (!item.active || item.last_alert_at) return false;
  const est = await itemEstimate(db, item);
  if (est.status !== 'order' && est.status !== 'empty') return false;
  const farm = (await db.query(`select name from farms where id = $1 and status = 'active'`, [item.farm_id])).rows[0];
  if (!farm) return false;
  const owners = (await db.query(
    `select u.id, u.email, u.lang from memberships m join users u on u.id = m.user_id
      where m.farm_id = $1 and m.role = 'owner' and m.status = 'active' and u.status = 'active'`, [item.farm_id])).rows;
  for (const o of owners) {
    await notify(db, o.id, 'stock_low', { item: item.name, qty: est.estimated, unit: item.unit, rupture_date: est.rupture_date, item_id: item.id, empty: est.status === 'empty' });
    await sendMail(db, o.email, o.lang, 'stock_low', { item: item.name, farm: farm.name, qty: est.estimated, unit: item.unit, date: est.rupture_date });
  }
  await db.query('update stock_items set last_alert_at = now() where id = $1', [item.id]);
  return true;
}

/** Tâche planifiée : vérifie tous les stocks (contexte RLS restreint aux tables de stock). */
export async function runStockAlerts(_pool?: pg.Pool): Promise<number> {
  return withTx(null, async (db) => {
    const { rows } = await db.query(
      `select si.* from stock_items si join farms f on f.id = si.farm_id and f.status = 'active' where si.active and si.last_alert_at is null`);
    let sent = 0;
    for (const it of rows) if (await checkStockAlert(db, it)) sent++;
    return sent;
  }, 'stock_service');
}
