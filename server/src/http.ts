import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import { pool, withTx, type Db } from './db.js';
import { HttpError, forbidden, notFound } from './lib/errors.js';
import { sha256 } from './lib/crypto.js';

export type User = {
  id: string; email: string; first_name: string; last_name: string; lang: 'fr' | 'en';
  status: string; platform_role: 'none' | 'admin' | 'validator' | 'analyst';
  email_verified_at: string | null; mfa_enabled: boolean;
};
export type Session = { id: string; mfa_verified: boolean };
export type Ctx = { req: Request; res: Response; db: Db; user: User; session: Session; ip: string };
export type PublicCtx = Omit<Ctx, 'user' | 'session'> & { user: User | null; session: Session | null };

declare module 'express-serve-static-core' {
  interface Request { user?: User | null; session?: Session | null }
}

export const SESSION_COOKIE = 'carnet_sid';

/** Charge l’utilisateur courant à partir du cookie de session (jeton haché en base). */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  req.user = null; req.session = null;
  const tok = req.cookies?.[SESSION_COOKIE];
  if (tok) {
    const { rows } = await pool.query(
      `update sessions s set last_seen_at = now()
         from users u
        where s.token_hash = $1 and s.expires_at > now() and u.id = s.user_id and u.status = 'active'
        returning s.id as session_id, s.mfa_verified, u.id, u.email, u.first_name, u.last_name, u.lang, u.status,
                  u.platform_role, u.email_verified_at, u.mfa_enabled`,
      [sha256(tok)],
    );
    if (rows[0]) {
      const r = rows[0];
      req.session = { id: r.session_id, mfa_verified: r.mfa_verified };
      req.user = { id: r.id, email: r.email, first_name: r.first_name, last_name: r.last_name, lang: r.lang, status: r.status,
        platform_role: r.platform_role, email_verified_at: r.email_verified_at, mfa_enabled: r.mfa_enabled };
    }
  }
  next();
}

/** Protection CSRF : en-tête personnalisé obligatoire pour toute requête modifiante. */
export function csrf(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'carnet') return next(new HttpError(403, 'csrf'));
  next();
}

const ipOf = (req: Request) => (req.ip ?? req.socket.remoteAddress ?? '').toString();

type Opts = { auth?: 'none' | 'user' | 'verified'; ctx?: string };

/** Enveloppe un gestionnaire : authentification, transaction + contexte RLS, sérialisation JSON. */
export function h(fn: (c: Ctx) => Promise<unknown>, opts: Opts = {}): RequestHandler {
  const auth = opts.auth ?? 'verified';
  return async (req, res, next) => {
    try {
      if (auth !== 'none') {
        if (!req.user) throw new HttpError(401, 'unauthenticated');
        if (auth === 'verified' && !req.user.email_verified_at) throw new HttpError(403, 'email_not_verified');
        // Un administrateur doit avoir validé sa MFA dans la session pour toute action
        if (req.user.platform_role === 'admin' && auth === 'verified' && !(req.user.mfa_enabled && req.session?.mfa_verified))
          throw new HttpError(403, 'mfa_required');
      }
      const out = await withTx(req.user?.id ?? null, (db) =>
        fn({ req, res, db, user: req.user as User, session: req.session as Session, ip: ipOf(req) }), opts.ctx);
      if (!res.headersSent) {
        if (out === undefined) res.status(204).end();
        else res.json(out);
      }
    } catch (e) { next(e); }
  };
}

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'validation', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })) });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, details: err.details });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
  // Erreurs PostgreSQL utiles côté client
  if (err?.code === '42501') return res.status(403).json({ error: 'forbidden' }); // violation RLS
  if (err?.code === '23505') return res.status(409).json({ error: 'unique_violation', details: err.constraint });
  if (err?.code === '23503') return res.status(400).json({ error: 'invalid_reference', details: err.constraint });
  if (err?.code === '55000' && String(err?.message).includes('report_signed')) return res.status(409).json({ error: 'report_signed' });
  if (err?.code === '23514') return res.status(400).json({ error: 'check_violation', details: err.constraint });
  if (err?.code === '22P02' || err?.code === '22007' || err?.code === '22008') return res.status(400).json({ error: 'invalid_value' });
  console.error(`[erreur] ${req.method} ${req.path}`, err);
  res.status(500).json({ error: 'internal' });
}

// ---------- Contrôles d’accès exploitation ----------
export type FarmRole = 'owner' | 'collaborator' | 'referent' | 'admin_grant' | 'vet';
export type FarmMode = 'read' | 'write' | 'manage';

