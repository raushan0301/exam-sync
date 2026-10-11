import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { http, HttpResponse } from 'msw';
import { server } from './msw/server';
import { API_BASE_URL } from './msw/handlers';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  setMockExamSessions,
  setMockExamSessionRooms,
  setMockQuizzes,
  setMockStudents,
  setMockRooms,
  setMockRoomSeats,
  setMockRoster,
  setMockSeatingGenerateWrongStatus,
  setMockSeatingGenerateHardViolations,
  setMockSeatingFinalizeHardViolations,
  setMockSeatingPlans,
  setMockSeatingAssignments,
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
    status: 'SEATING_GENERATION',
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

function setUpBaseFixtures() {
  signInAsAdmin();
  setMockExamSessions([makeSession()]);
  setMockQuizzes([makeQuiz()]);
  const room = makeRoom();
  setMockRooms([room]);
  setMockExamSessionRooms([{ ...room, allocatedCapacity: 4 }]);
  setMockRoomSeats(makeSeats(room.id));
  setMockStudents([makeStudent()]);
  setMockRoster([
    {
      id: 'roster-1',
      quizId: 'quiz-1',
      examSessionId: 'session-1',
      studentId: 'stu-1',
      status: 'ASSIGNED',
      assignedAt: NOW,
      cancelledAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ]);
  setMockSeatingPlans([]);
  setMockSeatingAssignments([]);
  setMockSeatingGenerateWrongStatus(false);
  setMockSeatingGenerateHardViolations(false);
  setMockSeatingFinalizeHardViolations(false);
}

describe('Seating — empty-column question and room layout', () => {
  it('shows the room name and layout before generating, and blocks Generate until the empty-column question is answered', async () => {
    setUpBaseFixtures();
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    expect(await screen.findByText(/Room 101 layout/i)).toBeInTheDocument();
    expect(await screen.findByText(/leave an empty seat column between students/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate seating/i })).toBeDisabled();

    await userEvent.click(screen.getByLabelText(/no — use every column/i));
    expect(screen.getByRole('button', { name: /generate seating/i })).toBeEnabled();
  });

  it('does not offer empty columns when the remaining seats cannot hold everyone', async () => {
    setUpBaseFixtures(); // 4 students allocated, 2x2 seats -> only 2 usable
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    expect(await screen.findByLabelText(/leave every second column empty/i)).toBeDisabled();
    expect(screen.getByText(/not enough seats: 2 usable for 4 students/i)).toBeInTheDocument();
  });

  it('sends skip_alternate_columns when the faculty chooses empty columns', async () => {
    setUpBaseFixtures();
    const room = makeRoom();
    setMockExamSessionRooms([{ ...room, allocatedCapacity: 2 }]);
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.post(`${API_BASE_URL}/exam-sessions/:id/seating/generate`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ message: 'stop here' }, { status: 409 });
      }),
    );
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(await screen.findByLabelText(/leave every second column empty/i));
    await userEvent.click(screen.getByRole('button', { name: /generate seating/i }));

    await waitFor(() => expect(sent).toMatchObject({ room_id: 'room-1', skip_alternate_columns: true }));
  });
});

describe('Seating generation', () => {
  it('generates a seating plan and shows the seat map', async () => {
    setUpBaseFixtures();
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(await screen.findByLabelText(/no — use every column/i));
    await userEvent.click(screen.getByRole('button', { name: /generate seating/i }));

    // A VALIDATED plan shows a success-ish status and the seat map with the assigned student's initials/roll rendered as an aria-label.
    await screen.findByText('Validated');
    expect(await screen.findByLabelText(/seat a1, occupied by jane doe/i)).toBeInTheDocument();
  });

  it('is blocked with a clear reason when the session is not in SEATING_GENERATION', async () => {
    setUpBaseFixtures();
    setMockExamSessions([makeSession({ status: 'ROOM_ALLOCATION' })]);
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    expect(
      await screen.findByText(/seating can only be generated while SEATING_GENERATION/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate seating/i })).toBeDisabled();
  });

  it('offers only the four strategies and explains in one line how each arranges seats', async () => {
    setUpBaseFixtures();
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    const options = within(await screen.findByLabelText(/strategy/i)).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Sequential', 'Alternate Subject', 'Alternate Batch', 'Subject + Batch Mix']);
    expect(screen.getByText(/fills seats row by row in roster order/i)).toBeInTheDocument();
    expect(screen.getByText(/one student from each subject in turn/i)).toBeInTheDocument();
    expect(screen.getByText(/one student from each batch in turn/i)).toBeInTheDocument();
    expect(screen.getByText(/each subject-and-batch combination in turn/i)).toBeInTheDocument();
  });

  it('shows hard violations when generation fails', async () => {
    setUpBaseFixtures();
    setMockSeatingGenerateHardViolations(true);
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(await screen.findByLabelText(/no — use every column/i));
    await userEvent.click(screen.getByRole('button', { name: /generate seating/i }));

    await screen.findByText('Failed');
    expect(await screen.findByText(/seat a1 is assigned to two students/i)).toBeInTheDocument();
  });

  it('the seat map has no swap/edit affordance on an occupied seat', async () => {
    setUpBaseFixtures();
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(await screen.findByLabelText(/no — use every column/i));
    await userEvent.click(screen.getByRole('button', { name: /generate seating/i }));

    const seatButton = await screen.findByLabelText(/seat a1, occupied by jane doe/i);
    await userEvent.click(seatButton);

    // No swap/reassign/edit button should exist anywhere on the page — the
    // real backend has no POST /seating-plans/{id}/swap endpoint (confirmed
    // deliberately deferred), so the frontend must never imply one exists.
    expect(screen.queryByRole('button', { name: /swap/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reassign/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit seat/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /move student/i })).not.toBeInTheDocument();
  });
});

