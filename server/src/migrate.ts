import { migrate, pool } from './db.js';
import { ensureAdmin } from './bootstrap.js';
await migrate();
await ensureAdmin(pool);
console.log('Migration terminée.');
await pool.end();
