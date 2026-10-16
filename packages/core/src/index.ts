export * from './types.js';
export { AdminError, isAdminError, toSafeError, type AdminErrorCode, type SafeErrorBody } from './errors.js';
export { checkPermission, createRolePolicy, isValidPermission, normalizeActor } from './permissions.js';
export { createRegistry, defineAdminModule, defineResource, RegistryError, type AdminRegistry, type RegisteredResource } from './registry.js';
export { parseListQuery, parseRecordId, sanitizeRecord, DEFAULT_LIMIT, MAX_LIMIT } from './query.js';
export { buildAuditEvent, createMemoryAuditSink, redactMetadata, sanitizeAuditString, type AuditEventInput } from './audit.js';
export {
  createAdminEngine,
  type AdminEngine,
  type AdminEngineOptions,
  type AdminOperation,
  type AdminRequest,
  type AdminResponse,
  type DescribedResource,
} from './engine.js';
