# @openadminkit/express

Express adapter for [OpenAdmin Kit](https://github.com/mathewG32/openadmin-kit). It mounts authenticated, authorized, and audited read-only admin API routes in your existing Express app.

> Pre-alpha. Not production-ready. See the main repository for the quickstart and security model.

```ts
app.use('/internal/admin/api', createExpressAdmin({ authenticate, authorize, audit, modules }));
```

MIT License
