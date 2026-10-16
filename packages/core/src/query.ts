import { AdminError } from './errors.js';
import type { AdminResource, FieldType, ListQuery, SortSpec } from './types.js';

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 512;
const MAX_FILTER_VALUE_LENGTH = 200;
const MAX_FILTERS = 10;
const MAX_RECORD_ID_LENGTH = 256;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function bad(param: string, reason: string): AdminError {
  return new AdminError('BAD_REQUEST', `Invalid query parameter "${param}".`, { param, reason });
}

function readString(raw: unknown, param: string): string | undefined {
  if (raw === undefined) return undefined;
  // Arrays (e.g. ?limit=1&limit=2) are rejected to prevent parameter-pollution ambiguity.
  if (typeof raw !== 'string') throw bad(param, 'must be a single string value');
  if (CONTROL_CHARS.test(raw)) throw bad(param, 'contains control characters');
  return raw;
}

/**
 * Converts untrusted query input into a bounded ListQuery.
 *
 * Accepted parameters (anything else is rejected):
 *   limit=1..100        default 25
 *   cursor=<opaque>     max 512 chars
 *   sort=field|-field   field must be declared sortable
 *   filter[field]=value field must be declared filterable; max 10 filters
 *
 * Supports both flat keys (`filter[status]`, Express 5 default parser)
 * and nested objects (`{ filter: { status } }`, qs-style parsers).
 */
export function parseListQuery(raw: Readonly<Record<string, unknown>>, resource: AdminResource): ListQuery {
  const filters: Record<string, string> = Object.create(null);
  let limitRaw: string | undefined;
  let cursor: string | undefined;
  let sortRaw: string | undefined;

  const addFilter = (field: string, value: unknown) => {
    const param = `filter[${field}]`;
    const def = Object.hasOwn(resource.fields, field) ? resource.fields[field] : undefined;
    if (!def || def.filterable !== true) throw bad(param, 'field is not filterable');
    const v = readString(value, param);
    if (v === undefined || v.length === 0) throw bad(param, 'value is required');
    if (v.length > MAX_FILTER_VALUE_LENGTH) throw bad(param, `value exceeds ${MAX_FILTER_VALUE_LENGTH} characters`);
    if (Object.hasOwn(filters, field)) throw bad(param, 'duplicate filter');
    filters[field] = v;
  };

  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (key === 'limit') limitRaw = readString(value, 'limit');
    else if (key === 'cursor') cursor = readString(value, 'cursor');
    else if (key === 'sort') sortRaw = readString(value, 'sort');
    else if (key === 'filter') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw bad('filter', 'must be filter[field]=value');
      for (const field of Object.keys(value)) addFilter(field, (value as Record<string, unknown>)[field]);
    } else {
      const m = /^filter\[([^\]]+)\]$/.exec(key);
      if (m && m[1] !== undefined) addFilter(m[1], value);
      else throw bad(key, 'unknown parameter');
    }
  }

  if (Object.keys(filters).length > MAX_FILTERS) throw bad('filter', `at most ${MAX_FILTERS} filters are allowed`);

  let limit = DEFAULT_LIMIT;
  if (limitRaw !== undefined) {
    if (!/^\d{1,15}$/.test(limitRaw)) throw bad('limit', 'must be a positive integer');
    limit = Number(limitRaw);
    if (limit < 1 || limit > MAX_LIMIT) throw bad('limit', `must be between 1 and ${MAX_LIMIT}`);
  }

  if (cursor !== undefined && (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH)) {
    throw bad('cursor', `must be 1-${MAX_CURSOR_LENGTH} characters`);
  }

  let sort: SortSpec | undefined;
  if (sortRaw !== undefined) {
    const direction = sortRaw.startsWith('-') ? 'desc' : 'asc';
    const field = direction === 'desc' ? sortRaw.slice(1) : sortRaw;
    const def = Object.hasOwn(resource.fields, field) ? resource.fields[field] : undefined;
    if (!def || def.sortable !== true) throw bad('sort', 'field is not sortable');
    sort = { field, direction };
  }

  const query: { limit: number; filters: Readonly<Record<string, string>>; cursor?: string; sort?: SortSpec } = {
    limit,
    filters: Object.freeze({ ...filters }),
  };
  if (cursor !== undefined) query.cursor = cursor;
  if (sort !== undefined) query.sort = sort;
  return Object.freeze(query);
}

/** Validates a record id taken from a URL path. */
export function parseRecordId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RECORD_ID_LENGTH || CONTROL_CHARS.test(raw)) {
    throw new AdminError('BAD_REQUEST', 'Invalid record id.');
  }
  return raw;
}

type SafeValue = string | number | boolean | null;

/** Coerces a value to its declared field type, or null if it doesn't match. Never converts across types. */
function coerce(type: FieldType, v: unknown): SafeValue {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'string':
      return typeof v === 'string' ? v : null;
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    case 'boolean':
      return typeof v === 'boolean' ? v : null;
    case 'date': {
      const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
      return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
    }
  }
}

/**
 * Projects a host record onto the resource's declared fields.
 *
 * - Undeclared keys (password hashes, tokens, internal flags) are dropped.
 * - Declared keys the record doesn't own are omitted.
 * - Values must match the declared type exactly; mismatches become `null`
 *   (a `string` field holding an object, a `number` field holding "42", NaN, Infinity…).
 * - `date` fields accept Date objects or parseable strings and are returned as ISO-8601 UTC.
 *
 * Pass `onMismatch` to find out when a host returns the wrong type.
 */
export function sanitizeRecord(
  record: unknown,
  resource: AdminResource,
  onMismatch?: (field: string, expected: FieldType) => void,
): Record<string, SafeValue> {
  const out: Record<string, SafeValue> = {};
  if (typeof record !== 'object' || record === null) return out;
  const src = record as Record<string, unknown>;
  for (const field of Object.keys(resource.fields)) {
    if (!Object.hasOwn(src, field)) continue;
    const def = resource.fields[field]!;
    const raw = src[field];
    const value = coerce(def.type, raw);
    if (value === null && raw !== null && raw !== undefined) onMismatch?.(field, def.type);
    out[field] = value;
  }
  return out;
}
