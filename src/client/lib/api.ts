import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public issues?: { path: string; message: string }[]) {
    super(message);
  }
}

function csrfToken(): string {
  return document.cookie.match(/(?:^|;\s*)(?:__Host-)?jalsetu_csrf=([^;]+)/)?.[1] ?? '';
}

type Body = Record<string, unknown> | unknown[] | Blob | undefined;

export async function api<T = unknown>(path: string, opts: { method?: string; body?: Body; headers?: Record<string, string> } = {}): Promise<T> {
  const { method = opts.body === undefined ? 'GET' : 'POST', body } = opts;
  const isBlob = body instanceof Blob;
  const res = await fetch(path.startsWith('/api') ? path : `/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined && !isBlob ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken() } : {}),
      ...opts.headers,
    },
    body: isBlob ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let data: { error?: string; code?: string; issues?: { path: string; message: string }[] } = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401 && !path.includes('/auth/')) window.dispatchEvent(new Event('jalsetu:unauthenticated'));
    if (data.code === 'PASSWORD_RESET_REQUIRED') window.dispatchEvent(new Event('jalsetu:must-reset'));
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.code, data.issues);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Loads `path` on mount / when it changes. Pass null to skip. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<ApiError | undefined>();
  const [loading, setLoading] = useState(Boolean(path));
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (mine === seq.current) {
        setData(d);
        setError(undefined);
      }
    } catch (e) {
      if (mine === seq.current) setError(e instanceof ApiError ? e : new ApiError(String(e), 0));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/** Wraps an async action with busy + error state, for buttons and forms. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [fn],
  );
  return { run, busy, error, setError };
}
