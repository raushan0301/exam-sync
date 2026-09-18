import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import { RoleGate } from '@/components/auth/RoleGate';
import { VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN, STUDENT_ACCESS_TOKEN, STUDENT_REFRESH_TOKEN } from './msw/handlers';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

describe('RoleGate', () => {
  it('renders Forbidden for a signed-in user whose role is not in `allow`, with a working "Return to dashboard" link', async () => {
    setTokens(STUDENT_ACCESS_TOKEN, STUDENT_REFRESH_TOKEN);

    renderWithProviders(
      <RoleGate allow={['ADMIN']}>
        <div>admin-only content</div>
      </RoleGate>,
    );

    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByText('admin-only content')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /return to dashboard/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/student/dashboard'));
  });

  it('renders children for an allowed role', async () => {
    setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN);

    renderWithProviders(
      <RoleGate allow={['ADMIN']}>
        <div>admin-only content</div>
      </RoleGate>,
    );

    expect(await screen.findByText('admin-only content')).toBeInTheDocument();
  });
});
