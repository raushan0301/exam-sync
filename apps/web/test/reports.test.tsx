import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  SESSION_TOKENS,
  ADMIN_USER,
  STUDENT_REFRESH_TOKEN,
  setMockReportJobs,
  setReportJobShouldFail,
  setMockExamSessions,
} from './msw/handlers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
}));

import AdminReportsPage from '@/app/admin/reports/page';

const ADMIN_TOKEN = 'reports-admin-token';
SESSION_TOKENS[ADMIN_TOKEN] = ADMIN_USER;

function signInAsAdmin() {
  setTokens(ADMIN_TOKEN, STUDENT_REFRESH_TOKEN);
}

const VALID_SESSION_ID = '11111111-1111-4111-8111-111111111111';

function seedSessions() {
  setMockExamSessions([
    {
      id: VALID_SESSION_ID,
      name: 'Cyber quiz 1 — Exam',
      sessionDate: '2026-09-22',
      startTime: '17:10',
      endTime: '17:30',
      status: 'IN_PROGRESS',
      createdByAdminId: 'admin-1',
      version: 1,
      quizIds: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ]);
}

/** The exam session is picked from a dropdown of real sessions (GET /exam-sessions), not typed as a UUID. */
async function pickSession() {
  const select = await screen.findByLabelText(/^exam session/i);
  await waitFor(() => expect(select).toBeEnabled());
  await userEvent.selectOptions(select, VALID_SESSION_ID);
}

describe('Admin: report generation', () => {
  it('shows polling progress then a download link on completion', async () => {
    signInAsAdmin();
    setMockReportJobs({});
    setReportJobShouldFail(false);
    seedSessions();
    renderWithProviders(<AdminReportsPage />);

    await pickSession();
    await userEvent.click(screen.getByRole('button', { name: /generate report/i }));

    // PENDING/RUNNING indeterminate progress shown while polling
    expect(await screen.findByText(/report queued|report is generating/i)).toBeInTheDocument();

    // Eventually reaches COMPLETED and exposes a Download button.
    await waitFor(
      () => expect(screen.getByRole('button', { name: /^download$/i })).toBeInTheDocument(),
      { timeout: 10000 },
    );
  }, 15000);

  it('shows the real error on failure with a working retry', async () => {
    signInAsAdmin();
    setMockReportJobs({});
    setReportJobShouldFail(true);
    seedSessions();
    renderWithProviders(<AdminReportsPage />);

    await pickSession();
    await userEvent.click(screen.getByRole('button', { name: /generate report/i }));

    expect(
      await screen.findByText(/no attendance records to export/i, {}, { timeout: 10000 }),
    ).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /^retry$/i });
    await userEvent.click(retryButton);

    // Retry clears the active job's status panel back to just the form.
    expect(screen.queryByText(/no attendance records to export/i)).not.toBeInTheDocument();
    setReportJobShouldFail(false);
  }, 15000);

  it('lists the real exam sessions in the dropdown, labelled by name and date', async () => {
    signInAsAdmin();
    seedSessions();
    renderWithProviders(<AdminReportsPage />);

    expect(await screen.findByRole('option', { name: 'Cyber quiz 1 — Exam · 2026-09-22' })).toBeInTheDocument();
  });

  it('requires choosing an exam session before submitting', async () => {
    signInAsAdmin();
    seedSessions();
    renderWithProviders(<AdminReportsPage />);

    await screen.findByRole('option', { name: /cyber quiz 1/i });
    await userEvent.click(screen.getByRole('button', { name: /generate report/i }));

    expect(await screen.findByText(/select an exam session/i)).toBeInTheDocument();
  });
});
