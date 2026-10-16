# Changelog

All notable changes to this project will be documented here. This project will follow [Semantic Versioning](https://semver.org/) from 1.0. Before then, any 0.x release may break APIs, and breaking changes will be listed here.

## [Unreleased] — 0.0.1-prealpha

### Added
- `@openadminkit/core`: module registry with startup validation, deny-by-default `checkPermission`, `createRolePolicy`, bounded `parseListQuery`, field-allowlist `sanitizeRecord`, safe error model, audit event builder with redaction, and the `createAdminEngine` request pipeline with timeouts and fail-closed auditing.
- `@openadminkit/express`: `createExpressAdmin` router with describe/list/get routes, request IDs, no-store headers, and 405 for write methods.
- `examples/express-basic`: cookie-session demo with admin/support/viewer roles, fake users, a daily-signups metric, and an audit log viewer.
- RFC-001 (core contracts), getting-started guide, security status doc, and CI workflow.
