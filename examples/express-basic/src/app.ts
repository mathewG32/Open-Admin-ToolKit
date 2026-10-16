import express, { type Express } from 'express';
import { createMemoryAuditSink, createRolePolicy, type AuditEvent } from '@openadminkit/core';
import { createExpressAdmin } from '@openadminkit/express';
import { auditModule, metricsModule, usersModule } from './modules.js';
import { currentStaff, isStaffName, login, logout } from './session.js';
import { DEMO_JS, DEMO_PAGE } from './page.js';

export type ExampleOptions = {
  metricsEnabled?: boolean;
  logAudit?: boolean;
};

export function createApp(options: ExampleOptions = {}): { app: Express; auditEvents: AuditEvent[] } {
  const app = express();
  app.disable('x-powered-by');

  // ---- The host app's own stuff (sessions, pages) ----
  const loginBody = express.json({ limit: '1kb' });

  app.post('/login', loginBody, (req, res) => {
    // Cookie-based auth: reject cross-site form posts. SameSite=Strict also helps.
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
      res.status(403).json({ error: 'Cross-origin login rejected.' });
      return;
    }
    const who = (req.body as { as?: unknown } | undefined)?.as;
    if (!isStaffName(who)) {
      res.status(400).json({ error: 'Unknown demo account.' });
      return;
    }
    login(res, who);
    res.json({ ok: true, as: who });
  });

  app.post('/logout', (req, res) => {
    logout(req, res);
    res.json({ ok: true });
  });

  app.get('/', (_req, res) => {
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    res.type('html').send(DEMO_PAGE);
  });
  app.get('/demo.js', (_req, res) => res.type('application/javascript').send(DEMO_JS));

  // ---- OpenAdmin Kit ----
  const audit = createMemoryAuditSink(5000);

  app.use(
    '/internal/admin/api',
    createExpressAdmin({
      // 1. Identity comes from YOUR session system, every request.
      authenticate: (req) => currentStaff(req),
      // 2. Explicit grants. No wildcards; unknown roles get nothing.
      authorize: createRolePolicy({
        admin: ['users.read', 'metrics.read', 'audit.read'],
        support: ['users.read', 'metrics.read'],
        viewer: ['metrics.read'],
      }),
      // 3. Audit events go to storage YOU own. Memory is for demos only.
      audit: (event) => {
        audit.sink(event);
        if (options.logAudit) console.log('[audit]', JSON.stringify(event));
      },
      modules: [usersModule, metricsModule(options.metricsEnabled ?? true), auditModule(audit.events)],
      onInternalError: (err, { requestId }) => console.error(`[admin] internal error (request ${requestId}):`, err),
      onAuditFailure: (err) => console.error('[admin] audit sink failure:', err),
    }),
  );

  return { app, auditEvents: audit.events };
}
