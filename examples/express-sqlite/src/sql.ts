import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { AdminError, type ListQuery, type ListResult } from '@openadminkit/core';

/**
 * A small, reusable way to turn OpenAdmin Kit's validated ListQuery into safe SQL.
 *
 * Defense in depth: the toolkit has already rejected undeclared filters/sorts,
 * and this builder ALSO maps every field through its own allowlist, so a field
 * name never reaches SQL as text. Values are always bound parameters.
 */
export type ListSpec = {
  /** SELECT list with aliases, e.g. "id, created_at AS createdAt". */
  select: string;
  /** FROM clause, e.g. "users". */
  from: string;
  /** Primary key column, used as the pagination tiebreaker. */
  idColumn: string;
  /** Allowed filters: field name → column + match mode. */
  filters: Record<string, { column: string; match: 'equals' | 'prefix' }>;
  /** Allowed sorts: field name → column. */
  sorts: Record<string, string>;
  /** Used when the client doesn't choose a sort. */
  defaultSort: { field: string; direction: 'asc' | 'desc' };
  /** Fixed conditions the client can never change (e.g. tenant scope). ANDed with filters. */
  scope?: { sql: string; params: SQLInputValue[] };
};

/** Escapes LIKE wildcards so a user typing "%" or "_" searches for those characters literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type Cursor = [SQLInputValue, string];

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(v) && v.length === 2 && ['string', 'number'].includes(typeof v[0]) && typeof v[1] === 'string') {
      return v as Cursor;
    }
  } catch {
    /* fall through */
  }
  throw new AdminError('BAD_REQUEST', 'Invalid cursor.', { param: 'cursor', reason: 'not a cursor from this API' });
}

export function runList<T extends Record<string, unknown>>(db: DatabaseSync, spec: ListSpec, query: ListQuery): ListResult<T> {
  const where: string[] = [];
  const params: SQLInputValue[] = [];

  if (spec.scope) {
    where.push(`(${spec.scope.sql})`);
    params.push(...spec.scope.params);
  }

  for (const [field, value] of Object.entries(query.filters)) {
    const f = Object.hasOwn(spec.filters, field) ? spec.filters[field] : undefined;
    if (!f) throw new AdminError('BAD_REQUEST', `Filtering by "${field}" isn't supported.`, { param: `filter[${field}]`, reason: 'not supported' });
    if (f.match === 'prefix') {
      where.push(`lower(${f.column}) LIKE ? ESCAPE '\\'`);
      params.push(`${escapeLike(value.toLowerCase())}%`);
    } else {
      where.push(`${f.column} = ?`);
      params.push(value);
    }
  }

  const sortField = query.sort?.field ?? spec.defaultSort.field;
  const direction = query.sort?.direction ?? spec.defaultSort.direction;
  const sortColumn = Object.hasOwn(spec.sorts, sortField) ? spec.sorts[sortField] : undefined;
  if (!sortColumn) throw new AdminError('BAD_REQUEST', `Sorting by "${sortField}" isn't supported.`, { param: 'sort', reason: 'not supported' });

  // Count before applying the cursor, so the total describes the whole filtered set.
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM ${spec.from} ${whereSql}`).get(...params) as { total: number };

  // Keyset pagination: stable under inserts, and fast on an index of (sortColumn, id).
  const pageWhere = [...where];
  const pageParams = [...params];
  if (query.cursor) {
    const [value, id] = decodeCursor(query.cursor);
    const op = direction === 'desc' ? '<' : '>';
    pageWhere.push(`(${sortColumn} ${op} ? OR (${sortColumn} = ? AND ${spec.idColumn} ${op} ?))`);
    pageParams.push(value, value, id);
  }
  const dir = direction === 'desc' ? 'DESC' : 'ASC';
  const sql = `SELECT ${spec.select}, ${sortColumn} AS __sort, ${spec.idColumn} AS __id FROM ${spec.from}
    ${pageWhere.length ? `WHERE ${pageWhere.join(' AND ')}` : ''}
    ORDER BY ${sortColumn} ${dir}, ${spec.idColumn} ${dir}
    LIMIT ?`;
  const rows = db.prepare(sql).all(...pageParams, query.limit + 1) as (T & { __sort: SQLInputValue; __id: string })[];

  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor([last.__sort, last.__id]) : null,
    total,
  };
}
