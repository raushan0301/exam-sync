import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  setMockFaculty,
  setMockExamSessions,
  setMockRooms,
  setMockInvigilators,
  SESSION_TOKENS,
  FACULTY_USER,
  type MockExamSession,
  type MockRoom,
} from './msw/handlers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import FacultyInvigilationDutiesPage from '@/app/faculty/invigilation-duties/page';

const NOW = '2026-01-01T00:00:00.000Z';
const FACULTY_ACCESS_TOKEN = 'faculty-access-token';
const FACULTY_REFRESH_TOKEN = 'faculty-refresh-token';
SESSION_TOKENS[FACULTY_ACCESS_TOKEN] = FACULTY_USER;

function signInAsFaculty() {
  setTokens(FACULTY_ACCESS_TOKEN, FACULTY_REFRESH_TOKEN);
}

function makeSession(overrides: Partial<MockExamSession> = {}): MockExamSession {
  return {
    id: 'session-1',
    name: 'Active Session',
    sessionDate: '2026-03-01',
    startTime: '09:00:00',
    endTime: '11:00:00',
    status: 'IN_PROGRESS',
    createdByAdminId: FACULTY_USER.id,
    version: 1,
    quizIds: [],
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

describe('FacultyInvigilationDutiesPage', () => {
  it('splits COMPLETED and CANCELLED-session duties into a History section (each tagged with its own status), keeping everything else in the main active list', async () => {
    signInAsFaculty();
    setMockFaculty([
      { id: 'fac-1', userId: FACULTY_USER.id, name: 'Dr. Test', departmentId: 'dept-1', employeeCode: 'F001', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
    ]);
    setMockRooms([makeRoom()]);
    setMockExamSessions([
      makeSession({ id: 'session-active', name: 'Active Session', status: 'IN_PROGRESS' }),
      makeSession({ id: 'session-done', name: 'Completed Session', status: 'COMPLETED' }),
      makeSession({ id: 'session-cancelled', name: 'Cancelled Session', status: 'CANCELLED' }),
    ]);
    setMockInvigilators([
      { id: 'inv-1', examSessionId: 'session-active', roomId: 'room-1', facultyId: 'fac-1', role: 'LEAD_INVIGILATOR', assignedAt: NOW, createdAt: NOW },
      { id: 'inv-2', examSessionId: 'session-done', roomId: 'room-1', facultyId: 'fac-1', role: 'LEAD_INVIGILATOR', assignedAt: NOW, createdAt: NOW },
      { id: 'inv-3', examSessionId: 'session-cancelled', roomId: 'room-1', facultyId: 'fac-1', role: 'LEAD_INVIGILATOR', assignedAt: NOW, createdAt: NOW },
    ]);

    renderWithProviders(<FacultyInvigilationDutiesPage />);

    const activeRow = await screen.findByText('Active Session');
    expect(activeRow).toBeInTheDocument();

    const historyHeading = await screen.findByRole('heading', { name: 'History' });
    const historySection = historyHeading.closest('div')!.parentElement!;
    const completedRow = within(historySection).getByText('Completed Session').closest('tr')!;
    expect(within(completedRow).getByText('Completed')).toBeInTheDocument();
    expect(within(completedRow).getByRole('button', { name: /view attendance/i })).toBeInTheDocument();

    const cancelledRow = within(historySection).getByText('Cancelled Session').closest('tr')!;
    expect(within(cancelledRow).getByText('Cancelled')).toBeInTheDocument();
    expect(within(cancelledRow).queryByRole('button', { name: /view attendance/i })).not.toBeInTheDocument();

    // Neither historical session should also appear in the main (active) table.
    const mainTables = screen.getAllByRole('table');
    expect(within(mainTables[0]).queryByText('Completed Session')).not.toBeInTheDocument();
    expect(within(mainTables[0]).queryByText('Cancelled Session')).not.toBeInTheDocument();
  });

  it('hides the History section entirely when no duty is for a COMPLETED session', async () => {
    signInAsFaculty();
    setMockFaculty([
      { id: 'fac-1', userId: FACULTY_USER.id, name: 'Dr. Test', departmentId: 'dept-1', employeeCode: 'F001', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
    ]);
    setMockRooms([makeRoom()]);
    setMockExamSessions([makeSession({ id: 'session-active', name: 'Active Session', status: 'IN_PROGRESS' })]);
    setMockInvigilators([
      { id: 'inv-1', examSessionId: 'session-active', roomId: 'room-1', facultyId: 'fac-1', role: 'LEAD_INVIGILATOR', assignedAt: NOW, createdAt: NOW },
    ]);

    renderWithProviders(<FacultyInvigilationDutiesPage />);

    await screen.findByText('Active Session');
    expect(screen.queryByRole('heading', { name: 'History' })).not.toBeInTheDocument();
  });
});
