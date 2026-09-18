import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  setMockExamSessions,
  setMockExamSessionRooms,
  setMockQuizzes,
  setMockRooms,
  setMockRoomSeats,
  setMockStudents,
  setMockRoster,
  setMockSeatingPlans,
  setMockSeatingAssignments,
  setMockAttendance,
  SESSION_TOKENS,
  FACULTY_USER,
  STUDENT_REFRESH_TOKEN,
  type MockExamSession,
  type MockQuiz,
  type MockRoom,
  type MockRoomSeat,
  type MockStudent,
} from './msw/handlers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: 'session-1' }),
}));

import FacultyAttendanceMarkingPage from '@/app/faculty/exam-sessions/[id]/attendance/page';

const NOW = '2026-01-01T00:00:00.000Z';
const FACULTY_ACCESS_TOKEN = 'faculty-attendance-access-token';
SESSION_TOKENS[FACULTY_ACCESS_TOKEN] = FACULTY_USER;

function signInAsFaculty() {
  setTokens(FACULTY_ACCESS_TOKEN, STUDENT_REFRESH_TOKEN);
}

function makeSession(overrides: Partial<MockExamSession> = {}): MockExamSession {
  return {
    id: 'session-1',
    name: 'Midterm Session',
    sessionDate: '2026-03-01',
    startTime: '09:00:00',
    endTime: '11:00:00',
    status: 'IN_PROGRESS',
    createdByAdminId: 'u-admin',
    version: 1,
    quizIds: ['quiz-1'],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeQuiz(): MockQuiz {
  return {
    id: 'quiz-1',
    title: 'Approved Quiz',
    status: 'APPROVED',
    subjectId: '11111111-1111-4111-8111-111111111111',
    createdByFacultyId: FACULTY_USER.id,
    academicYear: '2025-2026',
    semester: 1,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeRoom(): MockRoom {
  return {
    id: 'room-1',
    building: 'Main Hall',
    floor: 1,
    roomNumber: '101',
    capacity: 4,
    rows: 2,
    columns: 2,
    status: 'ACTIVE',
    accessibilityInfo: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeSeats(roomId: string): MockRoomSeat[] {
  const seats: MockRoomSeat[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      seats.push({
        id: `seat-${r}-${c}`,
        roomId,
        seatLabel: `${String.fromCharCode(65 + r)}${c + 1}`,
        rowIndex: r,
        colIndex: c,
        isAccessible: false,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
    }
  }
  return seats;
}

function makeStudent(): MockStudent {
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
  };
}

function setUpBaseFixtures(sessionOverrides: Partial<MockExamSession> = {}) {
  signInAsFaculty();
  setMockExamSessions([makeSession(sessionOverrides)]);
  setMockQuizzes([makeQuiz()]);
  const room = makeRoom();
  setMockRooms([room]);
  setMockExamSessionRooms([{ ...room, allocatedCapacity: 4 }]);
  setMockRoomSeats(makeSeats(room.id));
  setMockStudents([makeStudent()]);
  setMockRoster([
    { id: 'roster-1', quizId: 'quiz-1', examSessionId: 'session-1', studentId: 'stu-1', status: 'ASSIGNED', assignedAt: NOW, cancelledAt: null, createdAt: NOW, updatedAt: NOW },
  ]);
  setMockSeatingPlans([
    { id: 'plan-1', examSessionId: 'session-1', roomId: room.id, strategy: 'SEQUENTIAL', status: 'FINALIZED', softConstraintScore: 0.9, violationReport: [], version: 1, generatedAt: NOW, finalizedAt: NOW },
  ]);
  setMockSeatingAssignments([
    { id: 'sa-1', seatingPlanId: 'plan-1', studentId: 'stu-1', quizId: 'quiz-1', seatId: 'seat-0-0', createdAt: NOW },
  ]);
  setMockAttendance([]);
}

async function loadSeatMap() {
  await userEvent.type(screen.getByLabelText(/seating plan id/i), 'plan-1');
  await userEvent.click(screen.getByRole('button', { name: /load seat map/i }));
}

describe('Faculty attendance marking', () => {
  it('marks attendance via the seat map and updates the seat color / progress', async () => {
    setUpBaseFixtures();
    renderWithProviders(<FacultyAttendanceMarkingPage />);

    await screen.findByText(/midterm session — attendance/i);
    await loadSeatMap();

    expect(await screen.findByText('0 of 1 marked')).toBeInTheDocument();

    const seatButton = await screen.findByLabelText(/seat a1, jane doe, attendance not yet marked/i);
    await userEvent.click(seatButton);

    const panel = await screen.findByRole('dialog', { name: /mark attendance for jane doe/i });
    await userEvent.click(within(panel).getByRole('button', { name: /^present$/i }));

    await waitFor(() => expect(screen.getByText('1 of 1 marked')).toBeInTheDocument());
    expect(await screen.findByLabelText(/seat a1, jane doe, attendance present/i)).toBeInTheDocument();
  });

  it('is blocked with a clear message when the session is not IN_PROGRESS', async () => {
    setUpBaseFixtures({ status: 'READY_FOR_FINALIZATION' });
    renderWithProviders(<FacultyAttendanceMarkingPage />);

    await screen.findByText(/midterm session — attendance/i);
    expect(
      await screen.findByText(/attendance marking will be available once the session starts/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/seating plan id/i)).not.toBeInTheDocument();
  });

  it('re-marking a locked record without a reason shows the 423 and requires one', async () => {
    setUpBaseFixtures();
    setMockAttendance([
      { id: 'att-1', quizStudentAssignmentId: 'roster-1', seatId: 'seat-0-0', status: 'PRESENT', method: 'SEAT_BASED', markedByFacultyId: 'fac-1', markedAt: NOW, locked: true, createdAt: NOW, updatedAt: NOW },
    ]);
    renderWithProviders(<FacultyAttendanceMarkingPage />);

    await screen.findByText(/midterm session — attendance/i);
    await loadSeatMap();

    const seatButton = await screen.findByLabelText(/seat a1, jane doe, attendance present/i);
    await userEvent.click(seatButton);

    const panel = await screen.findByRole('dialog', { name: /mark attendance for jane doe/i });
    expect(within(panel).getByText(/this record is locked/i)).toBeInTheDocument();

    const absentButton = within(panel).getByRole('button', { name: /^absent$/i });
    expect(absentButton).toBeDisabled();
    expect(within(panel).getByText(/a reason is required to change a locked record/i)).toBeInTheDocument();

    await userEvent.type(within(panel).getByLabelText(/reason for change/i), 'Corrected after review');
    expect(within(panel).getByRole('button', { name: /^absent$/i })).toBeEnabled();
    await userEvent.click(within(panel).getByRole('button', { name: /^absent$/i }));

    await waitFor(() => expect(screen.getByText('1 of 1 marked')).toBeInTheDocument());
  });
});

// `within` is used above but only imported implicitly via testing-library's screen helpers in some setups —
// import explicitly to be safe across testing-library versions.
import { within } from '@testing-library/react';
