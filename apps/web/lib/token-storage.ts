/**
 * Centralized, typed localStorage wrapper for auth tokens. No other file in
 * the app should call `localStorage.getItem/setItem` for tokens directly —
 * go through these functions so key names and SSR-safety live in one place.
 */

const ACCESS_TOKEN_KEY = 'exam_sync_access_token';
const REFRESH_TOKEN_KEY = 'exam_sync_refresh_token';

/**
 * Fired on `window` whenever tokens are set/cleared, so IdentityProvider
 * (whose GET /users/me query is intentionally gated behind
 * `enabled: hasStoredSession()` to avoid firing pre-emptively while
 * signed out) knows to re-evaluate that gate and let TanStack Query's own
 * "enabled flips false -> true" behavior trigger the fetch. Without this,
 * a token appearing via login has no way to notify an already-mounted,
 * previously-disabled query observer.
 */
const AUTH_CHANGE_EVENT = 'exam-sync-auth-change';

function notifyAuthChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
  }
}

export function onAuthChange(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(AUTH_CHANGE_EVENT, listener);
  return () => window.removeEventListener(AUTH_CHANGE_EVENT, listener);
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

/** Persist a freshly-issued token pair. Refresh tokens rotate — always call this with the NEW refresh_token. */
export function setTokens(accessToken: string, refreshToken: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  notifyAuthChange();
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  notifyAuthChange();
}

export function hasStoredSession(): boolean {
  return !!getAccessToken();
}
