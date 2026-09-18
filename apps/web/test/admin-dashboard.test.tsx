import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import { server } from './msw/server';
import { API_BASE_URL, VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN, setMockQuizzes, setMockIncidents } from './msw/handlers';
import AdminDashboardPage from '@/app/admin/dashboard/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/dashboard',
}));

function signInAsAdmin() {
  setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN);
}

describe('Admin dashboard', () => {
  it('loading state renders skeletons before data resolves', () => {
    signInAsAdmin();
    setMockQuizzes([]);
    setMockIncidents([]);
    renderWithProviders(<AdminDashboardPage />);

    expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    // KpiTileSkeleton renders no "Pending Quiz Approvals" text yet.
    expect(screen.queryByText('Pending Quiz Approvals')).not.toBeInTheDocument();
  });

  it('success state renders real counts from mocked responses', async () => {
    signInAsAdmin();
    setMockQuizzes([
      {
        id: 'q1',
        title: 'Midterm',
        status: 'SUBMITTED',
        subjectId: 's1',
        createdByFacultyId: 'f1',
        academicYear: '2025-2026',
        semester: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'q2',
        title: 'Final',
        status: 'SUBMITTED',
        subjectId: 's1',
        createdByFacultyId: 'f2',
        academicYear: '2025-2026',
        semester: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    setMockIncidents([
      {
        id: 'i1',
        incidentType: 'CHEATING',
        severity: 'CRITICAL',
        status: 'OPEN',
        examSessionId: 'es1',
        description: 'x',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    renderWithProviders(<AdminDashboardPage />);

    expect(await screen.findByText('Pending Quiz Approvals')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
    expect(await screen.findByText('Open Incidents')).toBeInTheDocument();
    expect(await screen.findByText('CRITICAL')).toBeInTheDocument();
  });

  it('empty state renders "No open incidents" as good news when the list is empty', async () => {
    signInAsAdmin();
    setMockQuizzes([]);
    setMockIncidents([]);

    renderWithProviders(<AdminDashboardPage />);

    expect(await screen.findByText('No open incidents')).toBeInTheDocument();
  });

  it('error state renders with a working retry that re-fetches', async () => {
    signInAsAdmin();
    let calls = 0;
    server.use(
      http.get(`${API_BASE_URL}/quizzes`, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    renderWithProviders(<AdminDashboardPage />);

    expect(await screen.findByText("Couldn't load approvals")).toBeInTheDocument();
    const retryButton = screen.getAllByRole('button', { name: /retry/i })[0];
    retryButton.click();

    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.queryByText("Couldn't load approvals")).not.toBeInTheDocument());
  });
});
