import express, { type Request } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createMemoryAuditSink, createRolePolicy, defineAdminModule, defineResource } from '@openadminkit/core';
import { createExpressAdmin } from '../src/index.js';

type Row = { id: string; email: string; status: string; tenantId: string; passwordHash: string };
const ROWS: Row[] = Array.from({ length: 60 }, (_, i) => ({
  id: `u${i + 1}`,
  email: `user${i + 1}@example.test`,
  status: i % 3 === 0 ? 'suspended' : 'active',
  tenantId: i % 2 === 0 ? 't-a' : 't-b',
  passwordHash: 'SECRET-HASH',
}));

// Fake host session store: token -> verified identity.
const SESSIONS: Record<string, { id: string; roles: string[]; tenantId: string }> = {
  'tok-admin': { id: 'admin-1', roles: ['admin'], tenantId: 't-a' },
  'tok-support': { id: 'support-1', roles: ['support'], tenantId: 't-a' },
};

function hostAuthenticate(req: Request) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return Object.hasOwn(SESSIONS, token) ? SESSIONS[token] : null;
}

function buildApp(opts: { metricsEnabled?: boolean; failingAudit?: boolean } = {}) {
  const audit = createMemoryAuditSink();
  const users = defineResource<Row>({
    id: 'users',
    label: 'Users',
    permissionPrefix: 'users',
    idField: 'id',
    fields: { id: { type: 'string' }, email: { type: 'string', filterable: true }, status: { type: 'string', filterable: true } },
    // Tenant scoping happens in the host query, before any rows are returned.
    async list(ctx, q) {
      const rows = ROWS.filter((r) => r.tenantId === ctx.actor.tenantId)
        .filter((r) => Object.entries(q.filters).every(([k, v]) => String(r[k as keyof Row]) === v));
      const offset = q.cursor ? Number(q.cursor) : 0;
      return { items: rows.slice(offset, offset + q.limit), nextCursor: offset + q.limit < rows.length ? String(offset + q.limit) : null };
    },
    async get(ctx, id) {
      return ROWS.find((r) => r.id === id && r.tenantId === ctx.actor.tenantId) ?? null;
    },
  });
  const metrics = defineResource({
    id: 'signups',
    label: 'Signups',
    permissionPrefix: 'metrics',
    idField: 'day',
    fields: { day: { type: 'string' }, count: { type: 'number' } },
    list: async () => ({ items: [{ day: '2026-10-15', count: 4 }] }),
  });

  const app = express();
  app.use(
    '/internal/admin/api',
    createExpressAdmin({
      authenticate: hostAuthenticate,
      authorize: createRolePolicy({ admin: ['users.read', 'metrics.read'], support: ['metrics.read'] }),
      audit: opts.failingAudit ? () => { throw new Error('audit down'); } : audit.sink,
      modules: [
        defineAdminModule({ id: 'users', label: 'Users', permissions: ['users.read'], resources: [users] }),
        defineAdminModule({ id: 'metrics', label: 'Metrics', permissions: ['metrics.read'], resources: [metrics], enabled: opts.metricsEnabled ?? true }),
      ],
    }),
  );
  app.get('/internal/admin/api-host-route', (_req, res) => res.send('host'));
  return { app, events: audit.events };
}

const BASE = '/internal/admin/api';
const asAdmin = { Authorization: 'Bearer tok-admin' };
const asSupport = { Authorization: 'Bearer tok-support' };

