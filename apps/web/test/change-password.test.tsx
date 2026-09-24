import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens, getAccessToken } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import { SESSION_TOKENS, ADMIN_USER, VALID_REFRESH_TOKEN } from './msw/handlers';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: replace }),
  usePathname: () => '/change-password',
}));

import ChangePasswordPage from '@/app/change-password/page';

function signInWithMustChangePassword(token: string) {
  SESSION_TOKENS[token] = { ...ADMIN_USER, mustChangePassword: true };
  setTokens(token, VALID_REFRESH_TOKEN);
}

describe('Change password page', () => {
  it('rejects a new password shorter than 8 characters (client-side, before any request)', async () => {
    signInWithMustChangePassword('cp-token-1');
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordPage />);

    await user.type(await screen.findByLabelText(/current \(temporary\) password/i), 'temp-pass');
    await user.type(screen.getByLabelText(/^new password/i), 'short1');
    await user.type(screen.getByLabelText(/confirm new password/i), 'short1');
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
  });

  it('rejects a new password with no digit', async () => {
    signInWithMustChangePassword('cp-token-2');
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordPage />);

    await user.type(await screen.findByLabelText(/current \(temporary\) password/i), 'temp-pass');
    await user.type(screen.getByLabelText(/^new password/i), 'nodigitshere');
    await user.type(screen.getByLabelText(/confirm new password/i), 'nodigitshere');
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText('Password must contain at least one number.')).toBeInTheDocument();
  });

  it('rejects mismatched confirmation', async () => {
    signInWithMustChangePassword('cp-token-3');
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordPage />);

    await user.type(await screen.findByLabelText(/current \(temporary\) password/i), 'temp-pass');
    await user.type(screen.getByLabelText(/^new password/i), 'newpassword1');
    await user.type(screen.getByLabelText(/confirm new password/i), 'different1');
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
  });

  it('shows the backend error for an incorrect current password', async () => {
    signInWithMustChangePassword('cp-token-4');
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordPage />);

    await user.type(await screen.findByLabelText(/current \(temporary\) password/i), 'wrong-current-password');
    await user.type(screen.getByLabelText(/^new password/i), 'newpassword1');
    await user.type(screen.getByLabelText(/confirm new password/i), 'newpassword1');
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
  });

  it('success: clears the local session and redirects to /login', async () => {
    const token = 'cp-token-5';
    signInWithMustChangePassword(token);
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordPage />);

    await user.type(await screen.findByLabelText(/current \(temporary\) password/i), 'temp-pass');
    await user.type(screen.getByLabelText(/^new password/i), 'newpassword1');
    await user.type(screen.getByLabelText(/confirm new password/i), 'newpassword1');
    await user.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?changed=1'));
    expect(getAccessToken()).toBeNull();
  });
});
