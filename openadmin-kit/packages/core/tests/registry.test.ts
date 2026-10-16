import { describe, expect, it } from 'vitest';
import { createRegistry, defineAdminModule, defineResource, RegistryError, type AdminModule } from '../src/index.js';
import { makeUsersModule } from './fixtures.js';

const metricsModule = defineAdminModule({
  id: 'metrics',
  label: 'Metrics',
  permissions: ['metrics.read'],
  resources: [
    defineResource({
      id: 'daily-signups',
      label: 'Daily signups',
      permissionPrefix: 'metrics',
      idField: 'day',
      fields: { day: { type: 'string' }, count: { type: 'number' } },
      list: async () => ({ items: [] }),
    }),
  ],
});

describe('createRegistry', () => {
  it('registers enabled modules and indexes resources', () => {
    const reg = createRegistry([makeUsersModule().module, metricsModule]);
    expect(reg.modules.map((m) => m.id)).toEqual(['users', 'metrics']);
    expect(reg.getResource('users')?.readPermission).toBe('users.read');
    expect(reg.getResource('daily-signups')?.module.id).toBe('metrics');
  });

  it('removes disabled modules completely', () => {
    const reg = createRegistry([makeUsersModule({ enabled: false }).module, metricsModule]);
    expect(reg.modules.map((m) => m.id)).toEqual(['metrics']);
    expect(reg.getResource('users')).toBeUndefined();
    expect(reg.listResources().map((r) => r.resource.id)).toEqual(['daily-signups']);
  });

  it('does not resolve prototype keys as resources', () => {
    const reg = createRegistry([makeUsersModule().module]);
    expect(reg.getResource('__proto__')).toBeUndefined();
    expect(reg.getResource('constructor')).toBeUndefined();
  });

  it('rejects duplicate module ids', () => {
    const m = makeUsersModule().module;
    expect(() => createRegistry([m, { ...m, resources: [] }])).toThrow(/Duplicate module id "users"/);
  });

  it('rejects duplicate resource ids across modules', () => {
    const a = makeUsersModule().module;
    const b: AdminModule = { ...a, id: 'users-copy' };
    expect(() => createRegistry([a, b])).toThrow(/Duplicate resource id "users"/);
  });

  it('still validates disabled modules (bad config fails loudly even when off)', () => {
    const { module } = makeUsersModule({ enabled: false, permissions: [] });
    expect(() => createRegistry([module])).toThrow(RegistryError);
  });

  it('requires the resource read permission to be declared by the module', () => {
    const { module } = makeUsersModule({ permissions: ['users.suspend'] });
    expect(() => createRegistry([module])).toThrow(/does not declare it/);
  });

  it('rejects wildcard or malformed permissions', () => {
    expect(() => createRegistry([makeUsersModule({ permissions: ['users.*' as 'users.read'] }).module])).toThrow(/wildcards are not supported/);
    expect(() => createRegistry([makeUsersModule({ permissions: ['users' as 'users.read'] }).module])).toThrow(RegistryError);
  });

  it('rejects unsafe ids', () => {
    expect(() => createRegistry([makeUsersModule({ id: '../etc' }).module])).toThrow(/must match/);
    expect(() => createRegistry([makeUsersModule({ id: 'Users' }).module])).toThrow(/must match/);
  });

  it('requires idField to be a declared field', () => {
    const { module } = makeUsersModule();
    const res = { ...module.resources[0]!, idField: 'uuid' };
    expect(() => createRegistry([{ ...module, resources: [res] }])).toThrow(/idField "uuid"/);
  });

  it('requires at least one field and valid field types', () => {
    const { module } = makeUsersModule();
    const base = module.resources[0]!;
    expect(() => createRegistry([{ ...module, resources: [{ ...base, fields: {} }] }])).toThrow(/at least one field/);
    expect(() =>
      createRegistry([{ ...module, resources: [{ ...base, fields: { id: { type: 'json' as 'string' } } }] }]),
    ).toThrow(/invalid type/);
  });

  it('requires a list handler', () => {
    const { module } = makeUsersModule();
    const res = { ...module.resources[0]!, list: undefined as unknown as never };
    expect(() => createRegistry([{ ...module, resources: [res] }])).toThrow(/list handler is required/);
  });
});
