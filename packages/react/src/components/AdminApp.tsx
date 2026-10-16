import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DescribedResource } from '@openadminkit/core';
import { AdminClientError, createAdminClient, type AdminClient } from '../client.js';
import { useAsync, useHashRoute, routeHref } from '../hooks.js';
import { Overview } from './Overview.js';
import { ResourcePage } from './ResourcePage.js';
import { ErrorState, Loading } from './States.js';

export type AdminAppProps = {
  /** Where the OpenAdmin Kit router is mounted, e.g. "/internal/admin/api". */
  apiBase: string;
  /** Shown at the top of the sidebar. */
  appName?: string;
  /** Optional logo element shown beside the app name. */
  logo?: React.ReactNode;
  /** Where "Sign in" links point when the session has ended. */
  loginUrl?: string;
  /** "system" (default) follows the OS setting. */
  theme?: 'system' | 'light' | 'dark';
  /** BCP 47 locale for numbers and dates. Defaults to the browser's. */
  locale?: string;
  /** Supply your own client (custom fetch, headers, credentials). */
  client?: AdminClient;
  /** Extra controls for the top bar, such as your own sign-out button. */
  actions?: React.ReactNode;
};

/**
 * A complete read-only admin dashboard for an OpenAdmin Kit API.
 *
 * What it shows is decided by the server: navigation comes from `GET /`, which
 * only lists what the signed-in role can read. Hiding something here never
 * grants or removes access. The API enforces that on every request.
 */
export function AdminApp({ apiBase, appName = 'Admin', logo, loginUrl, theme = 'system', locale, client: providedClient, actions }: AdminAppProps) {
  const client = useMemo(() => providedClient ?? createAdminClient({ apiBase }), [providedClient, apiBase]);
  const nav = useAsync((signal) => client.describe(signal), [client]);
  const [route, navigate] = useHashRoute();
  const [menuOpen, setMenuOpen] = useState(false);

  const resources = useMemo(() => {
    const map = new Map<string, DescribedResource>();
    if (nav.status === 'success') for (const m of nav.data.modules) for (const r of m.resources) map.set(r.id, r);
    return map;
  }, [nav]);
  const metrics = useMemo(() => (nav.status === 'success' ? nav.data.modules.flatMap((m) => m.metrics ?? []) : []), [nav]);

  const activeResource = route.page === 'resource' ? resources.get(route.resourceId) : undefined;
  const pageTitle = route.page === 'overview' ? 'Overview' : activeResource?.label ?? 'Not found';

  useEffect(() => {
    if (typeof document !== 'undefined') document.title = `${pageTitle} – ${appName}`;
  }, [pageTitle, appName]);

  // Close the mobile menu whenever the page changes.
  useEffect(() => setMenuOpen(false), [route]);

  const onOpenRecord = useCallback(
    (id: string) => { if (route.page === 'resource') navigate({ page: 'resource', resourceId: route.resourceId, recordId: id }); },
    [navigate, route],
  );
  const onCloseRecord = useCallback(
    () => { if (route.page === 'resource') navigate({ page: 'resource', resourceId: route.resourceId }); },
    [navigate, route],
  );

  const themeAttr = theme === 'system' ? undefined : theme;

  if (nav.status === 'loading') {
    return (
      <div className="oa-app oa-app--center" data-theme={themeAttr}>
        <Loading label="Loading your admin workspace" />
      </div>
    );
  }
  if (nav.status === 'error') {
    return (
      <div className="oa-app oa-app--center" data-theme={themeAttr}>
        <div className="oa-panel oa-gate">
          <ErrorState error={nav.error} subject="the admin workspace" onRetry={nav.reload} loginUrl={loginUrl} />
        </div>
      </div>
    );
  }

  const { actor, modules } = nav.data;
  const isCurrent = (href: string) => (routeHref(route.page === 'resource' ? { page: 'resource', resourceId: route.resourceId } : route) === href ? 'page' : undefined);

  return (
    <div className="oa-app" data-theme={themeAttr} data-menu={menuOpen ? 'open' : undefined}>
      <a className="oa-skip" href="#oa-main">Skip to content</a>
      <aside className="oa-sidebar" aria-label="Admin sections">
        <div className="oa-brand">
          {logo}
          <span className="oa-brand-name">{appName}</span>
        </div>
        <nav className="oa-nav">
          <a className="oa-nav-link" href="#/" aria-current={isCurrent('#/')}>Overview</a>
          {modules.filter((m) => m.resources.length > 0).map((m) => (
            <div key={m.id} className="oa-nav-group">
              <p className="oa-nav-heading">{m.label}</p>
              {m.resources.map((r) => {
                const href = routeHref({ page: 'resource', resourceId: r.id });
                return <a key={r.id} className="oa-nav-link" href={href} aria-current={isCurrent(href)}>{r.label}</a>;
              })}
            </div>
          ))}
        </nav>
        <p className="oa-sidebar-note">You see the sections your role can read.</p>
      </aside>

      <div className="oa-main-col">
        <header className="oa-topbar">
          <button
            type="button"
            className="oa-button oa-button--icon oa-menu-button"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span aria-hidden="true">{menuOpen ? '×' : '≡'}</span>
          </button>
          <h1 className="oa-page-title">{pageTitle}</h1>
          <div className="oa-identity" aria-label="Signed in as">
            <span className="oa-identity-id">{actor.id}</span>
            <span className="oa-identity-roles">
              {actor.roles.length > 0 ? actor.roles.map((r) => <span key={r} className="oa-role">{r}</span>) : <span className="oa-role">no roles</span>}
            </span>
          </div>
          {actions}
        </header>

        <main id="oa-main" className="oa-main" tabIndex={-1}>
          {route.page === 'overview' && <Overview client={client} metrics={metrics} locale={locale} loginUrl={loginUrl} />}
          {route.page === 'resource' && activeResource && (
            <ResourcePage
              key={activeResource.id}
              client={client}
              resource={activeResource}
              recordId={route.recordId}
              onOpenRecord={onOpenRecord}
              onCloseRecord={onCloseRecord}
              locale={locale}
              loginUrl={loginUrl}
            />
          )}
          {route.page === 'resource' && !activeResource && (
            <div className="oa-panel oa-gate">
              <ErrorState error={new AdminClientError(404, 'NOT_FOUND', 'Not found.')} subject="This section" />
              <p className="oa-error-body"><a href="#/">Back to overview</a></p>
            </div>
          )}
        </main>
      </div>
      <div className="oa-menu-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
    </div>
  );
}
