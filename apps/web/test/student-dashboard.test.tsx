import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import { server } from './msw/server';
import { API_BASE_URL, STUDENT_ACCESS_TOKEN, STUDENT_REFRESH_TOKEN, setMockNotifications } from './msw/handlers';
import StudentDashboardPage from '@/app/student/dashboard/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/student/dashboard',
}));

function signInAsStudent() {
  setTokens(STUDENT_ACCESS_TOKEN, STUDENT_REFRESH_TOKEN);
}

describe('Student dashboard', () => {
  it('always renders the honest "My Schedule" empty state (no backend data source exists)', async () => {
    signInAsStudent();
    setMockNotifications([]);

    renderWithProviders(<StudentDashboardPage />);

    expect(screen.getByText('Student Dashboard')).toBeInTheDocument();
    expect(await screen.findByText('Exam schedule coming soon')).toBeInTheDocument();
  });

  it('loading state renders a skeleton for the notifications panel', () => {
    signInAsStudent();
    renderWithProviders(<StudentDashboardPage />);

    expect(screen.queryByText('No notifications yet')).not.toBeInTheDocument();
  });

  it('success state renders real notifications from the mocked response', async () => {
    signInAsStudent();
    setMockNotifications([
      {
        id: 'n1',
        eventType: 'QUIZ_APPROVED',
        channel: 'IN_APP',
        payload: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        sentAt: '2026-01-01T00:00:00.000Z',
        readAt: null,
      },
    ]);

    renderWithProviders(<StudentDashboardPage />);

    expect(await screen.findByText('Quiz approved')).toBeInTheDocument();
    expect(await screen.findByText('1 unread')).toBeInTheDocument();
  });

  it('empty state renders "No notifications yet" when the list is empty', async () => {
    signInAsStudent();
    setMockNotifications([]);

    renderWithProviders(<StudentDashboardPage />);

    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();
  });

  it('error state renders with a working retry that re-fetches', async () => {
    signInAsStudent();
    let calls = 0;
    server.use(
      http.get(`${API_BASE_URL}/me/notifications`, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    renderWithProviders(<StudentDashboardPage />);

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: /retry/i });
    retryButton.click();

    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getByText('No notifications yet')).toBeInTheDocument());
  });
});
