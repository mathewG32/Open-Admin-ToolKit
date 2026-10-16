import { isValidPermission } from './permissions.js';
import type { AdminMetric, AdminModule, AdminResource, FieldDef, Permission } from './types.js';

const ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const FIELD_TYPES = new Set(['string', 'number', 'boolean', 'date']);
const METRIC_DISPLAYS = new Set(['stat', 'bar', 'line']);
const METRIC_FORMATS = new Set(['number', 'currency', 'percent']);
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

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

export type RegisteredMetric = {
  readonly module: AdminModule;
  readonly metric: AdminMetric;
};

export type AdminRegistry = {
  /** Enabled modules only. */
  readonly modules: readonly AdminModule[];
  /** Looks up an enabled resource. Disabled modules' resources are not reachable. */
  getResource(resourceId: string): RegisteredResource | undefined;
  /** All enabled resources, in registration order. */
  listResources(): readonly RegisteredResource[];
  /** Looks up an enabled metric. Metric ids are a separate namespace from resource ids. */
  getMetric(metricId: string): RegisteredMetric | undefined;
  listMetrics(): readonly RegisteredMetric[];
};

/** Identity helper that gives module definitions full type checking. */
export function defineAdminModule(module: AdminModule): AdminModule {
  return module;
}

/** Identity helper that gives resource definitions full type checking. */
export function defineResource<T extends Record<string, unknown>>(resource: AdminResource<T>): AdminResource {
  return resource as unknown as AdminResource;
}

/** Identity helper that gives metric definitions full type checking. */
export function defineMetric(metric: AdminMetric): AdminMetric {
  return metric;
}

function checkTimeout(where: string, timeoutMs: unknown) {
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || (timeoutMs as number) < 1 || (timeoutMs as number) > 120_000)) {
    throw new RegistryError(`${where}: timeoutMs must be an integer between 1 and 120000.`);
  }
}

/**
 * Copies a validated resource into a deeply frozen snapshot. Later mutation of
 * the host's original object (e.g. flipping `filterable` on a field, swapping
 * `permissionPrefix`) cannot change what was validated.
 */
function snapshotResource(res: AdminResource): AdminResource {
  const fields: Record<string, FieldDef> = {};
  for (const name of Object.keys(res.fields)) {
    const def = res.fields[name]!;
    const copy: { -readonly [K in keyof FieldDef]: FieldDef[K] } = { type: def.type };
    if (def.label !== undefined) copy.label = String(def.label);
    if (def.filterable === true) copy.filterable = true;
    if (def.sortable === true) copy.sortable = true;
    fields[name] = Object.freeze(copy);
  }
  const snap: { -readonly [K in keyof AdminResource]: AdminResource[K] } = {
    id: res.id,
    label: res.label,
    permissionPrefix: res.permissionPrefix,
    idField: res.idField,
    fields: Object.freeze(fields),
    list: res.list,
  };
  if (res.get !== undefined) snap.get = res.get;
  if (res.timeoutMs !== undefined) snap.timeoutMs = res.timeoutMs;
  return Object.freeze(snap);
}

