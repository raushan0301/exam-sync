import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from './msw/server';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  API_BASE_URL,
  setMockQuizzes,
  setMockQuizApprovalHistory,
  setMockSubjects,
  setMockBatches,
  setMockRooms,
  setMockRoomAllocationConflict,
  setMockEligibleStudentCount,
  VALID_ACCESS_TOKEN,
  VALID_REFRESH_TOKEN,
  FACULTY_USER,
  type MockQuiz,
} from './msw/handlers';

async function setTimeField(groupName: RegExp | string, hour12: string, minute: string, period: 'AM' | 'PM') {
  const group = screen.getByRole('group', { name: groupName });
  await userEvent.selectOptions(within(group).getByLabelText('Hour'), hour12);
  await userEvent.selectOptions(within(group).getByLabelText('Minute'), minute);
  await userEvent.selectOptions(within(group).getByLabelText('AM or PM'), period);
}

const push = vi.fn();
let currentQuizId = 'quiz-1';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push }),
  useParams: () => ({ id: currentQuizId }),
}));

import FacultyQuizzesPage from '@/app/faculty/quizzes/page';
import NewQuizPage from '@/app/faculty/quizzes/new/page';
import { QuizDetailView } from '@/components/quiz/QuizDetailView';

const SUBJECT_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-01-01T00:00:00.000Z';

async function loginAs(email: string) {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-password' }),
  });
  const data = (await res.json()) as { access_token: string; refresh_token: string };
  setTokens(data.access_token, data.refresh_token);
}

function signInAsAdmin() {
  setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN);
}

