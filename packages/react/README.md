# @openadminkit/react

Optional React dashboard for [OpenAdmin Kit](https://github.com/mathewG32/openadmin-kit). It includes navigation, metric tiles and charts, tables with server-side filters, sorting, and pagination, and record details.

> Pre-alpha. Not production-ready. See the main repository for the security model.

```tsx
import { AdminApp } from '@openadminkit/react';
import '@openadminkit/react/styles.css';

<AdminApp apiBase="/internal/admin/api" appName="My app" loginUrl="/login" />
```

What the dashboard shows comes from the server's `GET /` response, which only lists what the signed-in role can read. The UI never decides access. The API checks every request.

Theme it by overriding `--oa-*` CSS variables on `.oa-app`.

MIT License
