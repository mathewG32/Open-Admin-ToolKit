import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export type AsyncState<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'success'; data: T; error?: undefined }
  | { status: 'error'; data?: undefined; error: unknown };

/**
 * Runs `fn` whenever `deps` change, aborting the previous run. Returns the
 * state plus a `reload` function. Results from stale runs are ignored.
 */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: DependencyList): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fnRef.current(controller.signal).then(
      (data) => { if (!controller.signal.aborted) setState({ status: 'success', data }); },
      (error: unknown) => {
        if (controller.signal.aborted || (error as { name?: string })?.name === 'AbortError') return;
        setState({ status: 'error', error });
      },
    );
    return () => controller.abort();
    // `deps` is the caller's dependency list, so this effect intentionally spreads it.
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

export type Route =
  | { page: 'overview' }
  | { page: 'resource'; resourceId: string; recordId?: string };

/** Parses `#/r/users/usr_1` style hashes. Unknown hashes fall back to the overview. */
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  if (parts[0] === 'r' && parts[1]) {
    return parts[2] ? { page: 'resource', resourceId: parts[1], recordId: parts[2] } : { page: 'resource', resourceId: parts[1] };
  }
  return { page: 'overview' };
}

export function routeHref(route: Route): string {
  if (route.page === 'overview') return '#/';
  const base = `#/r/${encodeURIComponent(route.resourceId)}`;
  return route.recordId ? `${base}/${encodeURIComponent(route.recordId)}` : base;
}

/** Hash-based routing, so hosts don't need server-side route configuration. */
export function useHashRoute(): [Route, (r: Route) => void] {
  const read = () => (typeof window === 'undefined' ? { page: 'overview' as const } : parseHash(window.location.hash));
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((r: Route) => {
    const href = routeHref(r);
    if (window.location.hash !== href) window.location.hash = href;
    setRoute(r);
  }, []);
  return [route, navigate];
}

/** Tracks an element's content width, for charts that draw in real pixels. */
export function useElementWidth<T extends HTMLElement>(fallback = 560): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(Math.round(w));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Debounces a value, used for filter inputs so we don't query on every keystroke. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
