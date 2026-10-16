import { describe, expect, it } from 'vitest';
import { checkPermission, createRolePolicy, normalizeActor } from '../src/index.js';
import { admin, nobody } from './fixtures.js';

const input = { actor: admin, permission: 'users.read' as const, target: { moduleId: 'users', resourceId: 'users' } };

describe('checkPermission (deny by default)', () => {
  it('grants only on literal true', async () => {
    expect(await checkPermission(() => true, input)).toBe(true);
    expect(await checkPermission(async () => true, input)).toBe(true);
  });

  it.each([
    ['false', () => false],
    ['undefined', () => undefined as unknown as boolean],
    ['truthy string', () => 'yes' as unknown as boolean],
    ['truthy number', () => 1 as unknown as boolean],
    ['object', () => ({ allowed: true }) as unknown as boolean],
  ])('denies when the policy returns %s', async (_label, fn) => {
    expect(await checkPermission(fn, input)).toBe(false);
  });

  it('denies when the policy throws', async () => {
    expect(await checkPermission(() => { throw new Error('db down'); }, input)).toBe(false);
  });

  it('denies when the policy rejects', async () => {
    expect(await checkPermission(() => Promise.reject(new Error('timeout')), input)).toBe(false);
  });
});

describe('createRolePolicy', () => {
  const policy = createRolePolicy({ admin: ['users.read', 'audit.read'], support: ['users.read'] });

  it('grants listed permissions', async () => {
    expect(await checkPermission(policy, input)).toBe(true);
  });

  it('denies actors with no matching role', async () => {
    expect(await checkPermission(policy, { ...input, actor: nobody })).toBe(false);
  });

  it('denies unlisted permissions for a known role', async () => {
    expect(await checkPermission(policy, { ...input, actor: { id: 's', roles: ['support'] }, permission: 'audit.read' })).toBe(false);
  });

  it('does not treat role names like "__proto__" or "constructor" specially', async () => {
    expect(await checkPermission(policy, { ...input, actor: { id: 'x', roles: ['__proto__', 'constructor', 'toString'] } })).toBe(false);
  });

  it('rejects wildcard permissions at configuration time', () => {
    expect(() => createRolePolicy({ admin: ['users.*' as 'users.read'] })).toThrow(/Wildcards are not supported/);
    expect(() => createRolePolicy({ admin: ['*' as 'users.read'] })).toThrow();
  });
});

describe('normalizeActor', () => {
  it('accepts a well-formed actor and strips unknown keys', () => {
    const a = normalizeActor({ id: 'u1', roles: ['admin'], isSuperUser: true, tenantId: 't1' });
    expect(a).toEqual({ id: 'u1', roles: ['admin'], tenantId: 't1' });
    expect(Object.isFrozen(a)).toBe(true);
  });

  it.each([
    ['null', null],
    ['string', 'u1'],
    ['missing id', { roles: [] }],
    ['empty id', { id: '', roles: [] }],
    ['numeric id', { id: 1, roles: [] }],
    ['roles not array', { id: 'u1', roles: 'admin' }],
    ['non-string role', { id: 'u1', roles: [1] }],
    ['empty tenant', { id: 'u1', roles: [], tenantId: '' }],
  ])('rejects %s', (_label, value) => {
    expect(normalizeActor(value)).toBeNull();
  });
});
