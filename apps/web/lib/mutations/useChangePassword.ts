'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { clearTokens } from '../token-storage';
import { queryKeys } from '../queries/queryKeys';

interface ChangePasswordInput {
  current_password: string;
  new_password: string;
}

/**
 * POST /auth/change-password — the only way to clear a `mustChangePassword`
 * account. The backend revokes every refresh token on success (a password
 * change is treated the same as suspected compromise — force re-auth
 * everywhere), so the local session is cleared here too rather than trying
 * to keep the now-half-dead one alive; the caller should redirect to
 * /login after this resolves.
 */
export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      apiFetch<void>('/auth/change-password', { method: 'POST', body: input }),
    onSuccess: () => {
      clearTokens();
      queryClient.removeQueries({ queryKey: queryKeys.currentUser() });
    },
  });
}
