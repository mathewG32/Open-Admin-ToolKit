# Security model and current status

OpenAdmin Kit is **pre-alpha** and has **not** had an independent security review. Use the example only with fake data.

## Threat model status (from the blueprint, section 6)

| Threat | Countermeasure | Status | Test |
|---|---|---|---|
| Anonymous access to admin APIs | `authenticate` runs on every request; `null` gives 401 | ✅ Implemented | `router.test.ts` › 401 without a session |
| User spoofing an admin role | Actor comes only from `authenticate`; headers, query, and body are ignored | ✅ Implemented (depends on host) | › ignores identity claims in headers… |
| Insecure direct object reference | `authorize` receives `recordId`; `get` returns null for out-of-scope records | ✅ Contract and example | › cannot read another tenant's records |
| UI hides a control but the API stays open | Server authorization on every operation; no UI exists yet | ✅ Implemented | › 403… even calling the API directly |
| CSRF on a cookie-based admin endpoint | API is GET-only; all writes return 405. Example uses SameSite=Strict and an Origin check on login. | ⚠️ Partial. Needed before actions (RFC-002). | › 405 for write methods |
| XSS in table values | JSON API with `nosniff`; demo page uses `textContent` and a CSP | ⚠️ Dashboard not built yet | — |
| Overly broad list/query | Limit 1–100, declared filters and sorts only, timeouts, output limit enforced | ✅ Implemented | `query.test.ts`, `engine.test.ts` |
| Arbitrary privileged command | No actions, shell, SQL, or URL fetch exist; ESLint bans `eval` and `Function` | ✅ By absence | — |
| Unauthorized role escalation | No role-management features exist yet | ➖ Not applicable yet | — |
| Secrets leaking through audit logs | Sensitive-key redaction, primitives only, filter values not logged | ✅ Implemented | `audit.test.ts`, › never contains secret fixture values |
| Brute force / abuse | Not implemented. Use host middleware such as `express-rate-limit`. | ❌ Open | — |
| Malicious third-party module | Modules are only what the host explicitly passes; no autoloading | ✅ By design | — |
| Compromised published dependency | Zero runtime dependencies in core; Express is a peer dependency. CI provenance is planned. | ⚠️ Partial (OA-066) | — |

## Known gaps before any alpha release

1. Independent security review of `engine.ts`, `query.ts`, and `audit.ts`.
2. Rate-limit hook or documented middleware recipe (OA-025).
3. Proxy deployment guide covering `trust proxy` and request-ID trust (OA-026).
4. Packed-tarball install test, so tests don't only run against workspace symlinks (OA-064).
5. Trusted publishing with provenance (OA-066).
6. Multi-tenancy is **interface-aware only**. Isolation depends entirely on the host's `list`/`get`/`authorize`. Do not advertise tenant isolation as a toolkit guarantee.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
