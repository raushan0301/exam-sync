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
  VALID_ACCESS_TOKEN,
  VALID_REFRESH_TOKEN,
  FACULTY_USER,
  type MockQuiz,
} from './msw/handlers';

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
    { id: BATCH_ID, programId: 'p1', year: 2026, section: 'A', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
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
    await user.click(screen.getByLabelText('A (2026)'));
    await user.type(screen.getByLabelText(/Academic Year/i), '2025-2026');
    const semesterInput = screen.getByLabelText(/Semester/i);
    await user.clear(semesterInput);
    await user.type(semesterInput, '1');
    await user.click(screen.getByRole('button', { name: 'Create Quiz' }));

    await waitFor(() => expect(push).toHaveBeenCalled());
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
    setMockQuizzes([makeQuiz({ id: 'q-incomplete', status: 'DRAFT', durationMinutes: null, totalMarks: null })]);
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
