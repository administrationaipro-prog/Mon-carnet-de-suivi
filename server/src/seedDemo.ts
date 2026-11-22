// Jeu de démonstration (§12) : une exploitation fictive avec les deux béliers du prototype.
// Ces données servent uniquement à illustrer le fonctionnement ; ce ne sont pas des statistiques collectives.
import { migrate, pool, withTx } from './db.js';
import { hashPassword } from './lib/crypto.js';

const EMAIL = process.env.DEMO_EMAIL ?? 'demo@carnet.local';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-Carnet-2026';

await migrate();
const existing = await pool.query('select id from users where email = $1', [EMAIL]);
if (existing.rowCount) { console.log(`Démo déjà présente (${EMAIL}).`); await pool.end(); process.exit(0); }
const u = await pool.query(
  `insert into users (email, password_hash, first_name, last_name, email_verified_at) values ($1,$2,'Éleveur','Démonstration', now()) returning id`,
  [EMAIL, await hashPassword(PASSWORD)]);
const uid = u.rows[0].id;
const f = await pool.query(`insert into farms (territory_code, name, locality, objective, conduct_system) values ('MQ','Exploitation de démonstration','Le Lamentin','meat','Semi-plein air') returning id`);
const fid = f.rows[0].id;
await pool.query(`insert into memberships (user_id, farm_id, role) values ($1,$2,'owner')`, [uid, fid]);
await pool.query(
  `insert into registration_requests (user_id, status, territory_code, farm_name, locality, production_type, accepted_terms, truthful_declaration, farm_id, submitted_at, decided_at)
   values ($1,'approved','MQ','Exploitation de démonstration','Le Lamentin','sheep_meat',true,true,$2,now(),now())`, [uid, fid]);
await withTx(uid, async (db) => {
  const lot = await db.query(`insert into lots (farm_id, name, conduct_system) values ($1,'Agneaux 2026','Engraissement') returning id`, [fid]);
  const animals = [
    { id: 'BELIER-1', name: 'Bélier 1', birth: '2026-09-19', breed: 'BB_X_IDF', w: [['2026-10-31', 11.3], ['2026-11-07', 12.81], ['2026-11-14', 13.29]] },
    { id: 'BELIER-2', name: 'Bélier 2', birth: '2026-09-29', breed: 'SM_X_IDF', w: [['2026-10-31', 9.8], ['2026-11-07', 11.67], ['2026-11-14', 12.32]] },
  ] as const;
  for (const a of animals) {
    const r = await db.query(
      `insert into animals (farm_id, internal_id, name, sex, birth_date, breed_code, objective, lot_id, parentage_source) values ($1,$2,$3,'M',$4,$5,'meat',$6,'unknown') returning id`,
      [fid, a.id, a.name, a.birth, a.breed, lot.rows[0].id]);
    for (const [date, kg] of a.w)
      await db.query(`insert into weighings (farm_id, animal_id, date, weight_kg, operator_id, source) values ($1,$2,$3,$4,$5,'demo')`, [fid, r.rows[0].id, date, kg, uid]);
  }
});
console.log(`Démo créée : ${EMAIL} / ${PASSWORD} (données fictives).`);
await pool.end();
