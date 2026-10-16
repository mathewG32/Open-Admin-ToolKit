import { useState } from 'react';
import type { DescribedMetric } from '@openadminkit/core';
import type { AdminClient } from '../client.js';
import { computeDelta, formatMetric } from '../format.js';
import { useAsync } from '../hooks.js';
import { BarChart, LineChart, SeriesTable, Sparkline } from './Charts.js';
import { Empty, ErrorState, Loading } from './States.js';

type Props = { client: AdminClient; metrics: DescribedMetric[]; locale?: string | undefined; loginUrl?: string | undefined };

function DeltaText({ value, previous, metric, locale }: { value: number; previous: number | undefined; metric: DescribedMetric; locale?: string | undefined }) {
  const delta = computeDelta(value, previous, metric.format, locale);
  if (!delta) return null;
  // Direction is carried by the arrow and the sign, not by color alone.
  const arrow = delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '→';
  return (
    <span className={`oa-delta oa-delta--${delta.direction}`}>
      <span aria-hidden="true">{arrow}</span> {delta.text}
      <span className="oa-delta-note"> vs. previous period</span>
    </span>
  );
}

/** One cell of the stat strip. Each metric loads (and fails) independently. */
function StatCell({ client, metric, locale, loginUrl }: { client: AdminClient; metric: DescribedMetric } & Omit<Props, 'metrics' | 'client'>) {
  const state = useAsync((signal) => client.metric(metric.id, signal), [client, metric.id]);
  return (
    <div className="oa-stat">
      <p className="oa-stat-label">{metric.label}</p>
      {state.status === 'loading' && <Loading label={`Loading ${metric.label}`} rows={1} />}
      {state.status === 'error' && <ErrorState error={state.error} subject={metric.label} onRetry={state.reload} loginUrl={loginUrl} />}
      {state.status === 'success' && (
        <>
          <p className="oa-stat-value">{formatMetric(state.data.data.value, metric.format, { currency: metric.currency, locale, compact: true })}</p>
          <div className="oa-stat-foot">
            <DeltaText value={state.data.data.value} previous={state.data.data.previous} metric={metric} locale={locale} />
            {metric.description && <span className="oa-stat-desc">{metric.description}</span>}
          </div>
          {state.data.data.series && <Sparkline points={state.data.data.series} label={metric.label} />}
        </>
      )}
    </div>
  );
}

function ChartPanel({ client, metric, locale, loginUrl }: { client: AdminClient; metric: DescribedMetric } & Omit<Props, 'metrics' | 'client'>) {
  const state = useAsync((signal) => client.metric(metric.id, signal), [client, metric.id]);
  const [asTable, setAsTable] = useState(false);
  const series = state.status === 'success' ? state.data.data.series ?? [] : [];
  const chartProps = { points: series, format: metric.format, currency: metric.currency, locale, label: metric.label };
  return (
    <section className="oa-panel oa-chart-panel" aria-labelledby={`oa-metric-${metric.id}`}>
      <header className="oa-panel-head">
        <div>
          <h2 id={`oa-metric-${metric.id}`} className="oa-panel-title">{metric.label}</h2>
          {metric.description && <p className="oa-panel-sub">{metric.description}</p>}
        </div>
        {state.status === 'success' && (
          <div className="oa-panel-figure">
            <span className="oa-panel-value">{formatMetric(state.data.data.value, metric.format, { currency: metric.currency, locale })}</span>
            <DeltaText value={state.data.data.value} previous={state.data.data.previous} metric={metric} locale={locale} />
          </div>
        )}
      </header>
      {state.status === 'loading' && <Loading label={`Loading ${metric.label}`} />}
      {state.status === 'error' && <ErrorState error={state.error} subject={metric.label} onRetry={state.reload} loginUrl={loginUrl} />}
      {state.status === 'success' && series.length === 0 && <Empty title="No data for this period yet" />}
      {state.status === 'success' && series.length > 0 && (
        <>
          {asTable ? <SeriesTable {...chartProps} /> : metric.display === 'line' ? <LineChart {...chartProps} /> : <BarChart {...chartProps} />}
          <button type="button" className="oa-link-button" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? 'Show chart' : 'Show as table'}
          </button>
        </>
      )}
    </section>
  );
}

export function Overview({ client, metrics, locale, loginUrl }: Props) {
  if (metrics.length === 0) {
    return (
      <Empty title="No metrics to show">
        Your role doesn’t include any metrics yet. Pick a section from the menu to browse records.
      </Empty>
    );
  }
  const stats = metrics.filter((m) => m.display === 'stat');
  const charts = metrics.filter((m) => m.display !== 'stat');
  return (
    <div className="oa-overview">
      {stats.length > 0 && (
        <section className="oa-stat-strip" aria-label="Key numbers">
          {stats.map((m) => <StatCell key={m.id} client={client} metric={m} locale={locale} loginUrl={loginUrl} />)}
        </section>
      )}
      {charts.length > 0 && (
        <div className="oa-chart-grid-layout">
          {charts.map((m) => <ChartPanel key={m.id} client={client} metric={m} locale={locale} loginUrl={loginUrl} />)}
        </div>
      )}
    </div>
  );
}
