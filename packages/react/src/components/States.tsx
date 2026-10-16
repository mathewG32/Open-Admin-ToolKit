import { AdminClientError } from '../client.js';

/** Placeholder bars shown while data loads. Announced once to screen readers. */
export function Loading({ label = 'Loading', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="oa-loading" role="status" aria-live="polite">
      <span className="oa-sr">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="oa-skeleton" style={{ width: `${92 - i * 14}%` }} aria-hidden="true" />
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="oa-empty">
      <p className="oa-empty-title">{title}</p>
      {children && <p className="oa-empty-body">{children}</p>}
    </div>
  );
}

/** What went wrong and what to do about it, based on the API's error code. */
export function describeError(error: unknown, subject: string): { title: string; body: string } {
  if (error instanceof AdminClientError) {
    switch (error.status) {
      case 0:
        return { title: 'Can’t reach the admin API', body: error.message };
      case 401:
        return { title: 'Sign in to continue', body: 'You’re signed out, or your session has expired.' };
      case 403:
        return { title: `Your role can’t open ${subject}`, body: 'Ask an administrator for access if you need it.' };
      case 404:
        return { title: `${subject} wasn’t found`, body: 'It may have been removed, or it isn’t available to your account.' };
      case 400:
        return {
          title: 'That request isn’t valid',
          body: error.details?.param ? `Check “${error.details.param}”: ${error.details.reason ?? error.message}` : error.message,
        };
      case 503:
        return { title: 'Activity logging is unavailable', body: 'Data is hidden until the audit log is reachable again, so every view is recorded.' };
      case 504:
        return { title: `${subject} took too long to load`, body: 'Try again. If it keeps happening, the data source may be overloaded.' };
      default:
        return { title: `${subject} couldn’t be loaded`, body: error.message };
    }
  }
  return { title: `${subject} couldn’t be loaded`, body: 'An unexpected error occurred.' };
}

export function ErrorState({
  error,
  subject,
  onRetry,
  loginUrl,
}: {
  error: unknown;
  subject: string;
  onRetry?: () => void;
  loginUrl?: string | undefined;
}) {
  const { title, body } = describeError(error, subject);
  const requestId = error instanceof AdminClientError ? error.requestId : undefined;
  const status = error instanceof AdminClientError ? error.status : undefined;
  return (
    <div className="oa-error" role="alert">
      <p className="oa-error-title">{title}</p>
      <p className="oa-error-body">{body}</p>
      <div className="oa-error-actions">
        {status === 401 && loginUrl && <a className="oa-button oa-button--primary" href={loginUrl}>Sign in</a>}
        {status !== 401 && status !== 403 && status !== 404 && onRetry && (
          <button type="button" className="oa-button" onClick={onRetry}>Try again</button>
        )}
      </div>
      {requestId && <p className="oa-error-ref">Reference for support: <code>{requestId}</code></p>}
    </div>
  );
}
