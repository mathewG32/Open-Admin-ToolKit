import { describe, expect, it, vi } from 'vitest';
import { AdminClientError, buildListQuery, computeDelta, createAdminClient, formatAxisLabel, formatField, formatMetric, humanize } from '../src/index.js';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('buildListQuery', () => {
  it('encodes limit, cursor, sort, and filters, skipping empty filters', () => {
    const q = buildListQuery({ limit: 10, cursor: 'abc', sort: '-createdAt', filters: { status: 'active', plan: '' } });
    expect(q).toBe('?limit=10&cursor=abc&sort=-createdAt&filter%5Bstatus%5D=active');
  });

  it('escapes filter values', () => {
    expect(buildListQuery({ filters: { email: 'a&b=c@example.test' } })).toBe('?filter%5Bemail%5D=a%26b%3Dc%40example.test');
  });

  it('returns an empty string with no params', () => {
    expect(buildListQuery()).toBe('');
  });
});

describe('createAdminClient', () => {
  it('sends same-origin credentials and encodes path segments', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: {} }));
    const client = createAdminClient({ apiBase: '/api/', fetch: fetchMock as unknown as typeof fetch });
    await client.get('users', '../../etc/passwd');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/resources/users/..%2F..%2Fetc%2Fpasswd');
    expect(init.credentials).toBe('same-origin');
  });

  it('turns API error bodies into AdminClientError', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'No.', requestId: 'req-9' } }));
    const client = createAdminClient({ apiBase: '/api', fetch: fetchMock as unknown as typeof fetch });
    const err = await client.list('users').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdminClientError);
    expect(err).toMatchObject({ status: 403, code: 'FORBIDDEN', requestId: 'req-9' });
  });

  it('reports network failures as status 0', async () => {
    const client = createAdminClient({ apiBase: '/api', fetch: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch });
    await expect(client.describe()).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });

  it('handles non-JSON responses (e.g. a proxy error page)', async () => {
    const client = createAdminClient({ apiBase: '/api', fetch: (async () => new Response('<html>502</html>', { status: 502 })) as typeof fetch });
    await expect(client.describe()).rejects.toMatchObject({ status: 502, code: 'BAD_RESPONSE' });
  });
});

describe('formatting', () => {
  it('formats metrics by kind', () => {
    expect(formatMetric(1234.5, 'currency', { locale: 'en-US', currency: 'USD' })).toBe('$1,234.50');
    expect(formatMetric(125000, 'currency', { locale: 'en-US', currency: 'USD', compact: true })).toBe('$125K');
    expect(formatMetric(0.564, 'percent', { locale: 'en-US' })).toBe('56.4%');
    expect(formatMetric(72540, 'number', { locale: 'en-US' })).toBe('72,540');
  });

  it('computes deltas honestly', () => {
    expect(computeDelta(110, 100, 'number', 'en-US')).toEqual({ direction: 'up', text: '+10%' });
    expect(computeDelta(90, 100, 'number', 'en-US')).toEqual({ direction: 'down', text: '-10%' });
    expect(computeDelta(5, 0, 'number', 'en-US')).toBeNull(); // no "+∞%"
    expect(computeDelta(5, undefined, 'number', 'en-US')).toBeNull();
    expect(computeDelta(0.3, 0.25, 'percent', 'en-US')).toEqual({ direction: 'up', text: '+5 pts' });
  });

  it('formats fields by declared type', () => {
    expect(formatField(null, 'string')).toBe('—');
    expect(formatField(true, 'boolean')).toBe('Yes');
    expect(formatField(1234.567, 'number', 'en-US')).toBe('1,234.57');
    expect(formatField('2026-10-16T12:00:00.000Z', 'date', 'en-US')).toMatch(/Oct 16, 2026/);
  });

  it('shortens ISO dates on axes and humanizes keys', () => {
    expect(formatAxisLabel('2026-10-16', 'en-US')).toBe('Oct 16');
    expect(formatAxisLabel('Week 3', 'en-US')).toBe('Week 3');
    expect(humanize('createdAt')).toBe('Created at');
    expect(humanize('user_id')).toBe('User id');
  });
});
