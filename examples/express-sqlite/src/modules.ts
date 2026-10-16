import type { DatabaseSync } from 'node:sqlite';
import { defineAdminModule, defineMetric, defineResource, type AdminModule, type MetricPoint } from '@openadminkit/core';
import { runList } from './sql.js';

const DAY = 86_400_000;

/** The last `n` UTC days ending today, as "YYYY-MM-DD". */
function lastDays(now: Date, n: number): string[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * DAY).toISOString().slice(0, 10));
}

/** Fills days with no rows with zero, so charts don't silently skip quiet days. */
function fillDays(days: string[], rows: { day: string; v: number }[]): MetricPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, r.v]));
  return days.map((day) => ({ x: day, y: Math.round((byDay.get(day) ?? 0) * 100) / 100 }));
}

const iso = (ms: number) => new Date(ms).toISOString();

export function createModules(db: DatabaseSync, now: () => Date = () => new Date()): AdminModule[] {
  // ---------------- Customers ----------------

  const users = defineResource({
    id: 'users',
    label: 'Users',
    permissionPrefix: 'users',
    idField: 'id',
    fields: {
      id: { type: 'string', label: 'ID' },
      name: { type: 'string', label: 'Name' },
      email: { type: 'string', label: 'Email', filterable: true },
      plan: { type: 'string', label: 'Plan', filterable: true },
      status: { type: 'string', label: 'Status', filterable: true },
      country: { type: 'string', label: 'Country', filterable: true },
      orders: { type: 'number', label: 'Orders' },
      spent: { type: 'number', label: 'Spent (USD)', sortable: true },
      createdAt: { type: 'date', label: 'Signed up', sortable: true },
    },
    // password_hash and api_token exist in the table but are never selected or declared.
    list: async (_ctx, query) =>
      runList(db, {
        select: `id, name, email, plan, status, country, created_at AS createdAt,
          (SELECT COUNT(*) FROM orders o WHERE o.user_id = users.id) AS orders,
          (SELECT COALESCE(SUM(amount_cents), 0) / 100.0 FROM orders o WHERE o.user_id = users.id AND o.status = 'paid') AS spent`,
        from: 'users',
        idColumn: 'id',
        filters: {
          email: { column: 'email', match: 'prefix' },
          plan: { column: 'plan', match: 'equals' },
          status: { column: 'status', match: 'equals' },
          country: { column: 'country', match: 'equals' },
        },
        sorts: {
          createdAt: 'created_at',
          spent: "(SELECT COALESCE(SUM(amount_cents), 0) FROM orders o WHERE o.user_id = users.id AND o.status = 'paid')",
        },
        defaultSort: { field: 'createdAt', direction: 'desc' },
      }, query),
    get: async (_ctx, id) =>
      (db.prepare(
        `SELECT id, name, email, plan, status, country, created_at AS createdAt,
          (SELECT COUNT(*) FROM orders o WHERE o.user_id = users.id) AS orders,
          (SELECT COALESCE(SUM(amount_cents), 0) / 100.0 FROM orders o WHERE o.user_id = users.id AND o.status = 'paid') AS spent
         FROM users WHERE id = ?`,
      ).get(id) as Record<string, unknown> | undefined) ?? null,
  });

  const orders = defineResource({
    id: 'orders',
    label: 'Orders',
    permissionPrefix: 'orders',
    idField: 'id',
    fields: {
      id: { type: 'string', label: 'Order' },
      userId: { type: 'string', label: 'Customer', filterable: true },
      item: { type: 'string', label: 'Item' },
      amount: { type: 'number', label: 'Amount (USD)', sortable: true },
      status: { type: 'string', label: 'Status', filterable: true },
      createdAt: { type: 'date', label: 'Placed', sortable: true },
    },
    list: async (_ctx, query) =>
      runList(db, {
        select: 'id, user_id AS userId, item, amount_cents / 100.0 AS amount, status, created_at AS createdAt',
        from: 'orders',
        idColumn: 'id',
        filters: { userId: { column: 'user_id', match: 'equals' }, status: { column: 'status', match: 'equals' } },
        sorts: { createdAt: 'created_at', amount: 'amount_cents' },
        defaultSort: { field: 'createdAt', direction: 'desc' },
      }, query),
    get: async (_ctx, id) =>
      (db.prepare('SELECT id, user_id AS userId, item, amount_cents / 100.0 AS amount, status, created_at AS createdAt FROM orders WHERE id = ?')
        .get(id) as Record<string, unknown> | undefined) ?? null,
  });

  // ---------------- Audit log (read from the same table the sink writes) ----------------

  const auditEvents = defineResource({
    id: 'audit-events',
    label: 'Audit log',
    permissionPrefix: 'audit',
    idField: 'eventId',
    fields: {
      timestamp: { type: 'date', label: 'Time', sortable: true },
      actorId: { type: 'string', label: 'Staff', filterable: true },
      action: { type: 'string', label: 'Action', filterable: true },
      outcome: { type: 'string', label: 'Outcome', filterable: true },
      resourceId: { type: 'string', label: 'Record' },
      requestId: { type: 'string', label: 'Request' },
      eventId: { type: 'string', label: 'Event' },
    },
    list: async (_ctx, query) =>
      runList(db, {
        select: 'event_id AS eventId, timestamp, actor_id AS actorId, action, outcome, resource_id AS resourceId, request_id AS requestId',
        from: 'audit_events',
        idColumn: 'event_id',
        filters: {
          actorId: { column: 'actor_id', match: 'equals' },
          action: { column: 'action', match: 'prefix' },
          outcome: { column: 'outcome', match: 'equals' },
        },
        sorts: { timestamp: 'timestamp' },
        defaultSort: { field: 'timestamp', direction: 'desc' },
      }, query),
    get: async (_ctx, id) =>
      (db.prepare('SELECT event_id AS eventId, timestamp, actor_id AS actorId, action, outcome, resource_id AS resourceId, request_id AS requestId FROM audit_events WHERE event_id = ?')
        .get(id) as Record<string, unknown> | undefined) ?? null,
  });

  // ---------------- Metrics: aggregates computed in SQL, never raw rows ----------------

  const count = (sql: string, ...params: string[]) => (db.prepare(sql).get(...params) as { n: number }).n;
  const sum = (sql: string, ...params: string[]) => (db.prepare(sql).get(...params) as { v: number | null }).v ?? 0;
  const daily = (sql: string, ...params: string[]) => db.prepare(sql).all(...params) as { day: string; v: number }[];

  const totalUsers = defineMetric({
    id: 'total-users',
    label: 'Total users',
    description: 'All time',
    permission: 'metrics.read',
    load: async () => {
      const t = now().getTime();
      const days = lastDays(now(), 30);
      const before = count('SELECT COUNT(*) AS n FROM users WHERE created_at < ?', `${days[0]}T00:00:00.000Z`);
      const signups = fillDays(days, daily("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS v FROM users WHERE created_at >= ? GROUP BY day", `${days[0]}T00:00:00.000Z`));
      let running = before;
      const series = signups.map((p) => ({ x: p.x, y: (running += p.y) }));
      return { value: count('SELECT COUNT(*) AS n FROM users WHERE created_at <= ?', iso(t)), previous: before, series };
    },
  });

  const paidShare = defineMetric({
    id: 'paid-share',
    label: 'On a paid plan',
    description: 'Active users on Pro or Team',
    permission: 'metrics.read',
    format: 'percent',
    load: async () => {
      const cutoff = iso(now().getTime() - 30 * DAY);
      const ratio = (extra: string, ...p: string[]) => {
        const all = count(`SELECT COUNT(*) AS n FROM users WHERE status = 'active' ${extra}`, ...p);
        const paid = count(`SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND plan IN ('pro', 'team') ${extra}`, ...p);
        return all === 0 ? 0 : paid / all;
      };
      return { value: ratio(''), previous: ratio('AND created_at < ?', cutoff) };
    },
  });

  const revenue30 = defineMetric({
    id: 'revenue-30d',
    label: 'Revenue',
    description: 'Paid orders, last 30 days',
    permission: 'metrics.revenue',
    format: 'currency',
    currency: 'USD',
    load: async () => {
      const t = now().getTime();
      const days = lastDays(now(), 30);
      const from = `${days[0]}T00:00:00.000Z`;
      const prevFrom = iso(new Date(from).getTime() - 30 * DAY);
      const q = "SELECT SUM(amount_cents) / 100.0 AS v FROM orders WHERE status = 'paid' AND created_at >= ? AND created_at < ?";
      const series = fillDays(days, daily("SELECT substr(created_at, 1, 10) AS day, SUM(amount_cents) / 100.0 AS v FROM orders WHERE status = 'paid' AND created_at >= ? GROUP BY day", from));
      return { value: sum(q, from, iso(t + DAY)), previous: sum(q, prevFrom, from), series };
    },
  });

  const orders30 = defineMetric({
    id: 'orders-30d',
    label: 'Orders',
    description: 'Last 30 days',
    permission: 'metrics.read',
    load: async () => {
      const days = lastDays(now(), 30);
      const from = `${days[0]}T00:00:00.000Z`;
      const prevFrom = iso(new Date(from).getTime() - 30 * DAY);
      const series = fillDays(days, daily('SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS v FROM orders WHERE created_at >= ? GROUP BY day', from));
      return {
        value: count('SELECT COUNT(*) AS n FROM orders WHERE created_at >= ?', from),
        previous: count('SELECT COUNT(*) AS n FROM orders WHERE created_at >= ? AND created_at < ?', prevFrom, from),
        series,
      };
    },
  });

  const revenueDaily = defineMetric({
    id: 'revenue-daily',
    label: 'Daily revenue',
    description: 'Paid orders, last 14 days',
    permission: 'metrics.revenue',
    display: 'bar',
    format: 'currency',
    currency: 'USD',
    load: async () => {
      const days = lastDays(now(), 14);
      const from = `${days[0]}T00:00:00.000Z`;
      const prevFrom = iso(new Date(from).getTime() - 14 * DAY);
      const series = fillDays(days, daily("SELECT substr(created_at, 1, 10) AS day, SUM(amount_cents) / 100.0 AS v FROM orders WHERE status = 'paid' AND created_at >= ? GROUP BY day", from));
      const q = "SELECT SUM(amount_cents) / 100.0 AS v FROM orders WHERE status = 'paid' AND created_at >= ? AND created_at < ?";
      return { value: series.reduce((a, p) => a + p.y, 0), previous: sum(q, prevFrom, from), series };
    },
  });

  const signupsDaily = defineMetric({
    id: 'signups-daily',
    label: 'New signups',
    description: 'Per day, last 30 days',
    permission: 'metrics.read',
    display: 'line',
    load: async () => {
      const days = lastDays(now(), 30);
      const from = `${days[0]}T00:00:00.000Z`;
      const prevFrom = iso(new Date(from).getTime() - 30 * DAY);
      const series = fillDays(days, daily('SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS v FROM users WHERE created_at >= ? GROUP BY day', from));
      return {
        value: series.reduce((a, p) => a + p.y, 0),
        previous: count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?', prevFrom, from),
        series,
      };
    },
  });

  return [
    defineAdminModule({ id: 'customers', label: 'Customers', permissions: ['users.read', 'orders.read'], resources: [users, orders] }),
    defineAdminModule({
      id: 'insights',
      label: 'Insights',
      permissions: ['metrics.read', 'metrics.revenue'],
      resources: [],
      metrics: [totalUsers, revenue30, orders30, paidShare, revenueDaily, signupsDaily],
    }),
    defineAdminModule({ id: 'security', label: 'Security', permissions: ['audit.read'], resources: [auditEvents] }),
  ];
}