function seedSubjectAndBatch() {
  setMockSubjects([
    { id: SUBJECT_ID, departmentId: 'd1', programId: null, code: 'CS101', name: 'Intro to CS', credits: 4, isActive: true, createdAt: NOW, updatedAt: NOW },
  ]);
  setMockBatches([
    { id: BATCH_ID, programId: 'p1', year: '2026', section: 'A', subsection: 'A1', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
  ]);
}

function makeQuiz(overrides: Partial<MockQuiz> = {}): MockQuiz {
  return {
    id: 'quiz-1',
    title: 'Midterm',
    status: 'DRAFT',
    subjectId: SUBJECT_ID,
    createdByFacultyId: FACULTY_USER.id,
    durationMinutes: 60,
    studentCount: 60,
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

describe('Quiz list', () => {
  it('loads quizzes and filters by status', async () => {
    await loginAs('faculty@exam-sync.test');
    seedSubjectAndBatch();
    setMockQuizzes([
      makeQuiz({ id: 'q-draft', title: 'Draft Quiz', status: 'DRAFT' }),
      makeQuiz({ id: 'q-approved', title: 'Approved Quiz', status: 'APPROVED' }),
    ]);

    renderWithProviders(<FacultyQuizzesPage />);

    expect(await screen.findByText('Draft Quiz')).toBeInTheDocument();
    expect(screen.getByText('Approved Quiz')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'DRAFT');

    await waitFor(() => expect(screen.queryByText('Approved Quiz')).not.toBeInTheDocument());
    expect(screen.getByText('Draft Quiz')).toBeInTheDocument();
  });
});

describe('Create quiz', () => {
  it('succeeds with valid data', async () => {
    await loginAs('faculty@exam-sync.test');
    seedSubjectAndBatch();
    setMockQuizzes([]);
    const user = userEvent.setup();

    renderWithProviders(<NewQuizPage />);

    await user.type(screen.getByLabelText(/Title/i), 'New Quiz');
    await user.selectOptions(screen.getByLabelText(/Subject/i), SUBJECT_ID);
    await user.click(screen.getByLabelText('A/A1 (2026)'));
    await user.type(screen.getByLabelText(/Academic Year/i), '2025-2026');
    const semesterInput = screen.getByLabelText(/Semester/i);
    await user.clear(semesterInput);
    await user.type(semesterInput, '1');
    await user.type(screen.getByLabelText(/Number of Students/i), '60');
    await user.type(screen.getByLabelText(/Preferred Date/i), '2026-05-01');
    await setTimeField('Preferred Time', '10', '00', 'AM');
    await user.click(screen.getByRole('button', { name: 'Create Quiz' }));

    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it('auto-fills Number of Students from real enrollment once subject/batch/year/semester are picked, and stops once the faculty edits it themselves', async () => {
    await loginAs('faculty@exam-sync.test');
    seedSubjectAndBatch();
    setMockQuizzes([]);
    setMockEligibleStudentCount(42);
    const user = userEvent.setup();

    renderWithProviders(<NewQuizPage />);

    await screen.findByLabelText('A/A1 (2026)');
    await user.selectOptions(screen.getByLabelText(/Subject/i), SUBJECT_ID);
    await user.click(screen.getByLabelText('A/A1 (2026)'));
    await user.type(screen.getByLabelText(/Academic Year/i), '2025-2026');
    const semesterInput = screen.getByLabelText(/Semester/i);
    await user.clear(semesterInput);
    await user.type(semesterInput, '1');

    await waitFor(() => expect(screen.getByLabelText(/Number of Students/i)).toHaveValue(42));
    expect(await screen.findByText(/Auto-filled from 42 enrolled students/i)).toBeInTheDocument();

    // Faculty overrides it — a later re-fetch (e.g. toggling a batch) must not clobber their own value.
    await user.clear(screen.getByLabelText(/Number of Students/i));
    await user.type(screen.getByLabelText(/Number of Students/i), '75');
    setMockEligibleStudentCount(50);
    await user.click(screen.getByLabelText('A/A1 (2026)'));
    await user.click(screen.getByLabelText('A/A1 (2026)'));

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByLabelText(/Number of Students/i)).toHaveValue(75);
  });

  it('shows validation errors for missing required fields', async () => {
    await loginAs('faculty@exam-sync.test');
    seedSubjectAndBatch();
    setMockQuizzes([]);
    const user = userEvent.setup();

    renderWithProviders(<NewQuizPage />);
    await user.click(screen.getByRole('button', { name: 'Create Quiz' }));

    expect(await screen.findByText('Title is required.')).toBeInTheDocument();
    expect(screen.getByText('Select at least one batch.')).toBeInTheDocument();
  });
});

describe('Submit for approval', () => {
  it('succeeds for a complete draft', async () => {
    await loginAs('faculty@exam-sync.test');
    seedSubjectAndBatch();
    currentQuizId = 'q-submit';
    setMockQuizzes([makeQuiz({ id: 'q-submit', status: 'DRAFT' })]);
    setMockQuizApprovalHistory([]);
    const user = userEvent.setup();

    renderWithProviders(<QuizDetailView quizId="q-submit" role="FACULTY" />);

    await screen.findByText('Midterm');
    await user.click(screen.getByRole('button', { name: 'Submit for Approval' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(screen.getAllByText('Submitted').length).toBeGreaterThan(0));
  });

  it('shows the real 422 completeness message for an incomplete quiz', async () => {
    await loginAs('faculty@exam-sync.test');
    seedSubjectAndBatch();
    setMockQuizzes([makeQuiz({ id: 'q-incomplete', status: 'DRAFT', durationMinutes: null, studentCount: null })]);
    setMockQuizApprovalHistory([]);
    const user = userEvent.setup();

    renderWithProviders(<QuizDetailView quizId="q-incomplete" role="FACULTY" />);

    await screen.findByText('Midterm');
    await user.click(screen.getByRole('button', { name: 'Submit for Approval' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText(/missing required fields/i)).toBeInTheDocument();
    expect(screen.getByText(/duration_minutes/)).toBeInTheDocument();
  });
});

describe('Approve / reject', () => {
  it('approve sends If-Match and succeeds', async () => {
    signInAsAdmin();
    seedSubjectAndBatch();
    const quiz = makeQuiz({ id: 'q-approve', status: 'SUBMITTED', version: 3, createdByFacultyId: 'some-other-faculty' });
    setMockQuizzes([quiz]);
    setMockQuizApprovalHistory([]);

    let capturedIfMatch: string | null = null;
    server.use(
      http.post(`${API_BASE_URL}/quizzes/:id/approve`, async ({ request }) => {
        capturedIfMatch = request.headers.get('if-match');
        return HttpResponse.json({ ...quiz, status: 'APPROVED', version: (quiz.version ?? 1) + 1 });
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<QuizDetailView quizId="q-approve" role="ADMIN" />);

    await screen.findByText('Midterm');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(capturedIfMatch).toBe('3'));
  });

  it('handles a 409 version conflict on approve', async () => {
    signInAsAdmin();
    seedSubjectAndBatch();
    const quiz = makeQuiz({ id: 'q-conflict', status: 'SUBMITTED', version: 5, createdByFacultyId: 'some-other-faculty' });
    setMockQuizzes([quiz]);
    setMockQuizApprovalHistory([]);
    server.use(
      http.post(`${API_BASE_URL}/quizzes/:id/approve`, () =>
        HttpResponse.json({ message: 'Quiz has been modified since it was last read (version mismatch).' }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();

    renderWithProviders(<QuizDetailView quizId="q-conflict" role="ADMIN" />);

    await screen.findByText('Midterm');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    expect((await screen.findAllByText(/changed by someone else/i)).length).toBeGreaterThan(0);
  });

  it('requires a reason in the UI and succeeds once one is given', async () => {
    signInAsAdmin();
    seedSubjectAndBatch();
    const quiz = makeQuiz({ id: 'q-reject', status: 'SUBMITTED', version: 1, createdByFacultyId: 'some-other-faculty' });
    setMockQuizzes([quiz]);
    setMockQuizApprovalHistory([]);
    const user = userEvent.setup();

    renderWithProviders(<QuizDetailView quizId="q-reject" role="ADMIN" />);

    await screen.findByText('Midterm');
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Reason/i), 'Needs more instructions.');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(screen.getAllByText('Rejected').length).toBeGreaterThan(0));
  });
});

describe('Quiz-stage room suggestion', () => {
  const ROOM_A = { id: 'room-a', building: 'A', floor: 1, roomNumber: '101', capacity: 100, rows: 10, columns: 10, status: 'ACTIVE' as const, accessibilityInfo: null, createdAt: NOW, updatedAt: NOW };

  it('faculty sees room-suggestion strategies for a DRAFT quiz and can submit a request', async () => {
    signInAsAdmin();
    seedSubjectAndBatch();
    setMockQuizzes([makeQuiz({ id: 'q-rooms', status: 'DRAFT' })]);
    setMockQuizApprovalHistory([]);
    setMockRooms([ROOM_A]);

    renderWithProviders(<QuizDetailView quizId="q-rooms" role="FACULTY" />);

    await screen.findByText('Midterm');
    await screen.findByText(/Fewest Classes/i);
    await userEvent.click(screen.getByRole('button', { name: /save room request/i }));

    await waitFor(() => expect(screen.getByText(/room request saved/i)).toBeInTheDocument());
  });

  it('faculty sees a student-schedule conflict banner on a DRAFT quiz, before ever submitting it', async () => {
    signInAsAdmin();
    seedSubjectAndBatch();
    setMockQuizzes([makeQuiz({ id: 'q-rooms-draft-conflict', status: 'DRAFT' })]);
    setMockQuizApprovalHistory([]);
    setMockRooms([ROOM_A]);
    server.use(
      http.get(`${API_BASE_URL}/quizzes/:id/rooms/conflicts`, () =>
        HttpResponse.json({
          requestedRooms: [],
          backupRoom: null,
          strategy: null,
          studentConflicts: [
            { studentId: 's1', conflictingExamSessionId: 'other-session', message: 'Student "s1" already has an active assignment in exam session "other-session".' },
          ],
        }),
      ),
    );

    renderWithProviders(<QuizDetailView quizId="q-rooms-draft-conflict" role="FACULTY" />);

    await screen.findByText('Midterm');
    expect(await screen.findByText(/Student schedule conflict/i)).toBeInTheDocument();
  });

  it('admin sees a live conflict preview for a SUBMITTED quiz with a pending room request', async () => {
    signInAsAdmin();
    seedSubjectAndBatch();
    setMockQuizzes([
      makeQuiz({ id: 'q-rooms-admin', status: 'SUBMITTED', version: 2, requestedRoomIds: ['room-a'], roomAllocationStrategy: 'FEWEST_ROOMS' }),
    ]);
    setMockQuizApprovalHistory([]);
    setMockRooms([ROOM_A]);
    setMockRoomAllocationConflict(false);

    renderWithProviders(<QuizDetailView quizId="q-rooms-admin" role="ADMIN" />);

    await screen.findByText('Midterm');
    expect(await screen.findByText(/Room 101/i)).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
  });

  it('admin can swap in an alternative room when the requested one is unavailable', async () => {
    signInAsAdmin();
    seedSubjectAndBatch();
    const ROOM_B = { id: 'room-b', building: 'A', floor: 1, roomNumber: '102', capacity: 100, rows: 10, columns: 10, status: 'ACTIVE' as const, accessibilityInfo: null, createdAt: NOW, updatedAt: NOW };
    setMockQuizzes([
      makeQuiz({ id: 'q-rooms-swap', status: 'SUBMITTED', version: 2, requestedRoomIds: ['room-a'], roomAllocationStrategy: 'FEWEST_ROOMS' }),
    ]);
    setMockQuizApprovalHistory([]);
    setMockRooms([ROOM_A, ROOM_B]);
    setMockRoomAllocationConflict(true);

    renderWithProviders(<QuizDetailView quizId="q-rooms-swap" role="ADMIN" />);

    await screen.findByText('Midterm');
    await screen.findByText('Unavailable');
    await userEvent.click(screen.getByRole('button', { name: /A 102 \(100\)/i }));

    await waitFor(() => expect(screen.queryByText(/Couldn't swap room/i)).not.toBeInTheDocument());
  });

  it('admin can remove the backup room with a note, and the faculty sees the note on their own view', async () => {
    signInAsAdmin();
    seedSubjectAndBatch();
    const ROOM_B = { id: 'room-b', building: 'A', floor: 1, roomNumber: '102', capacity: 50, rows: 10, columns: 5, status: 'ACTIVE' as const, accessibilityInfo: null, createdAt: NOW, updatedAt: NOW };
    setMockQuizzes([
      makeQuiz({
        id: 'q-rooms-backup-remove',
        status: 'SUBMITTED',
        version: 2,
        requestedRoomIds: ['room-a'],
        backupRoomId: 'room-b',
        roomAllocationStrategy: 'FEWEST_ROOMS',
      }),
    ]);
    setMockQuizApprovalHistory([]);
    setMockRooms([ROOM_A, ROOM_B]);
    setMockRoomAllocationConflict(false);

    const { unmount } = renderWithProviders(<QuizDetailView quizId="q-rooms-backup-remove" role="ADMIN" />);

    await screen.findByText('Midterm');
    await screen.findByText(/Backup room \(faculty-nominated\)/i);
    await userEvent.type(screen.getByLabelText(/Note to faculty/i), 'Backup room removed — it was double-booked.');
    await userEvent.click(screen.getByRole('button', { name: /^remove$/i }));

    await waitFor(() => expect(screen.queryByText(/Backup room \(faculty-nominated\)/i)).not.toBeInTheDocument());
    unmount();

    renderWithProviders(<QuizDetailView quizId="q-rooms-backup-remove" role="FACULTY" />);
    await screen.findByText('Midterm');
    expect(await screen.findByText(/Backup room removed — it was double-booked\./i)).toBeInTheDocument();
  });

  it('admin sees a student-schedule conflict warning before approving (BR-019, surfaced pre-approval)', async () => {
    signInAsAdmin();
    seedSubjectAndBatch();
    setMockQuizzes([
      makeQuiz({ id: 'q-student-conflict', status: 'SUBMITTED', version: 2, requestedRoomIds: [] }),
    ]);
    setMockQuizApprovalHistory([]);
    setMockRooms([ROOM_A]);
    server.use(
      http.get(`${API_BASE_URL}/quizzes/:id/rooms/conflicts`, () =>
        HttpResponse.json({
          requestedRooms: [],
          backupRoom: null,
          strategy: null,
          studentConflicts: [
            { studentId: 's1', conflictingExamSessionId: 'other-session', message: 'Student "s1" already has an active assignment in exam session "other-session".' },
          ],
        }),
      ),
    );

    renderWithProviders(<QuizDetailView quizId="q-student-conflict" role="ADMIN" />);

    await screen.findByText('Midterm');
    expect(await screen.findByText(/Student schedule conflict/i)).toBeInTheDocument();
  });

  it('faculty sees their own requested rooms (read-only) on a SUBMITTED quiz', async () => {
    signInAsAdmin();
    seedSubjectAndBatch();
    setMockQuizzes([
      makeQuiz({ id: 'q-rooms-faculty', status: 'SUBMITTED', version: 2, requestedRoomIds: ['room-a'], roomAllocationStrategy: 'FEWEST_ROOMS' }),
    ]);
    setMockQuizApprovalHistory([]);
    setMockRooms([ROOM_A]);
    setMockRoomAllocationConflict(false);

    renderWithProviders(<QuizDetailView quizId="q-rooms-faculty" role="FACULTY" />);

    await screen.findByText('Midterm');
    expect(await screen.findByText(/Requested Rooms/i)).toBeInTheDocument();
    expect(await screen.findByText(/Room 101/i)).toBeInTheDocument();
  });

  it('still shows the requested rooms (read-only, no swap) once the quiz is APPROVED', async () => {
    signInAsAdmin();
    seedSubjectAndBatch();
    setMockQuizzes([
      makeQuiz({ id: 'q-rooms-approved', status: 'APPROVED', version: 3, requestedRoomIds: ['room-a'], roomAllocationStrategy: 'FEWEST_ROOMS' }),
    ]);
    setMockQuizApprovalHistory([]);
    setMockRooms([ROOM_A]);
    setMockRoomAllocationConflict(false);

    renderWithProviders(<QuizDetailView quizId="q-rooms-approved" role="FACULTY" />);

    await screen.findByText('Midterm');
    expect(await screen.findByText(/Requested Rooms \(at approval time\)/i)).toBeInTheDocument();
    expect(await screen.findByText(/Room 101/i)).toBeInTheDocument();
  });
});
