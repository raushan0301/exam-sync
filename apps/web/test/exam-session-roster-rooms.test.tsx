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
  setMockBatches,
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
    // Bulk assign is a one-shot DRAFT-only action (RosterPanel hides the
    // button once the session has moved past DRAFT — see its own comment).
    setMockExamSessions([makeSession({ status: 'DRAFT' })]);
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

  it('does not leak a previous session\'s "assigned successfully" banner onto a different session rendered with the same component instance', async () => {
    signInAsAdmin();
    setMockExamSessions([
      makeSession({ id: 'session-1', status: 'DRAFT' }),
      makeSession({ id: 'session-2', status: 'DRAFT' }),
    ]);
    setMockQuizzes([makeQuiz()]);
    setMockExamSessionRooms([]);
    setMockRoster([]);
    setMockStudents([makeStudent()]);
    setMockAssignStudentsResult({ total: 2, success: 2, failure: 0 });

    const { rerender } = renderWithProviders(<ExamSessionDetailView key="session-1" sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /assign students/i }));
    expect(await screen.findByText(/2 of 2 student\(s\) assigned successfully/)).toBeInTheDocument();

    // Simulate the app's own page-level fix: a NEW `key` forces React to
    // fully remount for a different session, rather than reusing this
    // fiber's (and its mutations') leftover state.
    rerender(<ExamSessionDetailView key="session-2" sessionId="session-2" />);

    await screen.findByText('Midterm Session');
    expect(screen.queryByText(/assigned successfully/)).not.toBeInTheDocument();
  });

  it('adds and removes a roster entry (remove requires a reason)', async () => {
    signInAsAdmin();
    setMockExamSessions([makeSession()]);
    setMockQuizzes([makeQuiz()]);
    setMockExamSessionRooms([]);
    setMockBatches([
      { id: 'batch-1', programId: 'prog-1', year: '2024-2028', section: '3C7', subsection: '3C71', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
    ]);
    setMockStudents([makeStudent()]);
    setMockRoster([]);

    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /add student/i }));

    await screen.findByText('Add Students to Roster');
    const quizSelect = await screen.findByLabelText(/^quiz/i);
    await userEvent.selectOptions(quizSelect, 'quiz-1');
    const sectionCheckbox = await screen.findByLabelText(/2024-2028.*3C7-3C71/i);
    await userEvent.click(sectionCheckbox);

    const studentCheckbox = await screen.findByLabelText(/R001.*Jane Doe/i);
    await userEvent.click(studentCheckbox);

    await userEvent.click(screen.getByRole('button', { name: /add.*selected/i }));

    await waitFor(() => expect(screen.getByText(/1 student\(s\) added successfully/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^close$/i }));

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

describe('Room request + admin approval', () => {
  function rosterFor(sessionId: string, count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `ros-${i}`,
      quizId: 'quiz-1',
      examSessionId: sessionId,
      studentId: `stu-${i}`,
      status: 'ASSIGNED' as const,
      assignedAt: NOW,
      cancelledAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    }));
  }

  it('faculty submits a room request, then admin reviews and approves it', async () => {
    signInAsAdmin();
    setMockExamSessions([makeSession()]);
    setMockQuizzes([makeQuiz()]);
    setMockExamSessionRooms([]);
    setMockRooms([makeRoom()]);
    setMockRoster(rosterFor('session-1', 20));
    setMockStudents([]);
    setMockRoomAllocationConflict(false);

    const { unmount } = renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(await screen.findByLabelText(/no — use every column/i));
    await screen.findByText(/Fewest Classes/i);
    await userEvent.click(screen.getByRole('button', { name: /submit room request for approval/i }));

    await waitFor(() => expect(screen.getByText(/pending admin approval/i)).toBeInTheDocument());
    unmount();

    renderWithProviders(<ExamSessionDetailView sessionId="session-1" role="ADMIN" />);
    await screen.findByText('Midterm Session');
    expect(await screen.findByText(/pending your approval/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    await waitFor(() => expect(screen.queryByText(/pending your approval/i)).not.toBeInTheDocument());
  });

  it('admin can reject a room request, sending it back to the faculty', async () => {
    signInAsAdmin();
    setMockExamSessions([makeSession({ status: 'ROOM_ALLOCATION', requestedRoomIds: ['room-1'] })]);
    setMockQuizzes([makeQuiz()]);
    setMockExamSessionRooms([]);
    setMockRooms([makeRoom()]);
    setMockRoster(rosterFor('session-1', 20));
    setMockStudents([]);
    setMockRoomAllocationConflict(false);

    renderWithProviders(<ExamSessionDetailView sessionId="session-1" role="ADMIN" />);

    await screen.findByText('Midterm Session');
    await screen.findByText(/pending your approval/i);
    await userEvent.click(screen.getByRole('button', { name: /^reject$/i }));
    await userEvent.type(screen.getByLabelText(/reason/i), 'Rooms too far apart.');
    await userEvent.click(screen.getByRole('button', { name: /reject request/i }));

    await waitFor(() => expect(screen.queryByText(/pending your approval/i)).not.toBeInTheDocument());
  });

  it('skips the admin-review cycle entirely when the attached quiz already has an admin-approved room — faculty self-service allocates it directly', async () => {
    signInAsAdmin();
    setMockExamSessions([makeSession()]);
    setMockQuizzes([makeQuiz({ requestedRoomIds: ['room-1'] })]);
    setMockExamSessionRooms([]);
    setMockRooms([makeRoom()]);
    setMockRoster(rosterFor('session-1', 20));
    setMockStudents([]);
    setMockRoomAllocationConflict(false);

    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    expect(await screen.findByText(/using the room already approved/i)).toBeInTheDocument();
    expect(screen.queryByText(/Fewest Classes/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /allocate approved room/i }));
    await waitFor(() => expect(screen.queryByText(/using the room already approved/i)).not.toBeInTheDocument());
  });
});
