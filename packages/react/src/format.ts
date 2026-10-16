import type { FieldType, MetricFormat } from '@openadminkit/core';

export type FormatOptions = { locale?: string | undefined; currency?: string | undefined; compact?: boolean | undefined };

/** Formats a metric value for display. `percent` values are ratios (0.25 → "25%"). */
export function formatMetric(value: number, format: MetricFormat, opts: FormatOptions = {}): string {
  const { locale, currency = 'USD', compact = false } = opts;
  switch (format) {
    case 'currency': {
      const short = compact && Math.abs(value) >= 10_000;
      // Currency styles default to 2 minimum decimals; compact values ("$125K") and
      // whole-number axis ticks ("$8,000") read better without them.
      const whole = short || (compact && Number.isInteger(value));
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        notation: short ? 'compact' : 'standard',
        ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: short ? 1 : 0 } : {}),
      }).format(value);
    }
    case 'percent':
      return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value);
    default:
      return new Intl.NumberFormat(locale, {
        notation: compact && Math.abs(value) >= 100_000 ? 'compact' : 'standard',
        maximumFractionDigits: compact ? 1 : 2,
      }).format(value);
  }
}

export type Delta = { direction: 'up' | 'down' | 'flat'; text: string };

/**
 * Change versus the previous period. Returns null when there's nothing honest to
 * show (no previous value, or a previous value of zero, where a percentage is meaningless).
 * Percent metrics show the change in percentage points.
 */
export function computeDelta(value: number, previous: number | undefined, format: MetricFormat, locale?: string): Delta | null {
  if (previous === undefined) return null;
  const diff = value - previous;
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  if (format === 'percent') {
    const pts = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(diff * 100);
    return { direction, text: `${pts} pts` };
  }
  if (previous === 0) return null;
  const pct = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(diff / Math.abs(previous));
  return { direction, text: pct };
}

/** Formats a record value according to its declared field type. Returns plain text, never markup. */
export function formatField(value: unknown, type: FieldType, locale?: string): string {
  if (value === null || value === undefined) return '—';
  switch (type) {
    case 'boolean':
      return value === true ? 'Yes' : 'No';
    case 'number':
      return typeof value === 'number' ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value) : String(value);
    case 'date': {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return String(value);
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
    }
    default:
      return String(value);
  }
}

/** Shortens ISO dates on chart axes: "2026-10-16" → "Oct 16". Other labels pass through. */
export function formatAxisLabel(x: string, locale?: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) {
    const d = new Date(`${x}T00:00:00Z`);
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
  }
  return x;
}

/** Turns a field key like "createdAt" or "user_id" into "Created at" / "User id". */
export function humanize(key: string): string {
  const spaced = key.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
