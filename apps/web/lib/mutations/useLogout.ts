'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../api-client';
import { clearTokens } from '../token-storage';

/**
 * Calls POST /auth/logout to revoke the refresh token server-side, then
 * ALWAYS clears local tokens and redirects to /login — even if the network
 * call fails, so a user is never stuck "logged in" locally with a dead
 * session.
 */
export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () => apiFetch('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      clearTokens();
      queryClient.clear();
      router.push('/login');
    },
  });
}
