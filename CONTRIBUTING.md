# Contributing

Thanks for your interest! OpenAdmin Kit is early, so the most useful contributions right now are **trying the quickstart and reporting where it was confusing**.

## Setup

```bash
pnpm install
pnpm check      # build + typecheck + lint + test
pnpm demo       # http://localhost:3000 (SQLite + dashboard)
```

Node 22.13+ and pnpm 9+ are required.

## Ground rules

- **Security first.** Every new code path must deny by default. A PR that adds an endpoint or operation needs a negative test showing that unauthenticated and unauthorized requests fail and that the host handler is **never called**.
- **No arbitrary execution.** PRs that add generic SQL, shell, `eval`, or URL-fetch features will be closed.
- **Core stays dependency-free.** `@openadminkit/core` must not import Express, React, or any ORM.
- **Docs and tests ship with code.** If public behavior changes, update `CHANGELOG.md` and the relevant doc in `docs/`.

## Pull requests

1. Open an issue first for anything bigger than a bug fix.
2. Keep PRs focused, with one concern each.
3. Fill in the PR template, including the **security implications** section.
4. Security-sensitive changes (anything in `engine.ts`, `permissions.ts`, `query.ts`, `audit.ts`, or the Express router) need a maintainer review and are never auto-merged.

## Reporting bugs

Include a minimal reproduction: an Express snippet, the request, the expected status, and the actual status. For auth-related bugs, describe your session setup (cookie, JWT, provider).

For security issues, see [SECURITY.md](SECURITY.md). Do not file public issues.
