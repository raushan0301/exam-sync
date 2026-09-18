import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './utils/renderWithProviders';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: replace }),
  useSearchParams: () => new URLSearchParams(''),
}));

import LoginPage from '@/app/login/page';

describe('Login page', () => {
  it('success: redirects to the correct dashboard for the resolved role', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/email/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password1');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/dashboard'));
  });

  it('failure (401): shows the backend generic invalid-credentials message', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/email/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
  });
});
