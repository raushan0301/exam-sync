/**
 * Cursor pagination shared across list endpoints (API_CONTRACT.md "cursor
 * pagination everywhere ... never offset pagination"). First used ad hoc in
 * Phase 1's UsersService; extracted here now that Phase 2 needs the
 * identical shape four more times (departments/programs/batches/subjects)
 * — three-plus real call sites is the point past which sharing beats
 * duplication, not before.
 */
export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  next_cursor: string | null;
}

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 200;

export function resolveLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
}

/** Prisma `findMany` args for cursor pagination, given a resolved limit. */
export function cursorFindManyArgs(cursor: string | undefined, limit: number) {
  return {
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  };
}

/** Slices the over-fetched (`limit + 1`) row set into a page + next_cursor. */
export function toPaginatedResult<T extends { id: string }>(
  rows: T[],
  limit: number,
): PaginatedResult<T> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page,
    next_cursor: hasMore ? page[page.length - 1].id : null,
  };
}
