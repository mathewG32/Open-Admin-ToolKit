import { randomUUID } from 'node:crypto';
import type { AuditEvent, AuditOutcome } from './types.js';

/** Metadata keys that are always dropped, regardless of value. */
const SENSITIVE_KEY = /pass|secret|token|auth|cookie|session|api[-_]?key|private|credential|card|cvv|ssn|bearer/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const MAX_STRING = 200;
const MAX_KEYS = 20;

type MetaValue = string | number | boolean | null;

/** Removes newline/control characters (log-injection defense) and truncates. */
export function sanitizeAuditString(value: string): string {
  const cleaned = value.replace(CONTROL_CHARS, ' ');
  return cleaned.length > MAX_STRING ? `${cleaned.slice(0, MAX_STRING)}…` : cleaned;
}

/**
 * Keeps only small primitive values under non-sensitive keys.
 * Objects and arrays are dropped entirely so full request bodies can't leak in.
 */
export function redactMetadata(input: Readonly<Record<string, unknown>> | undefined): Record<string, MetaValue> {
  const out: Record<string, MetaValue> = {};
  if (!input) return out;
  let count = 0;
  for (const key of Object.keys(input)) {
    if (count >= MAX_KEYS) break;
    if (SENSITIVE_KEY.test(key)) continue;
    const v = input[key];
    let safe: MetaValue | undefined;
    if (v === null || typeof v === 'boolean') safe = v;
    else if (typeof v === 'number') safe = Number.isFinite(v) ? v : null;
    else if (typeof v === 'string') safe = sanitizeAuditString(v);
    if (safe === undefined) continue;
    out[sanitizeAuditString(key)] = safe;
    count++;
  }
  return out;
}

export type AuditEventInput = {
  actorId: string | null;
  action: string;
  outcome: AuditOutcome;
  requestId: string;
  resourceType?: string | undefined;
  resourceId?: string | undefined;
  tenantId?: string | undefined;
  metadata?: Readonly<Record<string, unknown>> | undefined;
  now?: Date | undefined;
};

export function buildAuditEvent(input: AuditEventInput): AuditEvent {
  const event: {
    -readonly [K in keyof AuditEvent]: AuditEvent[K];
  } = {
    eventId: randomUUID(),
    timestamp: (input.now ?? new Date()).toISOString(),
    actorId: input.actorId === null ? null : sanitizeAuditString(input.actorId),
    action: sanitizeAuditString(input.action),
    outcome: input.outcome,
    requestId: sanitizeAuditString(input.requestId),
    metadata: Object.freeze(redactMetadata(input.metadata)),
  };
  if (input.resourceType !== undefined) event.resourceType = sanitizeAuditString(input.resourceType);
  if (input.resourceId !== undefined) event.resourceId = sanitizeAuditString(input.resourceId);
  if (input.tenantId !== undefined) event.tenantId = sanitizeAuditString(input.tenantId);
  return Object.freeze(event);
}

/** Simple in-memory sink for demos and tests. Not for production persistence. */
export function createMemoryAuditSink(maxEvents = 1000): { sink: (e: AuditEvent) => void; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    sink: (e) => {
      events.push(e);
      if (events.length > maxEvents) events.shift();
    },
  };
}
