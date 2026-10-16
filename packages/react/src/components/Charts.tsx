import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { MetricFormat, MetricPoint } from '@openadminkit/core';
import { formatAxisLabel, formatMetric } from '../format.js';
import { useElementWidth } from '../hooks.js';

type ChartProps = {
  points: readonly MetricPoint[];
  format: MetricFormat;
  currency?: string | undefined;
  locale?: string | undefined;
  /** Accessible name, usually the metric label. */
  label: string;
  height?: number;
};

const PAD = { top: 12, right: 8, bottom: 26, left: 52 };

/** "Nice" axis maximum and 4 evenly spaced ticks starting at zero. */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1, 2, 3, 4];
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag;
  return [0, 1, 2, 3, 4].map((i) => i * step);
}

/** Indices of x labels to show so they don't collide (~1 label per 70px). */
function labelIndices(n: number, innerWidth: number): Set<number> {
  const maxLabels = Math.max(2, Math.floor(innerWidth / 70));
  const every = Math.max(1, Math.ceil(n / maxLabels));
  const out = new Set<number>();
  let lastShown = 0;
  for (let i = 0; i < n; i += every) {
    out.add(i);
    lastShown = i;
  }
  // Always label the most recent point; drop the previous label if it's closer than the usual spacing.
  if (n > 1 && lastShown !== n - 1) {
    if (n - 1 - lastShown < every && lastShown !== 0) out.delete(lastShown);
    out.add(n - 1);
  }
  return out;
}

/** Path for a bar whose top corners are rounded (4px) and whose base sits flat on the axis. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  if (h <= 0) return '';
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function useChartModel(points: readonly MetricPoint[], width: number, height: number) {
  return useMemo(() => {
    const innerW = Math.max(40, width - PAD.left - PAD.right);
    const innerH = Math.max(40, height - PAD.top - PAD.bottom);
    const max = Math.max(0, ...points.map((p) => p.y));
    const ticks = niceTicks(max);
    const top = ticks[ticks.length - 1] || 1;
    const y = (v: number) => PAD.top + innerH - (Math.max(0, v) / top) * innerH;
    return { innerW, innerH, ticks, y, labels: labelIndices(points.length, innerW) };
  }, [points, width, height]);
}

function ChartFrame(props: {
  children: React.ReactNode;
  model: ReturnType<typeof useChartModel>;
  width: number;
  height: number;
  points: readonly MetricPoint[];
  xAt: (i: number) => number;
  format: MetricFormat;
  currency?: string | undefined;
  locale?: string | undefined;
}) {
  const { model, width, height, points, xAt, format, currency, locale } = props;
  return (
    <>
      <g className="oa-chart-grid" aria-hidden="true">
        {model.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={model.y(t)} y2={model.y(t)} />
            <text x={PAD.left - 8} y={model.y(t)} dy="0.32em" textAnchor="end">
              {formatMetric(t, format, { currency, locale, compact: true })}
            </text>
          </g>
        ))}
      </g>
      {props.children}
      <g className="oa-chart-axis" aria-hidden="true">
        {points.map((p, i) =>
          model.labels.has(i) ? (
            <text key={p.x + i} x={xAt(i)} y={height - 6} textAnchor="middle">
              {formatAxisLabel(p.x, locale)}
            </text>
          ) : null,
        )}
      </g>
    </>
  );
}

function Tooltip({ point, left, format, currency, locale }: { point: MetricPoint; left: number; format: MetricFormat; currency?: string | undefined; locale?: string | undefined }) {
  return (
    <div className="oa-tooltip" style={{ left }} role="status">
      <span className="oa-tooltip-x">{formatAxisLabel(point.x, locale)}</span>
      <span className="oa-tooltip-y">{formatMetric(point.y, format, { currency, locale })}</span>
    </div>
  );
}

/** Arrow keys move the highlighted point; Escape clears it. */
function useActiveIndex(n: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    if (n === 0) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); setActive((a) => (a === null ? 0 : Math.min(n - 1, a + 1))); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setActive((a) => (a === null ? n - 1 : Math.max(0, a - 1))); }
    else if (e.key === 'Escape') setActive(null);
  };
  return { active, setActive, onKeyDown };
}

