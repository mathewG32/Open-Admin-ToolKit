import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import {
  createAdminEngine,
  toSafeError,
  AdminError,
  type AdminEngine,
  type AdminEngineOptions,
  type AdminOperation,
} from '@openadminkit/core';

export type ExpressAuthenticate = (req: Request) => unknown;

export type ExpressAdminOptions = AdminEngineOptions & {
  /**
   * Verify the request using YOUR existing session/token logic and return
   * `{ id, roles, tenantId? }`, or null when there is no valid session.
   * Never build the actor from request headers or body fields the client controls.
   */
  authenticate: ExpressAuthenticate;
  /**
   * Accept an incoming `X-Request-Id` (when it matches a safe pattern) instead of
   * generating one. Enable only behind a proxy you control. Default false.
   */
  trustRequestIdHeader?: boolean;
};

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

function requestIdFor(req: Request, trustHeader: boolean): string {
  if (trustHeader) {
    const incoming = req.get('x-request-id');
    if (incoming && SAFE_REQUEST_ID.test(incoming)) return incoming;
  }
  return randomUUID();
}

/** An AbortSignal that fires if the client disconnects before we respond. */
function disconnectSignal(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort(new Error('client disconnected'));
  });
  return controller.signal;
}

/**
 * Creates the admin API router. Mount it under a path you control, e.g.
 * `app.use('/internal/admin/api', createExpressAdmin({...}))`.
 *
 * Routes (all GET, all authenticated, authorized, and audited):
 *   GET /                          → resources this actor may read (navigation)
 *   GET /resources/:resourceId     → bounded, filtered list
 *   GET /resources/:resourceId/:id → single record
 *   GET /metrics/:metricId         → pre-computed aggregate (+ optional series)
 *
 * Any other path or method under the mount point returns a safe JSON 404/405.
 */
export function createExpressAdmin(options: ExpressAdminOptions): Router {
  if (typeof options?.authenticate !== 'function') {
    throw new TypeError('createExpressAdmin: "authenticate" is required. It must verify the host session on every request.');
  }
  const engine = createAdminEngine(options);
  return createExpressAdminFromEngine(engine, options);
}

/** Lower-level variant when you want to hold the engine yourself (e.g. for tests or a second transport). */
export function createExpressAdminFromEngine(
  engine: AdminEngine,
  options: Pick<ExpressAdminOptions, 'authenticate' | 'trustRequestIdHeader'>,
): Router {
  const trustHeader = options.trustRequestIdHeader === true;
  const router = Router();

  router.use((req, res, next) => {
    const requestId = requestIdFor(req, trustHeader);
    res.locals.openAdminRequestId = requestId;
    res.set({
      'X-Request-Id': requestId,
      // Admin responses must never be cached by browsers or shared proxies.
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    next();
  });

  const run = (operation: (req: Request) => AdminOperation) => async (req: Request, res: Response) => {
    const requestId = res.locals.openAdminRequestId as string;
    const { status, body } = await engine.handle({
      authenticate: () => options.authenticate(req),
      requestId,
      signal: disconnectSignal(res),
      operation: operation(req),
    });
    if (!res.headersSent) res.status(status).json(body);
  };

  router.get('/', run(() => ({ kind: 'describe' })));
  router.get('/resources/:resourceId', run((req) => ({
    kind: 'list',
    resourceId: String(req.params.resourceId),
    query: req.query as Record<string, unknown>,
  })));
  router.get('/resources/:resourceId/:recordId', run((req) => ({
    kind: 'get',
    resourceId: String(req.params.resourceId),
    recordId: req.params.recordId,
  })));
  router.get('/metrics/:metricId', run((req) => ({
    kind: 'metric',
    metricId: String(req.params.metricId),
  })));

  // Mutations are not part of the alpha. Anything else under the mount point gets a
  // safe JSON response instead of falling through to the host app's routes.
  router.use((req, res) => {
    const requestId = res.locals.openAdminRequestId as string;
    const known = /^\/(resources\/[^/]+(\/[^/]+)?|metrics\/[^/]+)?\/?$/.test(req.path);
    if (known && req.method !== 'GET' && req.method !== 'HEAD') {
      res.set('Allow', 'GET, HEAD');
      res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.', requestId } });
      return;
    }
    const { status, body } = toSafeError(new AdminError('NOT_FOUND'), requestId);
    res.status(status).json(body);
  });

  return router;
}

export { createAdminEngine } from '@openadminkit/core';
