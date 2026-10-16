import { buildAuditEvent, type AuditEventInput } from './audit.js';
import { AdminError, isAdminError, toSafeError, type SafeErrorBody } from './errors.js';
import { checkPermission, normalizeActor } from './permissions.js';
import { parseListQuery, parseRecordId, sanitizeRecord } from './query.js';
import { createRegistry, type AdminRegistry, type RegisteredMetric, type RegisteredResource } from './registry.js';
import type {
  AdminActor,
  AdminContext,
  AdminModule,
  AuditEvent,
  AuditFailureMode,
  AuditSink,
  AuthorizeFn,
  FieldMap,
  MetricDisplay,
  MetricFormat,
  MetricPoint,
  MetricResult,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CALLBACK_TIMEOUT_MS = 5_000;

/** Internal marker: a host callback (authenticate/authorize/audit) exceeded its deadline. */
class CallbackTimeoutError extends Error {
  constructor(readonly callback: 'authenticate' | 'authorize' | 'audit', ms: number) {
    super(`OpenAdmin Kit: host "${callback}" callback did not settle within ${ms}ms.`);
    this.name = 'CallbackTimeoutError';
  }
}

/**
 * Bounds how long we WAIT for a host callback. It cannot stop the callback's
 * underlying work (JS has no way to cancel a promise); it only guarantees the
 * request itself doesn't hang. Sync throws become rejections.
 */
async function withDeadline<T>(
  callback: CallbackTimeoutError['callback'],
  ms: number,
  fn: () => T | Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CallbackTimeoutError(callback, ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export type AdminEngineOptions = {
  /** Host authorization decision. Deny-by-default: only literal `true` grants. */
  authorize: AuthorizeFn;
  /** Host audit storage. Required: every protected operation produces an event. */
  audit: AuditSink;
  modules: readonly AdminModule[];
  /** Default 'fail-closed': if a success event can't be written, the data is not returned. */
  auditFailureMode?: AuditFailureMode;
  /**
   * Max time (ms) to wait for each `authenticate`, `authorize`, and `audit` call. Default 5000.
   * On expiry: authenticate → 504, authorize → deny (403), audit → treated as a sink failure.
   * This bounds the request, not the callback's own work; see docs/security.md › Cancellation.
   */
  callbackTimeoutMs?: number;
  /** Called when the audit sink throws. Use it to alert; never rethrow from here. */
  onAuditFailure?: (error: unknown, event: AuditEvent) => void;
  /** Called with the real error when a client receives a generic INTERNAL/TIMEOUT error. */
  onInternalError?: (error: unknown, info: { requestId: string }) => void;
};

export type AdminOperation =
  | { kind: 'describe' }
  | { kind: 'list'; resourceId: string; query: Readonly<Record<string, unknown>> }
  | { kind: 'get'; resourceId: string; recordId: unknown }
  | { kind: 'metric'; metricId: string };

export type DescribedMetric = {
  id: string;
  label: string;
  description?: string;
  display: MetricDisplay;
  format: MetricFormat;
  currency?: string;
};

const MAX_SERIES_POINTS = 1000;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Strictly validates a host metric result. Returns a clean copy, or null if malformed. */
function normalizeMetricResult(raw: unknown): MetricResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.value !== 'number' || !Number.isFinite(r.value)) return null;
  const out: { value: number; previous?: number; series?: MetricPoint[] } = { value: r.value };
  if (r.previous !== undefined && r.previous !== null) {
    if (typeof r.previous !== 'number' || !Number.isFinite(r.previous)) return null;
    out.previous = r.previous;
  }
  if (r.series !== undefined) {
    if (!Array.isArray(r.series) || r.series.length > MAX_SERIES_POINTS) return null;
    const series: MetricPoint[] = [];
    for (const p of r.series) {
      if (typeof p !== 'object' || p === null) return null;
      const { x, y } = p as Record<string, unknown>;
      if (typeof x !== 'string' || x.length === 0 || x.length > 64 || CONTROL_CHARS.test(x)) return null;
      if (typeof y !== 'number' || !Number.isFinite(y)) return null;
      series.push({ x, y });
    }
    out.series = series;
  }
  return out;
}

export type AdminRequest = {
  /** Calls the host's identity verification. Return null/undefined when there is no session. */
  authenticate: () => unknown;
  requestId: string;
  /** Aborted when the client disconnects. */
  signal: AbortSignal;
  operation: AdminOperation;
};

export type AdminResponse = { status: number; body: Record<string, unknown> | SafeErrorBody };

export type DescribedResource = {
  id: string;
  label: string;
  idField: string;
  fields: FieldMap;
  supportsGet: boolean;
};

export type AdminEngine = {
  readonly registry: AdminRegistry;
  /** Never throws. Always resolves to a status and a client-safe body. */
  handle(request: AdminRequest): Promise<AdminResponse>;
};

async function withTimeout<T>(
  parent: AbortSignal,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent.reason);
  if (parent.aborted) controller.abort(parent.reason);
  else parent.addEventListener('abort', onAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error('timeout'));
      reject(new AdminError('TIMEOUT'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', onAbort);
  }
}

/**
 * The transport-agnostic request pipeline:
 * authenticate → resolve resource → authorize → validate → run host handler
 * (bounded by timeout) → sanitize output → audit → safe response.
 *
 * Transports (Express today) only translate HTTP to `AdminRequest` and back.
 */
export function createAdminEngine(options: AdminEngineOptions): AdminEngine {
  if (typeof options?.authorize !== 'function') throw new TypeError('createAdminEngine: "authorize" function is required.');
  if (typeof options.audit !== 'function') throw new TypeError('createAdminEngine: "audit" sink is required.');
  const failClosed = (options.auditFailureMode ?? 'fail-closed') === 'fail-closed';
  const cbMs = options.callbackTimeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS;
  if (!Number.isInteger(cbMs) || cbMs < 1 || cbMs > 60_000) {
    throw new TypeError('createAdminEngine: "callbackTimeoutMs" must be an integer between 1 and 60000.');
  }
  const registry = createRegistry(options.modules);

  /**
   * The host policy, bounded. A timeout rejects, which checkPermission turns into a denial.
   * Timeouts are reported (a hanging policy store is an incident); ordinary throws are not
   * reported here because hosts sometimes throw to deny.
   */
  const authorizeFor = (req: AdminRequest): AuthorizeFn => async (input) => {
    try {
      return await withDeadline('authorize', cbMs, () => options.authorize(input));
    } catch (err) {
      if (err instanceof CallbackTimeoutError) reportInternal(err, req.requestId);
      throw err;
    }
  };

  /** `critical` events (successful data access) block the response in fail-closed mode. */
  async function writeAudit(input: AuditEventInput, critical: boolean): Promise<void> {
    const event = buildAuditEvent(input);
    try {
      await withDeadline('audit', cbMs, () => options.audit(event));
    } catch (err) {
      try {
        options.onAuditFailure?.(err, event);
      } catch {
        /* a failing alert hook must not change the outcome */
      }
      if (critical && failClosed) throw new AdminError('UNAVAILABLE');
    }
  }

  /** Reports each mismatched field once per request, so a bad column doesn't flood logs. */
  function mismatchReporter(req: AdminRequest, reg: RegisteredResource) {
    const seen = new Set<string>();
    return (field: string, expected: string) => {
      if (seen.has(field)) return;
      seen.add(field);
      reportInternal(
        new Error(`Resource "${reg.resource.id}" returned a value for "${field}" that is not a ${expected}; it was sent as null.`),
        req.requestId,
      );
    };
  }

  function reportInternal(err: unknown, requestId: string) {
    try {
      options.onInternalError?.(err, { requestId });
    } catch {
      /* ignore */
    }
  }

  async function resolveActor(req: AdminRequest): Promise<AdminActor> {
    let raw: unknown;
    try {
      raw = await withDeadline('authenticate', cbMs, req.authenticate);
    } catch (err) {
      reportInternal(err, req.requestId);
      // Identity could not be verified: deny. Do not reveal why.
      const timedOut = err instanceof CallbackTimeoutError;
      await writeAudit(
        { actorId: null, action: 'admin.authenticate', outcome: 'error', requestId: req.requestId, metadata: { errorCode: timedOut ? 'TIMEOUT' : 'INTERNAL' } },
        false,
      );
      throw new AdminError(timedOut ? 'TIMEOUT' : 'INTERNAL');
    }
    if (raw === null || raw === undefined) {
      await writeAudit({ actorId: null, action: 'admin.authenticate', outcome: 'denied', requestId: req.requestId }, false);
      throw new AdminError('UNAUTHENTICATED');
    }
    const actor = normalizeActor(raw);
    if (!actor) {
      reportInternal(new Error('authenticate() returned a malformed actor; expected { id: string, roles: string[], tenantId?: string }'), req.requestId);
      await writeAudit({ actorId: null, action: 'admin.authenticate', outcome: 'error', requestId: req.requestId }, false);
      throw new AdminError('INTERNAL');
    }
    return actor;
  }

  async function describe(actor: AdminActor, req: AdminRequest) {
    const modules: { id: string; label: string; resources: DescribedResource[]; metrics: DescribedMetric[] }[] = [];
    for (const mod of registry.modules) {
      const resources: DescribedResource[] = [];
      for (const res of mod.resources) {
        const allowed = await checkPermission(authorizeFor(req), {
          actor,
          permission: `${res.permissionPrefix}.read`,
          target: { moduleId: mod.id, resourceId: res.id },
        });
        if (allowed) {
          resources.push({ id: res.id, label: res.label, idField: res.idField, fields: res.fields, supportsGet: typeof res.get === 'function' });
        }
      }
      const metrics: DescribedMetric[] = [];
      for (const m of mod.metrics ?? []) {
        const allowed = await checkPermission(authorizeFor(req), {
          actor,
          permission: m.permission,
          target: { moduleId: mod.id, resourceId: m.id, kind: 'metric' },
        });
        if (allowed) {
          const d: DescribedMetric = { id: m.id, label: m.label, display: m.display ?? 'stat', format: m.format ?? 'number' };
          if (m.description !== undefined) d.description = m.description;
          if (m.currency !== undefined) d.currency = m.currency;
          metrics.push(d);
        }
      }
      // Navigation is a convenience only; every data request is authorized again.
      if (resources.length > 0 || metrics.length > 0) modules.push({ id: mod.id, label: mod.label, resources, metrics });
    }
    return { actor: { id: actor.id, roles: actor.roles }, modules, requestId: req.requestId };
  }

  async function metric(actor: AdminActor, req: AdminRequest, op: Extract<AdminOperation, { kind: 'metric' }>) {
    const reg: RegisteredMetric | undefined = typeof op.metricId === 'string' ? registry.getMetric(op.metricId) : undefined;
    if (!reg) {
      await writeAudit(
        { actorId: actor.id, action: 'admin.metric.lookup', outcome: 'denied', requestId: req.requestId, tenantId: actor.tenantId, metadata: { reason: 'unknown_metric' } },
        false,
      );
      throw new AdminError('NOT_FOUND');
    }
    const m = reg.metric;
    const action = `${m.id}.metric`;
    const allowed = await checkPermission(authorizeFor(req), {
      actor,
      permission: m.permission,
      target: { moduleId: reg.module.id, resourceId: m.id, kind: 'metric' },
    });
    if (!allowed) {
      await writeAudit(
        { actorId: actor.id, action, outcome: 'denied', requestId: req.requestId, resourceType: m.id, tenantId: actor.tenantId, metadata: { permission: m.permission } },
        false,
      );
      throw new AdminError('FORBIDDEN');
    }
    const raw = await runHost(actor, req, m, action, undefined, (ctx) => m.load(ctx));
    const result = normalizeMetricResult(raw);
    if (!result) {
      reportInternal(
        new Error(`Metric "${m.id}" load() must return { value: finite number, previous?: finite number, series?: { x: string, y: finite number }[] (max ${MAX_SERIES_POINTS}) }.`),
        req.requestId,
      );
      throw new AdminError('INTERNAL');
    }
    await writeAudit(
      { actorId: actor.id, action, outcome: 'success', requestId: req.requestId, resourceType: m.id, tenantId: actor.tenantId },
      true,
    );
    return { data: result, requestId: req.requestId };
  }

  async function authorizeResource(
    actor: AdminActor,
    req: AdminRequest,
    reg: RegisteredResource,
    action: string,
    recordId?: string,
  ) {
    const target = recordId === undefined
      ? { moduleId: reg.module.id, resourceId: reg.resource.id }
      : { moduleId: reg.module.id, resourceId: reg.resource.id, recordId };
    const allowed = await checkPermission(authorizeFor(req), { actor, permission: reg.readPermission, target });
    if (!allowed) {
      await writeAudit(
        {
          actorId: actor.id,
          action,
          outcome: 'denied',
          requestId: req.requestId,
          resourceType: reg.resource.id,
          resourceId: recordId,
          tenantId: actor.tenantId,
          metadata: { permission: reg.readPermission },
        },
        false,
      );
      throw new AdminError('FORBIDDEN');
    }
  }

  function contextFor(actor: AdminActor, req: AdminRequest, signal: AbortSignal): AdminContext {
    return Object.freeze({ actor, requestId: req.requestId, now: new Date(), signal });
  }

  /** Unknown resources look identical whether they never existed or belong to a disabled module. */
  async function lookup(actor: AdminActor, req: AdminRequest, resourceId: string): Promise<RegisteredResource> {
    const reg = typeof resourceId === 'string' ? registry.getResource(resourceId) : undefined;
    if (!reg) {
      await writeAudit(
        { actorId: actor.id, action: 'admin.resource.lookup', outcome: 'denied', requestId: req.requestId, tenantId: actor.tenantId, metadata: { reason: 'unknown_resource' } },
        false,
      );
      throw new AdminError('NOT_FOUND');
    }
    return reg;
  }

  /** `unit` is the resource or metric being run: its id is the audit resourceType. */
  async function runHost<T>(
    actor: AdminActor,
    req: AdminRequest,
    unit: { readonly id: string; readonly timeoutMs?: number | undefined },
    action: string,
    recordId: string | undefined,
    fn: (ctx: AdminContext) => Promise<T>,
  ): Promise<T> {
    try {
      return await withTimeout(req.signal, unit.timeoutMs ?? DEFAULT_TIMEOUT_MS, (signal) => fn(contextFor(actor, req, signal)));
    } catch (err) {
      // Host handlers may intentionally throw NOT_FOUND / FORBIDDEN / BAD_REQUEST AdminErrors.
      const safe = isAdminError(err) && err.code !== 'INTERNAL' ? err : new AdminError('INTERNAL');
      if (!isAdminError(err) || err.code === 'TIMEOUT' || err.code === 'INTERNAL') reportInternal(err, req.requestId);
      await writeAudit(
        {
          actorId: actor.id,
          action,
          outcome: safe.code === 'FORBIDDEN' ? 'denied' : 'error',
          requestId: req.requestId,
          resourceType: unit.id,
          resourceId: recordId,
          tenantId: actor.tenantId,
          metadata: { errorCode: safe.code },
        },
        false,
      );
      throw safe;
    }
  }

  async function list(actor: AdminActor, req: AdminRequest, op: Extract<AdminOperation, { kind: 'list' }>) {
    const reg = await lookup(actor, req, op.resourceId);
    const action = `${reg.resource.id}.list`;
    await authorizeResource(actor, req, reg, action);

    let query;
    try {
      query = parseListQuery(op.query ?? {}, reg.resource);
    } catch (err) {
      await writeAudit(
        { actorId: actor.id, action, outcome: 'error', requestId: req.requestId, resourceType: reg.resource.id, tenantId: actor.tenantId, metadata: { errorCode: 'BAD_REQUEST' } },
        false,
      );
      throw err;
    }

    const result = await runHost(actor, req, reg.resource, action, undefined, (ctx) => reg.resource.list(ctx, query));
    if (typeof result !== 'object' || result === null || !Array.isArray(result.items)) {
      reportInternal(new Error(`Resource "${reg.resource.id}" list() must return { items: [] }.`), req.requestId);
      throw new AdminError('INTERNAL');
    }
    // Never trust the host to respect the limit; enforce it on output too.
    const onMismatch = mismatchReporter(req, reg);
    const items = result.items.slice(0, query.limit).map((item) => sanitizeRecord(item, reg.resource, onMismatch));
    const nextCursor = typeof result.nextCursor === 'string' && result.nextCursor.length > 0 ? result.nextCursor : null;
    const page: { limit: number; nextCursor: string | null; total?: number } = { limit: query.limit, nextCursor };
    if (typeof result.total === 'number' && Number.isFinite(result.total)) page.total = result.total;

    await writeAudit(
      {
        actorId: actor.id,
        action,
        outcome: 'success',
        requestId: req.requestId,
        resourceType: reg.resource.id,
        tenantId: actor.tenantId,
        // Filter KEYS only — filter values may contain PII (e.g. an email search).
        metadata: {
          limit: query.limit,
          resultCount: items.length,
          filterFields: Object.keys(query.filters).join(','),
          sort: query.sort ? `${query.sort.direction === 'desc' ? '-' : ''}${query.sort.field}` : null,
          paged: query.cursor !== undefined,
        },
      },
      true,
    );
    return { data: items, page, requestId: req.requestId };
  }

  async function get(actor: AdminActor, req: AdminRequest, op: Extract<AdminOperation, { kind: 'get' }>) {
    const reg = await lookup(actor, req, op.resourceId);
    const getter = reg.resource.get;
    if (typeof getter !== 'function') throw new AdminError('NOT_FOUND');
    const action = `${reg.resource.id}.get`;
    const recordId = parseRecordId(op.recordId);
    // Authorize with the specific record id so hosts can apply record/tenant rules.
    await authorizeResource(actor, req, reg, action, recordId);

    const record = await runHost(actor, req, reg.resource, action, recordId, (ctx) => getter(ctx, recordId));
    if (record === null || record === undefined) {
      await writeAudit(
        { actorId: actor.id, action, outcome: 'error', requestId: req.requestId, resourceType: reg.resource.id, resourceId: recordId, tenantId: actor.tenantId, metadata: { errorCode: 'NOT_FOUND' } },
        false,
      );
      throw new AdminError('NOT_FOUND');
    }
    const data = sanitizeRecord(record, reg.resource, mismatchReporter(req, reg));
    await writeAudit(
      { actorId: actor.id, action, outcome: 'success', requestId: req.requestId, resourceType: reg.resource.id, resourceId: recordId, tenantId: actor.tenantId },
      true,
    );
    return { data, requestId: req.requestId };
  }

  async function handle(req: AdminRequest): Promise<AdminResponse> {
    try {
      const actor = await resolveActor(req);
      const op = req.operation;
      let body: Record<string, unknown>;
      switch (op.kind) {
        case 'describe':
          body = await describe(actor, req);
          break;
        case 'list':
          body = await list(actor, req, op);
          break;
        case 'get':
          body = await get(actor, req, op);
          break;
        case 'metric':
          body = await metric(actor, req, op);
          break;
        default:
          throw new AdminError('NOT_FOUND');
      }
      return { status: 200, body };
    } catch (err) {
      if (!isAdminError(err)) reportInternal(err, req.requestId);
      return toSafeError(err, req.requestId);
    }
  }

  return Object.freeze({ registry, handle });
}
