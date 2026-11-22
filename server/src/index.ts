import { createApp } from './app.js';
import { migrate, pool } from './db.js';
import { ensureAdmin } from './bootstrap.js';
import { config } from './config.js';

await migrate();
await ensureAdmin(pool);
// Purge périodique des sessions expirées et tentatives anciennes
setInterval(() => {
  pool.query(`delete from sessions where expires_at < now(); delete from login_attempts where at < now() - interval '30 days';`).catch(() => {});
}, 3_600_000).unref();

createApp().listen(config.port, () => console.log(`Carnet de suivi — http://localhost:${config.port} (${config.env})`));
