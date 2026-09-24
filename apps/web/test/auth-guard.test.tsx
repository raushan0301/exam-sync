import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { setTokens } from '@/lib/token-storage';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { renderWithProviders } from './utils/renderWithProviders';
import { SESSION_TOKENS, ADMIN_USER, VALID_REFRESH_TOKEN } from './msw/handlers';

const replaceMock = vi.fn();
let currentPathname = '/admin/dashboard';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: replaceMock }),
  usePathname: () => currentPathname,
}));

describe('AuthGuard', () => {
  it('redirects unauthenticated access to /login with ?redirect=<path>', async () => {
    renderWithProviders(
      <AuthGuard>
        <div>protected content</div>
      </AuthGuard>,
    );

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/login?redirect=%2Fadmin%2Fdashboard');
    });
  });

  it('redirects an authenticated user with mustChangePassword to /change-password', async () => {
    const token = 'must-change-password-token';
    SESSION_TOKENS[token] = { ...ADMIN_USER, mustChangePassword: true };
    setTokens(token, VALID_REFRESH_TOKEN);
    currentPathname = '/admin/dashboard';

    renderWithProviders(
      <AuthGuard>
        <div>protected content</div>
      </AuthGuard>,
    );

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/change-password');
    });
  });

  it('does NOT redirect away from /change-password itself, even with mustChangePassword true', async () => {
    const token = 'must-change-password-token-2';
    SESSION_TOKENS[token] = { ...ADMIN_USER, mustChangePassword: true };
    setTokens(token, VALID_REFRESH_TOKEN);
    currentPathname = '/change-password';
    replaceMock.mockClear();

    renderWithProviders(
      <AuthGuard>
        <div>change password form</div>
      </AuthGuard>,
    );

    expect(await screen.findByText('change password form')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalledWith('/change-password');
  });
});
