'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/Toast';
import { IdentityProvider } from '@/lib/identity/IdentityProvider';

/**
 * Client-side provider tree. M2 adds IdentityProvider (GET /users/me,
 * fetched exactly once app-wide) on top of M1's QueryClient + Toast infra.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <IdentityProvider>{children}</IdentityProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
