import type { DescribedMetric, DescribedResource, MetricResult } from '@openadminkit/core';

/** The navigation document returned by `GET /`. */
export type AdminDescription = {
  actor: { id: string; roles: string[] };
  modules: { id: string; label: string; resources: DescribedResource[]; metrics?: DescribedMetric[] }[];
  requestId: string;
};

export type AdminRecord = Record<string, string | number | boolean | null>;

export type ListPage = {
  data: AdminRecord[];
  page: { limit: number; nextCursor: string | null; total?: number };
  requestId: string;
};

export type ListParams = {
  limit?: number;
  cursor?: string | null;
  /** `field` ascending or `-field` descending. */
  sort?: string | null;
  filters?: Record<string, string>;
};

/** A failed admin API call. `status` 0 means the request never reached the server. */
export class AdminClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly details: Record<string, string> | undefined;

  constructor(status: number, code: string, message: string, requestId?: string, details?: Record<string, string>) {
    super(message);
    this.name = 'AdminClientError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

export type AdminClient = {
  describe(signal?: AbortSignal): Promise<AdminDescription>;
  list(resourceId: string, params?: ListParams, signal?: AbortSignal): Promise<ListPage>;
  get(resourceId: string, recordId: string, signal?: AbortSignal): Promise<{ data: AdminRecord; requestId: string }>;
  metric(metricId: string, signal?: AbortSignal): Promise<{ data: MetricResult; requestId: string }>;
};

export type AdminClientOptions = {
  /** Where the admin router is mounted, e.g. "/internal/admin/api". */
  apiBase: string;
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
  /**
   * Defaults to "same-origin", so session cookies are sent only to your own
   * origin. Use "include" only if the API lives on another origin you control.
   */
  credentials?: RequestCredentials;
  /** Extra headers on every request (e.g. an Authorization header for token auth). */
  headers?: Record<string, string>;
};

/** Builds the list query string. Exported for testing. */
export function buildListQuery(params: ListParams = {}): string {
  const q = new URLSearchParams();
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  if (params.cursor) q.set('cursor', params.cursor);
  if (params.sort) q.set('sort', params.sort);
  for (const [field, value] of Object.entries(params.filters ?? {})) {
    if (value !== '') q.set(`filter[${field}]`, value);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function createAdminClient(options: AdminClientOptions): AdminClient {
  const base = options.apiBase.replace(/\/+$/, '');
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const credentials = options.credentials ?? 'same-origin';

  async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      const init: RequestInit = { credentials, headers: { Accept: 'application/json', ...options.headers } };
      if (signal) init.signal = signal;
      res = await doFetch(`${base}${path}`, init);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw err;
      throw new AdminClientError(0, 'NETWORK', 'Could not reach the admin API. Check your connection and try again.');
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AdminClientError(res.status, 'BAD_RESPONSE', `The admin API returned an unreadable response (HTTP ${res.status}).`);
    }
    if (!res.ok) {
      const e = (body as { error?: { code?: string; message?: string; requestId?: string; details?: Record<string, string> } })?.error;
      throw new AdminClientError(res.status, e?.code ?? 'ERROR', e?.message ?? `Request failed (HTTP ${res.status}).`, e?.requestId, e?.details);
    }
    return body as T;
  }

  const seg = encodeURIComponent;
  return {
    describe: (signal) => request('/', signal),
    list: (resourceId, params, signal) => request(`/resources/${seg(resourceId)}${buildListQuery(params)}`, signal),
    get: (resourceId, recordId, signal) => request(`/resources/${seg(resourceId)}/${seg(recordId)}`, signal),
    metric: (metricId, signal) => request(`/metrics/${seg(metricId)}`, signal),
  };
}
