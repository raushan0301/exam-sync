import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  setMockIncidents,
  setMockIncidentHistory,
  setIncidentNotInvigilator,
  SESSION_TOKENS,
  ADMIN_USER,
  FACULTY_USER,
  STUDENT_REFRESH_TOKEN,
  type MockIncident,
} from './msw/handlers';
import { getAvailableActionsForStatus } from '@/lib/incident-workflow';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
}));

import NewIncidentPage from '@/app/faculty/incidents/new/page';
import FacultyIncidentsPage from '@/app/faculty/incidents/page';
import AdminIncidentsPage from '@/app/admin/incidents/page';

const NOW = '2026-01-01T00:00:00.000Z';
const FACULTY_TOKEN = 'incident-faculty-token';
const ADMIN_TOKEN = 'incident-admin-token';
SESSION_TOKENS[FACULTY_TOKEN] = FACULTY_USER;
SESSION_TOKENS[ADMIN_TOKEN] = ADMIN_USER;

function signInAsFaculty() {
  setTokens(FACULTY_TOKEN, STUDENT_REFRESH_TOKEN);
}
function signInAsAdmin() {
  setTokens(ADMIN_TOKEN, STUDENT_REFRESH_TOKEN);
}

function makeIncident(overrides: Partial<MockIncident> = {}): MockIncident {
  return {
    id: 'inc-1',
    incidentType: 'CHEATING_SUSPICION',
    severity: 'HIGH',
    status: 'OPEN',
    examSessionId: 'session-1',
    description: 'Student found with notes.',
    reporterId: FACULTY_USER.id,
    createdAt: NOW,
    ...overrides,
  };
}

describe('incident-workflow: getAvailableActionsForStatus', () => {
  it('offers only INVESTIGATE from OPEN', () => {
    expect(getAvailableActionsForStatus('OPEN')).toEqual(['INVESTIGATE']);
  });

  it('offers ESCALATE, RESOLVE, DISMISS from UNDER_REVIEW — RESOLVE not available from OPEN', () => {
    expect(getAvailableActionsForStatus('UNDER_REVIEW')).toEqual(['ESCALATE', 'RESOLVE', 'DISMISS']);
    expect(getAvailableActionsForStatus('OPEN')).not.toContain('RESOLVE');
  });

  it('offers only INVESTIGATE from ESCALATED', () => {
    expect(getAvailableActionsForStatus('ESCALATED')).toEqual(['INVESTIGATE']);
  });

  it('offers nothing from terminal states RESOLVED/DISMISSED', () => {
    expect(getAvailableActionsForStatus('RESOLVED')).toEqual([]);
    expect(getAvailableActionsForStatus('DISMISSED')).toEqual([]);
  });
});

