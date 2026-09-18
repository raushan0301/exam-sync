import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  API_BASE_URL,
  setMockExamSessions,
  setMockExamSessionRooms,
  setMockExamSessionConflictResult,
  setMockExamSessionRescheduleConflict,
  setMockQuizzes,
  setMockSubjects,
  VALID_ACCESS_TOKEN,
  VALID_REFRESH_TOKEN,
  ADMIN_USER,
  type MockExamSession,
  type MockQuiz,
} from './msw/handlers';

const push = vi.fn();
let currentSessionId = 'session-1';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push }),
  useParams: () => ({ id: currentSessionId }),
}));

import NewExamSessionPage from '@/app/admin/exam-sessions/new/page';
import { ExamSessionDetailView } from '@/components/exam-session/ExamSessionDetailView';

const SUBJECT_ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-01-01T00:00:00.000Z';

function signInAsAdmin() {
  setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN);
}

function makeSession(overrides: Partial<MockExamSession> = {}): MockExamSession {
  return {
    id: 'session-1',
    name: 'Midterm Session',
    sessionDate: '2026-03-01',
    startTime: '09:00:00',
    endTime: '11:00:00',
    status: 'DRAFT',
    createdByAdminId: ADMIN_USER.id,
    version: 1,
    quizIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeQuiz(overrides: Partial<MockQuiz> = {}): MockQuiz {
  return {
    id: 'quiz-1',
    title: 'Approved Quiz',
    status: 'APPROVED',
    subjectId: SUBJECT_ID,
    createdByFacultyId: 'u-faculty',
    durationMinutes: 60,
    totalMarks: 100,
    questionCount: 20,
    instructions: null,
    quizType: 'QUIZ',
    preferredDate: '2026-02-01',
    preferredTime: '10:00:00',
    academicYear: '2025-2026',
    semester: 1,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

beforeEachReset();

function beforeEachReset() {
  // vitest hoists describe/it registration; per-test reset happens inline
  // in each test via explicit setMock* calls below (matches the existing
  // quiz-lifecycle.test.tsx pattern — no global beforeEach in this suite).
}

describe('New Exam Session', () => {
  it('creates a session and redirects to its detail page', async () => {
    signInAsAdmin();
    setMockExamSessions([]);
    push.mockClear();

    renderWithProviders(<NewExamSessionPage />);

    await userEvent.type(screen.getByLabelText(/name/i), 'Final Session');
    const dateInputs = screen.getAllByDisplayValue('');
    await userEvent.type(screen.getByLabelText(/date/i), '2026-04-01');
    await userEvent.type(screen.getByLabelText(/start time/i), '09:00');
    await userEvent.type(screen.getByLabelText(/end time/i), '11:00');
    void dateInputs;

    await userEvent.click(screen.getByRole('button', { name: /create exam session/i }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    const [destination] = push.mock.calls[0] as [string];
    expect(destination).toMatch(/^\/admin\/exam-sessions\/.+/);
  });

  it('shows a validation error when required fields are missing', async () => {
    signInAsAdmin();
    setMockExamSessions([]);

    renderWithProviders(<NewExamSessionPage />);

    await userEvent.click(screen.getByRole('button', { name: /create exam session/i }));

    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
  });
});

describe('Exam Session detail', () => {
  it('loads and shows status, quizzes, and rooms', async () => {
    signInAsAdmin();
    currentSessionId = 'session-1';
    setMockExamSessions([makeSession({ id: 'session-1', quizIds: ['quiz-1'] })]);
    setMockQuizzes([makeQuiz({ id: 'quiz-1' })]);
    setMockSubjects([
      { id: SUBJECT_ID, departmentId: 'd1', programId: null, code: 'CS101', name: 'Intro to CS', credits: 4, isActive: true, createdAt: NOW, updatedAt: NOW },
    ]);
    setMockExamSessionRooms([]);

    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    expect(await screen.findByText('Midterm Session')).toBeInTheDocument();
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    expect(await screen.findByText('Approved Quiz')).toBeInTheDocument();
  });

  it('attaches an approved quiz to a DRAFT session', async () => {
    signInAsAdmin();
    currentSessionId = 'session-1';
    setMockExamSessions([makeSession({ id: 'session-1', quizIds: [] })]);
    setMockQuizzes([makeQuiz({ id: 'quiz-2', title: 'Attachable Quiz' })]);
    setMockExamSessionRooms([]);

    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    expect(screen.getByText('No quizzes attached yet.')).toBeInTheDocument();

    const select = screen.getByLabelText(/attach a quiz/i);
    await waitFor(() => expect(within(select).getByText('Attachable Quiz')).toBeInTheDocument());
    await userEvent.selectOptions(select, 'quiz-2');
    await userEvent.click(screen.getByRole('button', { name: /^attach$/i }));

    await waitFor(() => expect(screen.getByText('Attachable Quiz')).toBeInTheDocument());
  });

  it('detaches an attached quiz', async () => {
    signInAsAdmin();
    currentSessionId = 'session-1';
    setMockExamSessions([makeSession({ id: 'session-1', quizIds: ['quiz-1'] })]);
    setMockQuizzes([makeQuiz({ id: 'quiz-1' })]);
    setMockExamSessionRooms([]);

    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Approved Quiz');
    await userEvent.click(screen.getByRole('button', { name: /detach/i }));

    await waitFor(() => expect(screen.getByText('No quizzes attached yet.')).toBeInTheDocument());
  });

  it('reschedules a DRAFT session', async () => {
    signInAsAdmin();
    currentSessionId = 'session-1';
    setMockExamSessions([makeSession({ id: 'session-1' })]);
    setMockQuizzes([]);
    setMockExamSessionRooms([]);
    setMockExamSessionRescheduleConflict(false);

    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /^reschedule$/i }));

    const dialog = await screen.findByRole('dialog');
    const dateField = within(dialog).getByLabelText(/date/i);
    await userEvent.clear(dateField);
    await userEvent.type(dateField, '2026-05-01');
    await userEvent.click(within(dialog).getByRole('button', { name: /^reschedule$/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows structured conflict details on a reschedule 409', async () => {
    signInAsAdmin();
    currentSessionId = 'session-1';
    setMockExamSessions([makeSession({ id: 'session-1' })]);
    setMockQuizzes([]);
    setMockExamSessionRooms([]);
    setMockExamSessionRescheduleConflict(true);

    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /^reschedule$/i }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^reschedule$/i }));

    expect(await within(dialog).findByText(/hard conflict/i)).toBeInTheDocument();
    setMockExamSessionRescheduleConflict(false);
  });

  it('requires a reason to cancel, then cancels', async () => {
    signInAsAdmin();
    currentSessionId = 'session-1';
    setMockExamSessions([makeSession({ id: 'session-1' })]);
    setMockQuizzes([]);
    setMockExamSessionRooms([]);

    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /cancel session/i }));

    const dialog = await screen.findByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: /cancel session/i });
    expect(confirmButton).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'Venue unavailable.');
    expect(confirmButton).toBeEnabled();
    await userEvent.click(confirmButton);

    // Milestone 7's Roster status filter also has a "Cancelled" <option>,
    // so scope this to the status badge specifically (not any-role text).
    await waitFor(() => expect(screen.getByText('Cancelled', { selector: 'span' })).toBeInTheDocument());
  });

  it('checks conflicts and displays hard vs warning distinctly', async () => {
    signInAsAdmin();
    currentSessionId = 'session-1';
    setMockExamSessions([makeSession({ id: 'session-1' })]);
    setMockQuizzes([]);
    setMockExamSessionRooms([]);
    setMockExamSessionConflictResult({
      hard: [{ type: 'ROOM_OVERLAP', roomId: 'room-1', message: 'Room is double-booked.' }],
      warnings: [{ type: 'FACULTY_OVERLAP', facultyId: 'fac-1', message: 'Faculty has a soft overlap.' }],
    });

    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /check conflicts/i }));

    expect(await screen.findByText(/1 hard conflict/i)).toBeInTheDocument();
    expect(screen.getByText(/1 warning/i)).toBeInTheDocument();
    setMockExamSessionConflictResult({ hard: [], warnings: [] });
  });
});
