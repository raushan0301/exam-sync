import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useLogout } from '@/lib/mutations/useLogout';
import { setTokens, getAccessToken, getRefreshToken } from '@/lib/token-storage';
import { VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN } from './msw/handlers';
import { createTestQueryClient } from './utils/renderWithProviders';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock }),
}));

describe('Logout', () => {
  it('clears tokens and redirects to /login', async () => {
    setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN);
    expect(getAccessToken()).toBe(VALID_ACCESS_TOKEN);

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useLogout(), {
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });

    result.current.mutate();

    await waitFor(() => {
      expect(getAccessToken()).toBeNull();
      expect(getRefreshToken()).toBeNull();
      expect(pushMock).toHaveBeenCalledWith('/login');
    });
  });
});
