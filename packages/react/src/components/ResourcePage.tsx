import { useEffect, useMemo, useRef, useState } from 'react';
import type { DescribedResource } from '@openadminkit/core';
import type { AdminClient, AdminRecord } from '../client.js';
import { formatField, humanize } from '../format.js';
import { routeHref, useAsync, useDebounced } from '../hooks.js';
import { Empty, ErrorState, Loading } from './States.js';

type Props = {
  client: AdminClient;
  resource: DescribedResource;
  recordId?: string | undefined;
  onOpenRecord: (id: string) => void;
  onCloseRecord: () => void;
  locale?: string | undefined;
  loginUrl?: string | undefined;
};

const PAGE_SIZES = [10, 25, 50, 100];

function fieldLabel(resource: DescribedResource, key: string) {
  return resource.fields[key]?.label ?? humanize(key);
}

export function ResourcePage({ client, resource, recordId, onOpenRecord, onCloseRecord, locale, loginUrl }: Props) {
  const fieldKeys = Object.keys(resource.fields);
  const filterable = fieldKeys.filter((k) => resource.fields[k]?.filterable);

  // Controls are tagged with the resource they belong to, so switching resources
  // never sends one resource's filters or sort to another (which the API would reject).
  const [controls, setControls] = useState({ resourceId: resource.id, filters: {} as Record<string, string>, sort: null as string | null });
  const current = controls.resourceId === resource.id ? controls : { resourceId: resource.id, filters: {}, sort: null };
  if (controls !== current) setControls(current);
  const debounced = useDebounced(current, 300);
  const filters = debounced.resourceId === resource.id ? debounced.filters : {};
  const filterInput = current.filters;
  const sort = current.sort;
  const [limit, setLimit] = useState(25);

  // Pagination state is keyed by the query. A new query starts on page one immediately,
  // in the same render, instead of first refetching the old cursor.
  const queryKey = JSON.stringify([resource.id, filters, sort, limit]);
  const [pager, setPager] = useState({ key: queryKey, cursors: [null] as (string | null)[], index: 0 });
  const activePager = pager.key === queryKey ? pager : { key: queryKey, cursors: [null], index: 0 };
  if (pager !== activePager) setPager(activePager);
  const pageIndex = activePager.index;
  const cursor = activePager.cursors[pageIndex] ?? null;

  const state = useAsync(
    (signal) => client.list(resource.id, { limit, cursor, sort, filters }, signal),
    [client, queryKey, cursor],
  );

  const setFilterInput = (update: (f: Record<string, string>) => Record<string, string>) =>
    setControls((c) => ({ ...c, resourceId: resource.id, filters: update(c.resourceId === resource.id ? c.filters : {}) }));

  const goNext = () => {
    if (state.status !== 'success' || !state.data.page.nextCursor) return;
    const next = state.data.page.nextCursor;
    setPager((p) => ({ ...p, cursors: [...p.cursors.slice(0, p.index + 1), next], index: p.index + 1 }));
  };
  const goPrev = () => setPager((p) => ({ ...p, index: Math.max(0, p.index - 1) }));

  const toggleSort = (key: string) => {
    setControls((c) => {
      const s = c.resourceId === resource.id ? c.sort : null;
      return { ...c, resourceId: resource.id, sort: s === `-${key}` ? key : s === key ? null : `-${key}` };
    });
  };
  const sortState = (key: string): 'descending' | 'ascending' | 'none' =>
    sort === `-${key}` ? 'descending' : sort === key ? 'ascending' : 'none';

  const rows = state.status === 'success' ? state.data.data : [];
  const total = state.status === 'success' ? state.data.page.total : undefined;
  const first = pageIndex * limit + 1;
  const activeFilters = Object.values(filters).some((v) => v !== '');

  return (
    <div className="oa-resource">
      <section className="oa-panel" aria-labelledby="oa-table-title">
        <header className="oa-panel-head oa-table-head">
          <h2 id="oa-table-title" className="oa-panel-title">{resource.label}</h2>
          {filterable.length > 0 && (
            <form className="oa-filters" role="search" onSubmit={(e) => e.preventDefault()} aria-label={`Filter ${resource.label}`}>
              {filterable.map((key) => (
                <label key={key} className="oa-field">
                  <span className="oa-field-label">{fieldLabel(resource, key)}</span>
                  <input
                    type="search"
                    className="oa-input"
                    value={filterInput[key] ?? ''}
                    placeholder="Any"
                    maxLength={200}
                    autoComplete="off"
                    onChange={(e) => setFilterInput((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </label>
              ))}
            </form>
          )}
        </header>

        {state.status === 'loading' && <Loading label={`Loading ${resource.label}`} rows={6} />}
        {state.status === 'error' && <ErrorState error={state.error} subject={resource.label} onRetry={state.reload} loginUrl={loginUrl} />}
        {state.status === 'success' && rows.length === 0 && (
          <Empty title={activeFilters ? 'Nothing matches these filters' : `No ${resource.label.toLowerCase()} yet`}>
            {activeFilters ? 'Clear a filter to see more results.' : undefined}
          </Empty>
        )}
        {state.status === 'success' && rows.length > 0 && (
          <div className="oa-table-scroll" tabIndex={0} aria-label={`${resource.label} table, scrolls horizontally`}>
            <table className="oa-table">
              <thead>
                <tr>
                  {fieldKeys.map((key) => {
                    const def = resource.fields[key]!;
                    const label = fieldLabel(resource, key);
                    return (
                      <th
                        key={key}
                        scope="col"
                        aria-sort={def.sortable ? sortState(key) : undefined}
                        className={def.type === 'number' ? 'oa-num' : undefined}
                      >
                        {def.sortable ? (
                          <button type="button" className="oa-sort" onClick={() => toggleSort(key)}>
                            {label}
                            <span className="oa-sort-icon" aria-hidden="true">
                              {sortState(key) === 'descending' ? '↓' : sortState(key) === 'ascending' ? '↑' : '↕'}
                            </span>
                          </button>
                        ) : (
                          label
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const id = row[resource.idField];
                  const idText = id === null || id === undefined ? '' : String(id);
                  const openable = resource.supportsGet && idText !== '';
                  return (
                    <tr
                      key={idText || i}
                      className={openable ? 'oa-row--openable' : undefined}
                      aria-selected={recordId === idText || undefined}
                      onClick={openable ? (e) => { if (!(e.target as HTMLElement).closest('a')) onOpenRecord(idText); } : undefined}
                    >
                      {fieldKeys.map((key) => {
                        const def = resource.fields[key]!;
                        const text = formatField(row[key], def.type, locale);
                        return (
                          <td key={key} className={def.type === 'number' ? 'oa-num' : undefined}>
                            {key === resource.idField && openable ? (
                              <a href={routeHref({ page: 'resource', resourceId: resource.id, recordId: idText })}>{text}</a>
                            ) : key === 'status' || key === 'outcome' ? (
                              <span className="oa-tag" data-value={String(row[key] ?? '')}>{text}</span>
                            ) : (
                              text
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {state.status === 'success' && (
          <footer className="oa-pager">
            <span className="oa-pager-summary" aria-live="polite">
              {rows.length > 0
                ? `Rows ${first}–${first + rows.length - 1}${total !== undefined ? ` of ${total.toLocaleString(locale)}` : ''}`
                : ''}
            </span>
            <label className="oa-field oa-field--inline">
              <span className="oa-field-label">Rows per page</span>
              <select className="oa-input" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="oa-pager-buttons">
              <button type="button" className="oa-button" onClick={goPrev} disabled={pageIndex === 0}>Previous</button>
              <button type="button" className="oa-button" onClick={goNext} disabled={!state.data.page.nextCursor}>Next</button>
            </div>
          </footer>
        )}
      </section>

      {recordId !== undefined && resource.supportsGet && (
        <RecordDrawer client={client} resource={resource} recordId={recordId} onClose={onCloseRecord} locale={locale} loginUrl={loginUrl} />
      )}
    </div>
  );
}

function RecordDrawer({
  client,
  resource,
  recordId,
  onClose,
  locale,
  loginUrl,
}: {
  client: AdminClient;
  resource: DescribedResource;
  recordId: string;
  onClose: () => void;
  locale?: string | undefined;
  loginUrl?: string | undefined;
}) {
  const state = useAsync((signal) => client.get(resource.id, recordId, signal), [client, resource.id, recordId]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus();
    };
  }, [onClose]);

  const record: AdminRecord | undefined = state.status === 'success' ? state.data.data : undefined;
  const title = useMemo(() => `${resource.label}: ${recordId}`, [resource.label, recordId]);

  return (
    <>
      <div className="oa-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="oa-drawer" role="dialog" aria-modal="true" aria-labelledby="oa-drawer-title">
        <header className="oa-drawer-head">
          <div>
            <p className="oa-drawer-kicker">{resource.label}</p>
            <h2 id="oa-drawer-title" className="oa-drawer-title">{recordId}</h2>
          </div>
          <button ref={closeRef} type="button" className="oa-button oa-button--icon" onClick={onClose} aria-label={`Close ${title}`}>
            <span aria-hidden="true">×</span>
          </button>
        </header>
        {state.status === 'loading' && <Loading label={`Loading ${title}`} rows={5} />}
        {state.status === 'error' && <ErrorState error={state.error} subject="This record" onRetry={state.reload} loginUrl={loginUrl} />}
        {record && (
          <dl className="oa-details">
            {Object.keys(resource.fields).map((key) => (
              <div key={key} className="oa-detail">
                <dt>{fieldLabel(resource, key)}</dt>
                <dd>{formatField(record[key], resource.fields[key]!.type, locale)}</dd>
              </div>
            ))}
          </dl>
        )}
      </aside>
    </>
  );
}