describe('status codes', () => {
  it('401 without a session', async () => {
    const { app } = buildApp();
    const res = await request(app).get(`${BASE}/resources/users`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('401 with an invalid token', async () => {
    const { app } = buildApp();
    expect((await request(app).get(`${BASE}/resources/users`).set('Authorization', 'Bearer forged')).status).toBe(401);
  });

  it('403 for an authenticated user without permission, even calling the API directly', async () => {
    const { app } = buildApp();
    expect((await request(app).get(`${BASE}/resources/users`).set(asSupport)).status).toBe(403);
    expect((await request(app).get(`${BASE}/resources/users/u1`).set(asSupport)).status).toBe(403);
  });

  it('200 for an authorized user', async () => {
    const { app } = buildApp();
    const res = await request(app).get(`${BASE}/resources/users?limit=5`).set(asAdmin);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.page.limit).toBe(5);
  });

  it('safe 404 for unknown records/resources and paths', async () => {
    const { app } = buildApp();
    expect((await request(app).get(`${BASE}/resources/users/nope`).set(asAdmin)).status).toBe(404);
    expect((await request(app).get(`${BASE}/resources/payments`).set(asAdmin)).status).toBe(404);
    const res = await request(app).get(`${BASE}/sql?q=select`).set(asAdmin);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('400 for invalid queries', async () => {
    const { app } = buildApp();
    const res = await request(app).get(`${BASE}/resources/users?limit=99999`).set(asAdmin);
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual({ param: 'limit', reason: 'must be between 1 and 100' });
  });

  it('405 for write methods (no mutations in alpha)', async () => {
    const { app } = buildApp();
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(app)[method](`${BASE}/resources/users/u1`).set(asAdmin).send({ status: 'active' });
      expect(res.status).toBe(405);
    }
  });

  it('503 when the audit sink fails (fail-closed)', async () => {
    const { app } = buildApp({ failingAudit: true });
    const res = await request(app).get(`${BASE}/resources/users`).set(asAdmin);
    expect(res.status).toBe(503);
    expect(res.body.data).toBeUndefined();
  });
});

describe('spoofing and tenancy', () => {
  it('ignores identity claims in headers, query, or body', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get(`${BASE}/resources/users?role=admin`)
      .set('X-User-Id', 'admin-1')
      .set('X-Roles', 'admin')
      .set('X-Tenant-Id', 't-a');
    expect(res.status).toBe(401);
  });

  it('rejects a client-supplied tenant filter when tenantId is not a declared filter', async () => {
    const { app } = buildApp();
    for (const q of ['filter[tenantId]=t-b', 'filter[tenantId]=t-a', 'tenantId=t-b']) {
      const res = await request(app).get(`${BASE}/resources/users?${q}`).set(asAdmin);
      expect([q, res.status]).toEqual([q, 400]);
    }
  });

  it('safe pattern: even if tenantId IS filterable, scope is ANDed and cannot be overridden', async () => {
    // Mirrors the recipe in docs/getting-started.md: scope is applied separately from client filters.
    type R = { id: string; tenantId: string };
    const rows: R[] = [{ id: 'a1', tenantId: 't-a' }, { id: 'b1', tenantId: 't-b' }];
    const leaky = defineResource<R>({
      id: 'scoped',
      label: 'Scoped',
      permissionPrefix: 'users',
      idField: 'id',
      fields: { id: { type: 'string' }, tenantId: { type: 'string', filterable: true } },
      async list(ctx, q) {
        const scope = (r: R) => r.tenantId === ctx.actor.tenantId; // server-enforced
        const clientFilters = (r: R) => Object.entries(q.filters).every(([k, v]) => String(r[k as keyof R]) === v);
        return { items: rows.filter((r) => scope(r) && clientFilters(r)) };
      },
    });
    const app = express();
    app.use(BASE, createExpressAdmin({
      authenticate: hostAuthenticate,
      authorize: createRolePolicy({ admin: ['users.read'] }),
      audit: () => {},
      modules: [defineAdminModule({ id: 'scoped', label: 'Scoped', permissions: ['users.read'], resources: [leaky] })],
    }));
    const res = await request(app).get(`${BASE}/resources/scoped?filter[tenantId]=t-b`).set(asAdmin);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]); // t-a AND t-b → nothing, never b1
  });

  it('cannot read another tenant\'s records', async () => {
    const { app } = buildApp();
    // u2 belongs to tenant t-b; admin-1 is verified for t-a.
    expect((await request(app).get(`${BASE}/resources/users/u2`).set(asAdmin)).status).toBe(404);
    const list = await request(app).get(`${BASE}/resources/users?limit=100`).set(asAdmin);
    expect(list.body.data.map((u: { id: string }) => u.id)).not.toContain('u2');
  });
});

