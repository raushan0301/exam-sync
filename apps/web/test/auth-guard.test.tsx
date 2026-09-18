import { describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { renderWithProviders } from './utils/renderWithProviders';

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: replaceMock }),
  usePathname: () => '/admin/dashboard',
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
});
