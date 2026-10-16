/**
 * Core contracts. These are deliberately small; API details may change during alpha.
 */

/** The verified identity behind a request. Must come from the host's own session/token verification. */
export type AdminActor = {
  readonly id: string;
  readonly roles: readonly string[];
  /** Only set when the host has verified the tenant scope. Never taken from client input. */
  readonly tenantId?: string;
};

export type AdminContext = {
  readonly actor: AdminActor;
  readonly requestId: string;
  readonly now: Date;
  readonly signal: AbortSignal;
};

/** Permission identifiers are explicit `resource.action` strings, e.g. `users.read`. */
export type Permission = `${string}.${string}`;

/** What is being accessed. `recordId` is present for single-record reads. */
export type AuthorizationTarget = {
  readonly moduleId: string;
  readonly resourceId: string;
  readonly recordId?: string;
};

export type AuthorizeInput = {
  readonly actor: AdminActor;
  readonly permission: Permission;
  readonly target: AuthorizationTarget;
};

/**
 * Host-supplied authorization decision. Only a literal `true` grants access.
 * Anything else — false, undefined, a truthy non-boolean, a thrown error,
 * a rejected promise — is treated as a denial.
 */
export type AuthorizeFn = (input: AuthorizeInput) => boolean | Promise<boolean>;

// ---------- Resources ----------

export type FieldType = 'string' | 'number' | 'boolean' | 'date';

export type FieldDef = {
  readonly type: FieldType;
  readonly label?: string;
  /** Field may be used in `filter[field]=value`. Off by default. */
  readonly filterable?: boolean;
  /** Field may be used in `sort=field` / `sort=-field`. Off by default. */
  readonly sortable?: boolean;
};

/** The admin-safe public schema. Only these keys ever leave the server. */
export type FieldMap = Readonly<Record<string, FieldDef>>;

export type SortSpec = { readonly field: string; readonly direction: 'asc' | 'desc' };

/** A validated, bounded list query. Handlers receive only declared filters/sorts. */
export type ListQuery = {
  readonly limit: number;
  readonly cursor?: string;
  readonly filters: Readonly<Record<string, string>>;
  readonly sort?: SortSpec;
};

export type ListResult<T> = {
  readonly items: readonly T[];
  /** Opaque cursor for the next page, or null/undefined when there is none. */
  readonly nextCursor?: string | null;
  /** Optional; hosts should not be forced into expensive full-table counts. */
  readonly total?: number;
};

export type AdminResource<T extends Record<string, unknown> = Record<string, unknown>> = {
  readonly id: string;
  readonly label: string;
  /** Permissions checked are `${permissionPrefix}.read` for list and get. */
  readonly permissionPrefix: string;
  /** Name of the identifier field in returned records. Must be a declared field. */
  readonly idField: string;
  readonly fields: FieldMap;
  readonly list: (ctx: AdminContext, query: ListQuery) => Promise<ListResult<T>>;
  /** Return null when the record does not exist OR is outside the actor's scope. */
  readonly get?: (ctx: AdminContext, id: string) => Promise<T | null>;
  /** Max time a handler may take before the request fails with TIMEOUT. Default 10s. */
  readonly timeoutMs?: number;
};

// ---------- Modules ----------

export type AdminModule = {
  readonly id: string;
  readonly label: string;
  /** Every permission the module's resources/actions use must be declared here. */
  readonly permissions: readonly Permission[];
  readonly resources: readonly AdminResource[];
  /** Defaults to true. A disabled module registers no routes and no navigation. */
  readonly enabled?: boolean;
};

// ---------- Audit ----------

export type AuditOutcome = 'success' | 'denied' | 'error';

export type AuditEvent = {
  readonly eventId: string;
  /** ISO-8601 UTC timestamp. */
  readonly timestamp: string;
  /** null when the request was unauthenticated. */
  readonly actorId: string | null;
  readonly action: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly tenantId?: string;
  readonly outcome: AuditOutcome;
  readonly requestId: string;
  /** Small, allowlisted, redacted metadata only. */
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
};

/** Host-owned storage for audit events. */
export type AuditSink = (event: AuditEvent) => void | Promise<void>;

/**
 * What to do if the audit sink throws:
 * - 'fail-closed': the request fails with 503 and no data is returned.
 * - 'fail-open': the request continues; `onAuditFailure` is called.
 * Default is 'fail-closed'.
 */
export type AuditFailureMode = 'fail-closed' | 'fail-open';
