import {
  createMemoryAuditSink,
  defineAdminModule,
  defineResource,
  type AdminActor,
  type AdminModule,
  type ListQuery,
} from '../src/index.js';

export const admin: AdminActor = { id: 'u-admin', roles: ['admin'] };
export const support: AdminActor = { id: 'u-support', roles: ['support'] };
export const nobody: AdminActor = { id: 'u-nobody', roles: [] };

export type UserRow = {
  id: string;
  email: string;
  status: 'active' | 'suspended';
  createdAt: Date;
  passwordHash: string;
  apiToken: string;
};

export const USERS: UserRow[] = Array.from({ length: 150 }, (_, i) => ({
  id: `user-${String(i + 1).padStart(3, '0')}`,
  email: `person${i + 1}@example.test`,
  status: i % 5 === 0 ? 'suspended' : 'active',
  createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
  passwordHash: `$argon2id$SECRET-HASH-${i}`,
  apiToken: `tok_SECRET_${i}`,
}));

/** A minimal, offset-cursor in-memory provider. Records `lastQuery` for assertions. */
export function makeUsersModule(overrides: Partial<AdminModule> = {}) {
  const calls = { list: 0, get: 0, lastQuery: undefined as ListQuery | undefined };
  const usersResource = defineResource<UserRow>({
    id: 'users',
    label: 'Users',
    permissionPrefix: 'users',
    idField: 'id',
    fields: {
      id: { type: 'string' },
      email: { type: 'string', filterable: true },
      status: { type: 'string', filterable: true },
      createdAt: { type: 'date', sortable: true },
    },
    async list(_ctx, query) {
      calls.list++;
      calls.lastQuery = query;
      let rows = USERS.filter((u) => Object.entries(query.filters).every(([k, v]) => String(u[k as keyof UserRow]) === v));
      if (query.sort?.field === 'createdAt') {
        rows = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        if (query.sort.direction === 'desc') rows.reverse();
      }
      const offset = query.cursor ? Number(query.cursor) : 0;
      const page = rows.slice(offset, offset + query.limit);
      const next = offset + query.limit < rows.length ? String(offset + query.limit) : null;
      return { items: page, nextCursor: next };
    },
    async get(_ctx, id) {
      calls.get++;
      return USERS.find((u) => u.id === id) ?? null;
    },
  });
  const module = defineAdminModule({
    id: 'users',
    label: 'Users',
    permissions: ['users.read'],
    resources: [usersResource],
    ...overrides,
  });
  return { module, calls };
}

export function memoryAudit() {
  return createMemoryAuditSink();
}
