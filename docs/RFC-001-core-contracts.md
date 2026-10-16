# RFC-001: Core Contracts & Security Boundaries

- **Status:** Draft. It is implemented in the proof of concept, and the API can still change before alpha.
- **Scope:** `@openadminkit/core` and `@openadminkit/express`, read-only operations only.

## 1. Problem

Small teams rebuild the same admin plumbing in every project: protected routes, role checks, paginated tables, filters, and activity history. These rebuilds are usually tied to one database and one auth scheme. The security mistakes keep recurring too: unbounded queries, leaked fields, UI-only permission checks, and logs full of tokens.

## 2. Goals for this RFC

1. A transport-agnostic **engine** that every request passes through: authenticate → resolve → authorize → validate → run host handler → sanitize → audit → respond.
2. **Host ownership.** Identity, permissions, data, and audit storage come from the host app through callbacks. The toolkit never ships its own users table, ORM, or log store.
3. **Deny by default** at every decision point.
4. A **thin Express adapter** that only maps HTTP to engine calls.

## 3. Non-goals (for this RFC)

Mutations and actions (that's RFC-002), the React dashboard, multi-framework support, schema introspection, auto-CRUD, and any form of arbitrary query or command execution.

## 4. Trust boundary

```
Browser / any HTTP client         ← untrusted, even when it's "our" dashboard
        │
Express adapter                   ← maps HTTP, sets no-store headers, request ID
        │
Engine  (authenticate → authorize → validate → handler → sanitize → audit)
        │
Host callbacks                    ← trusted: authenticate, authorize, list/get, audit sink
```

The actor (`id`, `roles`, `tenantId`) always comes from the host's `authenticate(req)`. It is never read from headers, query strings, or bodies.

## 5. Contracts

### 5.1 Actor

```ts
type AdminActor = { id: string; roles: readonly string[]; tenantId?: string };
```

`authenticate` returns an actor, or `null`/`undefined` when there is no session (that gives a `401`). If it throws or returns a malformed object, the request is denied with a generic `500`, and `onInternalError` receives the cause. The engine freezes a copy and drops unknown keys, so a host can't accidentally pass `isSuperUser: true` through.

### 5.2 Authorization

```ts
type AuthorizeFn = (input: { actor; permission; target: { moduleId; resourceId; recordId? } }) => boolean | Promise<boolean>;
```

- Only `=== true` grants access.
- `get` is authorized with `recordId` in the target, so hosts can enforce record- and tenant-level rules.
- Permissions are `resource.action` strings that match `^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$`. Wildcards are rejected at startup.
- `createRolePolicy` is an optional helper that maps roles to explicit permission lists. It has no inheritance and no wildcards.

### 5.3 Resources

A resource declares `fields`, which is the **only** set of keys that can leave the server, plus which fields are `filterable` or `sortable`, a `list` handler, and an optional `get` handler.

List queries are validated before the host is called:

| Param | Rule |
|---|---|
| `limit` | Integer from 1 to 100, default 25 |
| `cursor` | Opaque string, 1–512 characters, passed through to the host |
| `sort` | `field` or `-field`, and the field must be `sortable` |
| `filter[field]` | The field must be `filterable`. Values must be non-empty, at most 200 characters, with no control characters. At most 10 filters. |
| anything else | `400` |

Repeated parameters (`?limit=1&limit=100`) get `400`. The engine also enforces `limit` on the output, in case the host ignores it.

`get` returns `null` when a record doesn't exist **or** is outside the actor's scope. Both produce the same `404`.

Handlers run under a timeout (default 10 s, configurable per resource up to 120 s), with an `AbortSignal` that fires on timeout or client disconnect.

### 5.4 Modules

```ts
{ id, label, permissions: Permission[], resources: AdminResource[], enabled?: boolean }
```

At startup the registry checks: unique module IDs, unique resource IDs across modules, safe ID patterns, that each resource's read permission is declared by its module, that `idField` is among the declared fields, and valid field types. **Disabled modules are still validated**, but they are not indexed. Their resources then return the same `404` as a resource that never existed, and they don't appear in navigation.

### 5.5 Errors

| Code | HTTP | When |
|---|---|---|
| `UNAUTHENTICATED` | 401 | No verified identity |
| `FORBIDDEN` | 403 | Authenticated, not permitted |
| `NOT_FOUND` | 404 | Unknown resource or record, out-of-scope record, disabled module |
| `BAD_REQUEST` | 400 | Invalid query. `details.param` and `details.reason` are included. |
| `TIMEOUT` | 504 | Host handler exceeded `timeoutMs` |
| `UNAVAILABLE` | 503 | Audit sink failed while in fail-closed mode |
| `INTERNAL` | 500 | Anything else. The message is always generic. |

Error bodies contain `code`, `message`, `requestId`, and optional `details`. They never include stacks or provider messages.

### 5.6 Audit

Every list or get produces an event, and so does every denial, unauthenticated attempt, unknown-resource lookup, and failure:

```ts
{ eventId, timestamp /*UTC ISO*/, actorId | null, action, resourceType?, resourceId?, tenantId?, outcome: 'success'|'denied'|'error', requestId, metadata }
```

- Metadata accepts primitives only. Keys that look sensitive (`pass`, `token`, `secret`, `session`, `cookie`, `auth`, `key`, `card`, and so on) are dropped. Strings are stripped of control characters and truncated to 200 characters. There are at most 20 keys.
- List events record filter **field names**, never filter values, because values like an email search are often PII.
- `auditFailureMode: 'fail-closed'` is the default: if a *success* event can't be written, the response is `503` and no data goes out. A failure while writing a denial event never turns that denial into a success.

## 6. Open questions

1. Should `describe` (`GET /`) be audited? Right now it isn't, because it would flood the log on every page load.
2. Should unknown paths under the mount point authenticate first, so they return `401` rather than `404`? At the moment they return `404` without calling `authenticate`. No data is exposed either way.
3. Should the core export a cursor helper (signed keyset cursors) or leave pagination entirely to hosts?
4. Is a CJS build needed? It's ESM-only for now.
5. Rate limiting: should the adapter provide a hook, or should the docs point hosts to existing middleware such as `express-rate-limit`?

## 7. Next: RFC-002 (actions)

Mutating actions will use the same pipeline plus input-schema validation, confirmation/step-up hooks, idempotency keys, and CSRF requirements for cookie-authenticated hosts. Until that RFC is accepted, the adapter returns `405` for every non-GET method.
