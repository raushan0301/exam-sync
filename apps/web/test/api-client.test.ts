import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './msw/server';
import {
  API_BASE_URL,
  VALID_ACCESS_TOKEN,
  VALID_REFRESH_TOKEN,
  ROTATED_ACCESS_TOKEN,
  ROTATED_REFRESH_TOKEN,
  resetRefreshCallCount,
} from './msw/handlers';
import { apiFetch, ApiError, NetworkError } from '@/lib/api-client';
import { setTokens, clearTokens, getAccessToken, getRefreshToken } from '@/lib/token-storage';

describe('apiFetch', () => {
  beforeEach(() => {
    clearTokens();
    resetRefreshCallCount();
  });

  afterEach(() => {
    clearTokens();
  });

  it('injects the Authorization header from stored token', async () => {
    setTokens('some-token', 'some-refresh');
    server.use(
      http.get(`${API_BASE_URL}/protected`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer some-token');
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await apiFetch('/protected');
    expect(result).toEqual({ ok: true });
  });

  it('401 -> refresh -> retries the original request once and succeeds', async () => {
    setTokens('stale-token', VALID_REFRESH_TOKEN);
    let calls = 0;
    server.use(
      // Pin the refresh response to the fixed ROTATED_* constants for a
      // deterministic assertion (the default handler issues random tokens).
      http.post(`${API_BASE_URL}/auth/refresh`, async ({ request }) => {
        const body = (await request.json()) as { refresh_token: string };
        expect(body.refresh_token).toBe(VALID_REFRESH_TOKEN);
        return HttpResponse.json({
          access_token: ROTATED_ACCESS_TOKEN,
          refresh_token: ROTATED_REFRESH_TOKEN,
          expires_in: 900,
        });
      }),
      http.get(`${API_BASE_URL}/protected`, ({ request }) => {
        calls += 1;
        const auth = request.headers.get('authorization');
        if (auth === `Bearer ${ROTATED_ACCESS_TOKEN}`) return HttpResponse.json({ ok: true });
        return HttpResponse.json({ statusCode: 401, message: 'Unauthorized' }, { status: 401 });
      }),
    );

    const result = await apiFetch('/protected');
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2); // original (401) + retry (success)
    expect(getAccessToken()).toBe(ROTATED_ACCESS_TOKEN);
    expect(getRefreshToken()).toBe(ROTATED_REFRESH_TOKEN); // rotated refresh token persisted
  });

  it('refresh failure clears tokens', async () => {
    setTokens('stale-token', 'not-a-valid-refresh-token');
    server.use(
      http.get(`${API_BASE_URL}/protected`, () =>
        HttpResponse.json({ statusCode: 401, message: 'Unauthorized' }, { status: 401 }),
      ),
    );

    await expect(apiFetch('/protected')).rejects.toBeInstanceOf(ApiError);
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('THE IMPORTANT ONE: concurrent 401s trigger only ONE POST /auth/refresh call', async () => {
    setTokens('stale-token', VALID_REFRESH_TOKEN);
    let localRefreshCalls = 0;
    server.use(
      http.post(`${API_BASE_URL}/auth/refresh`, () => {
        localRefreshCalls += 1;
        return HttpResponse.json({
          access_token: ROTATED_ACCESS_TOKEN,
          refresh_token: ROTATED_REFRESH_TOKEN,
          expires_in: 900,
        });
      }),
      http.get(`${API_BASE_URL}/protected-a`, ({ request }) => {
        const auth = request.headers.get('authorization');
        if (auth === `Bearer ${ROTATED_ACCESS_TOKEN}`) return HttpResponse.json({ ok: 'a' });
        return HttpResponse.json({ statusCode: 401, message: 'Unauthorized' }, { status: 401 });
      }),
      http.get(`${API_BASE_URL}/protected-b`, ({ request }) => {
        const auth = request.headers.get('authorization');
        if (auth === `Bearer ${ROTATED_ACCESS_TOKEN}`) return HttpResponse.json({ ok: 'b' });
        return HttpResponse.json({ statusCode: 401, message: 'Unauthorized' }, { status: 401 });
      }),
    );

    const [a, b] = await Promise.all([apiFetch('/protected-a'), apiFetch('/protected-b')]);
    expect(a).toEqual({ ok: 'a' });
    expect(b).toEqual({ ok: 'b' });
    expect(localRefreshCalls).toBe(1);
  });

  it('never retries more than once even if the retried request is still 401', async () => {
    setTokens('stale-token', VALID_REFRESH_TOKEN);
    let calls = 0;
    server.use(
      http.get(`${API_BASE_URL}/still-broken`, () => {
        calls += 1;
        return HttpResponse.json({ statusCode: 401, message: 'Unauthorized' }, { status: 401 });
      }),
    );

    await expect(apiFetch('/still-broken')).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(2); // original + one retry, never a third attempt
  });

  it('throws NetworkError (not ApiError) when fetch itself rejects', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    try {
      await expect(apiFetch('/anything')).rejects.toBeInstanceOf(NetworkError);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
