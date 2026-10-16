import { describe, expect, it, vi } from 'vitest';
import {
  AdminError,
  createAdminEngine,
  createRolePolicy,
  defineResource,
  type AdminOperation,
  type AuditEvent,
  type AuthorizeFn,
} from '../src/index.js';
import { admin, makeUsersModule, memoryAudit, nobody, support } from './fixtures.js';

const policy = createRolePolicy({ admin: ['users.read'], support: [] });

function setup(opts: { authorize?: AuthorizeFn; audit?: (e: AuditEvent) => void | Promise<void>; enabled?: boolean } = {}) {
  const { module, calls } = makeUsersModule(opts.enabled === false ? { enabled: false } : {});
  const mem = memoryAudit();
  const onInternalError = vi.fn();
  const onAuditFailure = vi.fn();
  const engine = createAdminEngine({
    authorize: opts.authorize ?? policy,
    audit: opts.audit ?? mem.sink,
    modules: [module],
    onInternalError,
    onAuditFailure,
  });
  const call = (actor: unknown, operation: AdminOperation, requestId = 'req-1') =>
    engine.handle({ authenticate: () => actor, requestId, signal: new AbortController().signal, operation });
  return { engine, calls, events: mem.events, call, onInternalError, onAuditFailure };
}

const listUsers: AdminOperation = { kind: 'list', resourceId: 'users', query: {} };

describe('authentication', () => {
  it('returns 401 and never calls the handler when there is no session', async () => {
    const { call, calls, events } = setup();
    for (const actor of [null, undefined]) {
      const res = await call(actor, listUsers);
      expect(res.status).toBe(401);
    }
    expect(calls.list).toBe(0);
    expect(events.every((e) => e.outcome === 'denied' && e.actorId === null)).toBe(true);
  });

  it('denies with a generic 500 when authenticate throws (adapter failure)', async () => {
    const { engine, calls, onInternalError } = setup();
    const res = await engine.handle({
      authenticate: () => { throw new Error('redis connection refused at 10.0.0.5'); },
      requestId: 'r',
      signal: new AbortController().signal,
      operation: listUsers,
    });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/redis|10\.0\.0\.5/);
    expect(calls.list).toBe(0);
    expect(onInternalError).toHaveBeenCalled();
  });

  it('denies malformed actors from a misconfigured authenticate()', async () => {
    const { call, calls } = setup();
    const res = await call({ userId: 'u1', role: 'admin' }, listUsers);
    expect(res.status).toBe(500);
    expect(calls.list).toBe(0);
  });
});

describe('authorization', () => {
  it('returns 403 and never calls the handler when permission is missing', async () => {
    const { call, calls, events } = setup();
    for (const actor of [support, nobody]) {
      expect((await call(actor, listUsers)).status).toBe(403);
      expect((await call(actor, { kind: 'get', resourceId: 'users', recordId: 'user-001' })).status).toBe(403);
    }
    expect(calls.list).toBe(0);
    expect(calls.get).toBe(0);
    expect(events.filter((e) => e.outcome === 'denied')).toHaveLength(4);
  });

  it('denies when the policy throws', async () => {
    const { call, calls } = setup({ authorize: () => { throw new Error('policy store down'); } });
    expect((await call(admin, listUsers)).status).toBe(403);
    expect(calls.list).toBe(0);
  });

  it('passes the specific record id to the policy for record-level rules', async () => {
    const authorize = vi.fn<AuthorizeFn>(({ target }) => target.recordId !== 'user-002');
    const { call } = setup({ authorize });
    expect((await call(admin, { kind: 'get', resourceId: 'users', recordId: 'user-001' })).status).toBe(200);
    expect((await call(admin, { kind: 'get', resourceId: 'users', recordId: 'user-002' })).status).toBe(403);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      permission: 'users.read',
      target: { moduleId: 'users', resourceId: 'users', recordId: 'user-002' },
    }));
  });

  it('describe only lists resources the actor can read', async () => {
    const { call } = setup();
    const forAdmin = await call(admin, { kind: 'describe' });
    const forSupport = await call(support, { kind: 'describe' });
    expect((forAdmin.body as { modules: unknown[] }).modules).toHaveLength(1);
    expect((forSupport.body as { modules: unknown[] }).modules).toHaveLength(0);
  });
});