export async function farmAccess(c: Ctx, farmId: string, mode: FarmMode): Promise<FarmRole> {
  if (!/^[0-9a-f-]{36}$/i.test(farmId)) throw notFound('farm_not_found');
  const { rows } = await c.db.query(
    `select m.role, f.status as farm_status from memberships m join farms f on f.id = m.farm_id
      where m.farm_id = $1 and m.user_id = $2 and m.status = 'active'`, [farmId, c.user.id]);
  const m = rows[0];
  if (!m) {
    const v = await activeVetGrant(c.db, farmId, c.user.id);
    if (v) {
      if (mode !== 'read') throw forbidden('read_only');
      return 'vet';
    }
    if (c.user.platform_role === 'admin') {
      const g = await c.db.query('select 1 from admin_access_grants where farm_id = $1 and admin_id = $2 and expires_at > now()', [farmId, c.user.id]);
      if (g.rowCount) {
        if (mode !== 'read') throw forbidden('read_only');
        return 'admin_grant';
      }
    }
    throw notFound('farm_not_found'); // ne révèle pas l’existence d’une autre exploitation
  }
  if (m.farm_status !== 'active') throw forbidden('farm_suspended');
  if (mode === 'write' && !['owner', 'collaborator'].includes(m.role)) throw forbidden('read_only');
  if (mode === 'manage' && m.role !== 'owner') throw forbidden('owner_only');
  return m.role;
}

/** Accès de consultation vétérinaire en cours (vétérinaire vérifié, non révoqué, non expiré). */
export async function activeVetGrant(db: { query: Db['query'] }, farmId: string, userId: string) {
  const { rows } = await db.query(
    `select va.id, va.scopes, va.expires_at from vet_access va join vet_profiles vp on vp.user_id = va.vet_id join farms f on f.id = va.farm_id
      where va.farm_id = $1 and va.vet_id = $2 and va.revoked_at is null and va.expires_at > now() and vp.status = 'verified' and f.status = 'active'
      order by va.expires_at desc limit 1`, [farmId, userId]);
  return (rows[0] as { id: string; scopes: string[]; expires_at: string } | undefined) ?? null;
}

/** Le vétérinaire doit disposer d'un accès en cours incluant la portée demandée. */
export async function requireVet(c: Ctx, farmId: string, scope = 'health') {
  if (!/^[0-9a-f-]{36}$/i.test(farmId)) throw notFound('farm_not_found');
  const g = await activeVetGrant(c.db, farmId, c.user.id);
  if (!g) throw forbidden('vet_access_required');
  if (!g.scopes.includes(scope)) throw forbidden('vet_scope_denied');
  const p = (await c.db.query('select * from vet_profiles where user_id = $1', [c.user.id])).rows[0];
  return { grant: g, profile: p };
}

/** Portée d'une ressource d'exploitation, pour limiter ce que voit un vétérinaire en consultation. */
const VET_SCOPE: Record<string, string | null> = {
  animals: 'herd', weighings: 'herd', lots: 'herd', dashboard: 'herd', alerts: 'herd', history: 'herd', growth: 'herd',
  analytics: 'herd', indicators: 'herd', 'mating-simulator': 'repro', mating: 'repro', repro: 'repro', inbreeding: 'herd',
  health: 'health', parasite: 'health', copro: 'health', files: 'health',
  feeding: 'feeding', stock: 'feeding', orders: 'feeding', parcels: 'feeding',
  vet: null,
};
export async function vetScopeGuard(req: Request, _res: Response, next: NextFunction) {
  try {
    const farmId = req.params.farmId as string | undefined;
    if (!req.user || !farmId || !/^[0-9a-f-]{36}$/i.test(farmId)) return next();
    const seg = req.path.split('/').filter(Boolean)[0] ?? '';
    const member = await pool.query(`select 1 from memberships where farm_id = $1 and user_id = $2 and status = 'active'`, [farmId, req.user.id]);
    if (member.rowCount) return next();
    const g = await activeVetGrant(pool, farmId, req.user.id);
    if (!g) return next(); // farmAccess répondra « introuvable »
    if (seg === '' ) return next();
    const scope = seg in VET_SCOPE ? VET_SCOPE[seg] : undefined;
    if (scope === null) return next();
    if (scope === undefined || !g.scopes.includes(scope)) return next(new HttpError(403, 'vet_scope_denied'));
    next();
  } catch (e) { next(e); }
}

export function requirePlatform(c: Ctx, ...roles: User['platform_role'][]) {
  if (!roles.includes(c.user.platform_role)) throw forbidden('platform_role_required');
}

export const today = () => new Date().toISOString().slice(0, 10);

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_iso');
export const zUuid = z.string().uuid();
export const zOptText = (max = 2000) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
export const zOptNum = z.union([z.number(), z.null()]).optional().transform((v) => (v === undefined ? null : v));
