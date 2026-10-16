# Getting started: add a protected read-only resource to an existing Express app

Expected time is about 15 minutes, assuming your app already has login and sessions.

> The packages aren't on npm yet. Until they are, build this repo and install the two packages from local paths (`pnpm add ../openadmin-kit/packages/core ../openadmin-kit/packages/express`), or work inside `examples/`.

To check the packaging the same way a stranger would get it, run `pnpm test:pack`. It packs both packages, installs the tarballs into a throwaway app outside the repo, typechecks a consumer, and makes real HTTP requests.

## 1. Decide who counts as an admin

OpenAdmin Kit never assumes that someone with an account is an admin. You need a way to tell, from your existing session, which **roles** a person has, for example a `role` column or a claim in your JWT.

## 2. Write `authenticate`

```ts
authenticate: async (req) => {
  const user = await sessions.verify(req);          // YOUR existing verification
  if (!user) return null;                           // → 401
  return { id: user.id, roles: user.roles, tenantId: user.verifiedTenantId };
}
```

Rules:
- Return `null` when there is no valid session.
- Build the actor **only** from verified session or token data. Never use `req.headers['x-user-role']`, `req.query`, or `req.body`.
- If verification throws, let it throw. The request is denied with a generic `500`.

## 3. Write `authorize`

Start with explicit role grants:

```ts
authorize: createRolePolicy({
  admin:   ['users.read', 'metrics.read', 'audit.read'],
  support: ['users.read'],
})
```

For record- or tenant-level rules, write your own function:

```ts
authorize: async ({ actor, permission, target }) => {
  if (!(await perms.has(actor.id, permission))) return false;
  if (target.recordId) return perms.canSeeRecord(actor, target.resourceId, target.recordId);
  return true;
}
```

Return exactly `true` to allow. Anything else denies.

## 4. Declare a resource

```ts
const users = defineResource({
  id: 'users',
  label: 'Users',
  permissionPrefix: 'users',
  idField: 'id',
  fields: {
    id:        { type: 'string' },
    email:     { type: 'string', filterable: true },
    status:    { type: 'string', filterable: true },
    createdAt: { type: 'date',   sortable: true },
  },
  async list(ctx, query) {
    // query.limit is 1-100. query.filters only contains fields declared filterable.
    // Tenant scope is applied as its OWN condition, ANDed with the client's filters.
    const rows = await db.user.findMany({
      where: {
        AND: [
          { tenantId: requireTenant(ctx) },   // server-enforced, from the verified actor
          query.filters,                      // client-chosen, already validated
        ],
      },
      orderBy: query.sort ? { [query.sort.field]: query.sort.direction } : { id: 'asc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
  },
  async get(ctx, id) {
    return db.user.findFirst({ where: { AND: [{ id }, { tenantId: requireTenant(ctx) }] } }); // null → 404
  },
});

// Fail closed if a multi-tenant resource is ever reached without a verified tenant.
function requireTenant(ctx: AdminContext): string {
  if (!ctx.actor.tenantId) throw new AdminError('FORBIDDEN');
  return ctx.actor.tenantId;
}
```

> ⚠️ **Never merge client filters over your scope.** This looks harmless but is a cross-tenant leak:
>
> ```ts
> where: { tenantId: ctx.actor.tenantId, ...query.filters }   // ❌ filter[tenantId]=other overrides it
> ```
>
> OpenAdmin Kit rejects `filter[tenantId]` with a `400` unless you declare `tenantId` as `filterable`. Don't declare it filterable, and keep the scope in a separate `AND` clause anyway, so a later config change can't open the hole. The regression tests for this are in `packages/express/tests/router.test.ts` › *spoofing and tenancy*.

Returning whole database rows is safe here, because anything not listed in `fields` (password hashes, tokens) is dropped before the response. Selecting only the columns you need is still better for performance.

Values must match their declared `type`. A `number` field that receives `"42"` is sent as `null`, and `onInternalError` is told about it once per field per request. `date` fields accept `Date` objects or parseable strings and are always returned as ISO-8601 UTC.

### Honor the abort signal

Your handler gets `ctx.signal`. When the resource's `timeoutMs` passes (default 10 s) or the client disconnects, the request ends right away, **but your query keeps running unless you pass the signal on**:

```ts
async list(ctx, query) {
  const res = await fetch(url, { signal: ctx.signal });           // fetch
  await pool.query({ text, values, signal: ctx.signal });          // drivers that support it
  // or set a server-side statement timeout shorter than timeoutMs
}
```

See [security.md › Cancellation](security.md#cancellation-what-timeouts-do-and-dont-do).

## 5. Store audit events

```ts
audit: async (event) => { await db.adminAuditEvent.create({ data: event }); }
```

The default is fail-closed: if this throws or takes longer than `callbackTimeoutMs` (default 5 s), successful reads return `503` rather than data that wasn't recorded. Set `auditFailureMode: 'fail-open'` with an `onAuditFailure` alert if you prefer availability.

Store events as they arrive. Don't add request bodies, headers, error messages, or tokens to them yourself. The built-in redaction only catches *keys* that look sensitive, so a secret under an innocent key name would get through.

`authenticate` and `authorize` have the same `callbackTimeoutMs` bound. If authentication hangs, the request gets a `504`. If authorization hangs, the request is **denied** (`403`). Both cases are reported to `onInternalError`.

## 6. Mount it

```ts
app.use('/internal/admin/api', createExpressAdmin({ authenticate, authorize, audit, modules: [
  defineAdminModule({ id: 'users', label: 'Users', permissions: ['users.read'], resources: [users] }),
]}));
```

## 7. Verify before you trust it

```bash
curl -i  https://yourapp/internal/admin/api/resources/users                 # expect 401
curl -i  -b "<non-admin session cookie>" https://yourapp/internal/admin/api/resources/users   # expect 403
curl -i  -b "<admin session cookie>"     https://yourapp/internal/admin/api/resources/users   # expect 200
```

Then add tests like the ones in `packages/express/tests/router.test.ts`, written against **your** roles.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| App crashes at startup with `RegistryError` | Read the message. Usually a permission isn't listed in the module's `permissions`, or `idField` isn't in `fields`. |
| Everything is `500` | `authenticate` threw or returned the wrong shape. It must be `{ id: string, roles: string[] }`. Check `onInternalError`. |
| Everything is `403` | `authorize` returned something other than literal `true`, for example a Promise resolving to a truthy object. |
| A field is missing from responses | It isn't declared in `fields`, or its value is an object or array. Only primitives and Dates are returned. |
| `400 filter[x] field is not filterable` | Add `filterable: true` to that field. |
| Everything is `503` | Your audit sink is throwing or hanging. |
| Everything is `504` | `authenticate` is hanging (for example, the session store is unreachable). |
| A field is always `null` | Your handler returns a different type than declared. Check `onInternalError`. |

## Before production: rate limiting

OpenAdmin Kit doesn't rate-limit yet. Put a limiter in front of the admin router:

```ts
import rateLimit from 'express-rate-limit';
app.use('/internal/admin/api', rateLimit({ windowMs: 60_000, limit: 120 }), createExpressAdmin({ ... }));
```

If you're behind a proxy or load balancer, set `app.set('trust proxy', <your hop count>)` so the limiter sees real client IPs.
