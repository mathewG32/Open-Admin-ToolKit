# Changelog

All notable changes to this project will be documented here. This project will follow [Semantic Versioning](https://semver.org/) from 1.0. Before then, any 0.x release may break APIs, and breaking changes will be listed here.

## [Unreleased] — 0.0.1-prealpha

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
