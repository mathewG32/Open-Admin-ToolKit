import { describe, expect, it, vi } from 'vitest';
import {
  createAdminEngine,
  createRegistry,
  createRolePolicy,
  defineAdminModule,
  defineMetric,
  RegistryError,
  type AdminMetric,
  type AuditEvent,
} from '../src/index.js';
import { admin, makeUsersModule, support } from './fixtures.js';

const revenue = defineMetric({
  id: 'revenue-30d',
  label: 'Revenue',
  description: 'Last 30 days',
  permission: 'metrics.revenue',
  format: 'currency',
  currency: 'USD',
  load: async () => ({ value: 1234.5, previous: 1000, series: [{ x: '2026-10-15', y: 40 }, { x: '2026-10-16', y: 55 }] }),
});

function metricsModule(metrics: AdminMetric[], extra: Partial<Parameters<typeof defineAdminModule>[0]> = {}) {
  return defineAdminModule({ id: 'metrics', label: 'Metrics', permissions: ['metrics.revenue'], resources: [], metrics, ...extra });
}

function setup(metrics: AdminMetric[] = [revenue]) {
  const events: AuditEvent[] = [];
  const onInternalError = vi.fn();
  const engine = createAdminEngine({
    authorize: createRolePolicy({ admin: ['users.read', 'metrics.revenue'], support: ['users.read'] }),
    audit: (e) => { events.push(e); },
    modules: [makeUsersModule().module, metricsModule(metrics)],
    onInternalError,
  });
  const call = (actor: unknown, metricId: string) =>
    engine.handle({ authenticate: () => actor, requestId: 'r', signal: new AbortController().signal, operation: { kind: 'metric', metricId } });
  const describeFor = async (actor: unknown) =>
    (await engine.handle({ authenticate: () => actor, requestId: 'r', signal: new AbortController().signal, operation: { kind: 'describe' } })).body as {
      modules: { id: string; metrics: { id: string }[] }[];
    };
  return { call, describeFor, events, onInternalError };
}

describe('metrics: registry', () => {
  it('requires the metric permission to be declared by its module', () => {
    expect(() => createRegistry([metricsModule([revenue], { permissions: [] })])).toThrow(/does not declare it/);
  });

  it('requires a currency code for currency format', () => {
    const bad = { ...revenue, currency: 'dollars' };
    expect(() => createRegistry([metricsModule([bad])])).toThrow(/ISO 4217/);
  });

  it('rejects duplicate metric ids across modules', () => {
    const a = metricsModule([revenue]);
    const b = { ...metricsModule([revenue]), id: 'metrics-two' };
    expect(() => createRegistry([a, b])).toThrow(RegistryError);
  });

  it('rejects unknown display/format values', () => {
    expect(() => createRegistry([metricsModule([{ ...revenue, display: 'pie' as 'bar' }])])).toThrow(/display/);
    expect(() => createRegistry([metricsModule([{ ...revenue, format: 'bytes' as 'number' }])])).toThrow(/format/);
  });

  it('a disabled module exposes no metrics', () => {
    const reg = createRegistry([metricsModule([revenue], { enabled: false })]);
    expect(reg.getMetric('revenue-30d')).toBeUndefined();
  });

  it('snapshots metrics with defaults filled in', () => {
    const plain = defineMetric({ id: 'count', label: 'Count', permission: 'metrics.revenue', load: async () => ({ value: 1 }) });
    const m = createRegistry([metricsModule([plain])]).getMetric('count')!.metric;
    expect(m).toMatchObject({ display: 'stat', format: 'number' });
    expect(Object.isFrozen(m)).toBe(true);
  });
});

describe('metrics: engine', () => {
  it('returns the validated result to an authorized actor', async () => {
    const { call, events } = setup();
    const res = await call(admin, 'revenue-30d');
    expect(res.status).toBe(200);
    expect((res.body as { data: unknown }).data).toEqual({ value: 1234.5, previous: 1000, series: [{ x: '2026-10-15', y: 40 }, { x: '2026-10-16', y: 55 }] });
    expect(events.at(-1)).toMatchObject({ action: 'revenue-30d.metric', outcome: 'success', actorId: 'u-admin' });
  });

  it('401 / 403 / 404 and never calls load when denied', async () => {
    const load = vi.fn(async () => ({ value: 1 }));
    const { call } = setup([{ ...revenue, load }]);
    expect((await call(null, 'revenue-30d')).status).toBe(401);
    expect((await call(support, 'revenue-30d')).status).toBe(403);
    expect((await call(admin, 'nope')).status).toBe(404);
    expect(load).not.toHaveBeenCalled();
  });

  it('passes kind: metric in the authorization target', async () => {
    const authorize = vi.fn(() => true);
    const engine = createAdminEngine({ authorize, audit: () => {}, modules: [metricsModule([revenue])] });
    await engine.handle({ authenticate: () => admin, requestId: 'r', signal: new AbortController().signal, operation: { kind: 'metric', metricId: 'revenue-30d' } });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      permission: 'metrics.revenue',
      target: { moduleId: 'metrics', resourceId: 'revenue-30d', kind: 'metric' },
    }));
  });

  it.each([
    ['missing value', {}],
    ['string value', { value: '12' }],
    ['NaN value', { value: Number.NaN }],
    ['infinite previous', { value: 1, previous: Infinity }],
    ['series not array', { value: 1, series: 'x' }],
    ['bad point', { value: 1, series: [{ x: 1, y: 2 }] }],
    ['control chars in x', { value: 1, series: [{ x: 'a\nb', y: 2 }] }],
    ['too many points', { value: 1, series: Array.from({ length: 1001 }, (_, i) => ({ x: String(i), y: i })) }],
  ])('rejects a malformed result (%s) with a generic 500', async (_label, result) => {
    const { call, onInternalError } = setup([{ ...revenue, load: async () => result as never }]);
    const res = await call(admin, 'revenue-30d');
    expect(res.status).toBe(500);
    expect(onInternalError).toHaveBeenCalled();
  });

  it('drops unknown keys from the result', async () => {
    const { call } = setup([{ ...revenue, load: async () => ({ value: 2, rawRows: [{ email: 'x@y.z' }] }) as never }]);
    const res = await call(admin, 'revenue-30d');
    expect((res.body as { data: unknown }).data).toEqual({ value: 2 });
  });

  it('describe lists only metrics the actor can read', async () => {
    const { describeFor } = setup();
    const forAdmin = await describeFor(admin);
    const forSupport = await describeFor(support);
    expect(forAdmin.modules.find((m) => m.id === 'metrics')?.metrics.map((m) => m.id)).toEqual(['revenue-30d']);
    expect(forSupport.modules.find((m) => m.id === 'metrics')).toBeUndefined();
  });

  it('times out slow metrics with 504', async () => {
    const { call } = setup([{ ...revenue, timeoutMs: 20, load: () => new Promise((r) => setTimeout(() => r({ value: 1 }), 500)) }]);
    expect((await call(admin, 'revenue-30d')).status).toBe(504);
  });
});
