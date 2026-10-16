# Security model and current status

OpenAdmin Kit is **pre-alpha** and has **not** had an independent security review. Use the example only with fake data.

## Threat model status (from the blueprint, section 6)

| Threat | Countermeasure | Status | Test |
|---|---|---|---|
| Anonymous access to admin APIs | `authenticate` runs on every resource request; `null` gives 401 | ✅ Implemented | `router.test.ts` › 401 without a session |
| User spoofing an admin role | Actor comes only from `authenticate`; headers, query, and body are ignored | ✅ Implemented (depends on host) | › ignores identity claims in headers… |
| Insecure direct object reference / cross-tenant reads | `authorize` receives `recordId`; `get` returns null for out-of-scope records; `filter[tenantId]` is rejected unless declared; the docs recipe ANDs the scope separately | ✅ Contract, recipe, and regression tests | › rejects a client-supplied tenant filter…, › safe pattern…, › cannot read another tenant's records |
| UI hides a control but the API stays open | Server authorization on every operation; no UI exists yet | ✅ Implemented | › 403… even calling the API directly |
| Hanging host integration (session store, policy store, audit DB) | `callbackTimeoutMs` bounds `authenticate` (→ 504), `authorize` (→ deny), and `audit` (→ sink failure); handlers are bounded by `timeoutMs` | ✅ Implemented | `engine.test.ts` › callback timeouts |
| Config changed after validation | Registry stores deeply frozen snapshots; later mutation of the host's objects has no effect | ✅ Implemented | `registry.test.ts` › snapshots definitions… |
| CSRF on a cookie-based admin endpoint | API is GET-only; all writes return 405. Example uses SameSite=Strict and an Origin check on login. | ⚠️ Partial. Needed before actions (RFC-002). | › 405 for write methods |
| XSS in table values | JSON API with `nosniff`; output values are type-checked; the dashboard renders all values as React text (no `innerHTML`); the demo serves a strict CSP with no inline script or style | ✅ Implemented | `AdminApp.test.tsx` › renders untrusted values as text…, `sqlite.test.ts` › strict CSP… |
| SQL injection through filters, sorts, or cursors (host side) | The toolkit validates fields; the example's `runList` maps fields through its own allowlist, binds every value, escapes LIKE wildcards, and validates cursor shape | ✅ Demonstrated in the example (your own queries are your responsibility) | `sqlite.test.ts` › filters with bound parameters…, › rejects forged… cursors |
| Metric results leaking raw data | Metric results are validated to `{ value, previous?, series? }`; unknown keys (e.g. raw rows) are dropped | ✅ Implemented | `metrics.test.ts` › drops unknown keys… |
| Overly broad list/query | Limit 1–100, declared filters and sorts only, timeouts, output limit enforced | ✅ Implemented | `query.test.ts`, `engine.test.ts` |
| Arbitrary privileged command | No actions, shell, SQL, or URL fetch exist; ESLint bans `eval` and `Function` | ✅ By absence | — |
| Unauthorized role escalation | No role-management features exist yet | ➖ Not applicable yet | — |
| Secrets leaking through audit logs | The engine writes only controlled metadata; sensitive-key redaction; primitives only; filter values not logged | ✅ Implemented, with limits (see below) | `audit.test.ts`, › never contains secret fixture values |
| Brute force / abuse | Not built in. Use host middleware (recipe in getting-started.md). | ❌ Open (OA-025) | — |
| Malicious third-party module | Modules are only what the host explicitly passes; no autoloading | ✅ By design | — |
| Broken or tampered published package | `pnpm test:pack` installs the real tarballs into an external app; tarball contents are allowlisted | ✅ Implemented | `scripts/pack-test.mjs` |
| Compromised CI dependency | Actions pinned to commit SHAs; Dependabot; no runtime dependencies in core. Trusted publishing is planned. | ⚠️ Partial (OA-066) | — |

## Cancellation: what timeouts do and don't do

JavaScript can't forcibly stop a promise. OpenAdmin Kit's timeouts therefore bound **how long a request waits**. They don't bound how long your code runs.

| Callback | Bound | On expiry | Is your work stopped? |
|---|---|---|---|
| Resource `list` / `get` | `timeoutMs` (default 10 s) | `504`; `ctx.signal` is aborted | **Only if your handler passes `ctx.signal` on** to its driver or `fetch`, or uses a database statement timeout |
| `authenticate` | `callbackTimeoutMs` (default 5 s) | `504` | No. No signal is passed. Keep session lookups fast or time-boxed. |
| `authorize` | `callbackTimeoutMs` | Deny (`403`) | No |
| `audit` | `callbackTimeoutMs` | Treated as a sink failure (`503` in fail-closed mode) | No. A late write may still land, so events can be stored for requests that already failed. |
| Client disconnect | — | `ctx.signal` is aborted | Same as `list`/`get` |

This is acceptable for read-only operations. **It is not acceptable for writes.** A mutation that times out on our side but finishes in the database would report failure for something that actually happened. RFC-002 (actions) must define idempotency keys and an explicit cancellation contract before any mutating API ships.

## Audit metadata: what redaction can and can't catch

The engine builds every audit event itself, from controlled values: IDs, permission names, counts, error codes, and filter **field names**. Filter values and request bodies are never added.

`redactMetadata` is a second line of defense. It drops keys that look sensitive (`password`, `token`, `secret`, `session`, `cookie`, `auth`, `apiKey`, `card`, …), keeps only primitive values, strips control characters, and truncates strings. **It can't recognize a secret stored under an innocent key** (`{ note: "sk_live_…" }`). If you build events yourself, or extend metadata later:

- allowlist the keys you add, rather than relying on redaction
- never add raw request bodies, headers, query strings, error messages, or stack traces
- treat the audit store as sensitive anyway: restrict who can read it and set a retention period

## Route behavior under the mount point

Not every path is handled the same way:

| Request | Authenticated? | Audited? | Response |
|---|---|---|---|
| `GET /`, `GET /resources/:id`, `GET /resources/:id/:recordId` | Yes | Yes (except `GET /`, see RFC-001 open question 1) | 200 / 400 / 401 / 403 / 404 / 503 / 504 |
| Known path, non-GET method | No | No | `405` with `Allow: GET, HEAD` |
| Any other path | No | No | Generic `404` |

The unauthenticated responses expose no data and don't reveal whether any resource exists: unknown resources return the same `404` to authenticated callers, too. If you need every request to the admin prefix logged, add your own access-log middleware in front of the router.

## Known gaps before any alpha release

1. Independent security review of `engine.ts`, `query.ts`, `registry.ts`, and `audit.ts`.
2. Built-in rate-limit hook (OA-025). Until then, use the middleware recipe.
3. Proxy deployment guide covering `trust proxy` and request-ID trust (OA-026).
4. Trusted publishing with provenance (OA-066).
5. Multi-tenancy is **interface-aware only**. Isolation depends on the host's `list`/`get`/`authorize`. Do not advertise tenant isolation as a toolkit guarantee.
6. Private vulnerability reporting must be **enabled in the GitHub repo settings** before the repo goes public (SECURITY.md points to it).

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
