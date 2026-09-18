/**
 * Typed fetch wrapper — Milestone 2's real data layer, replacing the M1
 * placeholder. Adds: automatic bearer-token injection, single-flight
 * 401-triggered token refresh with one retry, and typed responses.
 *
 * Refresh-storm prevention: `refreshPromise` is a MODULE-LEVEL singleton.
 * Every concurrent request that hits a 401 calls `getRefreshPromise()`,
 * which returns the SAME in-flight promise if one is already running
 * instead of firing a new POST /auth/refresh. Once it settles (success or
 * failure) the slot is cleared so a later 401 can start a fresh refresh.
 */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './token-storage';

export interface ApiErrorBody {
  message?: string;
  error?: { message?: string };
  details?: unknown;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody | null,
  ) {
    super(body?.message ?? body?.error?.message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
  }

  /** Structured validation/conflict details the backend attached, if any. */
  get details(): unknown {
    return this.body?.details;
  }
}

export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('Network request failed');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

// Paths that must never trigger the 401-refresh-retry dance (avoids loops).
const AUTH_EXEMPT_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout'];

let refreshPromise: Promise<boolean> | null = null;

/** Returns the single shared in-flight refresh promise, starting one if needed. */
function getRefreshPromise(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;

    try {
      const res = await fetch(new URL('/auth/refresh', API_BASE_URL).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as TokenPair;
      // Refresh tokens rotate server-side — always persist the NEW pair.
      setTokens(data.access_token, data.refresh_token);
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

function redirectToLogin(): void {
  clearTokens();
  if (typeof window !== 'undefined') {
    const redirect = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?redirect=${redirect}`;
  }
}

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
  signal?: AbortSignal;
  /** Extra request headers — e.g. `If-Match` for optimistic-concurrency writes (BR-051). */
  headers?: Record<string, string>;
  /** Internal: set on the retry attempt to prevent infinite retry loops. */
  _isRetry?: boolean;
}

export async function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const url = new URL(path, API_BASE_URL);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
  }

  const isExempt = AUTH_EXEMPT_PATHS.some((p) => path.startsWith(p));
  const token = getAccessToken();

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token && !isExempt ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (err) {
    // fetch throws before a response is received — distinct from a 5xx.
    throw new NetworkError(err);
  }

  const isNoContent = res.status === 204;
  const data = isNoContent ? null : await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 401 && !isExempt && !options._isRetry) {
      const refreshed = await getRefreshPromise();
      if (refreshed) {
        return apiFetch<T>(path, { ...options, _isRetry: true });
      }
      redirectToLogin();
      throw new ApiError(401, data);
    }
    throw new ApiError(res.status, data);
  }

  return data as T;
}
