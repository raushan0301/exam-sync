'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from '../queries/queryKeys';

/** POST /me/nav-seen — "I opened this page", which clears its "new" badge. */
export function useMarkNavSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => apiFetch<void>('/me/nav-seen', { method: 'POST', body: { key } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.navCounts }),
  });
}