describe('Seating — empty-column default from the room request', () => {
  it.each([
    [true, /yes — leave every second column empty/i],
    [false, /no — use every column/i],
  ])('pre-selects the answer given when rooms were requested (emptyColumnsPlanned=%s) and lets Generate go straight away', async (planned, label) => {
    setUpBaseFixtures();
    setMockExamSessions([makeSession({ emptyColumnsPlanned: planned })]);
    const room = makeRoom();
    setMockExamSessionRooms([{ ...room, allocatedCapacity: 2 }]); // 2 students fit even with empty columns
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    expect(await screen.findByLabelText(label)).toBeChecked();
    expect(screen.getByRole('button', { name: /generate seating/i })).toBeEnabled();
  });

  it('still asks when the question was never answered', async () => {
    setUpBaseFixtures();
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    expect(await screen.findByLabelText(/no — use every column/i)).not.toBeChecked();
    expect(screen.getByRole('button', { name: /generate seating/i })).toBeDisabled();
  });
});

describe('Seating — score explanation', () => {
  it('explains the Soft Constraint Score in plain words next to the number', async () => {
    setUpBaseFixtures();
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(await screen.findByLabelText(/no — use every column/i));
    await userEvent.click(screen.getByRole('button', { name: /generate seating/i }));

    const note = await screen.findByTestId('score-explanation');
    expect(note).toHaveTextContent(/what this score means/i);
    expect(note).toHaveTextContent(/100% = nobody has a matching neighbour/i);
    expect(note).toHaveTextContent(/never blocks finalizing/i);
  });
});

describe('Seating after a page reload', () => {
  it('shows the room\'s existing plan instead of offering a fresh Generate (which would hand back the old plan and ignore new choices)', async () => {
    setUpBaseFixtures();
    setMockSeatingPlans([
      {
        id: 'plan-existing',
        examSessionId: 'session-1',
        roomId: 'room-1',
        strategy: 'ALTERNATE_SUBJECT',
        status: 'VALIDATED',
        softConstraintScore: 1,
        violationReport: [],
        version: 1,
        generatedAt: NOW,
        finalizedAt: null,
      },
    ]);
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await waitFor(() => expect(screen.getAllByText('Validated').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /generate seating/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change strategy/i })).toBeInTheDocument();
  });
});

describe('Seating finalization', () => {
  it('finalizes successfully from VALIDATED', async () => {
    setUpBaseFixtures();
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(await screen.findByLabelText(/no — use every column/i));
    await userEvent.click(screen.getByRole('button', { name: /generate seating/i }));
    await screen.findByText('Validated');

    await userEvent.click(screen.getByRole('button', { name: /^finalize$/i }));
    const dialog = await screen.findByRole('dialog', { name: /finalize seating plan/i });
    await userEvent.click(within(dialog).getByRole('button', { name: /^finalize$/i }));

    await waitFor(() => expect(screen.getAllByText('Finalized').length).toBeGreaterThan(0));
  });

  it('shows the wrong-status 409 distinctly', async () => {
    setUpBaseFixtures();
    setMockSeatingPlans([
      {
        id: 'plan-already-final',
        examSessionId: 'session-1',
        roomId: 'room-1',
        strategy: 'SEQUENTIAL',
        status: 'FINALIZED',
        softConstraintScore: 0.9,
        violationReport: [],
        version: 1,
        generatedAt: NOW,
        finalizedAt: NOW,
      },
    ]);
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    // The existing FINALIZED plan is found again on load — no Generate form is offered.
    await waitFor(() => expect(screen.getAllByText('Finalized').length).toBeGreaterThan(0));

    // A FINALIZED plan offers no Finalize action at all (read-only).
    expect(screen.queryByRole('button', { name: /^finalize$/i })).not.toBeInTheDocument();
  });

  it('shows the fresh-hard-violations 409 distinctly from the wrong-status case', async () => {
    setUpBaseFixtures();
    setMockSeatingFinalizeHardViolations(true);
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click(await screen.findByLabelText(/no — use every column/i));
    await userEvent.click(screen.getByRole('button', { name: /generate seating/i }));
    await waitFor(() => expect(screen.getAllByText('Validated').length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole('button', { name: /^finalize$/i }));
    const dialog = await screen.findByRole('dialog', { name: /finalize seating plan/i });
    await userEvent.click(within(dialog).getByRole('button', { name: /^finalize$/i }));

    expect(await screen.findByText(/hard constraint violations and cannot be finalized \(BR-026\)/i)).toBeInTheDocument();
    expect(await screen.findByText(/newly-added roster entry now conflicts/i)).toBeInTheDocument();
  });
});