export function BarChart({ points, format, currency, locale, label, height = 240 }: ChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const model = useChartModel(points, width, height);
  const { active, setActive, onKeyDown } = useActiveIndex(points.length);
  const band = model.innerW / Math.max(1, points.length);
  // Bars stay thin, and always leave at least a 2px surface gap between neighbours.
  const barW = Math.max(2, Math.min(24, band * 0.62, band - 2));
  const xAt = (i: number) => PAD.left + band * i + band / 2;

  return (
    <div className="oa-chart" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${label}, bar chart with ${points.length} values. Use arrow keys to read values.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
      >
        <ChartFrame model={model} width={width} height={height} points={points} xAt={xAt} format={format} currency={currency} locale={locale}>
          <g className="oa-bars">
            {points.map((p, i) => {
              const yTop = model.y(p.y);
              return (
                <path
                  key={p.x + i}
                  d={barPath(xAt(i) - barW / 2, yTop, barW, PAD.top + model.innerH - yTop)}
                  className={active === null || active === i ? 'oa-bar' : 'oa-bar oa-bar--dim'}
                />
              );
            })}
          </g>
          <line className="oa-baseline" x1={PAD.left} x2={width - PAD.right} y1={PAD.top + model.innerH} y2={PAD.top + model.innerH} />
          {/* Hit targets: the full column, bigger than the mark. */}
          {points.map((p, i) => (
            <rect
              key={`hit-${p.x}-${i}`}
              className="oa-hit"
              x={PAD.left + band * i}
              y={PAD.top}
              width={band}
              height={model.innerH}
              onMouseEnter={() => setActive(i)}
            />
          ))}
        </ChartFrame>
      </svg>
      {active !== null && points[active] && (
        <Tooltip point={points[active]} left={Math.min(Math.max(xAt(active), 60), width - 60)} format={format} currency={currency} locale={locale} />
      )}
    </div>
  );
}

export function LineChart({ points, format, currency, locale, label, height = 240 }: ChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const model = useChartModel(points, width, height);
  const { active, setActive, onKeyDown } = useActiveIndex(points.length);
  const step = points.length > 1 ? model.innerW / (points.length - 1) : 0;
  const xAt = (i: number) => (points.length > 1 ? PAD.left + step * i : PAD.left + model.innerW / 2);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${model.y(p.y).toFixed(1)}`).join('');

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const i = step > 0 ? Math.round((x - PAD.left) / step) : 0;
    setActive(Math.max(0, Math.min(points.length - 1, i)));
  };

  const activePoint = active !== null ? points[active] : undefined;
  return (
    <div className="oa-chart" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${label}, line chart with ${points.length} values. Use arrow keys to read values.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseMove={onMove}
        onMouseLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
      >
        <ChartFrame model={model} width={width} height={height} points={points} xAt={xAt} format={format} currency={currency} locale={locale}>
          <line className="oa-baseline" x1={PAD.left} x2={width - PAD.right} y1={PAD.top + model.innerH} y2={PAD.top + model.innerH} />
          {activePoint && active !== null && (
            <line className="oa-crosshair" x1={xAt(active)} x2={xAt(active)} y1={PAD.top} y2={PAD.top + model.innerH} />
          )}
          <path className="oa-line" d={d} />
          {activePoint && active !== null && (
            <circle className="oa-marker" cx={xAt(active)} cy={model.y(activePoint.y)} r={4.5} />
          )}
        </ChartFrame>
      </svg>
      {activePoint && active !== null && (
        <Tooltip point={activePoint} left={Math.min(Math.max(xAt(active), 60), width - 60)} format={format} currency={currency} locale={locale} />
      )}
    </div>
  );
}

/** A small trend line for stat tiles. Decorative: the tile's text carries the value. */
export function Sparkline({ points, label }: { points: readonly MetricPoint[]; label: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>(120);
  const h = 36;
  if (points.length < 2) return null;
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const x = (i: number) => 2 + ((width - 4) * i) / (points.length - 1);
  const y = (v: number) => 3 + (h - 6) * (1 - (v - min) / span);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  const last = points[points.length - 1]!;
  return (
    <div className="oa-sparkline" ref={ref} aria-hidden="true" title={`${label} trend`}>
      <svg width={width} height={h}>
        <path d={d} />
        <circle cx={x(points.length - 1)} cy={y(last.y)} r={2.5} />
      </svg>
    </div>
  );
}

/** The same data as an accessible table: the non-visual (and copyable) view of every chart. */
export function SeriesTable({ points, format, currency, locale, label }: ChartProps) {
  const id = useId();
  return (
    <div className="oa-series-table">
      <table aria-labelledby={id}>
        <caption id={id}>{label}</caption>
        <thead>
          <tr><th scope="col">Period</th><th scope="col">Value</th></tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.x + i}>
              <td>{formatAxisLabel(p.x, locale)}</td>
              <td>{formatMetric(p.y, format, { currency, locale })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
