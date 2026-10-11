import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  setMockExamSessions,
  setMockExamSessionRooms,
  setMockQuizzes,
  setMockStudents,
  setMockRooms,
  setMockRoomSeats,
  setMockRoster,
  setMockSeatingPlans,
  setMockSeatingAssignments,
  setMockRoomRequests,
  setMockExtraRoomsState,
  defaultExtraRoomsState,
  ROOM_REQUESTS,
  LAST_ROOM_REQUEST_BODY,
  LAST_ROOM_REQUEST_ACTION,
  VALID_ACCESS_TOKEN,
  VALID_REFRESH_TOKEN,
  ADMIN_USER,
  type MockExamSession,
  type MockQuiz,
  type MockRoom,
  type MockRoomRequest,
  type MockRoomSeat,
} from './msw/handlers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: 'session-1' }),
}));
import { ExamSessionDetailView } from '@/components/exam-session/ExamSessionDetailView';
import AdminRoomRequestsPage from '@/app/admin/room-requests/page';

const NOW = '2026-01-01T00:00:00.000Z';

const session = (over: Partial<MockExamSession> = {}): MockExamSession => ({
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
  ...over,
});

const quiz = (): MockQuiz => ({
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
});

const room = (): MockRoom => ({
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
});

const seats = (roomId: string): MockRoomSeat[] =>
  [0, 1].flatMap((r) =>
    [0, 1].map((c) => ({ id: `seat-${r}-${c}`, roomId, seatLabel: `${String.fromCharCode(65 + r)}${c + 1}`, rowIndex: r, colIndex: c, isAccessible: false, isActive: true, createdAt: NOW, updatedAt: NOW })),
  );

const request = (over: Partial<MockRoomRequest> = {}): MockRoomRequest => ({
  id: 'req-1',
  examSessionId: 'session-1',
  requestedByFacultyId: 'fac-1',
  reason: 'Late additions to the roster; the open rooms cannot seat everyone.',
  trigger: 'TOO_MANY_STUDENTS',
  status: 'PENDING',
  previousStatus: 'SEATING_GENERATION',
  emptyColumns: false,
  requestedRoomIds: ['room-x'],
  approvedRoomIds: [],
  reviewedByAdminId: null,
  reviewNote: null,
  reviewedAt: null,
  createdAt: '2026-02-01T10:00:00.000Z',
  updatedAt: NOW,
  examSessionName: 'Midterm Session',
  examSessionDate: '2026-03-01',
  examSessionStartTime: '09:00:00',
  examSessionEndTime: '11:00:00',
  examSessionStatus: 'ROOM_ALLOCATION',
  facultyName: 'Jaskirat Singh',
  facultyEmployeeCode: 'FAC001',
  requestedRooms: [{ roomId: 'room-x', label: 'B-201', capacity: 20, freeSeats: 20, available: true }],
  approvedRoomLabels: [],
  currentRooms: [
    { roomId: 'room-1', label: 'A-101', allocated: 10, finalized: true },
    { roomId: 'room-2', label: 'A-102', allocated: 30, finalized: false },
  ],
  studentsToPlace: 30,
  ...over,
});

function setUp(sessionOver: Partial<MockExamSession> = {}) {
  setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN);
  setMockExamSessions([session(sessionOver)]);
  setMockQuizzes([quiz()]);
  setMockRooms([room()]);
  setMockExamSessionRooms([{ ...room(), allocatedCapacity: 4 }]);
  setMockRoomSeats(seats('room-1'));
  setMockStudents([]);
  setMockRoster([]);
  setMockSeatingPlans([]);
  setMockSeatingAssignments([]);
  setMockRoomRequests([]);
  setMockExtraRoomsState({});
}

beforeEach(() => {
  setMockRoomRequests([]);
  setMockExtraRoomsState({});
});

