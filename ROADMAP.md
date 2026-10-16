# Roadmap

Estimates assume part-time work and will slip.

## Now — proof of concept ✅
Headless core, the Express adapter, an example app, security tests, and RFC-001.

## Done — stabilization pass (external review)
- [x] Fix tenant-scoping recipe + regression tests (review #1)
- [x] Bound authenticate/authorize/audit callbacks (review #2)
- [x] Packed-tarball install test outside the monorepo (review #3, OA-064)
- [x] CI on `main`, SHA-pinned actions, Dependabot (review #4)
- [x] Deep-freeze validated definitions (review #5)
- [x] Document timeout vs. cancellation (review #6)
- [x] Output value-type enforcement (review #7)
- [x] Audit metadata guidance (review #8)
- [x] Rate-limit recipe (stopgap for OA-025)

## Next — before `0.1.0-alpha.1`
- [ ] Enable private vulnerability reporting in GitHub settings
- [ ] Phase 0 homework: talk to 3–5 developers; time AdminJS and Refine installs for the same use case (OA-001)
- [ ] Check name and npm scope availability (OA-002)
- [ ] Database-backed example, e.g. SQLite or Postgres via Prisma or Drizzle (review #9)
- [ ] Proxy deployment guide (OA-026)
- [ ] React dashboard shell: navigation from `GET /`, a read-only table, a detail drawer, and metric cards (Phase 3)
- [ ] Two outside developers complete the quickstart in under 15 minutes without help (OA-069, review #10)
- [ ] Read-only dogfooding in CompTackle **staging** only

## Later — beta
- [ ] RFC-002: typed allowlisted actions, CSRF requirements, step-up auth hook, idempotency
- [ ] `@openadminkit/testing` (mock actors, contract assertions)
- [ ] Trusted npm publishing with provenance

## Maybe — only if there's demand
Next.js adapter, Prisma recipes, full multi-tenancy contract, plugin registry.
