import { apiFetch } from '../api-client';
import type { PaginatedResult } from './types';

/** The server clamps every list request to this many rows per page (`MAX_PAGE_LIMIT` in the API). */
const SERVER_MAX_PAGE_SIZE = 200;
/** Safety stop so a bug or runaway dataset can't loop forever: 100 pages = 20,000 rows. */
const MAX_PAGES = 100;

/**
 * Follows `next_cursor` until the list is exhausted and returns everything as
 * one page (`next_cursor: null`), so pick-lists show EVERY row instead of
 * silently stopping at the server's 200-row page cap. If the safety stop is
 * ever hit, `next_cursor` is left set so the truncation is detectable.
 */
export async function fetchAllPages<T>(
  path: string,
  query: Record<string, string | undefined> = {},
): Promise<PaginatedResult<T>> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await apiFetch<PaginatedResult<T>>(path, {
      query: { ...query, limit: String(SERVER_MAX_PAGE_SIZE), cursor },
    });
    items.push(...result.items);
    if (!result.next_cursor) return { items, next_cursor: null };
    cursor = result.next_cursor;
  }
  return { items, next_cursor: cursor ?? null };
}

/**
 * One page by default; every page when the query carries `all: 'true'` (set by
 * a hook's `all: true` option). `all` is a client-side switch — never sent to the API.
 */
export function fetchList<T>(
  path: string,
  query: Record<string, string | undefined>,
): Promise<PaginatedResult<T>> {
  const { all, ...rest } = query;
  return all === 'true' ? fetchAllPages<T>(path, rest) : apiFetch<PaginatedResult<T>>(path, { query: rest });
}
