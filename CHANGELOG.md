# Changelog

All notable changes to this project will be documented here. This project will follow [Semantic Versioning](https://semver.org/) from 1.0. Before then, any 0.x release may break APIs, and breaking changes will be listed here.

## [Unreleased] — 0.0.1-prealpha

### Added: dashboard, metrics, and SQLite demo
- **`@openadminkit/react`**: an optional dashboard driven entirely by `GET /`. It has a stat strip with sparklines and change versus the previous period, bar and line charts with hover and keyboard tooltips and a table view, resource tables with server-side filters, sorting, and keyset pagination, a record drawer, and per-panel loading and error states. Dark and light themes use `--oa-*` tokens and work under a strict CSP.
- **Metrics contract (core + express):** `defineMetric({ id, label, permission, display, format, currency, load })` and `GET /metrics/:id`. Results are strictly validated (`value`, optional `previous`, `series` of at most 1000 points), unknown keys are dropped, and access is authorized with `target.kind = 'metric'` and audited. `describe` now lists metrics per module.
- **`examples/express-sqlite`** (`pnpm demo`): a fictional SaaS on Node's built-in SQLite with 480 customers and their orders, three staff roles, parameterized SQL through an allowlisted list builder (`sql.ts`), keyset cursors, a LIKE-escaped prefix search, an audit log persisted to a table and readable in the dashboard, SQL-computed metrics, and a strict CSP. It has 21 tests, including SQL-injection, cursor-forgery, and live role-change checks.
- The pack test now packs and installs all three packages, and server-renders `AdminApp` from the installed tarball.

### Changed
- Minimum Node is now **22.13** (Node 20 reached end-of-life in April 2026, and built-in SQLite needs 22.13+). The CI matrix is 22 and 24.

### Security
- **Docs (P0):** the tenant-scoping recipe in `getting-started.md` spread `...query.filters` over the tenant condition, so it could be overridden by `filter[tenantId]` when that field was declared filterable. The recipe now ANDs the server scope separately and fails closed without a tenant. Regression tests were added for both the rejected filter and the safe pattern.
- `authenticate`, `authorize`, and `audit` are now bounded by `callbackTimeoutMs` (default 5000). On a hang, authenticate returns 504, authorize denies, and audit is treated as a sink failure.
- The registry now stores deeply frozen snapshots of validated modules, resources, and fields. Mutating the original objects after startup no longer changes behavior.

### Changed (breaking)
- `sanitizeRecord` now enforces declared field types. Mismatched values are returned as `null` (previously a string in a `number` field passed through, and objects were omitted). `date` fields also accept parseable strings and always return ISO-8601 UTC. Mismatches are reported once per field per request via `onInternalError`.

### Added
- `scripts/pack-test.mjs` / `pnpm test:pack`: packs both packages, allowlists tarball contents, installs them with npm into an app outside the repo, typechecks a TypeScript consumer, and makes real HTTP requests.
- Per-package README and LICENSE files, so the tarballs ship them.
- `docs/security.md`: cancellation contract, audit-metadata guidance, route-behavior table, and a rate-limit recipe.
- Dependabot for GitHub Actions and npm.

### Fixed
- CI now runs on the repository's `main` branch. Actions are pinned to commit SHAs, and CI runs the pack test.

## Initial proof of concept

### Added
- `@openadminkit/core`: module registry with startup validation, deny-by-default `checkPermission`, `createRolePolicy`, bounded `parseListQuery`, field-allowlist `sanitizeRecord`, safe error model, audit event builder with redaction, and the `createAdminEngine` request pipeline with timeouts and fail-closed auditing.
- `@openadminkit/express`: `createExpressAdmin` router with describe/list/get routes, request IDs, no-store headers, and 405 for write methods.
- `examples/express-basic`: cookie-session demo with admin/support/viewer roles, fake users, a daily-signups metric, and an audit log viewer.
- RFC-001 (core contracts), getting-started guide, security status doc, and CI workflow.