describe('response safety', () => {
  it('never returns undeclared fields', async () => {
    const { app } = buildApp();
    const res = await request(app).get(`${BASE}/resources/users/u1`).set(asAdmin);
    expect(res.body.data).toEqual({ id: 'u1', email: 'user1@example.test', status: 'suspended' });
    expect(res.text).not.toMatch(/SECRET|passwordHash|tenantId/);
  });

  it('sets no-store and request id headers', async () => {
    const { app } = buildApp();
    const res = await request(app).get(`${BASE}/resources/users`).set(asAdmin);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('does not trust incoming X-Request-Id by default', async () => {
    const { app } = buildApp();
    const res = await request(app).get(`${BASE}/resources/users`).set(asAdmin).set('X-Request-Id', 'attacker-chosen');
    expect(res.headers['x-request-id']).not.toBe('attacker-chosen');
  });

  it('rejects repeated query params', async () => {
    const { app } = buildApp();
    expect((await request(app).get(`${BASE}/resources/users?limit=1&limit=100`).set(asAdmin)).status).toBe(400);
  });
});

describe('modules and navigation', () => {
  it('describe returns only readable resources per role', async () => {
    const { app } = buildApp();
    const adminNav = await request(app).get(`${BASE}/`).set(asAdmin);
    const supportNav = await request(app).get(`${BASE}/`).set(asSupport);
    expect(adminNav.body.modules.map((m: { id: string }) => m.id)).toEqual(['users', 'metrics']);
    expect(supportNav.body.modules.map((m: { id: string }) => m.id)).toEqual(['metrics']);
  });

  it('a disabled module has no navigation and no reachable endpoint', async () => {
    const { app } = buildApp({ metricsEnabled: false });
    const nav = await request(app).get(`${BASE}/`).set(asAdmin);
    expect(nav.body.modules.map((m: { id: string }) => m.id)).toEqual(['users']);
    expect((await request(app).get(`${BASE}/resources/signups`).set(asAdmin)).status).toBe(404);
    // Other modules keep working.
    expect((await request(app).get(`${BASE}/resources/users`).set(asAdmin)).status).toBe(200);
  });
});

describe('metrics route', () => {
  it('serves GET /metrics/:id with the same auth pipeline, and 405 for writes', async () => {
    const app = express();
    app.use(BASE, createExpressAdmin({
      authenticate: hostAuthenticate,
      authorize: createRolePolicy({ admin: ['metrics.read'] }),
      audit: () => {},
      modules: [defineAdminModule({
        id: 'm', label: 'M', permissions: ['metrics.read'], resources: [],
        metrics: [{ id: 'active', label: 'Active', permission: 'metrics.read', load: async () => ({ value: 7 }) }],
      })],
    }));
    expect((await request(app).get(`${BASE}/metrics/active`)).status).toBe(401);
    expect((await request(app).get(`${BASE}/metrics/active`).set(asSupport)).status).toBe(403);
    const ok = await request(app).get(`${BASE}/metrics/active`).set(asAdmin);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ value: 7 });
    expect((await request(app).post(`${BASE}/metrics/active`).set(asAdmin)).status).toBe(405);
  });
});

describe('audit trail', () => {
  it('records successes, denials, and unauthenticated attempts without secrets', async () => {
    const { app, events } = buildApp();
    await request(app).get(`${BASE}/resources/users?filter[email]=user1@example.test`).set(asAdmin);
    await request(app).get(`${BASE}/resources/users`).set(asSupport);
    await request(app).get(`${BASE}/resources/users`);
    expect(events.map((e) => [e.actorId, e.action, e.outcome])).toEqual([
      ['admin-1', 'users.list', 'success'],
      ['support-1', 'users.list', 'denied'],
      [null, 'admin.authenticate', 'denied'],
    ]);
    expect(events[0]!.tenantId).toBe('t-a');
    const serialized = JSON.stringify(events);
    expect(serialized).not.toMatch(/tok-admin|tok-support|Bearer|SECRET|user1@example\.test/);
  });
});
