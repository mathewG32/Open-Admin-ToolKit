# Getting started: add a protected read-only resource to an existing Express app

Expected time is about 15 minutes, assuming your app already has login and sessions.

> The packages aren't on npm yet. Until they are, build this repo and install the two packages from local paths (`pnpm add ../openadmin-kit/packages/core ../openadmin-kit/packages/express`), or work inside `examples/`.

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
    // query.limit is 1-100. query.filters only contains filterable fields.
    // Apply tenant scoping IN the query, not after fetching:
    const rows = await db.user.findMany({
      where: { tenantId: ctx.actor.tenantId, ...query.filters },
      orderBy: query.sort ? { [query.sort.field]: query.sort.direction } : { id: 'asc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
  },
  async get(ctx, id) {
    return db.user.findFirst({ where: { id, tenantId: ctx.actor.tenantId } }); // null → 404
  },
});
```

Returning whole database rows is safe here, because anything not listed in `fields` (password hashes, tokens) is dropped before the response. Selecting only the columns you need is still better for performance.

## 5. Store audit events

```ts
audit: async (event) => { await db.adminAuditEvent.create({ data: event }); }
```

The default is fail-closed: if this throws, successful reads return `503` rather than data that wasn't recorded. Set `auditFailureMode: 'fail-open'` with an `onAuditFailure` alert if you prefer availability.

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
| Everything is `503` | Your audit sink is throwing. |
