import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Express } from 'express';
import { openDatabase, SEED_USERS } from '../src/db.js';
import { createApp } from '../src/app.js';
import { escapeLike } from '../src/sql.js';

const API = '/internal/admin/api';
const NOW = new Date('2026-10-16T15:00:00.000Z');

let db: DatabaseSync;
let app: Express;
const cookies: Record<string, string[]> = {};

async function login(staffId: string) {
  const res = await request(app).post('/login').send({ staffId });
  expect(res.status).toBe(200);
  const c = res.headers['set-cookie'];
  return Array.isArray(c) ? c : [String(c)];
}

beforeAll(async () => {
  db = openDatabase(':memory:', NOW);
  app = createApp({ db, now: () => NOW });
  for (const who of ['staff_admin', 'staff_support', 'staff_analyst']) cookies[who] = await login(who);
});

const as = (who: string) => ({ Cookie: cookies[who]!.join('; ') });

describe('SQLite-backed resources', () => {
  it('pages through every user exactly once with keyset cursors', async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `${API}/resources/users?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await request(app).get(url).set(as('staff_admin'));
      expect(res.status).toBe(200);
      expect(res.body.page.total).toBe(SEED_USERS);
      for (const u of res.body.data) seen.add(u.id);
      cursor = res.body.page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(seen.size).toBe(SEED_USERS);
    expect(pages).toBe(5);
  });

  it('sorts newest first by default and by spend on request', async () => {
    const byDate = await request(app).get(`${API}/resources/users?limit=20`).set(as('staff_admin'));
    const dates = byDate.body.data.map((u: { createdAt: string }) => u.createdAt);
    expect([...dates].sort().reverse()).toEqual(dates);

    const bySpend = await request(app).get(`${API}/resources/users?limit=20&sort=-spent`).set(as('staff_admin'));
    const spend = bySpend.body.data.map((u: { spent: number }) => u.spent);
    expect([...spend].sort((a, b) => b - a)).toEqual(spend);
  });

  it('never returns password hashes or API tokens, even though the table has them', async () => {
    const list = await request(app).get(`${API}/resources/users?limit=100`).set(as('staff_admin'));
    const one = await request(app).get(`${API}/resources/users/usr_0001`).set(as('staff_admin'));
    for (const res of [list, one]) expect(res.text).not.toMatch(/argon2|DEMO-NOT-A-REAL-HASH|sk_demo_|password|api_?token/i);
  });

  it('filters with bound parameters: SQL and LIKE metacharacters are just text', async () => {
    for (const evil of ["' OR 1=1 --", '%', '_', '\\', 'a%"; DROP TABLE users; --']) {
      const res = await request(app).get(`${API}/resources/users?filter[email]=${encodeURIComponent(evil)}`).set(as('staff_admin'));
      expect([evil, res.status, res.body.data.length]).toEqual([evil, 200, 0]);
    }
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    expect(n).toBe(SEED_USERS);
  });

  it('email filter is a case-insensitive prefix search', async () => {
    const sample = (db.prepare('SELECT email FROM users ORDER BY id LIMIT 1').get() as { email: string }).email;
    const prefix = sample.slice(0, 6).toUpperCase();
    const res = await request(app).get(`${API}/resources/users?limit=100&filter[email]=${encodeURIComponent(prefix)}`).set(as('staff_admin'));
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((u: { email: string }) => u.email.toUpperCase().startsWith(prefix))).toBe(true);
  });

  it('combines filters with AND', async () => {
    const res = await request(app).get(`${API}/resources/users?limit=100&filter[plan]=team&filter[status]=active`).set(as('staff_admin'));
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((u: { plan: string; status: string }) => u.plan === 'team' && u.status === 'active')).toBe(true);
  });

  it('rejects forged or garbage cursors with 400', async () => {
    for (const cursor of ['not-base64!', Buffer.from('{"a":1}').toString('base64url'), Buffer.from('[1]').toString('base64url')]) {
      const res = await request(app).get(`${API}/resources/users?cursor=${encodeURIComponent(cursor)}`).set(as('staff_admin'));
      expect(res.status).toBe(400);
    }
  });

  it('orders are filterable by customer', async () => {
    const res = await request(app).get(`${API}/resources/orders?limit=100&filter[userId]=usr_0001`).set(as('staff_support'));
    expect(res.status).toBe(200);
    expect(res.body.data.every((o: { userId: string }) => o.userId === 'usr_0001')).toBe(true);
  });

  it('escapeLike escapes wildcards and the escape character', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

describe('metrics', () => {
  it('computes aggregates from SQL', async () => {
    const total = await request(app).get(`${API}/metrics/total-users`).set(as('staff_admin'));
    expect(total.body.data.value).toBe(SEED_USERS);
    expect(total.body.data.series).toHaveLength(30);

    const daily = await request(app).get(`${API}/metrics/revenue-daily`).set(as('staff_admin'));
    expect(daily.body.data.series).toHaveLength(14);
    expect(daily.body.data.series.at(-1).x).toBe('2026-10-16');
    const sum = daily.body.data.series.reduce((a: number, p: { y: number }) => a + p.y, 0);
    expect(daily.body.data.value).toBeCloseTo(sum, 2);

    const share = await request(app).get(`${API}/metrics/paid-share`).set(as('staff_admin'));
    expect(share.body.data.value).toBeGreaterThan(0);
    expect(share.body.data.value).toBeLessThan(1);
  });

  it('keeps revenue from support, and customer records from analysts', async () => {
    expect((await request(app).get(`${API}/metrics/revenue-30d`).set(as('staff_support'))).status).toBe(403);
    expect((await request(app).get(`${API}/metrics/revenue-30d`).set(as('staff_analyst'))).status).toBe(200);
    expect((await request(app).get(`${API}/resources/users`).set(as('staff_analyst'))).status).toBe(403);
    const nav = await request(app).get(`${API}/`).set(as('staff_support'));
    const metricIds = nav.body.modules.flatMap((m: { metrics: { id: string }[] }) => m.metrics.map((x) => x.id));
    expect(metricIds).not.toContain('revenue-30d');
    expect(metricIds).toContain('orders-30d');
  });
});

describe('persisted audit log', () => {
  it('writes every access to the audit_events table, readable by admins only', async () => {
    await request(app).get(`${API}/resources/audit-events`).set(as('staff_support')); // denied
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM audit_events').get() as { n: number };
    expect(n).toBeGreaterThan(10);
    const res = await request(app).get(`${API}/resources/audit-events?filter[actorId]=staff_support&filter[outcome]=denied`).set(as('staff_admin'));
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ actorId: 'staff_support', action: 'audit-events.list', outcome: 'denied' });
    expect((await request(app).get(`${API}/resources/audit-events`).set(as('staff_analyst'))).status).toBe(403);
  });

  it('stores no cookies, session ids, or filter values', () => {
    const rows = JSON.stringify(db.prepare('SELECT * FROM audit_events').all());
    expect(rows).not.toMatch(/shelfwise_sid|Cookie/);
    expect(rows).not.toContain('DROP TABLE');
  });
});

describe('pages and sessions', () => {
  it('serves pages with a strict CSP and no inline styles or scripts', async () => {
    const res = await request(app).get('/login');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).not.toContain('unsafe-inline');
    expect(res.text).not.toMatch(/style="|<script>(?!<\/script>)/);
  });

  it('rejects cross-origin sign-in and sign-out', async () => {
    expect((await request(app).post('/login').set('Origin', 'https://evil.example').send({ staffId: 'staff_admin' })).status).toBe(403);
    expect((await request(app).post('/logout').set('Origin', 'https://evil.example').set(as('staff_admin'))).status).toBe(403);
  });

  it('picks up role changes on the next request', async () => {
    const cookie = await login('staff_support');
    const headers = { Cookie: cookie.join('; ') };
    expect((await request(app).get(`${API}/resources/users`).set(headers)).status).toBe(200);
    db.prepare("UPDATE staff SET roles = 'analyst' WHERE id = 'staff_support'").run();
    try {
      expect((await request(app).get(`${API}/resources/users`).set(headers)).status).toBe(403);
    } finally {
      db.prepare("UPDATE staff SET roles = 'support' WHERE id = 'staff_support'").run();
    }
  });

  it('signing out ends access', async () => {
    const cookie = await login('staff_admin');
    await request(app).post('/logout').set('Cookie', cookie.join('; '));
    expect((await request(app).get(`${API}/`).set('Cookie', cookie.join('; '))).status).toBe(401);
  });
});
