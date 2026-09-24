import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import { server } from './msw/server';
import {
  API_BASE_URL,
  FACULTY_USER,
  STUDENT_REFRESH_TOKEN,
  SESSION_TOKENS,
  setMockQuizzes,
  setMockIncidents,
  setMockFaculty,
  setMockInvigilators,
} from './msw/handlers';
import FacultyDashboardPage from '@/app/faculty/dashboard/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/faculty/dashboard',
}));

// Register a faculty session token distinct from the shared STUDENT one.
const FACULTY_ACCESS_TOKEN = 'faculty-dashboard-access-token';
SESSION_TOKENS[FACULTY_ACCESS_TOKEN] = FACULTY_USER;
const NOW = '2026-01-01T00:00:00.000Z';

function signInAsFaculty() {
  setTokens(FACULTY_ACCESS_TOKEN, STUDENT_REFRESH_TOKEN);
  // GET /faculty/me needs a Faculty row whose userId matches FACULTY_USER —
  // the dashboard's Invigilation Duties card resolves it on every render.
  setMockFaculty([
    { id: 'fac-dashboard-1', userId: FACULTY_USER.id, name: 'Dr. Smith', departmentId: 'dept-1', employeeCode: 'DS1', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
  ]);
  setMockInvigilators([]);
}

describe('Faculty dashboard', () => {
  it('loading state renders skeletons before data resolves', () => {
    signInAsFaculty();
    renderWithProviders(<FacultyDashboardPage />);

    expect(screen.getByText('Faculty Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('No quizzes yet')).not.toBeInTheDocument();
  });

  it('success state renders quiz-status and incident counts from mocked responses', async () => {
    signInAsFaculty();
    setMockQuizzes([
      {
        id: 'q1',
        title: 'Midterm',
        status: 'DRAFT',
        subjectId: 's1',
        createdByFacultyId: FACULTY_USER.id,
        academicYear: '2025-2026',
        semester: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'q2',
        title: 'Final',
        status: 'APPROVED',
        subjectId: 's1',
        createdByFacultyId: FACULTY_USER.id,
        academicYear: '2025-2026',
        semester: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    setMockIncidents([
      {
        id: 'i1',
        incidentType: 'DISRUPTION',
        severity: 'LOW',
        status: 'RESOLVED',
        examSessionId: 'es1',
        description: 'x',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    renderWithProviders(<FacultyDashboardPage />);

    expect(await screen.findByText('My Quizzes by Status')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Draft')).toBeInTheDocument());
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(await screen.findByText('Resolved')).toBeInTheDocument();
  });

  it('empty state renders "No quizzes yet" when the list is genuinely empty', async () => {
    signInAsFaculty();
    setMockQuizzes([]);
    setMockIncidents([]);

    renderWithProviders(<FacultyDashboardPage />);

    expect(await screen.findByText('No quizzes yet')).toBeInTheDocument();
    expect(await screen.findByText('No incidents reported')).toBeInTheDocument();
  });

  it('error state renders with a working retry that re-fetches', async () => {
    signInAsFaculty();
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

    renderWithProviders(<FacultyDashboardPage />);

    const errorState = await screen.findByText('Something went wrong');
    expect(errorState).toBeInTheDocument();
    const retryButton = screen.getAllByRole('button', { name: /retry/i })[0];
    retryButton.click();

    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getByText('No quizzes yet')).toBeInTheDocument());
  });
});
