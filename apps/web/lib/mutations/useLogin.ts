'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { setTokens } from '../token-storage';
import { queryKeys } from '../queries/queryKeys';

interface LoginInput {
  email: string;
  password: string;
}

interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: LoginInput) => apiFetch<TokenPair>('/auth/login', { method: 'POST', body: input }),
    onSuccess: async (data) => {
      setTokens(data.access_token, data.refresh_token);
      // Fetch the freshly-authenticated identity before the caller redirects.
      await queryClient.invalidateQueries({ queryKey: queryKeys.currentUser() });
      await queryClient.refetchQueries({ queryKey: queryKeys.currentUser() });
    },
  });
}
