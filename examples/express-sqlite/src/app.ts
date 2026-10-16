import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import express, { type Express, type Request, type Response } from 'express';
import { createRolePolicy, type AuditEvent } from '@openadminkit/core';
import { createExpressAdmin } from '@openadminkit/express';
import { createModules } from './modules.js';

export type ExampleOptions = {
  db: DatabaseSync;
  now?: () => Date;
  logAudit?: boolean;
};

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const COOKIE = 'shelfwise_sid';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function createApp({ db, now = () => new Date(), logAudit = false }: ExampleOptions): Express {
  const app = express();
  app.disable('x-powered-by');

  // ---------- The host app's own session system (stand-in for express-session, Auth.js, etc.) ----------

  const sessions = new Map<string, { staffId: string; expires: number }>();
  const findStaff = db.prepare('SELECT id, name, roles FROM staff WHERE id = ?');

  function currentStaff(req: Request): { id: string; roles: string[] } | null {
    const sid = readCookie(req, COOKIE);
    if (!sid) return null;
    const s = sessions.get(sid);
    if (!s || s.expires < Date.now()) {
      if (s) sessions.delete(sid);
      return null;
    }
    // Roles are re-read from the database on every request, so a role change takes effect immediately.
    const row = findStaff.get(s.staffId) as { id: string; roles: string } | undefined;
    if (!row) return null;
    return { id: row.id, roles: row.roles.split(',').map((r) => r.trim()).filter(Boolean) };
  }

  const sameOrigin = (req: Request) => {
    const origin = req.get('origin');
    return !origin || origin === `${req.protocol}://${req.get('host')}`;
  };

  app.post('/login', express.json({ limit: '1kb' }), (req: Request, res: Response) => {
    // Demo login: pick a staff account. A real app verifies a password, SSO, or magic link here.
    if (!sameOrigin(req)) {
      res.status(403).json({ error: 'Cross-origin sign-in rejected.' });
      return;
    }
    const staffId = (req.body as { staffId?: unknown } | undefined)?.staffId;
    const row = typeof staffId === 'string' ? (findStaff.get(staffId) as { id: string } | undefined) : undefined;
    if (!row) {
      res.status(400).json({ error: 'Unknown demo account.' });
      return;
    }
    const sid = randomBytes(32).toString('base64url');
    sessions.set(sid, { staffId: row.id, expires: Date.now() + SESSION_TTL_MS });
    res.cookie(COOKIE, sid, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_TTL_MS });
    res.json({ ok: true });
  });

  app.post('/logout', (req: Request, res: Response) => {
    if (!sameOrigin(req)) {
      res.status(403).json({ error: 'Cross-origin sign-out rejected.' });
      return;
    }
    const sid = readCookie(req, COOKIE);
    if (sid) sessions.delete(sid);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // ---------- OpenAdmin Kit ----------

  const insertAudit = db.prepare(
    `INSERT INTO audit_events (event_id, timestamp, actor_id, action, resource_type, resource_id, tenant_id, outcome, request_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const auditSink = (e: AuditEvent) => {
    insertAudit.run(e.eventId, e.timestamp, e.actorId, e.action, e.resourceType ?? null, e.resourceId ?? null, e.tenantId ?? null, e.outcome, e.requestId, JSON.stringify(e.metadata));
    if (logAudit) console.log('[audit]', JSON.stringify(e));
  };

  app.use(
    '/internal/admin/api',
    createExpressAdmin({
      authenticate: (req) => currentStaff(req),
      authorize: createRolePolicy({
        admin: ['users.read', 'orders.read', 'audit.read', 'metrics.read', 'metrics.revenue'],
        support: ['users.read', 'orders.read', 'metrics.read'],
        analyst: ['metrics.read', 'metrics.revenue'],
      }),
      audit: auditSink,
      modules: createModules(db, now),
      onInternalError: (err, { requestId }) => console.error(`[admin] internal error (request ${requestId}):`, err),
      onAuditFailure: (err) => console.error('[admin] audit sink failure:', err),
    }),
  );

  // ---------- Pages ----------

  const page = (res: Response, html: string) => {
    res.set({ 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    res.type('html').send(html);
  };

  app.get('/', (_req, res) => res.redirect('/admin'));
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.get('/login', (_req, res) => page(res, LOGIN_HTML));
  app.get('/login.js', (_req, res) => res.type('application/javascript').send(LOGIN_JS));

  app.get('/admin', (_req, res) => {
    if (!existsSync(`${PUBLIC_DIR}app.js`)) {
      res.status(503).type('text').send('Dashboard bundle not built. Run: pnpm --filter express-sqlite-example build:client');
      return;
    }
    page(res, ADMIN_HTML);
  });
  app.use('/admin/assets', express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));

  return app;
}

const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shelfwise admin</title>
<link rel="stylesheet" href="/admin/assets/app.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/admin/assets/app.js"></script>
</body>
</html>`;

const LOGIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in – Shelfwise admin</title>
<link rel="stylesheet" href="/admin/assets/app.css">
</head>
<body>
<div class="oa-app oa-app--center">
  <main class="oa-panel oa-login">
    <h1 class="oa-login-title">Sign in to Shelfwise admin</h1>
    <p class="oa-login-body">This demo has three staff accounts. Each role sees different parts of the dashboard, and the API enforces it on every request.</p>
    <div class="oa-login-options">
      <button class="oa-login-option" data-staff="staff_admin"><strong>Avery, admin</strong><span>Everything, including revenue and the audit log</span></button>
      <button class="oa-login-option" data-staff="staff_support"><strong>Sky, support</strong><span>Customers and orders, no revenue or audit log</span></button>
      <button class="oa-login-option" data-staff="staff_analyst"><strong>Ari, analyst</strong><span>Metrics only, including revenue</span></button>
    </div>
    <p class="oa-login-error" id="error" role="alert"></p>
  </main>
</div>
<script src="/login.js"></script>
</body>
</html>`;

const LOGIN_JS = `
document.querySelectorAll('[data-staff]').forEach(function (b) {
  b.addEventListener('click', async function () {
    var res = await fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: b.dataset.staff }) });
    if (res.ok) { location.href = '/admin'; return; }
    document.getElementById('error').textContent = 'Sign-in failed. Try again.';
  });
});
`;
