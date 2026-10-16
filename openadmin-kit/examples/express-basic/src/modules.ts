import { AdminError, defineAdminModule, defineResource, type AuditEvent, type ListQuery } from '@openadminkit/core';
import { USERS, type HostUser } from './data.js';

/** Offset cursors are fine for a demo. Real apps should prefer keyset cursors. */
function page<T>(rows: readonly T[], query: ListQuery) {
  const offset = query.cursor === undefined ? 0 : Number(query.cursor);
  if (!Number.isInteger(offset) || offset < 0) throw new AdminError('BAD_REQUEST', 'Invalid cursor.');
  const items = rows.slice(offset, offset + query.limit);
  const next = offset + query.limit < rows.length ? String(offset + query.limit) : null;
  return { items, nextCursor: next, total: rows.length };
}

// ---------------- Users ----------------

const usersResource = defineResource<HostUser>({
  id: 'users',
  label: 'Users',
  permissionPrefix: 'users',
  idField: 'id',
  // Only these fields ever leave the server. passwordHash/resetToken are not declared.
  fields: {
    id: { type: 'string', label: 'ID' },
    email: { type: 'string', label: 'Email', filterable: true },
    displayName: { type: 'string', label: 'Name' },
    plan: { type: 'string', label: 'Plan', filterable: true },
    status: { type: 'string', label: 'Status', filterable: true },
    createdAt: { type: 'date', label: 'Created', sortable: true },
  },
  async list(_ctx, query) {
    // In a real app, translate query.filters/sort into your ORM/SQL with parameters.
    let rows = USERS.filter((u) => Object.entries(query.filters).every(([field, value]) => String(u[field as keyof HostUser]) === value));
    if (query.sort) {
      const dir = query.sort.direction === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) * dir);
    }
    return page(rows, query);
  },
  async get(_ctx, id) {
    return USERS.find((u) => u.id === id) ?? null;
  },
});

export const usersModule = defineAdminModule({
  id: 'users',
  label: 'Users',
  permissions: ['users.read'],
  resources: [usersResource],
});

// ---------------- Metrics ----------------

type SignupDay = { day: string; signups: number; proSignups: number };

const dailySignups = defineResource<SignupDay>({
  id: 'daily-signups',
  label: 'Daily signups',
  permissionPrefix: 'metrics',
  idField: 'day',
  fields: {
    day: { type: 'string', label: 'Day', sortable: true },
    signups: { type: 'number', label: 'Signups' },
    proSignups: { type: 'number', label: 'Pro signups' },
  },
  // The host supplies already-computed aggregates. No raw user rows are exposed here.
  async list(_ctx, query) {
    const byDay = new Map<string, SignupDay>();
    for (const u of USERS) {
      const day = u.createdAt.toISOString().slice(0, 10);
      const row = byDay.get(day) ?? { day, signups: 0, proSignups: 0 };
      row.signups++;
      if (u.plan === 'pro') row.proSignups++;
      byDay.set(day, row);
    }
    let rows = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
    if (query.sort?.direction === 'desc') rows = rows.reverse();
    return page(rows, query);
  },
});

export const metricsModule = (enabled: boolean) =>
  defineAdminModule({
    id: 'metrics',
    label: 'Metrics',
    permissions: ['metrics.read'],
    resources: [dailySignups],
    enabled,
  });

// ---------------- Audit log viewer ----------------

/** Exposes the demo's in-memory audit events as a read-only resource (admin only). */
export function auditModule(events: readonly AuditEvent[]) {
  const resource = defineResource<AuditEvent>({
    id: 'audit-events',
    label: 'Audit events',
    permissionPrefix: 'audit',
    idField: 'eventId',
    fields: {
      eventId: { type: 'string', label: 'Event' },
      timestamp: { type: 'string', label: 'Time', sortable: true },
      actorId: { type: 'string', label: 'Actor', filterable: true },
      action: { type: 'string', label: 'Action', filterable: true },
      outcome: { type: 'string', label: 'Outcome', filterable: true },
      resourceType: { type: 'string', label: 'Resource' },
      resourceId: { type: 'string', label: 'Record' },
      requestId: { type: 'string', label: 'Request' },
    },
    async list(_ctx, query) {
      // Newest first by default.
      let rows = [...events].reverse();
      rows = rows.filter((e) => Object.entries(query.filters).every(([k, v]) => String(e[k as keyof AuditEvent]) === v));
      if (query.sort?.direction === 'asc') rows = rows.reverse();
      return page(rows, query);
    },
    async get(_ctx, id) {
      return events.find((e) => e.eventId === id) ?? null;
    },
  });
  return defineAdminModule({ id: 'audit', label: 'Audit log', permissions: ['audit.read'], resources: [resource] });
}
