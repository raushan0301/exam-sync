import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
  setMockFaculty,
  setMockInvigilators,
  setMockInvigilatorOverlapConflict,
  setMockSeatingPlans,
  setMockSeatingAssignments,
  setMockAttendance,
  VALID_ACCESS_TOKEN,
  VALID_REFRESH_TOKEN,
  ADMIN_USER,
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
    status: 'READY_FOR_FINALIZATION',
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
    capacity: 4,
    rows: 2,
    columns: 2,
    status: 'ACTIVE',
    accessibilityInfo: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
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

function setUpBaseFixtures(sessionOverrides: Partial<MockExamSession> = {}) {
  signInAsAdmin();
  setMockExamSessions([makeSession(sessionOverrides)]);
  setMockQuizzes([makeQuiz()]);
  const room = makeRoom();
  setMockRooms([room]);
  setMockExamSessionRooms([{ ...room, allocatedCapacity: 4 }]);
  setMockRoomSeats(makeSeats(room.id));
  setMockStudents([makeStudent()]);
  setMockFaculty([
    { id: 'fac-1', userId: 'u-faculty', name: 'Dr. Smith', departmentId: 'dept-1', employeeCode: 'F001', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
  ]);
  setMockRoster([
    { id: 'roster-1', quizId: 'quiz-1', examSessionId: 'session-1', studentId: 'stu-1', status: 'ASSIGNED', assignedAt: NOW, cancelledAt: null, createdAt: NOW, updatedAt: NOW },
  ]);
  setMockInvigilators([]);
  setMockInvigilatorOverlapConflict(false);
  setMockSeatingPlans([]);
  setMockSeatingAssignments([]);
  setMockAttendance([]);
}

describe('Invigilator assignment', () => {
  it('assigns an invigilator successfully', async () => {
    setUpBaseFixtures();
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /assign invigilator/i }));

    const dialog = await screen.findByRole('dialog', { name: /assign invigilator/i });
    await userEvent.selectOptions(within(dialog).getByLabelText(/room/i), 'room-1');
    await userEvent.selectOptions(within(dialog).getByLabelText(/faculty/i), 'fac-1');
    await userEvent.selectOptions(within(dialog).getByLabelText(/role/i), 'LEAD_INVIGILATOR');
    await userEvent.click(within(dialog).getByRole('button', { name: /^assign$/i }));

    expect(await screen.findByText(/dr\. smith/i)).toBeInTheDocument();
  });

  it('removes an invigilator assignment so it can be re-assigned correctly', async () => {
    setUpBaseFixtures();
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /assign invigilator/i }));
    const dialog = await screen.findByRole('dialog', { name: /assign invigilator/i });
    await userEvent.selectOptions(within(dialog).getByLabelText(/room/i), 'room-1');
    await userEvent.selectOptions(within(dialog).getByLabelText(/faculty/i), 'fac-1');
    await userEvent.click(within(dialog).getByRole('button', { name: /^assign$/i }));
    const invigilatorRow = (await screen.findByText(/dr\. smith/i)).closest('li')!;

    await userEvent.click(within(invigilatorRow).getByRole('button', { name: /remove/i }));
    const confirmDialog = await screen.findByRole('dialog', { name: /remove invigilator/i });
    await userEvent.click(within(confirmDialog).getByRole('button', { name: /^remove$/i }));

    await waitFor(() => expect(screen.queryByText(/dr\. smith/i)).not.toBeInTheDocument());
    expect(await screen.findByText(/no invigilators assigned yet/i)).toBeInTheDocument();
  });

  it('shows the BR-031 overlap 409 clearly', async () => {
    setUpBaseFixtures();
    setMockInvigilatorOverlapConflict(true);
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /assign invigilator/i }));
    const dialog = await screen.findByRole('dialog', { name: /assign invigilator/i });
    await userEvent.selectOptions(within(dialog).getByLabelText(/room/i), 'room-1');
    await userEvent.selectOptions(within(dialog).getByLabelText(/faculty/i), 'fac-1');
    await userEvent.click(within(dialog).getByRole('button', { name: /^assign$/i }));

    expect(await screen.findByText(/already invigilating an overlapping session/i)).toBeInTheDocument();
  });
});

// `POST .../start` and `.../complete` are UNCHANGED by the faculty-
// lifecycle-ownership change — they remain `@Roles(ROLE.ADMIN)` on the
// backend (attendance.controller.ts; not in that change's own enumerated
// endpoint list), so `ExamSessionDetailView` only shows these two buttons
// for `role="ADMIN"` (see that component's own comment). Every render in
// this describe block passes it explicitly for that reason.
describe('Exam session lifecycle (FACULTY-only start/complete — fixed from a stale ADMIN-only gap left behind by the faculty-lifecycle-ownership change)', () => {
  it('starts the session from READY_FOR_FINALIZATION when every room has a finalized plan', async () => {
    setUpBaseFixtures();
    setMockSeatingPlans([
      { id: 'plan-1', examSessionId: 'session-1', roomId: 'room-1', strategy: 'SEQUENTIAL', status: 'FINALIZED', softConstraintScore: 0.9, violationReport: [], version: 1, generatedAt: NOW, finalizedAt: NOW },
    ]);
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" role="FACULTY" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /start exam session/i }));
    const dialog = await screen.findByRole('dialog', { name: /start exam session/i });
    await userEvent.click(within(dialog).getByRole('button', { name: /^start$/i }));

    await waitFor(() => expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0));
  });

  it('completes the session from IN_PROGRESS', async () => {
    setUpBaseFixtures({ status: 'IN_PROGRESS' });
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" role="FACULTY" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(screen.getByRole('button', { name: /complete exam session/i }));
    const dialog = await screen.findByRole('dialog', { name: /complete exam session/i });
    await userEvent.click(within(dialog).getByRole('button', { name: /^complete$/i }));

    await waitFor(() => expect(screen.getAllByText('Completed').length).toBeGreaterThan(0));
  });

  it('does not show Start/Complete actions in DRAFT', async () => {
    setUpBaseFixtures({ status: 'DRAFT' });
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" role="FACULTY" />);

    await screen.findByText('Midterm Session');
    expect(screen.queryByRole('button', { name: /start exam session/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /complete exam session/i })).not.toBeInTheDocument();
  });

  it('never shows Start/Complete for ADMIN, even in a status where FACULTY would see them (ADMIN is read-only for the whole lifecycle)', async () => {
    setUpBaseFixtures({ status: 'IN_PROGRESS' });
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" role="ADMIN" />);

    await screen.findByText('Midterm Session');
    expect(screen.queryByRole('button', { name: /complete exam session/i })).not.toBeInTheDocument();
  });
});

describe('Attendance overview (admin)', () => {
  it('loads the attendance overview table', async () => {
    setUpBaseFixtures({ status: 'IN_PROGRESS' });
    setMockAttendance([
      { id: 'att-1', quizStudentAssignmentId: 'roster-1', seatId: 'seat-0-0', status: 'PRESENT', method: 'SEAT_BASED', markedByFacultyId: 'fac-1', markedAt: NOW, locked: false, createdAt: NOW, updatedAt: NOW },
    ]);
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    expect(await screen.findByText('Present')).toBeInTheDocument();
  });

  it('shows an empty state when nothing has been marked yet', async () => {
    setUpBaseFixtures({ status: 'IN_PROGRESS' });
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    expect(await screen.findByText(/no attendance recorded yet/i)).toBeInTheDocument();
  });
});