describe('resources', () => {
  it('lists with bounded pagination and sanitized fields', async () => {
    const { call } = setup();
    const res = await call(admin, { kind: 'list', resourceId: 'users', query: { limit: '10' } });
    expect(res.status).toBe(200);
    const body = res.body as { data: Record<string, unknown>[]; page: { limit: number; nextCursor: string | null } };
    expect(body.data).toHaveLength(10);
    expect(body.page).toEqual({ limit: 10, nextCursor: '10' });
    expect(JSON.stringify(body)).not.toMatch(/SECRET|passwordHash|apiToken/);
  });

  it('follows cursors to the end', async () => {
    const { call } = setup();
    let cursor: string | null = null;
    let seen = 0;
    do {
      const query: Record<string, string> = { limit: '100' };
      if (cursor) query.cursor = cursor;
      const res = await call(admin, { kind: 'list', resourceId: 'users', query });
      const body = res.body as { data: unknown[]; page: { nextCursor: string | null } };
      seen += body.data.length;
      cursor = body.page.nextCursor;
    } while (cursor);
    expect(seen).toBe(150);
  });

  it('passes only validated filters to the host', async () => {
    const { call, calls } = setup();
    const res = await call(admin, { kind: 'list', resourceId: 'users', query: { 'filter[status]': 'suspended' } });
    expect(res.status).toBe(200);
    expect(calls.lastQuery?.filters).toEqual({ status: 'suspended' });
    expect((res.body as { data: { status: string }[] }).data.every((u) => u.status === 'suspended')).toBe(true);
  });

  it('rejects invalid queries with 400 before calling the host', async () => {
    const { call, calls } = setup();
    const res = await call(admin, { kind: 'list', resourceId: 'users', query: { limit: '5000' } });
    expect(res.status).toBe(400);
    expect(calls.list).toBe(0);
  });

  it('enforces the limit even if the host ignores it', async () => {
    const { module } = makeUsersModule();
    const greedy = defineResource({ ...module.resources[0]!, list: async () => ({ items: Array.from({ length: 500 }, (_, i) => ({ id: String(i) })) }) });
    const engine = createAdminEngine({ authorize: policy, audit: () => {}, modules: [{ ...module, resources: [greedy] }] });
    const res = await engine.handle({ authenticate: () => admin, requestId: 'r', signal: new AbortController().signal, operation: { kind: 'list', resourceId: 'users', query: { limit: '5' } } });
    expect((res.body as { data: unknown[] }).data).toHaveLength(5);
  });

  it('returns 404 for unknown records, unknown resources, and disabled modules', async () => {
    const { call } = setup();
    expect((await call(admin, { kind: 'get', resourceId: 'users', recordId: 'nope' })).status).toBe(404);
    expect((await call(admin, { kind: 'list', resourceId: 'payments', query: {} })).status).toBe(404);
    const disabled = setup({ enabled: false });
    expect((await disabled.call(admin, listUsers)).status).toBe(404);
    expect(disabled.calls.list).toBe(0);
  });

  it('hides provider error details', async () => {
    const { module } = makeUsersModule();
    const broken = defineResource({ ...module.resources[0]!, list: async () => { throw new Error('ERROR: relation "users" does not exist at pg://admin:pw@db'); } });
    const onInternalError = vi.fn();
    const engine = createAdminEngine({ authorize: policy, audit: () => {}, modules: [{ ...module, resources: [broken] }], onInternalError });
    const res = await engine.handle({ authenticate: () => admin, requestId: 'r', signal: new AbortController().signal, operation: listUsers });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/relation|pg:\/\/|pw/);
    expect(onInternalError).toHaveBeenCalledOnce();
  });

  it('lets hosts throw intentional AdminErrors (e.g. NOT_FOUND for out-of-tenant records)', async () => {
    const { module } = makeUsersModule();
    const scoped = defineResource({ ...module.resources[0]!, get: async () => { throw new AdminError('NOT_FOUND'); } });
    const engine = createAdminEngine({ authorize: policy, audit: () => {}, modules: [{ ...module, resources: [scoped] }] });
    const res = await engine.handle({ authenticate: () => admin, requestId: 'r', signal: new AbortController().signal, operation: { kind: 'get', resourceId: 'users', recordId: 'user-001' } });
    expect(res.status).toBe(404);
  });

  it('times out slow providers with 504 and aborts their signal', async () => {
    const { module } = makeUsersModule();
    let aborted = false;
    const slow = defineResource({
      ...module.resources[0]!,
      timeoutMs: 20,
      list: (ctx) => new Promise((resolve) => {
        ctx.signal.addEventListener('abort', () => { aborted = true; });
        setTimeout(() => resolve({ items: [] }), 500);
      }),
    });
    const engine = createAdminEngine({ authorize: policy, audit: () => {}, modules: [{ ...module, resources: [slow] }] });
    const res = await engine.handle({ authenticate: () => admin, requestId: 'r', signal: new AbortController().signal, operation: listUsers });
    expect(res.status).toBe(504);
    expect(aborted).toBe(true);
  });
});

