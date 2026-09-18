'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type { Notification } from '../queries/types';

/**
 * PATCH /me/notifications/{id}/read — self-scoped, any role. No request
 * body. Idempotent server-side (already-read is a silent no-op success).
 * Invalidates the notifications list so `readAt` refreshes everywhere it's
 * rendered (inbox page + the M3 NotificationsPanel dashboard widget).
 */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<Notification | null>(`/me/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
    },
  });
}
