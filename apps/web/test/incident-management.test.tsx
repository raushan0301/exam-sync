import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from './msw/server';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  setMockIncidents,
  setMockIncidentHistory,
  setIncidentNotInvigilator,
  setMockFaculty,
  setMockExamSessions,
  setMockRooms,
  setMockInvigilators,
  INCIDENTS,
  API_BASE_URL,
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

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const CANCELLED_SESSION_ID = '22222222-2222-4222-8222-222222222222';
const ROOM_ID = '33333333-3333-4333-8333-333333333333';

/** Seeds the faculty's own invigilation duties — the form's exam-session dropdown is built from these. */
function seedDuties(sessions: { id: string; name: string; status: string }[] = [{ id: SESSION_ID, name: 'Cyber quiz 1 — Exam', status: 'IN_PROGRESS' }]) {
  setMockFaculty([
    { id: 'fac-1', userId: FACULTY_USER.id, name: 'Dr. Smith', departmentId: 'd1', employeeCode: 'E001', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
  ]);
  setMockRooms([
    { id: ROOM_ID, building: 'E', floor: 3, roomNumber: 'E-306', capacity: 28, rows: 4, columns: 7, status: 'ACTIVE', accessibilityInfo: null, createdAt: NOW, updatedAt: NOW },
  ]);
  setMockExamSessions(
    sessions.map((x) => ({
      id: x.id,
      name: x.name,
      sessionDate: '2026-09-22',
      startTime: '17:10',
      endTime: '17:30',
      status: x.status as never,
      createdByAdminId: 'admin-1',
      version: 1,
      quizIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    })),
  );
  setMockInvigilators(
    sessions.map((x, i) => ({
      id: `inv-${i}`,
      examSessionId: x.id,
      roomId: ROOM_ID,
      facultyId: 'fac-1',
      role: 'LEAD_INVIGILATOR' as const,
      assignedAt: NOW,
      createdAt: NOW,
    })),
  );
}

/** The exam session is picked from the faculty's own duties, not typed as a UUID. */
async function pickDuty(label = 'Cyber quiz 1 — Exam · E E-306 · 2026-09-22') {
  const select = await screen.findByLabelText(/^exam session/i);
  await screen.findByRole('option', { name: label });
  await userEvent.selectOptions(select, screen.getByRole('option', { name: label }));
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
  it('lists only the faculty\'s own active duties — completed and cancelled sessions are excluded', async () => {
    signInAsFaculty();
    seedDuties([
      { id: SESSION_ID, name: 'Cyber quiz 1 — Exam', status: 'IN_PROGRESS' },
      { id: CANCELLED_SESSION_ID, name: 'Old cancelled exam', status: 'CANCELLED' },
    ]);
    renderWithProviders(<NewIncidentPage />);

    expect(await screen.findByRole('option', { name: /cyber quiz 1/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /old cancelled exam/i })).not.toBeInTheDocument();
  });

  it('lists ALL of the faculty\'s duties even when the server paginates them (cap is 200 per page)', async () => {
    signInAsFaculty();
    seedDuties();
    const duties = Array.from({ length: 230 }, (_, i) => ({
      id: `duty-${i}`,
      examSessionId: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      roomId: ROOM_ID,
      facultyId: 'fac-1',
      role: 'LEAD_INVIGILATOR',
      assignedAt: NOW,
      createdAt: NOW,
      examSession: { name: `Exam ${i}`, sessionDate: '2026-09-22', startTime: '10:00', endTime: '11:00', status: 'IN_PROGRESS' },
      room: { building: 'E', roomNumber: 'E-306' },
    }));
    server.use(
      http.get(`${API_BASE_URL}/faculty/:id/invigilation-duties`, ({ request }) => {
        const url = new URL(request.url);
        const cursor = url.searchParams.get('cursor');
        const start = cursor ? duties.findIndex((d) => d.id === cursor) + 1 : 0;
        const page = duties.slice(start, start + 200);
        return HttpResponse.json({ items: page, next_cursor: start + 200 < duties.length ? page[page.length - 1].id : null });
      }),
    );
    renderWithProviders(<NewIncidentPage />);

    // Duty #229 only exists on page 2 — it used to be unreachable.
    expect(await screen.findByRole('option', { name: 'Exam 229 · E E-306 · 2026-09-22' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Exam 0 · E E-306 · 2026-09-22' })).toBeInTheDocument();
  });

  it('says so when the faculty has no invigilation duties', async () => {
    signInAsFaculty();
    seedDuties([]);
    renderWithProviders(<NewIncidentPage />);

    expect(await screen.findByText(/no invigilation duties found/i)).toBeInTheDocument();
  });

  it('creates an incident for the picked session, carrying that duty\'s room', async () => {
    signInAsFaculty();
    setMockIncidents([]);
    setIncidentNotInvigilator(false);
    seedDuties();
    renderWithProviders(<NewIncidentPage />);

    await pickDuty();
    await userEvent.selectOptions(screen.getByLabelText(/incident type/i), 'CHEATING_SUSPICION');
    await userEvent.click(screen.getByRole('radio', { name: /^high$/i }));
    await userEvent.type(screen.getByLabelText(/^description/i), 'Found with unauthorized notes.');

    await userEvent.click(screen.getByRole('button', { name: /report incident/i }));

    await waitFor(() => expect(INCIDENTS).toHaveLength(1));
    expect(INCIDENTS[0]).toEqual(
      expect.objectContaining({ examSessionId: SESSION_ID, roomId: ROOM_ID, incidentType: 'CHEATING_SUSPICION', severity: 'HIGH' }),
    );
  });

  it('shows validation errors for missing session/description/severity', async () => {
    signInAsFaculty();
    seedDuties();
    renderWithProviders(<NewIncidentPage />);

    await screen.findByRole('option', { name: /cyber quiz 1/i });
    await userEvent.selectOptions(screen.getByLabelText(/incident type/i), 'MISCONDUCT');
    await userEvent.click(screen.getByRole('button', { name: /report incident/i }));

    expect(await screen.findByText(/select the exam session you are invigilating/i)).toBeInTheDocument();
    expect(await screen.findByText(/description is required/i)).toBeInTheDocument();
    expect(await screen.findByText(/select a severity/i)).toBeInTheDocument();
  });

  it('shows a clear 403 when the faculty is not an invigilator on the session (BR-037)', async () => {
    signInAsFaculty();
    setIncidentNotInvigilator(true);
    seedDuties();
    renderWithProviders(<NewIncidentPage />);

    await pickDuty();
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

/** Admin triage is a filtered table now: every row has a "Review" button that opens the detail drawer. */
async function reviewRowWith(text: RegExp) {
  const row = (await screen.findByText(text)).closest('tr') as HTMLElement;
  await userEvent.click(within(row).getByRole('button', { name: /^review$/i }));
}

describe('Admin: triage table', () => {
  it('loads incidents into a table with severity and status', async () => {
    signInAsAdmin();
    setMockIncidents([
      makeIncident({ id: 'inc-open', status: 'OPEN', description: 'Open one.' }),
      makeIncident({ id: 'inc-review', status: 'UNDER_REVIEW', description: 'Review one.' }),
    ]);
    renderWithProviders(<AdminIncidentsPage />);

    await screen.findByText(/incident triage/i);
    expect(await screen.findByText('Open one.')).toBeInTheDocument();
    expect(screen.getByText('Review one.')).toBeInTheDocument();
    expect(screen.queryByText(/disclose/i)).not.toBeInTheDocument();
  });

  it('filters by status tab on the server, and by severity', async () => {
    signInAsAdmin();
    setMockIncidents([
      makeIncident({ id: 'inc-open', status: 'OPEN', severity: 'LOW', description: 'Open low one.' }),
      makeIncident({ id: 'inc-review', status: 'UNDER_REVIEW', severity: 'HIGH', description: 'Review high one.' }),
    ]);
    renderWithProviders(<AdminIncidentsPage />);

    await screen.findByText('Open low one.');
    await userEvent.click(screen.getByRole('tab', { name: /under review/i }));
    expect(await screen.findByText('Review high one.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Open low one.')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('tab', { name: /^all$/i }));
    await screen.findByText('Open low one.');
    await userEvent.selectOptions(screen.getByDisplayValue(/all severities/i), 'LOW');
    await waitFor(() => expect(screen.queryByText('Review high one.')).not.toBeInTheDocument());
    expect(screen.getByText('Open low one.')).toBeInTheDocument();
  });

  it('"All severities" is a real option you can go back to (not a disabled placeholder)', async () => {
    signInAsAdmin();
    setMockIncidents([
      makeIncident({ id: 'a', severity: 'LOW', description: 'Low one.' }),
      makeIncident({ id: 'b', severity: 'HIGH', description: 'High one.' }),
    ]);
    renderWithProviders(<AdminIncidentsPage />);

    await screen.findByText('Low one.');
    const severity = screen.getByDisplayValue(/all severities/i);
    await userEvent.selectOptions(severity, 'HIGH');
    await waitFor(() => expect(screen.queryByText('Low one.')).not.toBeInTheDocument());

    await userEvent.selectOptions(severity, '');
    expect(await screen.findByText('Low one.')).toBeInTheDocument();
    expect(screen.getByText('High one.')).toBeInTheDocument();
  });

  it('flags a CRITICAL incident row', async () => {
    signInAsAdmin();
    setMockIncidents([makeIncident({ id: 'crit', severity: 'CRITICAL', description: 'Critical one.' })]);
    renderWithProviders(<AdminIncidentsPage />);

    const row = (await screen.findByText('Critical one.')).closest('tr') as HTMLElement;
    expect(row.className).toMatch(/border-l-danger/);
  });

  it('executes an available action (INVESTIGATE) and moves the incident', async () => {
    signInAsAdmin();
    setMockIncidents([makeIncident({ id: 'inc-open', status: 'OPEN' })]);
    setMockIncidentHistory([]);
    renderWithProviders(<AdminIncidentsPage />);

    await screen.findByText(/incident triage/i);
    await reviewRowWith(/found with notes/i);

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
    await reviewRowWith(/found with notes/i);

    const drawer = await screen.findByRole('dialog', { name: /incident detail/i });
    await userEvent.click(within(drawer).getByRole('button', { name: /^resolve$/i }));

    const modal = await screen.findByRole('dialog', { name: /resolve incident/i });
    await userEvent.click(within(modal).getByRole('button', { name: /^resolve$/i }));

    expect(await within(modal).findByText(/resolution note is required/i)).toBeInTheDocument();
  });
});
