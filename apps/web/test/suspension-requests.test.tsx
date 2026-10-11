import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  setMockExamSessions,
  setMockExamSessionRooms,
  setMockQuizzes,
  setMockSuspensionRequests,
  EXAM_SESSIONS,
  SUSPENSION_REQUESTS,
  VALID_ACCESS_TOKEN,
  VALID_REFRESH_TOKEN,
  type MockExamSession,
  type MockSuspensionRequest,
} from './msw/handlers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: 'session-1' }),
  usePathname: () => '/',
}));

import { ExamSessionDetailView } from '@/components/exam-session/ExamSessionDetailView';
import AdminSuspensionRequestsPage from '@/app/admin/suspension-requests/page';

const NOW = '2026-01-01T00:00:00.000Z';
const REASON = 'The venue was double-booked and cannot be moved.';

function signIn() {
  setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN);
}

function makeSession(overrides: Partial<MockExamSession> = {}): MockExamSession {
  return {
    id: 'session-1',
    name: 'Midterm Session',
    sessionDate: '2026-03-01',
    startTime: '09:00:00',
    endTime: '11:00:00',
    status: 'ROOM_ALLOCATION',
    createdByAdminId: 'admin-1',
    version: 1,
    quizIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<MockSuspensionRequest> = {}): MockSuspensionRequest {
  return {
    id: 'susp-1',
    examSessionId: 'session-1',
    requestedByFacultyId: 'fac-1',
    reason: REASON,
    status: 'PENDING',
    reviewedByAdminId: null,
    reviewNote: null,
    reviewedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    examSessionName: 'Midterm Session',
    examSessionDate: '2026-03-01',
    examSessionStartTime: '09:00:00',
    examSessionEndTime: '11:00:00',
    examSessionStatus: 'ROOM_ALLOCATION',
    facultyName: 'Dr. Smith',
    facultyEmployeeCode: 'E001',
    ...overrides,
  };
}

function seedSession(session = makeSession(), requests: MockSuspensionRequest[] = []) {
  signIn();
  setMockExamSessions([session]);
  setMockQuizzes([]);
  setMockExamSessionRooms([]);
  setMockSuspensionRequests(requests);
}

describe('Faculty: request a session suspension (replaces direct cancel)', () => {
  it('offers "Request Suspension" and no longer offers a direct "Cancel Session"', async () => {
    seedSession();
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    expect(screen.getByRole('button', { name: /request suspension/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel session/i })).not.toBeInTheDocument();
  });

  it('needs a real explanation (10+ characters) before it can be sent, then files a PENDING request', async () => {
    seedSession();
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /request suspension/i }));

    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: /send request/i });
    expect(send).toBeDisabled();
    expect(within(dialog).getByText(/at least 10 characters \(0\/10\)/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/nothing changes until an admin approves/i)).toBeInTheDocument();

    const field = within(dialog).getByLabelText(/why should this session be suspended/i);
    await userEvent.type(field, 'too short');
    expect(send).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, `  ${REASON}  `);
    expect(within(dialog).getByText(/ready to send/i)).toBeInTheDocument();
    await userEvent.click(send);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(SUSPENSION_REQUESTS).toHaveLength(1);
    expect(SUSPENSION_REQUESTS[0]).toEqual(expect.objectContaining({ status: 'PENDING', reason: REASON }));
    // The session itself is untouched — only an admin's approval cancels it.
    expect(EXAM_SESSIONS[0].status).toBe('ROOM_ALLOCATION');

    expect(await screen.findByText(/suspension requested — waiting for admin approval/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /suspension requested/i })).toBeDisabled();
  });

  it('keeps the dialog and the typed reason when the server refuses (e.g. a request is already pending)', async () => {
    seedSession();
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /request suspension/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/why should this session be suspended/i), REASON);

    // Someone filed a request after this page loaded.
    setMockSuspensionRequests([makeRequest()]);
    await userEvent.click(within(dialog).getByRole('button', { name: /send request/i }));

    expect(await within(dialog).findByText(/already waiting for admin review/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/why should this session be suspended/i)).toHaveValue(REASON);
  });

  it.each(['IN_PROGRESS', 'COMPLETED', 'CANCELLED'])('offers no suspension for a %s session', async (status) => {
    seedSession(makeSession({ status: status as MockExamSession['status'] }));
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    expect(screen.queryByRole('button', { name: /request suspension/i })).not.toBeInTheDocument();
  });

  it('shows the declined request with the admin\'s reason, and lets the faculty ask again', async () => {
    seedSession(makeSession(), [
      makeRequest({ status: 'REJECTED', reviewNote: 'The exam must go ahead as planned.', reviewedAt: NOW }),
    ]);
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    expect(await screen.findByText(/the suspension request was declined/i)).toBeInTheDocument();
    expect(screen.getByText(/the exam must go ahead as planned/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request suspension/i })).toBeEnabled();
  });

  it('says a session was suspended once an admin approved it', async () => {
    seedSession(makeSession({ status: 'CANCELLED' }), [
      makeRequest({ status: 'APPROVED', reviewNote: 'Rebook in November', reviewedAt: NOW, examSessionStatus: 'CANCELLED' }),
    ]);
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    expect(await screen.findByText(/this session was suspended/i)).toBeInTheDocument();
    expect(screen.getByText(/rebook in november/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request suspension/i })).not.toBeInTheDocument();
  });

  it('an ADMIN viewing the session sees the pending request with a link to review it, but cannot file one', async () => {
    seedSession(makeSession(), [makeRequest()]);
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" role="ADMIN" />);

    expect(await screen.findByText(/waiting for admin approval/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /review the request/i })).toHaveAttribute('href', '/admin/suspension-requests');
    expect(screen.queryByRole('button', { name: /request suspension/i })).not.toBeInTheDocument();
  });
});

