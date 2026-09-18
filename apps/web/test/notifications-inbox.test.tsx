import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import { SESSION_TOKENS, ADMIN_USER, STUDENT_REFRESH_TOKEN, setMockNotifications, type MockNotification } from './msw/handlers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
}));

import AdminNotificationsPage from '@/app/admin/notifications/page';

const ADMIN_TOKEN = 'notifications-admin-token';
SESSION_TOKENS[ADMIN_TOKEN] = ADMIN_USER;

function signInAsAdmin() {
  setTokens(ADMIN_TOKEN, STUDENT_REFRESH_TOKEN);
}

function makeNotification(overrides: Partial<MockNotification> = {}): MockNotification {
  return {
    id: 'notif-1',
    eventType: 'QUIZ_APPROVED',
    channel: 'IN_APP',
    payload: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    sentAt: '2026-01-01T00:00:01.000Z',
    readAt: null,
    ...overrides,
  };
}

describe('Notifications inbox', () => {
  it('loads and shows unread notifications distinctly', async () => {
    signInAsAdmin();
    setMockNotifications([
      makeNotification({ id: 'n-unread', eventType: 'QUIZ_APPROVED', readAt: null }),
      makeNotification({ id: 'n-read', eventType: 'INCIDENT_CREATED', readAt: '2026-01-01T01:00:00.000Z' }),
    ]);
    renderWithProviders(<AdminNotificationsPage />);

    await screen.findByText(/quiz approved/i);
    expect(screen.getByText(/incident created/i)).toBeInTheDocument();
    // Unread row exposes a "Mark read" action; the already-read row doesn't.
    expect(screen.getAllByRole('button', { name: /mark read/i }).length).toBe(1);
  });

  it('marks a notification as read and updates the UI', async () => {
    signInAsAdmin();
    setMockNotifications([makeNotification({ id: 'n-unread', readAt: null })]);
    renderWithProviders(<AdminNotificationsPage />);

    await screen.findByText(/quiz approved/i);
    const markReadButton = screen.getByRole('button', { name: /mark read/i });
    await userEvent.click(markReadButton);

    await waitFor(() => expect(screen.queryByRole('button', { name: /mark read/i })).not.toBeInTheDocument());
  });

  it('shows an empty state with no notifications', async () => {
    signInAsAdmin();
    setMockNotifications([]);
    renderWithProviders(<AdminNotificationsPage />);

    expect(await screen.findByText(/no notifications yet/i)).toBeInTheDocument();
  });
});
