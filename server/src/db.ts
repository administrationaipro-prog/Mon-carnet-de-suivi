import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

// Les dates SQL (type DATE) restent des chaînes ISO "AAAA-MM-JJ" : pas de décalage de fuseau.
pg.types.setTypeParser(1082, (v) => v);
// numeric -> number
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => Number(v));

export type Db = pg.PoolClient;

export let pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export function setPool(url: string) {
  pool = new pg.Pool({ connectionString: url, max: 10 });
  return pool;
}

export async function migrate(p: pg.Pool = pool) {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8');
  const c = await p.connect();
  try {
    const { rows } = await c.query('select rolsuper, rolbypassrls from pg_roles where rolname = current_user');
    if (rows[0]?.rolsuper || rows[0]?.rolbypassrls) {
      console.warn('[sécurité] ATTENTION : le rôle de connexion contourne la RLS (superuser/bypassrls). Utilisez un rôle applicatif dédié.');
    }
    await c.query('select pg_advisory_lock(424242)');
    await c.query(sql);
    await c.query('select pg_advisory_unlock(424242)');
  } finally {
    c.release();
  }
}

/** Exécute fn dans une transaction avec le contexte de sécurité (RLS) positionné. */
export async function withTx<T>(userId: string | null, fn: (db: Db) => Promise<T>, ctx = 'user'): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.user_id', $1, true), set_config('app.ctx', $2, true)", [userId ?? '', ctx]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function getSetting<T>(db: Db | pg.Pool, key: string, fallback: T): Promise<T> {
  const { rows } = await db.query('select value from settings where key = $1', [key]);
  return rows[0] ? (rows[0].value as T) : fallback;
}
