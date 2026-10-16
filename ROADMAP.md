# Roadmap

Estimates assume part-time work and will slip.

## Done
- [x] Headless core, Express adapter, RFC-001, security tests
- [x] Stabilization pass from the first external review (tenant recipe, callback timeouts, packed install test, CI on `main`, frozen config, typed output)
- [x] Metrics contract and `GET /metrics/:id` (OA-040, OA-041)
- [x] Database-backed example: SQLite, keyset pagination, persisted audit log (review #9)
- [x] React dashboard: navigation, stat strip, charts with table view, tables, record drawer, light/dark, mobile (Phase 3, OA-030–036)
- [x] Audit log viewer with filters, in the example (OA-044)

## Next — before `0.1.0-alpha.1`
- [ ] Commit `.github/` and `.gitignore`, delete `README-placeholder.md`, confirm CI is green on GitHub
- [ ] Enable private vulnerability reporting in GitHub settings
- [ ] Check name and npm scope availability (OA-002)
- [ ] Two outside developers complete the quickstart in under 15 minutes without help (OA-069, review #10)
- [ ] Browser end-to-end tests in CI (Playwright) for login, navigation, filters, and the drawer
- [ ] Rate-limit hook (OA-025) and proxy deployment guide (OA-026)
- [ ] Read-only dogfooding in CompTackle **staging** only

## Later — beta
- [ ] RFC-002: typed allowlisted actions, CSRF requirements, step-up auth hook, idempotency, and a cancellation contract
- [ ] `@openadminkit/testing` (mock actors, contract assertions)
- [ ] Trusted npm publishing with provenance (OA-066)
- [ ] Dashboard: saved views, CSV export with role-scoped fields, and select-style filters for enumerable fields

## Maybe — only if there's demand
Next.js adapter, Prisma/Drizzle recipes, full multi-tenancy contract, plugin registry.
