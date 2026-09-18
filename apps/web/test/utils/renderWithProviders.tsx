import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IdentityProvider } from '@/lib/identity/IdentityProvider';
import { ToastProvider } from '@/components/ui/Toast';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(ui: ReactElement, { queryClient = createTestQueryClient() } = {}) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <IdentityProvider>{children}</IdentityProvider>
        </ToastProvider>
      </QueryClientProvider>
    );
  }
  return { ...render(ui, { wrapper: Wrapper }), queryClient };
}
