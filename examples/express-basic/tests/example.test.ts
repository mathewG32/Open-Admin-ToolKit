import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const API = '/internal/admin/api';

async function loginAs(app: ReturnType<typeof createApp>['app'], who: string) {
  const res = await request(app).post('/login').send({ as: who });
  expect(res.status).toBe(200);
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie : [String(cookie)];
}

describe('express-basic example (end to end, through real cookie sessions)', () => {
  it('blocks anonymous access', async () => {
    const { app } = createApp();
    expect((await request(app).get(`${API}/resources/users`)).status).toBe(401);
  });

  it('admin can list users; responses omit password hashes and reset tokens', async () => {
    const { app } = createApp();
    const cookie = await loginAs(app, 'admin');
    const res = await request(app).get(`${API}/resources/users?limit=10&filter[status]=suspended`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((u: { status: string }) => u.status === 'suspended')).toBe(true);
    expect(res.text).not.toMatch(/argon2|DEMO-NOT-A-REAL-HASH|rst_DEMO|passwordHash|resetToken/);
  });

  it('role matrix is enforced server-side', async () => {
    const { app } = createApp();
    const matrix: Record<string, Record<string, number>> = {
      admin: { users: 200, 'daily-signups': 200, 'audit-events': 200 },
      support: { users: 200, 'daily-signups': 200, 'audit-events': 403 },
      viewer: { users: 403, 'daily-signups': 200, 'audit-events': 403 },
    };
    for (const [who, expected] of Object.entries(matrix)) {
      const cookie = await loginAs(app, who);
      for (const [resource, status] of Object.entries(expected)) {
        const res = await request(app).get(`${API}/resources/${resource}`).set('Cookie', cookie);
        expect([who, resource, res.status]).toEqual([who, resource, status]);
      }
    }
  });

  it('admin can see the audit trail of other staff, including denials', async () => {
    const { app } = createApp();
    const viewer = await loginAs(app, 'viewer');
    await request(app).get(`${API}/resources/users`).set('Cookie', viewer);
    const admin = await loginAs(app, 'admin');
    const res = await request(app).get(`${API}/resources/audit-events?filter[outcome]=denied`).set('Cookie', admin);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ actorId: 'staff_viewer', action: 'users.list', outcome: 'denied' });
  });

  it('DISABLE_METRICS removes the module from navigation and the API', async () => {
    const { app } = createApp({ metricsEnabled: false });
    const cookie = await loginAs(app, 'admin');
    const nav = await request(app).get(`${API}/`).set('Cookie', cookie);
    expect(nav.body.modules.map((m: { id: string }) => m.id)).toEqual(['users', 'audit']);
    expect((await request(app).get(`${API}/resources/daily-signups`).set('Cookie', cookie)).status).toBe(404);
  });

  it('rejects cross-origin logins', async () => {
    const { app } = createApp();
    const res = await request(app).post('/login').set('Origin', 'https://evil.example').send({ as: 'admin' });
    expect(res.status).toBe(403);
  });

  it('logout ends access', async () => {
    const { app } = createApp();
    const cookie = await loginAs(app, 'admin');
    await request(app).post('/logout').set('Cookie', cookie);
    expect((await request(app).get(`${API}/resources/users`).set('Cookie', cookie)).status).toBe(401);
  });
});
