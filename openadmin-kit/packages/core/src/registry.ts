import { isValidPermission } from './permissions.js';
import type { AdminModule, AdminResource, Permission } from './types.js';

const ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const FIELD_TYPES = new Set(['string', 'number', 'boolean', 'date']);

/** Thrown at startup when module configuration is invalid. Never thrown per-request. */
export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

export type RegisteredResource = {
  readonly module: AdminModule;
  readonly resource: AdminResource;
  readonly readPermission: Permission;
};

export type AdminRegistry = {
  /** Enabled modules only. */
  readonly modules: readonly AdminModule[];
  /** Looks up an enabled resource. Disabled modules' resources are not reachable. */
  getResource(resourceId: string): RegisteredResource | undefined;
  /** All enabled resources, in registration order. */
  listResources(): readonly RegisteredResource[];
};

/** Identity helper that gives module definitions full type checking. */
export function defineAdminModule(module: AdminModule): AdminModule {
  return module;
}

/** Identity helper that gives resource definitions full type checking. */
export function defineResource<T extends Record<string, unknown>>(resource: AdminResource<T>): AdminResource {
  return resource as unknown as AdminResource;
}

function validateResource(mod: AdminModule, res: AdminResource, declared: ReadonlySet<string>): Permission {
  const where = `module "${mod.id}", resource "${String(res?.id)}"`;
  if (typeof res !== 'object' || res === null) throw new RegistryError(`${where}: resource must be an object.`);
  if (typeof res.id !== 'string' || !ID_PATTERN.test(res.id)) {
    throw new RegistryError(`${where}: id must match ${ID_PATTERN} (lowercase letters, digits, dashes).`);
  }
  if (typeof res.label !== 'string' || res.label.length === 0) throw new RegistryError(`${where}: label is required.`);
  if (typeof res.list !== 'function') throw new RegistryError(`${where}: a list handler is required.`);
  if (res.get !== undefined && typeof res.get !== 'function') throw new RegistryError(`${where}: get must be a function.`);
  if (res.timeoutMs !== undefined && (!Number.isInteger(res.timeoutMs) || res.timeoutMs < 1 || res.timeoutMs > 120_000)) {
    throw new RegistryError(`${where}: timeoutMs must be an integer between 1 and 120000.`);
  }

  const fieldNames = Object.keys(res.fields ?? {});
  if (fieldNames.length === 0) throw new RegistryError(`${where}: at least one field must be declared.`);
  for (const name of fieldNames) {
    if (!FIELD_PATTERN.test(name)) throw new RegistryError(`${where}: field name "${name}" is not allowed.`);
    const def = res.fields[name];
    if (!def || !FIELD_TYPES.has(def.type)) {
      throw new RegistryError(`${where}: field "${name}" has invalid type "${String(def?.type)}".`);
    }
  }
  if (!fieldNames.includes(res.idField)) {
    throw new RegistryError(`${where}: idField "${res.idField}" must be one of the declared fields.`);
  }

  const readPermission = `${res.permissionPrefix}.read`;
  if (!isValidPermission(readPermission)) {
    throw new RegistryError(`${where}: permissionPrefix "${res.permissionPrefix}" does not produce a valid permission.`);
  }
  if (!declared.has(readPermission)) {
    throw new RegistryError(
      `${where}: uses permission "${readPermission}" but module "${mod.id}" does not declare it in "permissions".`,
    );
  }
  return readPermission;
}

/**
 * Validates every module (enabled or not) and indexes the enabled ones.
 * Throws RegistryError with a descriptive message on any problem, so
 * misconfiguration fails at startup rather than silently at request time.
 */
export function createRegistry(modules: readonly AdminModule[]): AdminRegistry {
  if (!Array.isArray(modules)) throw new RegistryError('modules must be an array.');

  const moduleIds = new Set<string>();
  const resourceOwners = new Map<string, string>();
  const enabled: AdminModule[] = [];
  const index = new Map<string, RegisteredResource>();

  for (const mod of modules) {
    if (typeof mod !== 'object' || mod === null) throw new RegistryError('Each module must be an object.');
    if (typeof mod.id !== 'string' || !ID_PATTERN.test(mod.id)) {
      throw new RegistryError(`Module id "${String(mod.id)}" must match ${ID_PATTERN}.`);
    }
    if (moduleIds.has(mod.id)) throw new RegistryError(`Duplicate module id "${mod.id}".`);
    moduleIds.add(mod.id);

    if (!Array.isArray(mod.permissions)) throw new RegistryError(`module "${mod.id}": permissions must be an array.`);
    for (const p of mod.permissions) {
      if (!isValidPermission(p)) {
        throw new RegistryError(`module "${mod.id}": invalid permission "${String(p)}". Use "resource.action"; wildcards are not supported.`);
      }
    }
    const declared = new Set<string>(mod.permissions);
    if (!Array.isArray(mod.resources)) throw new RegistryError(`module "${mod.id}": resources must be an array.`);

    const isEnabled = mod.enabled !== false;
    const pending: RegisteredResource[] = [];
    for (const res of mod.resources) {
      const readPermission = validateResource(mod, res, declared);
      const owner = resourceOwners.get(res.id);
      if (owner !== undefined) {
        throw new RegistryError(`Duplicate resource id "${res.id}" in modules "${owner}" and "${mod.id}".`);
      }
      resourceOwners.set(res.id, mod.id);
      pending.push(Object.freeze({ module: mod, resource: res, readPermission }));
    }

    if (isEnabled) {
      enabled.push(mod);
      for (const r of pending) index.set(r.resource.id, r);
    }
  }

  const ordered = Object.freeze([...index.values()]);
  return Object.freeze({
    modules: Object.freeze(enabled),
    getResource: (id: string) => index.get(id),
    listResources: () => ordered,
  });
}