describe('Faculty: request more rooms from the seating step', () => {
  it('offers the button, asks the empty-column question first, explains the shortfall, preselects the nearest free room, and sends the request', async () => {
    setUp();
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click((await screen.findAllByRole('button', { name: /^request more rooms$/i }))[0]);
    const dialog = await screen.findByRole('dialog', { name: /request more rooms/i });

    expect(within(dialog).getByText(/leave every second seat column empty/i)).toBeInTheDocument();
    expect(within(dialog).queryByTestId('shortfall')).not.toBeInTheDocument(); // nothing until the question is answered
    await userEvent.click(within(dialog).getByLabelText(/no — use every column/i));

    expect(await within(dialog).findByTestId('shortfall')).toHaveTextContent('30 students to place and only 20 seats in the open rooms — about 10 more are needed.');
    expect(within(dialog).getByText(/Building B · floor 0/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Room 201 \(20 free seats\)/)).toBeChecked();

    const send = within(dialog).getByRole('button', { name: /send request/i });
    expect(send).toBeDisabled(); // a reason of at least 10 characters is required
    await userEvent.type(within(dialog).getByLabelText(/why are more rooms needed/i), 'Late additions to the roster.');
    await userEvent.click(send);

    await waitFor(() => expect(LAST_ROOM_REQUEST_BODY).toMatchObject({ room_ids: ['room-x'], reason: 'Late additions to the roster.', empty_columns: false }));
    // The session goes back to the Rooms step and seating is paused.
    expect(await screen.findByTestId('room-request-pending')).toHaveTextContent(/More rooms requested — seating is paused/i);
    expect(screen.getAllByText(/Seating is paused/i).length).toBeGreaterThan(0);
    for (const generate of screen.queryAllByRole('button', { name: /generate seating/i })) expect(generate).toBeDisabled(); // nothing can be generated meanwhile
  });

  it('describes the empty-column shortfall when the rooms hold everyone but not in the roomier layout', async () => {
    setUp();
    setMockExtraRoomsState(defaultExtraRoomsState({ emptyColumns: true, studentsToPlace: 15, fullSeats: 20, usableSeats: 10, seatsNeeded: 5, trigger: 'NO_ROOM_FOR_EMPTY_COLUMNS' }));
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await userEvent.click((await screen.findAllByRole('button', { name: /^request more rooms$/i }))[0]);
    const dialog = await screen.findByRole('dialog', { name: /request more rooms/i });
    await userEvent.click(within(dialog).getByLabelText(/yes — leave every second column empty/i));

    expect(await within(dialog).findByTestId('shortfall')).toHaveTextContent('with empty columns the open rooms have only 10 usable seats — about 5 more are needed.');
  });

  it('withdrawing the request puts the session straight back to seating', async () => {
    setUp({ status: 'ROOM_ALLOCATION' });
    setMockRoomRequests([request()]);
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByTestId('room-request-pending');
    expect(screen.getByText(/Locked for you/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^withdraw request$/i }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^withdraw request$/i }));

    await waitFor(() => expect(LAST_ROOM_REQUEST_ACTION).toMatchObject({ action: 'cancel', id: 'req-1' }));
    await waitFor(() => expect(screen.queryByTestId('room-request-pending')).not.toBeInTheDocument());
  });

  it('after a decline, shows the admin\'s reason and seating carries on', async () => {
    setUp();
    setMockRoomRequests([request({ status: 'REJECTED', reviewNote: 'No free room that day.' })]);
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    expect(await screen.findByText(/Your request for more rooms was declined/i)).toBeInTheDocument();
    expect(screen.getByText(/No free room that day\./)).toBeInTheDocument();
    expect(screen.queryByTestId('room-request-pending')).not.toBeInTheDocument();
  });

  it('hides the button when more rooms cannot be requested (e.g. every room is finalized)', async () => {
    setUp();
    setMockExtraRoomsState(defaultExtraRoomsState({ canRequest: false, blockedReason: 'Every room\'s seating is already finalized.' }));
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" />);

    await screen.findByText('Midterm Session');
    await screen.findByRole('heading', { name: 'Seating' });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^request more rooms$/i })).not.toBeInTheDocument());
  });

  it('shows the admin a pointer to Room Requests instead of the first-allocation approval screen', async () => {
    setUp({ status: 'ROOM_ALLOCATION' });
    setMockRoomRequests([request()]);
    renderWithProviders(<ExamSessionDetailView sessionId="session-1" role="ADMIN" />);

    const pending = await screen.findByTestId('room-request-pending');
    expect(within(pending).getByRole('link', { name: /room requests/i })).toHaveAttribute('href', '/admin/room-requests');
    expect(within(pending).queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/pending your approval/i)).not.toBeInTheDocument();
  });
});

describe('Admin: Room Requests queue', () => {
  it('lists pending requests and opens the review with finalized rooms marked untouched and the others marked for re-split', async () => {
    setUp();
    setMockRoomRequests([request(), request({ id: 'req-2', status: 'APPROVED', examSessionName: 'Old exam' })]);
    renderWithProviders(<AdminRoomRequestsPage />);

    expect(await screen.findByText('Midterm Session')).toBeInTheDocument();
    expect(screen.queryByText('Old exam')).not.toBeInTheDocument(); // Pending tab by default
    await userEvent.click(screen.getByRole('button', { name: /^review$/i }));

    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText(/Late additions to the roster/)).toBeInTheDocument();
    const current = within(drawer).getByTestId('current-rooms');
    expect(within(current).getByText('Finalized — untouched')).toBeInTheDocument();
    expect(within(current).getByText('Will be re-split')).toBeInTheDocument();
    expect(within(drawer).getByText(/the 30 students who are not in a finalized room are re-split/i)).toBeInTheDocument();
  });

  it('approves with the asked-for rooms by default, or with the admin\'s change, and sends the note', async () => {
    setUp();
    setMockRoomRequests([request()]);
    renderWithProviders(<AdminRoomRequestsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /^review$/i }));
    const drawer = await screen.findByRole('dialog');

    await userEvent.click(await within(drawer).findByLabelText(/B-201 \(20 free seats\)/)); // untick the asked-for room…
    await userEvent.click(await within(drawer).findByRole('button', { name: /swap in another free room/i })); // …and swap in another
    await userEvent.click(await screen.findByRole('option', { name: /room 410/i }));
    await userEvent.type(within(drawer).getByLabelText(/note to the faculty member/i), 'Swapped for a bigger room.');
    await userEvent.click(within(drawer).getByRole('button', { name: /approve & add rooms/i }));

    await waitFor(() => expect(LAST_ROOM_REQUEST_ACTION).toMatchObject({ action: 'approve', id: 'req-1' }));
    expect(LAST_ROOM_REQUEST_ACTION?.body).toMatchObject({ room_ids: ['room-z'], note: 'Swapped for a bigger room.' });
    await waitFor(() => expect(ROOM_REQUESTS[0].status).toBe('APPROVED'));
  });

  it('declining needs a note, and the note is sent', async () => {
    setUp();
    setMockRoomRequests([request()]);
    renderWithProviders(<AdminRoomRequestsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /^review$/i }));
    const drawer = await screen.findByRole('dialog');

    const decline = await within(drawer).findByRole('button', { name: /decline request/i });
    expect(decline).toBeDisabled();
    await userEvent.type(within(drawer).getByLabelText(/note to the faculty member/i), 'No free room that day.');
    await userEvent.click(decline);

    await waitFor(() => expect(LAST_ROOM_REQUEST_ACTION).toMatchObject({ action: 'reject', body: { note: 'No free room that day.' } }));
  });
});
