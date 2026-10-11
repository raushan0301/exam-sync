import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './msw/server';
import { API_BASE_URL, VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN } from './msw/handlers';
import { fetchAllPages, fetchList } from '@/lib/queries/fetch-list';
import { setTokens, clearTokens } from '@/lib/token-storage';

type Row = { id: string };
const rows = (from: number, to: number): Row[] => Array.from({ length: to - from }, (_, i) => ({ id: `r${from + i}` }));

describe('fetchAllPages / fetchList — pick-lists must not stop at the server page cap', () => {
  beforeEach(() => setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN));
  afterEach(() => clearTokens());

  it('follows next_cursor across every page and returns all rows in one result', async () => {
    const seen: { cursor: string | null; limit: string | null }[] = [];
    server.use(
      http.get(`${API_BASE_URL}/faculty`, ({ request }) => {
        const url = new URL(request.url);
        const cursor = url.searchParams.get('cursor');
        seen.push({ cursor, limit: url.searchParams.get('limit') });
        if (!cursor) return HttpResponse.json({ items: rows(0, 200), next_cursor: 'c1' });
        if (cursor === 'c1') return HttpResponse.json({ items: rows(200, 400), next_cursor: 'c2' });
        return HttpResponse.json({ items: rows(400, 450), next_cursor: null });
      }),
    );

    const result = await fetchAllPages<Row>('/faculty', { status: 'ACTIVE' });

    expect(result.items).toHaveLength(450);
    expect(new Set(result.items.map((r) => r.id)).size).toBe(450); // no duplicates
    expect(result.next_cursor).toBeNull();
    expect(seen).toEqual([
      { cursor: null, limit: '200' },
      { cursor: 'c1', limit: '200' },
      { cursor: 'c2', limit: '200' },
    ]);
  });

  it('keeps the caller\'s own filters on every page', async () => {
    const statuses: (string | null)[] = [];
    server.use(
      http.get(`${API_BASE_URL}/batches`, ({ request }) => {
        const url = new URL(request.url);
        statuses.push(url.searchParams.get('status'));
        return HttpResponse.json(
          url.searchParams.get('cursor') ? { items: rows(1, 2), next_cursor: null } : { items: rows(0, 1), next_cursor: 'c1' },
        );
      }),
    );
    await fetchAllPages<Row>('/batches', { status: 'ACTIVE' });
    expect(statuses).toEqual(['ACTIVE', 'ACTIVE']);
  });

  it('stops at the safety cap instead of looping forever, and flags the truncation', async () => {
    let calls = 0;
    server.use(
      http.get(`${API_BASE_URL}/subjects`, () => {
        calls++;
        return HttpResponse.json({ items: rows(calls, calls + 1), next_cursor: `c${calls}` });
      }),
    );

    const result = await fetchAllPages<Row>('/subjects');

    expect(calls).toBe(100);
    expect(result.items).toHaveLength(100);
    expect(result.next_cursor).toBe('c100'); // still set -> truncation is detectable
  });

  it('fetchList without `all` makes ONE request and never sends the client-only `all` flag', async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${API_BASE_URL}/programs`, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({ items: rows(0, 3), next_cursor: 'more' });
      }),
    );

    const result = await fetchList<Row>('/programs', { status: 'ACTIVE', limit: '25' });

    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]).searchParams.has('all')).toBe(false);
    expect(result.next_cursor).toBe('more'); // a normal page keeps its cursor
  });

  it('fetchList with all=true loops, uses the 200 page size, and does not send `all`', async () => {
    const seen: { limit: string | null; all: boolean }[] = [];
    server.use(
      http.get(`${API_BASE_URL}/departments`, ({ request }) => {
        const url = new URL(request.url);
        seen.push({ limit: url.searchParams.get('limit'), all: url.searchParams.has('all') });
        return HttpResponse.json(
          url.searchParams.get('cursor') ? { items: rows(1, 3), next_cursor: null } : { items: rows(0, 1), next_cursor: 'c1' },
        );
      }),
    );

    const result = await fetchList<Row>('/departments', { all: 'true', limit: '25' });

    expect(result.items).toHaveLength(3);
    expect(seen).toEqual([{ limit: '200', all: false }, { limit: '200', all: false }]);
  });
});
