import { describe, expect, it } from 'vitest';
import { buildAuditEvent, redactMetadata, sanitizeAuditString } from '../src/index.js';

describe('audit redaction', () => {
  it('drops sensitive keys regardless of value', () => {
    const out = redactMetadata({
      password: 'hunter2',
      newPassword: 'x',
      apiKey: 'k',
      api_key: 'k',
      accessToken: 't',
      sessionId: 's',
      cookie: 'c',
      Authorization: 'Bearer abc',
      cardNumber: '4111',
      clientSecret: 'cs',
      limit: 10,
    });
    expect(out).toEqual({ limit: 10 });
  });

  it('drops objects and arrays so request bodies cannot be logged', () => {
    expect(redactMetadata({ body: { email: 'a@b.c' }, ids: ['1', '2'], ok: true })).toEqual({ ok: true });
  });

  it('strips control characters (log injection) and truncates', () => {
    expect(sanitizeAuditString('admin\nFAKE LOG LINE\r')).toBe('admin FAKE LOG LINE ');
    expect(sanitizeAuditString('x'.repeat(500)).length).toBe(201);
  });

  it('caps the number of metadata keys', () => {
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(redactMetadata(many))).toHaveLength(20);
  });

  it('builds a complete, frozen event with a UTC timestamp', () => {
    const e = buildAuditEvent({
      actorId: 'u1\nadmin',
      action: 'users.list',
      outcome: 'success',
      requestId: 'r1',
      resourceType: 'users',
      metadata: { token: 'secret', count: 3 },
      now: new Date('2026-10-16T12:00:00Z'),
    });
    expect(e).toMatchObject({
      actorId: 'u1 admin',
      action: 'users.list',
      outcome: 'success',
      requestId: 'r1',
      resourceType: 'users',
      timestamp: '2026-10-16T12:00:00.000Z',
      metadata: { count: 3 },
    });
    expect(e.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.isFrozen(e)).toBe(true);
  });
});
