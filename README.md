# OpenAdmin Kit

> **Build your product. We provide the admin foundation.**

A small, self-hosted admin toolkit for TypeScript/Express apps. You plug in **your** session check, **your** permission rules, and **your** data. OpenAdmin Kit gives you authenticated, deny-by-default, audited admin API routes. You don't have to wire up auth checks, pagination limits, field filtering, and audit logging again for every project.

> ⚠️ **Pre-alpha (0.0.x).** This is a working proof of concept, not a production-ready package. It has not had an independent security review. APIs will change. The package names below are not published to npm yet.

## What works today

- **Headless core** (`@openadminkit/core`): module registry, deny-by-default authorization, bounded list/get queries, field allowlisting, safe errors, timeouts, and redacted audit events.
- **Express adapter** (`@openadminkit/express`): a router you mount under your own path, with `401` / `403` / `404` / `400` / `503` handling, request IDs, `no-store` headers, and `405` for any write method.
- **Example app** (`examples/express-basic`): cookie sessions, three staff roles, 120 fake users, a metrics module, and an audit-log viewer.
- **111 tests** covering the security cases from the blueprint's threat model.

Not built yet: the React dashboard, mutating actions, the `@openadminkit/testing` package, and Next.js/Prisma adapters. See [ROADMAP.md](ROADMAP.md).

## Quickstart (about 2 minutes)

You need Node 20+ and pnpm 9+.

```bash
pnpm install
pnpm build
pnpm example
```

Open http://localhost:3000, click **Log in as viewer**, then **Users (5)**. The response is `403`. Log in as **admin** and try again.

From the terminal:

```bash
curl -i localhost:3000/internal/admin/api/resources/users          # 401

curl -c jar -H 'Content-Type: application/json' -d '{"as":"support"}' localhost:3000/login
curl -b jar 'localhost:3000/internal/admin/api/resources/users?limit=3&filter[status]=suspended'   # 200
curl -b jar  localhost:3000/internal/admin/api/resources/audit-events                              # 403
```

Run every check:

```bash
pnpm check   # build + typecheck + lint + test
```

## Adding it to your own Express app

```ts
import { createRolePolicy, defineAdminModule, defineResource } from '@openadminkit/core';
import { createExpressAdmin } from '@openadminkit/express';

const users = defineResource({
  id: 'users',
  label: 'Users',
  permissionPrefix: 'users',            // checks "users.read"
  idField: 'id',
  fields: {                              // ONLY these fields ever leave the server
    id: { type: 'string' },
    email: { type: 'string', filterable: true },
    createdAt: { type: 'date', sortable: true },
  },
  list: (ctx, query) => myUserService.listForAdmin(ctx.actor, query),  // query is already validated + bounded
  get: (ctx, id) => myUserService.findForAdmin(ctx.actor, id),         // return null if missing OR out of scope
});

app.use('/internal/admin/api', createExpressAdmin({
  authenticate: (req) => {               // your existing session/JWT check
    const s = req.session?.user;
    return s ? { id: s.id, roles: s.roles } : null;
  },
  authorize: createRolePolicy({ admin: ['users.read'] }),   // or your own (input) => boolean
  audit: (event) => myAuditTable.insert(event),             // storage you own
  modules: [defineAdminModule({ id: 'users', label: 'Users', permissions: ['users.read'], resources: [users] })],
}));
```

[docs/getting-started.md](docs/getting-started.md) walks through this step by step.

## API surface

| Route | Purpose |
|---|---|
| `GET /` | The modules and resources this actor can read (for navigation) |
| `GET /resources/:id?limit=&cursor=&sort=&filter[field]=` | Bounded list, 1–100 rows per page (default 25) |
| `GET /resources/:id/:recordId` | Single record |

## Security model

- **The backend is the trust boundary.** Hiding a button never grants or blocks anything. Every request re-runs `authenticate` and `authorize`.
- **Deny by default.** Only a literal `true` from your `authorize` function grants access. Throws, rejections, `undefined`, and `"yes"` all deny.
- **Allowlisted output.** Records are projected onto the declared `fields`, so a `passwordHash` your query happens to return is dropped.
- **Strict input.** Unknown params, undeclared filters and sorts, repeated params, oversized values, and control characters all get `400`.
- **Audit fail-closed.** If a success event can't be written, the data isn't returned (`503`). This is configurable.
- **No raw errors.** Database and provider errors become a generic `500`. Your `onInternalError` hook gets the real error.

Read [docs/security.md](docs/security.md) for the threat-model status and known gaps.

## Repository layout

```
packages/core       contracts, registry, engine (no Express/React dependency)
packages/express    Express router
examples/express-basic
docs/               RFC-001, getting started, security
```

## License

[MIT](LICENSE)