describe('auditing', () => {
  it('records actor, action, outcome, and request id on success', async () => {
    const { call, events } = setup();
    await call(admin, { kind: 'list', resourceId: 'users', query: { 'filter[email]': 'person1@example.test' } }, 'req-abc');
    const e = events.at(-1)!;
    expect(e).toMatchObject({ actorId: 'u-admin', action: 'users.list', outcome: 'success', requestId: 'req-abc', resourceType: 'users' });
    // Filter keys are logged, filter values (possible PII) are not.
    expect(e.metadata.filterFields).toBe('email');
    expect(JSON.stringify(e)).not.toContain('person1@example.test');
  });

  it('never contains secret fixture values', async () => {
    const { call, events } = setup();
    await call(admin, listUsers);
    await call(admin, { kind: 'get', resourceId: 'users', recordId: 'user-001' });
    await call(support, listUsers);
    expect(JSON.stringify(events)).not.toMatch(/SECRET|argon2|tok_/);
  });

  it('fails closed: returns 503 and no data when the audit sink is down', async () => {
    const { call, onAuditFailure } = setup({ audit: () => { throw new Error('disk full'); } });
    const res = await call(admin, listUsers);
    expect(res.status).toBe(503);
    expect(res.body).not.toHaveProperty('data');
    expect(onAuditFailure).toHaveBeenCalled();
  });

  it('still denies (not 503) when the audit sink is down during a denial', async () => {
    const { call } = setup({ audit: () => { throw new Error('disk full'); } });
    expect((await call(support, listUsers)).status).toBe(403);
    expect((await call(null, listUsers)).status).toBe(401);
  });

  it('fail-open mode returns data and reports the failure', async () => {
    const { module } = makeUsersModule();
    const onAuditFailure = vi.fn();
    const engine = createAdminEngine({ authorize: policy, audit: async () => { throw new Error('x'); }, auditFailureMode: 'fail-open', onAuditFailure, modules: [module] });
    const res = await engine.handle({ authenticate: () => admin, requestId: 'r', signal: new AbortController().signal, operation: listUsers });
    expect(res.status).toBe(200);
    expect(onAuditFailure).toHaveBeenCalledOnce();
  });
});

describe('configuration', () => {
  it('requires authorize and audit', () => {
    const { module } = makeUsersModule();
    expect(() => createAdminEngine({ audit: () => {}, modules: [module] } as never)).toThrow(/authorize/);
    expect(() => createAdminEngine({ authorize: policy, modules: [module] } as never)).toThrow(/audit/);
  });
});
