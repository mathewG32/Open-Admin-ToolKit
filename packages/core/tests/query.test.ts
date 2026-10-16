import { describe, expect, it } from 'vitest';
import { AdminError, MAX_LIMIT, parseListQuery, parseRecordId, sanitizeRecord } from '../src/index.js';
import { makeUsersModule, USERS } from './fixtures.js';

const resource = makeUsersModule().module.resources[0]!;

function expectBadRequest(fn: () => unknown, param?: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AdminError);
    expect((err as AdminError).code).toBe('BAD_REQUEST');
    if (param) expect((err as AdminError).details?.param).toBe(param);
    return;
  }
  throw new Error('expected BAD_REQUEST');
}

describe('parseListQuery', () => {
  it('applies a bounded default', () => {
    expect(parseListQuery({}, resource)).toEqual({ limit: 25, filters: {} });
  });

  it('parses limit, cursor, sort, and flat filters', () => {
    const q = parseListQuery({ limit: '10', cursor: 'abc', sort: '-createdAt', 'filter[status]': 'active' }, resource);
    expect(q).toEqual({ limit: 10, cursor: 'abc', sort: { field: 'createdAt', direction: 'desc' }, filters: { status: 'active' } });
  });

  it('parses nested filter objects (qs-style parsers)', () => {
    expect(parseListQuery({ filter: { status: 'active' } }, resource).filters).toEqual({ status: 'active' });
  });

  it.each(['0', '-1', `${MAX_LIMIT + 1}`, '10000', 'abc', '1.5', '1e2', ''])('rejects limit=%s', (limit) => {
    expectBadRequest(() => parseListQuery({ limit }, resource), 'limit');
  });

  it('rejects repeated params (parameter pollution)', () => {
    expectBadRequest(() => parseListQuery({ limit: ['10', '100'] }, resource), 'limit');
  });

  it('rejects unknown params', () => {
    expectBadRequest(() => parseListQuery({ where: '1=1' }, resource), 'where');
  });

  it('rejects filters on undeclared or non-filterable fields', () => {
    expectBadRequest(() => parseListQuery({ 'filter[passwordHash]': 'x' }, resource), 'filter[passwordHash]');
    expectBadRequest(() => parseListQuery({ 'filter[createdAt]': 'x' }, resource), 'filter[createdAt]');
    expectBadRequest(() => parseListQuery({ filter: JSON.parse('{"__proto__":"x"}') }, resource));
    expectBadRequest(() => parseListQuery({ 'filter[constructor]': 'x' }, resource));
  });

  it('rejects sort on non-sortable fields', () => {
    expectBadRequest(() => parseListQuery({ sort: 'email' }, resource), 'sort');
    expectBadRequest(() => parseListQuery({ sort: '-passwordHash' }, resource), 'sort');
  });

  it('rejects oversized and control-character values', () => {
    expectBadRequest(() => parseListQuery({ cursor: 'x'.repeat(513) }, resource), 'cursor');
    expectBadRequest(() => parseListQuery({ 'filter[email]': 'x'.repeat(201) }, resource));
    expectBadRequest(() => parseListQuery({ 'filter[email]': 'a\nb' }, resource));
  });

  it('rejects empty filter values', () => {
    expectBadRequest(() => parseListQuery({ 'filter[status]': '' }, resource));
  });
});

describe('parseRecordId', () => {
  it('accepts normal ids', () => expect(parseRecordId('user-001')).toBe('user-001'));
  it.each([[''], ['x'.repeat(257)], ['a\u0000b'], [42], [undefined]])('rejects %j', (v) => {
    expect(() => parseRecordId(v)).toThrow(AdminError);
  });
});

describe('sanitizeRecord', () => {
  it('returns only declared fields and drops secrets', () => {
    const out = sanitizeRecord(USERS[0], resource);
    expect(Object.keys(out).sort()).toEqual(['createdAt', 'email', 'id', 'status']);
    expect(JSON.stringify(out)).not.toMatch(/SECRET/);
  });

  it('serializes dates and nulls nested objects', () => {
    const out = sanitizeRecord({ id: 'x', createdAt: new Date('2026-01-01T00:00:00Z'), email: { nested: 'leak' } }, resource);
    expect(out).toEqual({ id: 'x', createdAt: '2026-01-01T00:00:00.000Z', email: null });
  });

  it('enforces declared types and reports mismatches', () => {
    const typed = { ...resource, fields: { s: { type: 'string' }, n: { type: 'number' }, b: { type: 'boolean' }, d: { type: 'date' } } } as typeof resource;
    const mismatches: string[] = [];
    const report = (f: string) => mismatches.push(f);
    expect(sanitizeRecord({ s: 42, n: '42', b: 'true', d: 'not a date' }, typed, report)).toEqual({ s: null, n: null, b: null, d: null });
    expect(mismatches).toEqual(['s', 'n', 'b', 'd']);
    expect(sanitizeRecord({ n: Number.NaN, d: '2026-10-16' }, typed)).toEqual({ n: null, d: '2026-10-16T00:00:00.000Z' });
    mismatches.length = 0;
    expect(sanitizeRecord({ s: 'ok', n: 1, b: false, d: null }, typed, report)).toEqual({ s: 'ok', n: 1, b: false, d: null });
    expect(mismatches).toEqual([]);
  });

  it('ignores inherited properties', () => {
    const proto = { email: 'inherited@example.test' };
    const rec = Object.assign(Object.create(proto), { id: 'x' });
    expect(sanitizeRecord(rec, resource)).toEqual({ id: 'x' });
  });
});