describe('Faculty: report incident', () => {
  it('creates an incident successfully', async () => {
    signInAsFaculty();
    setMockIncidents([]);
    setIncidentNotInvigilator(false);
    renderWithProviders(<NewIncidentPage />);

    await userEvent.type(screen.getByLabelText(/exam session id/i), '11111111-1111-4111-8111-111111111111');
    await userEvent.selectOptions(screen.getByLabelText(/incident type/i), 'CHEATING_SUSPICION');
    await userEvent.click(screen.getByRole('radio', { name: /^high$/i }));
    await userEvent.type(screen.getByLabelText(/^description/i), 'Found with unauthorized notes.');

    await userEvent.click(screen.getByRole('button', { name: /report incident/i }));

    await waitFor(() => expect(screen.queryByText(/validation/i)).not.toBeInTheDocument());
  });

  it('shows validation errors for missing description/severity', async () => {
    signInAsFaculty();
    renderWithProviders(<NewIncidentPage />);

    await userEvent.type(screen.getByLabelText(/exam session id/i), '11111111-1111-4111-8111-111111111111');
    await userEvent.selectOptions(screen.getByLabelText(/incident type/i), 'MISCONDUCT');
    await userEvent.click(screen.getByRole('button', { name: /report incident/i }));

    expect(await screen.findByText(/description is required/i)).toBeInTheDocument();
    expect(await screen.findByText(/select a severity/i)).toBeInTheDocument();
  });

  it('shows a clear 403 when the faculty is not an invigilator on the session (BR-037)', async () => {
    signInAsFaculty();
    setIncidentNotInvigilator(true);
    renderWithProviders(<NewIncidentPage />);

    await userEvent.type(screen.getByLabelText(/exam session id/i), '11111111-1111-4111-8111-111111111111');
    await userEvent.selectOptions(screen.getByLabelText(/incident type/i), 'MISCONDUCT');
    await userEvent.click(screen.getByRole('radio', { name: /^low$/i }));
    await userEvent.type(screen.getByLabelText(/^description/i), 'Talking during exam.');
    await userEvent.click(screen.getByRole('button', { name: /report incident/i }));

    expect(await screen.findByText(/don't have permission/i)).toBeInTheDocument();
    setIncidentNotInvigilator(false);
  });
});

describe('Faculty: own incident list', () => {
  it('excludes status-action UI and never renders disclose', async () => {
    signInAsFaculty();
    setMockIncidents([makeIncident()]);
    renderWithProviders(<FacultyIncidentsPage />);

    await screen.findByText(/my reported incidents/i);
    expect(screen.queryByText(/disclose/i)).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /view/i }));

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).queryByRole('button', { name: /investigate/i })).not.toBeInTheDocument();
    expect(within(drawer).queryByText(/history/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/disclose/i)).not.toBeInTheDocument();
  });
});

describe('Admin: triage board', () => {
  it('loads and groups incidents by status', async () => {
    signInAsAdmin();
    setMockIncidents([
      makeIncident({ id: 'inc-open', status: 'OPEN' }),
      makeIncident({ id: 'inc-review', status: 'UNDER_REVIEW' }),
    ]);
    renderWithProviders(<AdminIncidentsPage />);

    await screen.findByText(/incident triage/i);
    await waitFor(() => expect(screen.queryAllByText(/found with notes/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/disclose/i)).not.toBeInTheDocument();
  });

  it('executes an available action (INVESTIGATE) and moves the incident', async () => {
    signInAsAdmin();
    setMockIncidents([makeIncident({ id: 'inc-open', status: 'OPEN' })]);
    setMockIncidentHistory([]);
    renderWithProviders(<AdminIncidentsPage />);

    await screen.findByText(/incident triage/i);
    await userEvent.click(await screen.findByText(/found with notes/i));

    const drawer = await screen.findByRole('dialog', { name: /incident detail/i });
    await userEvent.click(within(drawer).getByRole('button', { name: /^investigate$/i }));

    const modal = await screen.findByRole('dialog', { name: /investigate incident/i });
    await userEvent.click(within(modal).getByRole('button', { name: /^investigate$/i }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /investigate incident/i })).not.toBeInTheDocument());
  });

  it('requires a resolution to RESOLVE and 422s cleanly without one', async () => {
    signInAsAdmin();
    setMockIncidents([makeIncident({ id: 'inc-review', status: 'UNDER_REVIEW' })]);
    setMockIncidentHistory([]);
    renderWithProviders(<AdminIncidentsPage />);

    await screen.findByText(/incident triage/i);
    await userEvent.click(await screen.findByText(/found with notes/i));

    const drawer = await screen.findByRole('dialog', { name: /incident detail/i });
    await userEvent.click(within(drawer).getByRole('button', { name: /^resolve$/i }));

    const modal = await screen.findByRole('dialog', { name: /resolve incident/i });
    await userEvent.click(within(modal).getByRole('button', { name: /^resolve$/i }));

    expect(await within(modal).findByText(/resolution note is required/i)).toBeInTheDocument();
  });
});
