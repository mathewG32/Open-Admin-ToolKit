import type { AdminActor, AuthorizeFn, AuthorizeInput, Permission } from './types.js';

const PERMISSION_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

export function isValidPermission(value: unknown): value is Permission {
  return typeof value === 'string' && PERMISSION_PATTERN.test(value);
}

/**
 * Runs the host's authorization function with deny-by-default semantics.
 * Returns true ONLY if the host returned the literal boolean `true`.
 * Thrown errors, rejected promises, `undefined`, and truthy non-booleans all deny.
 */
export async function checkPermission(authorize: AuthorizeFn, input: AuthorizeInput): Promise<boolean> {
  try {
    const decision = await authorize(input);
    return decision === true;
  } catch {
    return false;
  }
}

/**
 * Validates the identity object returned by a host's authenticate callback.
 * Returns a frozen copy containing only known keys, or null if malformed.
 */
export function normalizeActor(value: unknown): AdminActor | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0 || v.id.length > 256) return null;
  if (!Array.isArray(v.roles) || !v.roles.every((r) => typeof r === 'string')) return null;
  if (v.tenantId !== undefined && (typeof v.tenantId !== 'string' || v.tenantId.length === 0)) return null;
  const actor: { id: string; roles: readonly string[]; tenantId?: string } = {
    id: v.id,
    roles: Object.freeze([...(v.roles as string[])]),
  };
  if (typeof v.tenantId === 'string') actor.tenantId = v.tenantId;
  return Object.freeze(actor);
}

/**
 * Convenience policy: maps role names to an explicit list of permissions.
 * No wildcards, no inheritance — a role has exactly the permissions listed.
 * Unknown roles grant nothing.
 *
 * This is a starting point for simple apps. Apps with record-level or
 * tenant-level rules should write their own AuthorizeFn and inspect `target`.
 */
export function createRolePolicy(grants: Readonly<Record<string, readonly Permission[]>>): AuthorizeFn {
  for (const [role, perms] of Object.entries(grants)) {
    for (const p of perms) {
      if (!isValidPermission(p)) {
        throw new Error(`createRolePolicy: role "${role}" has invalid permission "${String(p)}". Wildcards are not supported.`);
      }
    }
  }
  const table = new Map<string, ReadonlySet<string>>(
    Object.entries(grants).map(([role, perms]) => [role, new Set(perms)]),
  );
  return ({ actor, permission }) => actor.roles.some((role) => table.get(role)?.has(permission) === true);
}