function snapshotMetric(m: AdminMetric): AdminMetric {
  const snap: { -readonly [K in keyof AdminMetric]: AdminMetric[K] } = {
    id: m.id,
    label: m.label,
    permission: m.permission,
    display: m.display ?? 'stat',
    format: m.format ?? 'number',
    load: m.load,
  };
  if (m.description !== undefined) snap.description = String(m.description);
  if (m.currency !== undefined) snap.currency = m.currency;
  if (m.timeoutMs !== undefined) snap.timeoutMs = m.timeoutMs;
  return Object.freeze(snap);
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
  checkTimeout(where, res.timeoutMs);

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

function validateMetric(mod: AdminModule, m: AdminMetric, declared: ReadonlySet<string>) {
  const where = `module "${mod.id}", metric "${String(m?.id)}"`;
  if (typeof m !== 'object' || m === null) throw new RegistryError(`${where}: metric must be an object.`);
  if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) throw new RegistryError(`${where}: id must match ${ID_PATTERN}.`);
  if (typeof m.label !== 'string' || m.label.length === 0) throw new RegistryError(`${where}: label is required.`);
  if (typeof m.load !== 'function') throw new RegistryError(`${where}: a load function is required.`);
  if (!isValidPermission(m.permission)) throw new RegistryError(`${where}: invalid permission "${String(m.permission)}".`);
  if (!declared.has(m.permission)) {
    throw new RegistryError(`${where}: uses permission "${m.permission}" but module "${mod.id}" does not declare it in "permissions".`);
  }
  if (m.display !== undefined && !METRIC_DISPLAYS.has(m.display)) throw new RegistryError(`${where}: display must be stat, bar, or line.`);
  if (m.format !== undefined && !METRIC_FORMATS.has(m.format)) throw new RegistryError(`${where}: format must be number, currency, or percent.`);
  if (m.format === 'currency' && (typeof m.currency !== 'string' || !CURRENCY_PATTERN.test(m.currency))) {
    throw new RegistryError(`${where}: currency format requires an ISO 4217 "currency" code such as "USD".`);
  }
  checkTimeout(where, m.timeoutMs);
}

/**
 * Validates every module (enabled or not) and indexes deeply frozen snapshots
 * of the enabled ones.
 * Throws RegistryError with a descriptive message on any problem, so
 * misconfiguration fails at startup rather than silently at request time.
 */
export function createRegistry(modules: readonly AdminModule[]): AdminRegistry {
  if (!Array.isArray(modules)) throw new RegistryError('modules must be an array.');

  const moduleIds = new Set<string>();
  const resourceOwners = new Map<string, string>();
  const metricOwners = new Map<string, string>();
  const enabled: AdminModule[] = [];
  const index = new Map<string, RegisteredResource>();
  const metricIndex = new Map<string, RegisteredMetric>();

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
    if (mod.metrics !== undefined && !Array.isArray(mod.metrics)) throw new RegistryError(`module "${mod.id}": metrics must be an array.`);

    const isEnabled = mod.enabled !== false;
    const resourceSnaps: { resource: AdminResource; readPermission: Permission }[] = [];
    for (const res of mod.resources) {
      const readPermission = validateResource(mod, res, declared);
      const owner = resourceOwners.get(res.id);
      if (owner !== undefined) {
        throw new RegistryError(`Duplicate resource id "${res.id}" in modules "${owner}" and "${mod.id}".`);
      }
      resourceOwners.set(res.id, mod.id);
      resourceSnaps.push({ resource: snapshotResource(res), readPermission });
    }

    const metricSnaps: AdminMetric[] = [];
    for (const m of mod.metrics ?? []) {
      validateMetric(mod, m, declared);
      const owner = metricOwners.get(m.id);
      if (owner !== undefined) throw new RegistryError(`Duplicate metric id "${m.id}" in modules "${owner}" and "${mod.id}".`);
      metricOwners.set(m.id, mod.id);
      metricSnaps.push(snapshotMetric(m));
    }

    if (isEnabled) {
      const frozenModule: AdminModule = Object.freeze({
        id: mod.id,
        label: String(mod.label),
        permissions: Object.freeze([...mod.permissions]),
        resources: Object.freeze(resourceSnaps.map((s) => s.resource)),
        metrics: Object.freeze(metricSnaps),
        enabled: true,
      });
      enabled.push(frozenModule);
      for (const s of resourceSnaps) {
        index.set(s.resource.id, Object.freeze({ module: frozenModule, resource: s.resource, readPermission: s.readPermission }));
      }
      for (const m of metricSnaps) metricIndex.set(m.id, Object.freeze({ module: frozenModule, metric: m }));
    }
  }

  const ordered = Object.freeze([...index.values()]);
  const orderedMetrics = Object.freeze([...metricIndex.values()]);
  return Object.freeze({
    modules: Object.freeze(enabled),
    getResource: (id: string) => index.get(id),
    listResources: () => ordered,
    getMetric: (id: string) => metricIndex.get(id),
    listMetrics: () => orderedMetrics,
  });
}
