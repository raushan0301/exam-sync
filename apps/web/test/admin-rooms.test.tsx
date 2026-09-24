import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  API_BASE_URL,
  setMockRooms,
  setMockRoomSeats,
  setMockAvailabilityBlocks,
  VALID_ACCESS_TOKEN,
  VALID_REFRESH_TOKEN,
  type MockRoom,
  type MockRoomSeat,
} from './msw/handlers';

let currentRoomId = 'room-1';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: currentRoomId }),
}));

import RoomsPage from '@/app/admin/rooms/page';
import RoomDetailPage from '@/app/admin/rooms/[id]/page';

const NOW = '2026-01-01T00:00:00.000Z';

/** TimeInput renders three <select>s (Hour/Minute/AM-PM) inside a role="group" named by the field's label, instead of a single typeable text field. */
async function setTimeField(groupName: RegExp, hour12: string, minute: string, period: 'AM' | 'PM') {
  const group = screen.getByRole('group', { name: groupName });
  await userEvent.selectOptions(within(group).getByLabelText('Hour'), hour12);
  await userEvent.selectOptions(within(group).getByLabelText('Minute'), minute);
  await userEvent.selectOptions(within(group).getByLabelText('AM or PM'), period);
}

function signInAsAdmin() {
  setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN);
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

function makeSeat(overrides: Partial<MockRoomSeat> = {}): MockRoomSeat {
  return {
    id: 'seat-1',
    roomId: 'room-1',
    seatLabel: 'A1',
    rowIndex: 0,
    colIndex: 0,
    isAccessible: false,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('Rooms list', () => {
  it('loads and lists rooms', async () => {
    signInAsAdmin();
    setMockRooms([makeRoom()]);

    renderWithProviders(<RoomsPage />);

    expect(await screen.findByText('101')).toBeInTheDocument();
    expect(screen.getByText('Main Hall')).toBeInTheDocument();
  });

  it('creates a new room', async () => {
    signInAsAdmin();
    setMockRooms([]);

    renderWithProviders(<RoomsPage />);

    await screen.findByText('No rooms yet');
    const newRoomButtons = screen.getAllByRole('button', { name: /new room/i });
    await userEvent.click(newRoomButtons[0]);

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/building/i), 'North Wing');
    await userEvent.type(within(dialog).getByLabelText(/^floor/i), '2');
    await userEvent.type(within(dialog).getByLabelText(/room number/i), '202');
    await userEvent.type(within(dialog).getByLabelText(/^capacity/i), '40');
    await userEvent.type(within(dialog).getByLabelText(/^rows/i), '5');
    await userEvent.type(within(dialog).getByLabelText(/^columns/i), '8');

    await userEvent.click(within(dialog).getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(screen.getByText('202')).toBeInTheDocument());
  });

  it('deactivates a room', async () => {
    signInAsAdmin();
    setMockRooms([makeRoom()]);

    renderWithProviders(<RoomsPage />);

    await screen.findByText('101');
    await userEvent.click(screen.getByRole('button', { name: /deactivate/i }));
    await userEvent.click(screen.getByRole('button', { name: /^deactivate$/i }));

    await waitFor(() => expect(screen.getByText('Inactive', { selector: 'span' })).toBeInTheDocument());
  });
});

describe('Room detail', () => {
  it('shows the seat grid and toggles a seat', async () => {
    signInAsAdmin();
    currentRoomId = 'room-1';
    setMockRooms([makeRoom()]);
    setMockRoomSeats([makeSeat()]);
    setMockAvailabilityBlocks([]);

    renderWithProviders(<RoomDetailPage />);

    await screen.findByText(/Room 101/);
    const seatButton = await screen.findByTitle('A1');
    await userEvent.click(seatButton);

    await userEvent.click(screen.getByRole('button', { name: /disable seat/i }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Seat A1/i })).not.toBeInTheDocument());
  });

  it('creates an availability block', async () => {
    signInAsAdmin();
    currentRoomId = 'room-1';
    setMockRooms([makeRoom()]);
    setMockRoomSeats([]);
    setMockAvailabilityBlocks([]);

    renderWithProviders(<RoomDetailPage />);

    await screen.findByText(/Room 101/);
    await userEvent.click(screen.getByRole('button', { name: /add block/i }));

    await userEvent.type(screen.getByLabelText(/^date/i), '2026-05-01');
    await setTimeField(/start time/i, '9', '00', 'AM');
    await setTimeField(/end time/i, '11', '00', 'AM');
    await userEvent.type(screen.getByLabelText(/reason/i), 'Maintenance');

    await userEvent.click(screen.getByRole('button', { name: /^add block$/i }));

    await waitFor(() => expect(screen.getByText('Maintenance')).toBeInTheDocument());
  });
});
