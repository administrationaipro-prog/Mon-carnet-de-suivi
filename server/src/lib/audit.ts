import type { Db } from '../db.js';

export async function audit(db: Db, a: {
  actor?: string | null; action: string; resource?: string; resourceId?: string | null;
  farmId?: string | null; result?: string; details?: unknown; ip?: string | null;
}) {
  await db.query(
    `insert into audit_logs (actor_id, action, resource, resource_id, farm_id, result, details, ip)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.actor ?? null, a.action, a.resource ?? null, a.resourceId ?? null, a.farmId ?? null,
     a.result ?? 'ok', a.details === undefined ? null : JSON.stringify(a.details), a.ip ?? null],
  );
}

export async function recordHistory(db: Db, h: {
  farmId: string; table: string; recordId: string; actor: string; action: 'update' | 'delete';
  before: unknown; after?: unknown; reason?: string | null;
}) {
  await db.query(
    `insert into record_history (farm_id, table_name, record_id, actor_id, action, before, after, reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [h.farmId, h.table, h.recordId, h.actor, h.action, JSON.stringify(h.before),
     h.after === undefined ? null : JSON.stringify(h.after), h.reason ?? null],
  );
}
