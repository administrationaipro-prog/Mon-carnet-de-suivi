import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSession, csrf, errorHandler } from './http.js';
import { authRouter } from './routes/auth.js';
import { registrationRouter } from './routes/registration.js';
import { farmsRouter, invitationsRouter } from './routes/farms.js';
import { animalsRouter } from './routes/animals.js';
import { analyticsRouter, collectiveRouter } from './routes/analytics.js';
import { adminRouter, refRouter } from './routes/admin.js';
import { pool } from './db.js';
import { config } from './config.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"], connectSrc: ["'self'"], workerSrc: ["'self'"], manifestSrc: ["'self'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: config.cookieSecure,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(loadSession);
  api.use(csrf);
  api.get('/health', async (_req, res) => {
    await pool.query('select 1');
    res.json({ status: 'ok', time: new Date().toISOString() });
  });
  api.use('/auth', authRouter);
  api.use('/ref', refRouter);
  api.use('/registration', registrationRouter);
  api.use('/invitations', invitationsRouter);
  api.use('/farms/:farmId', animalsRouter);
  api.use('/farms/:farmId', analyticsRouter);
  api.use('/farms', farmsRouter);
  api.use('/collective', collectiveRouter);
  api.use('/admin', adminRouter);
  api.use((_req, res) => { res.status(404).json({ error: 'not_found' }); });
  api.use(errorHandler);
  app.use('/api', api);

  // Interface PWA compilée
  const here = dirname(fileURLToPath(import.meta.url));
  const dist = [resolve(here, '../../client/dist'), resolve(process.cwd(), 'client/dist'), resolve(process.cwd(), '../client/dist')].find((p) => existsSync(p));
  if (dist) {
    app.use(express.static(dist, {
      index: false,
      setHeaders: (res, p) => {
        if (p.endsWith('sw.js') || p.endsWith('.html') || p.endsWith('manifest.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
        else if (p.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }));
    app.get(/^\/(?!api\/).*/, (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(join(dist, 'index.html')); });
  }
  return app;
}
