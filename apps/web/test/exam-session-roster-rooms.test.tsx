import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  setMockExamSessions,
  setMockExamSessionRooms,
  setMockQuizzes,
  setMockStudents,
  setMockRooms,
  setMockRoster,
  setMockRoomAllocationConflict,
  setMockAssignStudentsResult,
  VALID_ACCESS_TOKEN,
  VALID_REFRESH_TOKEN,
  ADMIN_USER,
  type MockExamSession,
  type MockQuiz,
  type MockRoom,
  type MockStudent,
} from './msw/handlers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: 'session-1' }),
}));

import { ExamSessionDetailView } from '@/components/exam-session/ExamSessionDetailView';

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
    status: 'ASSIGNING_STUDENTS',
    createdByAdminId: ADMIN_USER.id,
    version: 1,
    quizIds: ['quiz-1'],
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
    subjectId: '11111111-1111-4111-8111-111111111111',
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

function makeRoom(overrides: Partial<MockRoom> = {}): MockRoom {
  return {
    id: 'room-1',
    building: 'Main Hall',
    floor: 1,
    roomNumber: '101',
    capacity: 30,
    rows: 5,
    columns: 6,
    status: 'ACTIVE',
    accessibilityInfo: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeStudent(overrides: Partial<MockStudent> = {}): MockStudent {
  return {
    id: 'stu-1',
    userId: 'u-stu-1',
    name: 'Jane Doe',
    programId: 'prog-1',
    batchId: 'batch-1',
    rollNumber: 'R001',
    status: 'ACTIVE',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('Roster', () => {
  it('assign students shows a result summary', async () => {
    signInAsAdmin();
    setMockExamSessions([makeSession()]);
    setMockQuizzes([makeQuiz()]);
    setMockExamSessionRooms([]);
    setMockRoster([]);
    setMockStudents([makeStudent()]);
    setMockAssignStudentsResult({ total: 5, success: 4, failure: 1 });

    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /assign students/i }));

    expect(await screen.findByText(/4 of 5 student\(s\) assigned successfully/)).toBeInTheDocument();
  });

  it('adds and removes a roster entry (remove requires a reason)', async () => {
    signInAsAdmin();
    setMockExamSessions([makeSession()]);
    setMockQuizzes([makeQuiz()]);
    setMockExamSessionRooms([]);
    setMockStudents([makeStudent()]);
    setMockRoster([]);

    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /add student/i }));

    await screen.findByText('Add Student to Roster');
    const quizSelect = await screen.findByLabelText(/^quiz/i);
    await userEvent.selectOptions(quizSelect, 'quiz-1');
    const studentSelect = screen.getByLabelText(/^student/i);
    await userEvent.selectOptions(studentSelect, 'stu-1');

    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    const removeButton = screen.getByRole('button', { name: /^remove$/i });
    expect(removeButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/reason/i), 'Withdrew from exam.');
    await userEvent.click(screen.getByRole('button', { name: /^remove$/i }));

    // The entry stays on the roster (its status flips to CANCELLED, it's
    // never deleted) — the row's Remove action disappears instead.
    await waitFor(() => expect(screen.queryByRole('button', { name: /^remove$/i })).not.toBeInTheDocument());
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });
});

describe('Room allocation', () => {
  it('allocates rooms automatically and refreshes the session', async () => {
    signInAsAdmin();
    setMockExamSessions([makeSession()]);
    setMockQuizzes([makeQuiz()]);
    setMockExamSessionRooms([]);
    setMockRooms([makeRoom()]);
    setMockRoster([]);
    setMockStudents([]);
    setMockRoomAllocationConflict(false);

    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /allocate rooms/i }));
    await userEvent.click(screen.getByRole('button', { name: /^allocate$/i }));

    // Session moves past ASSIGNING_STUDENTS on success, so the "Allocate
    // Rooms" action (only shown while ASSIGNING_STUDENTS) disappears.
    await waitFor(() => expect(screen.queryByRole('button', { name: /allocate rooms/i })).not.toBeInTheDocument());
  });

  it('shows a structured error on a capacity conflict', async () => {
    signInAsAdmin();
    setMockExamSessions([makeSession()]);
    setMockQuizzes([makeQuiz()]);
    setMockExamSessionRooms([]);
    setMockRooms([makeRoom()]);
    setMockRoster([]);
    setMockStudents([]);
    setMockRoomAllocationConflict(true);

    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /allocate rooms/i }));
    await userEvent.click(screen.getByRole('button', { name: /^allocate$/i }));

    expect(await screen.findByText(/Insufficient room capacity/)).toBeInTheDocument();
  });
});
