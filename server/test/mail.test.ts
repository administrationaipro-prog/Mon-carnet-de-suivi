import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { pool } from '../src/db.js';
import { config } from '../src/config.js';
import { dispatchOutbox, toHtml } from '../src/lib/mail.js';
import { setup, agent, registerVerified, makeAdmin, post } from './helpers.js';

let app: any, server: http.Server;
const received: { headers: http.IncomingHttpHeaders; body: any }[] = [];
let nextStatus = 201;

beforeAll(async () => {
  app = await setup();
  server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (d) => (data += d));
    req.on('end', () => {
      received.push({ headers: req.headers, body: JSON.parse(data) });
      res.writeHead(nextStatus, { 'content-type': 'application/json' });
      res.end(nextStatus < 300 ? JSON.stringify({ messageId: `<msg-${received.length}@brevo>` }) : JSON.stringify({ code: 'invalid_parameter', message: 'sender not valid' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  Object.assign(config, {
    brevoApiKey: 'xkeysib-test', mailFromEmail: 'noreply@example.org', mailFromName: 'Carnet de suivi',
    brevoApiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v3/smtp/email`,
  });
});
afterAll(async () => {
  Object.assign(config, { brevoApiKey: null, mailFromEmail: null });
  server.close();
  await pool.end();
});

const last = async (email: string) => (await pool.query('select * from outbox_emails where to_email = $1 order by id desc limit 1', [email])).rows[0];

describe('Envoi des courriels via Brevo', () => {
  it('envoie le courriel de vérification au format de l’API Brevo', async () => {
    const a = agent(app, 'brevo@test.org');
    await post(a, '/api/auth/register', { email: 'brevo@test.org', password: 'motdepasse-solide-1', first_name: 'B', last_name: 'R', lang: 'fr' });
    expect((await last('brevo@test.org')).status).toBe('pending');
    expect(await dispatchOutbox(pool)).toBe(1);
    const m = received.at(-1)!;
    expect(m.headers['api-key']).toBe('xkeysib-test');
    expect(m.body.sender).toEqual({ name: 'Carnet de suivi', email: 'noreply@example.org' });
    expect(m.body.to).toEqual([{ email: 'brevo@test.org' }]);
    expect(m.body.subject).toBe('Vérifiez votre adresse courriel');
    expect(m.body.textContent).toMatch(/verify-email\?token=/);
    expect(m.body.htmlContent).toMatch(/<a href="http[^"]+verify-email\?token=/);
    const row = await last('brevo@test.org');
    expect(row.status).toBe('sent');
    expect(row.provider_id).toBe('<msg-1@brevo>');
    expect(await dispatchOutbox(pool)).toBe(0); // rien à renvoyer
  });

  it('aucun courriel pour une opération annulée (envoi après validation de la transaction)', async () => {
    const before = received.length;
    const r = await post(agent(app, 'x'), '/api/auth/register', { email: 'brevo@test.org', password: 'court', first_name: 'B', last_name: 'R' });
    expect(r.status).toBe(400);
    await dispatchOutbox(pool);
    expect(received.length).toBe(before);
  });

  it('erreur temporaire : nouvel essai programmé ; erreur 400 : échec définitif', async () => {
    await registerVerified(app, 'retry@test.org');
    await dispatchOutbox(pool);
    nextStatus = 503;
    await post(agent(app, 'r'), '/api/auth/forgot-password', { email: 'retry@test.org' });
    await dispatchOutbox(pool);
    let row = await last('retry@test.org');
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    nextStatus = 400;
    await pool.query('update outbox_emails set next_attempt_at = now() where id = $1', [row.id]);
    await dispatchOutbox(pool);
    row = await last('retry@test.org');
    expect(row.status).toBe('failed');
    expect(row.last_error).toMatch(/brevo_400 invalid_parameter: sender not valid/);
    nextStatus = 201;
  });

  it('courriel de test et relance depuis l’administration', async () => {
    const admin = await makeAdmin(app, 'admin-mail@test.org');
    expect((await post(admin, '/api/admin/test-email')).body.mail_enabled).toBe(true);
    await dispatchOutbox(pool);
    expect(received.at(-1)!.body.to[0].email).toBe('admin-mail@test.org');
    const failed = await last('retry@test.org');
    expect((await post(admin, `/api/admin/outbox/${failed.id}/retry`)).status).toBe(200);
    await dispatchOutbox(pool);
    expect((await last('retry@test.org')).status).toBe('sent');
    const stats = await admin.get('/api/admin/stats');
    expect(stats.body.mail_enabled).toBe(true);
  });

  it('HTML échappé', () => {
    expect(toHtml('<b>x</b> https://a.b/c?d=1&e=2')).toContain('&lt;b&gt;x&lt;/b&gt; <a href="https://a.b/c?d=1&amp;e=2">');
  });
});
