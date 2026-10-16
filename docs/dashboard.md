# The React dashboard (`@openadminkit/react`)

An optional, read-only admin UI for any OpenAdmin Kit API. If you don't want it, don't install it. The backend works the same without it.

## Install and mount

```bash
pnpm add @openadminkit/react react react-dom
```

```tsx
import { AdminApp } from '@openadminkit/react';
import '@openadminkit/react/styles.css';

export function AdminPage() {
  return (
    <AdminApp
      apiBase="/internal/admin/api"   // where you mounted createExpressAdmin
      appName="My app"
      loginUrl="/login"               // where "Sign in" links go after a 401
      actions={<MySignOutButton />}   // optional extra controls in the top bar
    />
  );
}
```

Put this page behind your own login like any other page. Even if you don't, the API still returns `401`/`403`, and the dashboard explains what happened.

| Prop | Default | Purpose |
|---|---|---|
| `apiBase` | — | Admin API mount path |
| `appName` | `"Admin"` | Sidebar title |
| `logo` | — | Element shown beside the name |
| `loginUrl` | — | Target of "Sign in" buttons |
| `theme` | `"system"` | `"light"`, `"dark"`, or follow the OS |
| `locale` | browser's | Number and date formatting |
| `client` | built from `apiBase` | A custom `createAdminClient({...})` with your own fetch, headers, or credentials |
| `actions` | — | Extra top-bar controls |

Routing uses the URL hash (`#/r/users/usr_0001`), so your server doesn't need any route configuration.

## What each screen does

- **Overview:** metrics with `display: 'stat'` appear in one divided strip, showing the value, the change versus the previous period (an arrow and sign, never color alone), and a sparkline when a series is provided. Metrics with `display: 'bar' | 'line'` get a chart panel with a hover or keyboard tooltip and a **Show as table** toggle.
- **Resource pages:** one text filter per `filterable` field (debounced and sent to the server), sortable column headers for `sortable` fields (`aria-sort`), cursor pagination, and a rows-per-page selector. All filtering and sorting happens on the server.
- **Record drawer:** opens when a resource has `get`. Escape closes it, and focus returns to where you were.
- **States:** every panel loads and fails independently. Errors tell you what to do: sign in (401), ask for access (403), retry (network, 504). They include the request ID for support.

## Theming

All colors, radii, and the font are CSS custom properties on `.oa-app`:

```css
.oa-app {
  --oa-font: "Inter", system-ui, sans-serif;
  --oa-accent: #7c3aed;
  --oa-series-1: #7c3aed;
  --oa-radius: 14px;
}
```

Dark and light are separate palettes, both chosen deliberately. If you change `--oa-series-1`, check its contrast against `--oa-panel` in **both** modes. Chart marks need at least 3:1.

## Content security policy

The dashboard needs no inline scripts, no inline `<style>` blocks, and no `eval`. It works under:

```
default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'
```

The only styles it sets at runtime are positions (tooltip position, skeleton widths) through the DOM style API, which CSP allows.

## Security notes

- Hiding a link is never access control. The sidebar mirrors `GET /`, and every request is authorized again on the server.
- All values render as text. There's no `dangerouslySetInnerHTML`, and a stored `<img onerror>` shows up as literal characters. That's tested in `packages/react/tests/AdminApp.test.tsx`.
- The client sends `credentials: 'same-origin'` by default, so your session cookie only goes to your own origin.

## Building your own UI instead

Everything the dashboard uses is exported: `createAdminClient`, `formatMetric`, `computeDelta`, `BarChart`, `LineChart`, `Sparkline`, `SeriesTable`, `ResourcePage`, `Overview`, and the state components. Or skip the package and call the JSON API directly.
