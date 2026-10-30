import { ConflictException, NotFoundException } from '@nestjs/common';
import { buildXlsxBuffer, readTemplateExampleRow } from '../../common/bulk-import/test-utils';
import { Prisma, RoomStatus } from '@exam-sync/db';
import { RoomsService } from './rooms.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

function buildPrismaMock() {
  const tx = {
    room: { create: jest.fn(), update: jest.fn() },
    roomSeat: { createMany: jest.fn(), update: jest.fn() },
    roomAvailability: { create: jest.fn() },
  };
  return {
    room: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    roomSeat: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    roomAvailability: { create: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'], mustChangePassword: false };

describe('RoomsService — Phase 11 (rooms, seats, availability calendar)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let service: RoomsService;
  let importJobsService: { create: jest.Mock };

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    importJobsService = { create: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    service = new RoomsService(prisma, auditHook as unknown as AuditHookService, importJobsService as any, { runningHoldsOnDay: jest.fn().mockResolvedValue([]) } as any);
  });

  describe('create — seat map generation from rows×columns', () => {
    const dto = { building: 'Main', floor: 1, room_number: '101', capacity: 6, rows: 2, columns: 3 };

    it('creates the room and generates exactly rows×columns seats, labeled A1..A3, B1..B3', async () => {
      prisma.__tx.room.create.mockResolvedValue({ id: 'room-1', ...dto });

      await service.create(dto, admin);

      expect(prisma.__tx.roomSeat.createMany).toHaveBeenCalledWith({
        data: [
          { roomId: 'room-1', seatLabel: 'A1', rowIndex: 0, colIndex: 0 },
          { roomId: 'room-1', seatLabel: 'A2', rowIndex: 0, colIndex: 1 },
          { roomId: 'room-1', seatLabel: 'A3', rowIndex: 0, colIndex: 2 },
          { roomId: 'room-1', seatLabel: 'B1', rowIndex: 1, colIndex: 0 },
          { roomId: 'room-1', seatLabel: 'B2', rowIndex: 1, colIndex: 1 },
          { roomId: 'room-1', seatLabel: 'B3', rowIndex: 1, colIndex: 2 },
        ],
      });
    });

    it('extends past single letters for > 26 rows (AA, AB, ... spreadsheet-style)', async () => {
      const bigDto = { building: 'Main', floor: 1, room_number: 'Big', capacity: 27, rows: 27, columns: 1 };
      prisma.__tx.room.create.mockResolvedValue({ id: 'room-2', ...bigDto });

      await service.create(bigDto, admin);

      const seats = prisma.__tx.roomSeat.createMany.mock.calls[0][0].data;
      expect(seats[25].seatLabel).toBe('Z1'); // row index 25 -> 'Z'
      expect(seats[26].seatLabel).toBe('AA1'); // row index 26 -> 'AA'
    });

    it('audits CREATE and returns the room', async () => {
      prisma.__tx.room.create.mockResolvedValue({ id: 'room-1', ...dto });

      const result = await service.create(dto, admin);

      expect(result.id).toBe('room-1');
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Room', entityId: 'room-1' }),
        expect.anything(),
      );
    });

    it('maps a (building, room_number) uniqueness violation to a clean 409', async () => {
      prisma.$transaction.mockRejectedValue(p2002());

      await expect(service.create(dto, admin)).rejects.toThrow(ConflictException);
    });
  });

  describe('findById / list', () => {
    it('404s for a non-existent room', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });

    it('filters by status, building, min_capacity, and search', async () => {
      prisma.room.findMany.mockResolvedValue([]);

      await service.list({ status: RoomStatus.ACTIVE, building: 'Main', minCapacity: 50, search: 'lab' });

      expect(prisma.room.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: RoomStatus.ACTIVE,
            building: 'Main',
            capacity: { gte: 50 },
            OR: [
              { building: { contains: 'lab', mode: 'insensitive' } },
              { roomNumber: { contains: 'lab', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });
  });

  describe('update — status/deactivation rules', () => {
    const existing = { id: 'room-1', building: 'Main', roomNumber: '101', status: RoomStatus.ACTIVE };

    it('audits a transition INTO INACTIVE as DEACTIVATE', async () => {
      prisma.room.findUnique.mockResolvedValue(existing);
      prisma.__tx.room.update.mockResolvedValue({ ...existing, status: RoomStatus.INACTIVE });

      await service.update('room-1', { status: RoomStatus.INACTIVE }, admin);

      expect(auditHook.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEACTIVATE' }), expect.anything());
    });

    it('audits a transition OUT OF INACTIVE as REACTIVATE', async () => {
      prisma.room.findUnique.mockResolvedValue({ ...existing, status: RoomStatus.INACTIVE });
      prisma.__tx.room.update.mockResolvedValue({ ...existing, status: RoomStatus.ACTIVE });

      await service.update('room-1', { status: RoomStatus.ACTIVE }, admin);

      expect(auditHook.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'REACTIVATE' }), expect.anything());
    });

    it('audits ACTIVE <-> MAINTENANCE (neither side INACTIVE) as a plain UPDATE', async () => {
      prisma.room.findUnique.mockResolvedValue(existing);
      prisma.__tx.room.update.mockResolvedValue({ ...existing, status: RoomStatus.MAINTENANCE });

      await service.update('room-1', { status: RoomStatus.MAINTENANCE }, admin);

      expect(auditHook.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE' }), expect.anything());
    });

    it('audits a non-status field edit as UPDATE', async () => {
      prisma.room.findUnique.mockResolvedValue(existing);
      prisma.__tx.room.update.mockResolvedValue({ ...existing, capacity: 80 });

      await service.update('room-1', { capacity: 80 }, admin);

      expect(auditHook.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE' }), expect.anything());
    });

    it('does NOT accept rows/columns (no such fields on UpdateRoomDto — compile-time enforced, not runtime)', () => {
      // Documented via the DTO itself; this test exists to make the
      // decision discoverable from the spec file, not to assert behavior
      // TypeScript already guarantees.
      expect(true).toBe(true);
    });

    it('maps a uniqueness violation on rename to a clean 409', async () => {
      prisma.room.findUnique.mockResolvedValue(existing);
      prisma.__tx.room.update.mockRejectedValue(p2002());

      await expect(
        service.update('room-1', { room_number: '102' }, admin),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listSeats / updateSeat — individual seat disable (IMPLEMENTATION_PLAN.md test note)', () => {
    it('404s listSeats for a non-existent room', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      await expect(service.listSeats('missing')).rejects.toThrow(NotFoundException);
    });

    it('lists a room\'s seats ordered by row then column', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.roomSeat.findMany.mockResolvedValue([{ id: 'seat-1' }]);

      const result = await service.listSeats('room-1');

      expect(result).toEqual([{ id: 'seat-1' }]);
      expect(prisma.roomSeat.findMany).toHaveBeenCalledWith({
        where: { roomId: 'room-1' },
        orderBy: [{ rowIndex: 'asc' }, { colIndex: 'asc' }],
      });
    });

    it('404s updateSeat when the seat does not belong to the given room', async () => {
      prisma.roomSeat.findUnique.mockResolvedValue({ id: 'seat-1', roomId: 'OTHER-ROOM' });

      await expect(
        service.updateSeat('room-1', 'seat-1', { is_active: false }, admin),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s updateSeat when the seat does not exist', async () => {
      prisma.roomSeat.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSeat('room-1', 'missing-seat', { is_active: false }, admin),
      ).rejects.toThrow(NotFoundException);
    });

    it('disabling a seat (is_active: false) is audited as DEACTIVATE', async () => {
      const existing = { id: 'seat-1', roomId: 'room-1', isActive: true, isAccessible: false };
      prisma.roomSeat.findUnique.mockResolvedValue(existing);
      prisma.__tx.roomSeat.update.mockResolvedValue({ ...existing, isActive: false });

      await service.updateSeat('room-1', 'seat-1', { is_active: false }, admin);

      expect(prisma.__tx.roomSeat.update).toHaveBeenCalledWith({
        where: { id: 'seat-1' },
        data: { isActive: false, isAccessible: undefined },
      });
      expect(auditHook.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEACTIVATE', entityType: 'RoomSeat' }), expect.anything());
    });

    it('re-enabling a seat (is_active: true) is audited as REACTIVATE', async () => {
      const existing = { id: 'seat-1', roomId: 'room-1', isActive: false, isAccessible: false };
      prisma.roomSeat.findUnique.mockResolvedValue(existing);
      prisma.__tx.roomSeat.update.mockResolvedValue({ ...existing, isActive: true });

      await service.updateSeat('room-1', 'seat-1', { is_active: true }, admin);

      expect(auditHook.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'REACTIVATE' }), expect.anything());
    });

    it('marking a seat accessible (without touching is_active) is a plain UPDATE', async () => {
      const existing = { id: 'seat-1', roomId: 'room-1', isActive: true, isAccessible: false };
      prisma.roomSeat.findUnique.mockResolvedValue(existing);
      prisma.__tx.roomSeat.update.mockResolvedValue({ ...existing, isAccessible: true });

      await service.updateSeat('room-1', 'seat-1', { is_accessible: true }, admin);

      expect(auditHook.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE' }), expect.anything());
    });
  });

  describe('availability blocks', () => {
    it('createAvailabilityBlock 404s for a non-existent room', async () => {
      prisma.room.findUnique.mockResolvedValue(null);

      await expect(
        service.createAvailabilityBlock('missing', { date: '2026-06-01', start_time: '09:00', end_time: '10:00', reason: 'MAINTENANCE' }, admin),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a block and audits CREATE', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.__tx.roomAvailability.create.mockResolvedValue({ id: 'block-1', roomId: 'room-1' });

      await service.createAvailabilityBlock(
        'room-1',
        { date: '2026-06-01', start_time: '09:00', end_time: '10:00', reason: 'MAINTENANCE' },
        admin,
      );

      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'RoomAvailability' }),
        expect.anything(),
      );
    });

    it('listAvailabilityBlocks 404s for a non-existent room', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      await expect(service.listAvailabilityBlocks('missing', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAvailable — GET /rooms/available', () => {
    it('queries only ACTIVE rooms, capacity >= min_capacity, with no overlapping availability block', async () => {
      prisma.room.findMany.mockResolvedValue([]);

      await service.findAvailable({ date: '2026-06-01', start_time: '10:00', end_time: '11:00', min_capacity: 50 });

      expect(prisma.room.findMany).toHaveBeenCalledWith({
        where: {
          status: RoomStatus.ACTIVE,
          capacity: { gte: 50 },
          availabilityBlocks: {
            none: {
              date: new Date('2026-06-01T00:00:00Z'),
              startTime: { lt: new Date('1970-01-01T11:00:00Z') },
              endTime: { gt: new Date('1970-01-01T10:00:00Z') },
            },
          },
        },
        orderBy: { capacity: 'asc' },
      });
    });

    it('omits the capacity filter entirely when min_capacity is not given', async () => {
      prisma.room.findMany.mockResolvedValue([]);

      await service.findAvailable({ date: '2026-06-01', start_time: '10:00', end_time: '11:00' });

      const calledWith = prisma.room.findMany.mock.calls[0][0];
      expect(calledWith.where).not.toHaveProperty('capacity');
    });
  });

  describe('generateBulkImportTemplate', () => {

    it('uses a fixed example row, independent of existing data', async () => {

      const row = await readTemplateExampleRow(await service.generateBulkImportTemplate());


      expect(row.building).toBe('F-Block');

    });

  });

  describe('bulkImport', () => {
    it('imports a valid row', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      prisma.__tx.room.create.mockResolvedValue({ id: 'r1', building: 'Main Block', roomNumber: 'A101' });
      const buffer = await buildXlsxBuffer(
        ['building', 'room_number', 'floor', 'capacity', 'rows', 'columns'],
        [['Main Block', 'A101', 1, 60, 10, 6]],
      );

      await service.bulkImport(buffer, admin);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          successCount: 1,
          failureCount: 0,
          results: [{ row: 2, status: 'SUCCESS', id: 'r1' }],
        }),
      );
    });

    it.each([['G'], ['g'], ['Ground'], [' G ']])('reads floor %j as ground floor (0)', async (floor) => {
      prisma.room.findUnique.mockResolvedValue(null);
      prisma.__tx.room.create.mockResolvedValue({ id: 'r1', building: 'F-Block', roomNumber: 'F-101' });
      const buffer = await buildXlsxBuffer(
        ['building', 'room_number', 'floor', 'capacity', 'rows', 'columns'],
        [['F-Block', 'F-101', floor, 60, 10, 6]],
      );

      await service.bulkImport(buffer, admin);

      expect(prisma.__tx.room.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ floor: 0 }) }),
      );
    });

    it('still reads numeric floors, and rejects non-numeric, non-ground values', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      prisma.__tx.room.create.mockResolvedValue({ id: 'r1', building: 'F-Block', roomNumber: 'F-101' });
      const buffer = await buildXlsxBuffer(
        ['building', 'room_number', 'floor', 'capacity', 'rows', 'columns'],
        [['F-Block', 'F-101', 3, 60, 10, 6], ['F-Block', 'F-102', 'X', 60, 10, 6]],
      );

      await service.bulkImport(buffer, admin);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          successCount: 1,
          failureCount: 1,
          results: [
            expect.objectContaining({ row: 2, status: 'SUCCESS' }),
            expect.objectContaining({ row: 3, status: 'FAILURE', error: expect.stringContaining("'floor' must be a number") }),
          ],
        }),
      );
    });

    it('reports an existing (building, room_number) combination as a per-row FAILURE', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'existing', building: 'Main Block', roomNumber: 'A101' });
      const buffer = await buildXlsxBuffer(
        ['building', 'room_number', 'floor', 'capacity', 'rows', 'columns'],
        [['Main Block', 'A101', 1, 60, 10, 6]],
      );

      await service.bulkImport(buffer, admin);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          successCount: 0,
          failureCount: 1,
          results: [expect.objectContaining({ row: 2, status: 'FAILURE', error: expect.stringContaining('already exists') })],
        }),
      );
    });
  });

  describe('getAvailabilityCalendar — held seats', () => {
    it('adds a SEAT_HOLD range, with the seats and quiz titles, beside the booked and blocked ranges', async () => {
      const room = { id: 'room-1', building: 'B', roomNumber: '107', capacity: 42 };
      prisma.room.findMany.mockResolvedValue([room]);
      prisma.examSessionRoom = { findMany: jest.fn().mockResolvedValue([]) };
      prisma.roomAvailability.findMany.mockResolvedValue([]);
      const holds = { runningHoldsOnDay: jest.fn().mockResolvedValue([
        { roomId: 'room-1', start: new Date('1970-01-01T09:30:00Z'), end: new Date('1970-01-01T11:00:00Z'), seats: 5, quizTitles: ['Quiz C'] },
      ]) };
      service = new RoomsService(prisma, auditHook as unknown as AuditHookService, importJobsService as any, holds as any);

      const [entry] = await service.getAvailabilityCalendar('2026-10-12');

      expect(entry.bookedRanges).toEqual([
        { start_time: '09:30', end_time: '11:00', source: 'SEAT_HOLD', seats_held: 5, quiz_titles: ['Quiz C'] },
      ]);
    });
  });
});
