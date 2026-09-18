import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useIdentity } from '@/lib/identity/IdentityProvider';
import { setTokens } from '@/lib/token-storage';
import { VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN } from './msw/handlers';
import { renderWithProviders } from './utils/renderWithProviders';

function Probe() {
  const { user, isAuthenticated, isLoading, primaryRole } = useIdentity();
  if (isLoading) return <div>loading</div>;
  return (
    <div>
      <div data-testid="authenticated">{String(isAuthenticated)}</div>
      <div data-testid="email">{user?.email ?? 'none'}</div>
      <div data-testid="role">{primaryRole ?? 'none'}</div>
    </div>
  );
}

describe('IdentityProvider / useIdentity', () => {
  it('exposes isAuthenticated=false and user=null with no stored token', async () => {
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId('authenticated').textContent).toBe('false'));
    expect(screen.getByTestId('email').textContent).toBe('none');
  });

  it('fetches GET /users/me once a token is present and exposes user/role', async () => {
    setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN);
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId('authenticated').textContent).toBe('true'));
    expect(screen.getByTestId('email').textContent).toBe('admin@exam-sync.test');
    expect(screen.getByTestId('role').textContent).toBe('ADMIN');
  });
});