describe('Admin: suspension request review queue', () => {
  const twoSessions = () => {
    signIn();
    setMockExamSessions([
      makeSession({ id: 'session-1', name: 'Midterm Session' }),
      makeSession({ id: 'session-2', name: 'Final Session' }),
    ]);
  };

  it('lists pending requests first, with the faculty, exam and reason; other statuses are separate tabs', async () => {
    twoSessions();
    setMockSuspensionRequests([
      makeRequest({ id: 'a', examSessionId: 'session-1', examSessionName: 'Midterm Session', createdAt: '2026-01-02T00:00:00.000Z' }),
      makeRequest({ id: 'b', examSessionId: 'session-2', examSessionName: 'Final Session', status: 'APPROVED', reason: 'Cohort merged into another exam.' }),
    ]);
    renderWithProviders(<AdminSuspensionRequestsPage />);

    expect(await screen.findByText('Midterm Session')).toBeInTheDocument();
    expect(screen.getByText('Dr. Smith (E001)')).toBeInTheDocument();
    expect(screen.getByText(REASON)).toBeInTheDocument();
    expect(screen.queryByText('Final Session')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /^approved$/i }));
    expect(await screen.findByText('Final Session')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Midterm Session')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('tab', { name: /^all$/i }));
    expect(await screen.findByText('Midterm Session')).toBeInTheDocument();
    expect(screen.getByText('Final Session')).toBeInTheDocument();
  });

  it('shows a friendly empty state when nothing is waiting', async () => {
    twoSessions();
    setMockSuspensionRequests([]);
    renderWithProviders(<AdminSuspensionRequestsPage />);

    expect(await screen.findByText(/no requests waiting for review/i)).toBeInTheDocument();
  });

  it('APPROVE cancels the session, records the admin\'s note, and the request leaves the pending list', async () => {
    twoSessions();
    setMockSuspensionRequests([makeRequest()]);
    renderWithProviders(<AdminSuspensionRequestsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /^review$/i }));
    const drawer = await screen.findByRole('dialog', { name: /suspension request/i });
    expect(within(drawer).getByText(REASON)).toBeInTheDocument();
    expect(within(drawer).getByText(/approving cancels this session/i)).toBeInTheDocument();

    await userEvent.type(within(drawer).getByLabelText(/note to the faculty member/i), 'Rebook in November');
    await userEvent.click(within(drawer).getByRole('button', { name: /approve & suspend session/i }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /suspension request/i })).not.toBeInTheDocument());
    expect(SUSPENSION_REQUESTS[0]).toEqual(expect.objectContaining({ status: 'APPROVED', reviewNote: 'Rebook in November' }));
    expect(EXAM_SESSIONS.find((s) => s.id === 'session-1')?.status).toBe('CANCELLED');
    expect(await screen.findByText(/no requests waiting for review/i)).toBeInTheDocument();
  });

  it('DECLINE needs a reason, leaves the session untouched, and records the note', async () => {
    twoSessions();
    setMockSuspensionRequests([makeRequest()]);
    renderWithProviders(<AdminSuspensionRequestsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /^review$/i }));
    const drawer = await screen.findByRole('dialog', { name: /suspension request/i });
    const decline = within(drawer).getByRole('button', { name: /decline request/i });
    expect(decline).toBeDisabled();

    await userEvent.type(within(drawer).getByLabelText(/note to the faculty member/i), 'The exam must go ahead.');
    expect(decline).toBeEnabled();
    await userEvent.click(decline);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /suspension request/i })).not.toBeInTheDocument());
    expect(SUSPENSION_REQUESTS[0]).toEqual(expect.objectContaining({ status: 'REJECTED', reviewNote: 'The exam must go ahead.' }));
    expect(EXAM_SESSIONS.find((s) => s.id === 'session-1')?.status).toBe('ROOM_ALLOCATION');
  });

  it('shows the server\'s reason in the drawer when approval is refused (the session has since started)', async () => {
    signIn();
    setMockExamSessions([makeSession({ status: 'IN_PROGRESS' })]);
    setMockSuspensionRequests([makeRequest()]);
    renderWithProviders(<AdminSuspensionRequestsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /^review$/i }));
    const drawer = await screen.findByRole('dialog', { name: /suspension request/i });
    await userEvent.click(within(drawer).getByRole('button', { name: /approve & suspend session/i }));

    expect(await within(drawer).findByText(/cannot be cancelled/i)).toBeInTheDocument();
    expect(SUSPENSION_REQUESTS[0].status).toBe('PENDING');
  });

  it('a reviewed request is read-only: shows the decision and note, with no approve/decline buttons', async () => {
    twoSessions();
    setMockSuspensionRequests([makeRequest({ status: 'REJECTED', reviewNote: 'Exam must go ahead.', reviewedAt: NOW })]);
    renderWithProviders(<AdminSuspensionRequestsPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /^rejected$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^view$/i }));
    const drawer = await screen.findByRole('dialog', { name: /suspension request/i });
    expect(within(drawer).getByText(/exam must go ahead/i)).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /decline/i })).not.toBeInTheDocument();
  });
});
