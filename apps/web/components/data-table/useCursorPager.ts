'use client';

import { useState } from 'react';

/**
 * Manages cursor-based pagination state for a single list view. The
 * backend only returns an opaque `next_cursor` (no page numbers, no total
 * count, no "previous cursor") — so "Prev" is implemented here as a client-
 * side stack of previously-visited cursors, popped on Prev and pushed on
 * Next. Reset (`reset()`) whenever a filter/search change should return to
 * page 1 — call it from the same place you change the filter.
 */
export function useCursorPager() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<(string | undefined)[]>([]);

  function goNext(nextCursor: string | null | undefined) {
    if (!nextCursor) return;
    setHistory((h) => [...h, cursor]);
    setCursor(nextCursor);
  }

  function goPrev() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const copy = [...h];
      const prev = copy.pop();
      setCursor(prev);
      return copy;
    });
  }

  function reset() {
    setCursor(undefined);
    setHistory([]);
  }

  return { cursor, hasPrev: history.length > 0, goNext, goPrev, reset };
}
