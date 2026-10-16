/**
 * Typed, safe error model. Every error that can reach a client is an AdminError
 * with a stable code and a message that is safe to show. Anything else is
 * treated as an internal error and its details are never serialized.
 */

export type AdminErrorCode =
  | 'UNAUTHENTICATED' // 401: no verified identity
  | 'FORBIDDEN' // 403: identity verified, permission denied
  | 'NOT_FOUND' // 404: unknown resource/record, or existence hidden
  | 'BAD_REQUEST' // 400: invalid query/input
  | 'TIMEOUT' // 504: host provider took too long
  | 'UNAVAILABLE' // 503: a required dependency (e.g. audit sink) is down
  | 'INTERNAL'; // 500: anything unexpected

const STATUS: Record<AdminErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  TIMEOUT: 504,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};

const DEFAULT_MESSAGE: Record<AdminErrorCode, string> = {
  UNAUTHENTICATED: 'Authentication required.',
  FORBIDDEN: 'You do not have permission to perform this operation.',
  NOT_FOUND: 'Not found.',
  BAD_REQUEST: 'Invalid request.',
  TIMEOUT: 'The operation timed out.',
  UNAVAILABLE: 'A required service is unavailable.',
  INTERNAL: 'An internal error occurred.',
};

export class AdminError extends Error {
  readonly code: AdminErrorCode;
  readonly status: number;
  /** Safe, client-visible details (e.g. which query param was invalid). Never put secrets here. */
  readonly details: Readonly<Record<string, string>> | undefined;

  constructor(code: AdminErrorCode, message?: string, details?: Record<string, string>) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.name = 'AdminError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export function isAdminError(err: unknown): err is AdminError {
  return err instanceof AdminError;
}

/** Shape sent to clients. Contains no stack, no raw provider/database message. */
export type SafeErrorBody = {
  error: {
    code: AdminErrorCode;
    message: string;
    requestId: string;
    details?: Readonly<Record<string, string>>;
  };
};

/**
 * Converts any thrown value into a client-safe body + status.
 * Non-AdminErrors collapse to INTERNAL with a generic message.
 */
export function toSafeError(err: unknown, requestId: string): { status: number; body: SafeErrorBody } {
  const e = isAdminError(err) ? err : new AdminError('INTERNAL');
  const body: SafeErrorBody = { error: { code: e.code, message: e.message, requestId } };
  if (e.details && Object.keys(e.details).length > 0) body.error.details = e.details;
  return { status: e.status, body };
}
