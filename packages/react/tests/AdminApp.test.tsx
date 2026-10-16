// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminClient } from '../src/index.js';

const DESCRIBE = {
  actor: { id: 'staff_admin', roles: ['admin'] },
  requestId: 'r0',
  modules: [
    {
      id: 'users',
      label: 'Customers',
      resources: [{
        id: 'users',
        label: 'Users',
        idField: 'id',
        supportsGet: true,
        fields: {
          id: { type: 'string', label: 'ID' },
          name: { type: 'string', label: 'Name' },
          status: { type: 'string', label: 'Status', filterable: true },
          orders: { type: 'number', label: 'Orders' },
          createdAt: { type: 'date', label: 'Created', sortable: true },
        },
      }],
      metrics: [],
    },
    {
      id: 'insights',
      label: 'Insights',
      resources: [],
      metrics: [
        { id: 'total-users', label: 'Total users', display: 'stat', format: 'number', description: 'All time' },
        { id: 'revenue', label: 'Daily revenue', display: 'bar', format: 'currency', currency: 'USD' },
      ],
    },
  ],
};

const XSS = '<img src=x onerror="window.__pwned=1">';
const ROWS = [
  { id: 'usr_1', name: 'Ana Rivera', status: 'active', orders: 3, createdAt: '2026-10-01T10:00:00.000Z' },
  { id: 'usr_2', name: XSS, status: 'suspended', orders: 0, createdAt: '2026-10-02T10:00:00.000Z' },
];

type Handler = (url: URL) => { status: number; body: unknown };
function mockFetch(overrides: Record<string, Handler> = {}) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    calls.push(url.pathname + url.search);
    const key = Object.keys(overrides).find((k) => url.pathname.endsWith(k));
    let result: { status: number; body: unknown };
    if (key) result = overrides[key]!(url);
    else if (url.pathname === '/api/') result = { status: 200, body: DESCRIBE };
    else if (url.pathname === '/api/metrics/total-users') result = { status: 200, body: { data: { value: 480, previous: 400, series: [{ x: '2026-10-01', y: 1 }, { x: '2026-10-02', y: 3 }] } } };
    else if (url.pathname === '/api/metrics/revenue') result = { status: 200, body: { data: { value: 950, series: [{ x: '2026-10-01', y: 400 }, { x: '2026-10-02', y: 550 }] } } };
    else if (url.pathname === '/api/resources/users') result = { status: 200, body: { data: ROWS, page: { limit: 25, nextCursor: 'c2', total: 48 } } };
    else if (url.pathname === '/api/resources/users/usr_1') result = { status: 200, body: { data: ROWS[0] } };
    else result = { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found.', requestId: 'x' } } };
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

function renderApp(overrides?: Record<string, Handler>) {
  const m = mockFetch(overrides);
  const client = createAdminClient({ apiBase: '/api', fetch: m.fetch });
  render(<AdminApp apiBase="/api" appName="Shelfwise" loginUrl="/login" locale="en-US" client={client} />);
  return m;
}

beforeEach(() => { window.location.hash = ''; });
afterEach(() => cleanup());

describe('AdminApp', () => {
  it('builds navigation from the server and shows who is signed in', async () => {
    renderApp();
    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Users' })).toHaveAttribute('href', '#/r/users');
    // A module with only metrics doesn't get an empty nav group.
    expect(within(nav).queryByText('Insights')).toBeNull();
    expect(screen.getByText('staff_admin')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('renders stats and charts, with a table view for each chart', async () => {
    renderApp();
    expect(await screen.findByText('480')).toBeInTheDocument();
    expect(screen.getByText('+20%')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /Daily revenue, bar chart with 2 values/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    const table = screen.getByRole('table', { name: 'Daily revenue' });
    expect(within(table).getByText('$550.00')).toBeInTheDocument();
  });

  it('renders untrusted values as text, never as markup', async () => {
    window.location.hash = '#/r/users';
    renderApp();
    expect(await screen.findByText(XSS)).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('shows rows, paging summary, and sends filters to the server', async () => {
    window.location.hash = '#/r/users';
    const { calls } = renderApp();
    expect(await screen.findByText('Ana Rivera')).toBeInTheDocument();
    expect(screen.getByText('Rows 1–2 of 48')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Status' }), { target: { value: 'suspended' } });
    await waitFor(() => expect(calls.some((c) => c.includes('filter%5Bstatus%5D=suspended'))).toBe(true));
  });

  it('pages forward with the server cursor and back again', async () => {
    window.location.hash = '#/r/users';
    const { calls } = renderApp();
    await screen.findByText('Ana Rivera');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(calls.some((c) => c.includes('cursor=c2'))).toBe(true));
    expect(await screen.findByText('Rows 26–27 of 48')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('Rows 1–2 of 48')).toBeInTheDocument();
  });

  it('sorts via column headers with aria-sort', async () => {
    window.location.hash = '#/r/users';
    const { calls } = renderApp();
    await screen.findByText('Ana Rivera');
    const header = screen.getByRole('columnheader', { name: /Created/ });
    expect(header).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(within(header).getByRole('button'));
    await waitFor(() => expect(calls.some((c) => c.includes('sort=-createdAt'))).toBe(true));
    expect(screen.getByRole('columnheader', { name: /Created/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('opens a record drawer from the route and closes it with Escape', async () => {
    window.location.hash = '#/r/users/usr_1';
    renderApp();
    const dialog = await screen.findByRole('dialog', { name: 'usr_1' });
    expect(await within(dialog).findByText('Ana Rivera')).toBeInTheDocument();
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.hash).toBe('#/r/users');
  });

  it('asks the user to sign in when the session has ended', async () => {
    renderApp({ '/api/': () => ({ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Authentication required.', requestId: 'r1' } } }) });
    expect(await screen.findByText('Sign in to continue')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('explains a 403 on a resource without offering a pointless retry', async () => {
    window.location.hash = '#/r/users';
    renderApp({ '/api/resources/users': () => ({ status: 403, body: { error: { code: 'FORBIDDEN', message: 'No.', requestId: 'r2' } } }) });
    expect(await screen.findByText('Your role can’t open Users')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByText('r2')).toBeInTheDocument();
  });

  it('treats a section missing from navigation as not found', async () => {
    window.location.hash = '#/r/payments';
    renderApp();
    expect(await screen.findByText('This section wasn’t found')).toBeInTheDocument();
  });
});
