/**
 * A bare-bones test page so you can click through the API in a browser.
 * This is NOT the dashboard (that's Phase 3) — it just calls the JSON API.
 * Values are rendered with textContent, never innerHTML.
 */

export const DEMO_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenAdmin Kit demo</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { max-width: 900px; margin: 2rem auto; padding: 0 16px; line-height: 1.5; }
  fieldset { border: 1px solid #8884; border-radius: 8px; margin: 0 0 1rem; }
  button { font: inherit; padding: .35rem .8rem; margin: .2rem; border-radius: 6px; border: 1px solid #8886; background: transparent; cursor: pointer; }
  button:focus-visible { outline: 2px solid #4a7dff; outline-offset: 2px; }
  pre { background: #8881; padding: 1rem; border-radius: 8px; overflow-x: auto; font-size: 13px; }
  .status { font-weight: 600; }
</style>
</head>
<body>
  <h1>OpenAdmin Kit — Express demo</h1>
  <p>Log in as a demo staff role, then call the admin API. Try a request each role shouldn't be allowed to make.</p>

  <fieldset>
    <legend>Session</legend>
    <button data-login="admin">Log in as admin</button>
    <button data-login="support">Log in as support</button>
    <button data-login="viewer">Log in as viewer</button>
    <button id="logout">Log out</button>
  </fieldset>

  <fieldset>
    <legend>Admin API</legend>
    <button data-get="/internal/admin/api/">Navigation</button>
    <button data-get="/internal/admin/api/resources/users?limit=5">Users (5)</button>
    <button data-get="/internal/admin/api/resources/users?filter[status]=suspended&amp;limit=5">Suspended users</button>
    <button data-get="/internal/admin/api/resources/users/usr_0001">One user</button>
    <button data-get="/internal/admin/api/resources/daily-signups?limit=7&amp;sort=-day">Signups (7 days)</button>
    <button data-get="/internal/admin/api/resources/audit-events?limit=10">Audit log</button>
    <button data-get="/internal/admin/api/resources/users?limit=5000">Bad query</button>
  </fieldset>

  <p class="status" id="status" role="status" aria-live="polite">Not logged in.</p>
  <pre id="out">(responses appear here)</pre>
  <script src="/demo.js"></script>
</body>
</html>`;

export const DEMO_JS = `
const out = document.getElementById('out');
const status = document.getElementById('status');
function show(label, res, body) {
  status.textContent = label + ' → HTTP ' + res.status;
  out.textContent = JSON.stringify(body, null, 2);
}
document.querySelectorAll('[data-login]').forEach((b) => b.addEventListener('click', async () => {
  const res = await fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ as: b.dataset.login }) });
  show('Login as ' + b.dataset.login, res, await res.json());
}));
document.getElementById('logout').addEventListener('click', async () => {
  const res = await fetch('/logout', { method: 'POST' });
  show('Logout', res, await res.json());
});
document.querySelectorAll('[data-get]').forEach((b) => b.addEventListener('click', async () => {
  const res = await fetch(b.dataset.get);
  show('GET ' + b.dataset.get, res, await res.json());
}));
`;
