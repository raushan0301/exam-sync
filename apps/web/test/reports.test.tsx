import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import { SESSION_TOKENS, ADMIN_USER, STUDENT_REFRESH_TOKEN, setMockReportJobs, setReportJobShouldFail } from './msw/handlers';

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

describe('Admin: report generation', () => {
  it('shows polling progress then a download link on completion', async () => {
    signInAsAdmin();
    setMockReportJobs({});
    setReportJobShouldFail(false);
    renderWithProviders(<AdminReportsPage />);

    await userEvent.type(screen.getByLabelText(/exam session id/i), VALID_SESSION_ID);
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
    renderWithProviders(<AdminReportsPage />);

    await userEvent.type(screen.getByLabelText(/exam session id/i), VALID_SESSION_ID);
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

  it('validates the exam session ID as a UUID before submitting', async () => {
    signInAsAdmin();
    renderWithProviders(<AdminReportsPage />);

    await userEvent.type(screen.getByLabelText(/exam session id/i), 'not-a-uuid');
    await userEvent.click(screen.getByRole('button', { name: /generate report/i }));

    expect(await screen.findByText(/valid exam session id/i)).toBeInTheDocument();
  });
});
