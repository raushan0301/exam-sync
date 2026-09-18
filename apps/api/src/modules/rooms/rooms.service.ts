import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Room, RoomAvailability, RoomSeat, RoomStatus } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import {
  cursorFindManyArgs,
  PaginatedResult,
  resolveLimit,
  toPaginatedResult,
} from '../../common/pagination/paginate';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { UpdateSeatDto } from './dto/update-seat.dto';
import { CreateAvailabilityBlockDto } from './dto/create-availability-block.dto';

export interface ListRoomsParams {
  cursor?: string;
  limit?: number;
  search?: string;
  status?: RoomStatus;
  building?: string;
  minCapacity?: number;
}

export interface FindAvailableRoomsParams {
  date: string;
  start_time: string;
  end_time: string;
  min_capacity?: number;
}

/**
 * Owns `rooms` + `room_seats` + `room_availability` (ARCHITECTURE.md §R,
 * IMPLEMENTATION_PLAN.md Phase 11: "rooms, seats, availability calendar").
 *
 * Deliberately does NOT touch `exam_session_rooms` or the BR-018 exclusion
 * constraint — that table/constraint is Phase 12's own DB-changes item
 * (§S "Room Allocation Algorithm"), built on top of what this phase
 * creates. `findAvailable` below checks ONLY `rooms.status` and
 * `room_availability` blocks (this phase's own data) — it does NOT check
 * for existing session bookings, since there is no booking table yet;
 * Phase 12's real allocation flow re-validates against `exam_session_rooms`
 * itself once that exists.
 */
@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
  ) {}

  /**
   * `POST /rooms` (ADMIN). Immediately generates the room's `room_seats`
   * map from `rows`×`columns` (IMPLEMENTATION_PLAN.md test note) —
   * `A1..A{columns}`, `B1..`, etc., extending past single letters (`AA1`)
   * for `rows` > 26 the same way spreadsheet columns do, since the
   * documented example (`'A1'`) never states a row-count ceiling.
   */
  async create(dto: CreateRoomDto, actor: AuthenticatedUser): Promise<Room> {
    const room = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.room.create({
          data: {
            building: dto.building,
            floor: dto.floor,
            roomNumber: dto.room_number,
            capacity: dto.capacity,
            rows: dto.rows,
            columns: dto.columns,
            accessibilityInfo: dto.accessibility_info as Prisma.InputJsonValue | undefined,
          },
        });

        const seats: Prisma.RoomSeatCreateManyInput[] = [];
        for (let rowIndex = 0; rowIndex < dto.rows; rowIndex++) {
          for (let colIndex = 0; colIndex < dto.columns; colIndex++) {
            seats.push({
              roomId: created.id,
              seatLabel: `${this.rowLabel(rowIndex)}${colIndex + 1}`,
              rowIndex,
              colIndex,
            });
          }
        }
        await tx.roomSeat.createMany({ data: seats });

        await this.auditHook.record(
          {
            actor,
            action: 'CREATE',
            entityType: 'Room',
            entityId: created.id,
            newValue: created,
          },
          tx,
        );

        return created;
      })
      .catch((err) => this.mapUniqueViolation(err, dto.building, dto.room_number));

    return room;
  }

  async findById(id: string): Promise<Room> {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) {
      throw new NotFoundException();
    }
    return room;
  }

  /** `GET /rooms` — open to any authenticated role (per the user's explicit Phase 11 authorization decision: "ADMIN write, any authenticated role can read"). */
  async list(params: ListRoomsParams): Promise<PaginatedResult<Room>> {
    const limit = resolveLimit(params.limit);

    const rows = await this.prisma.room.findMany({
      ...cursorFindManyArgs(params.cursor, limit),
      where: {
        status: params.status,
        building: params.building,
        ...(params.minCapacity !== undefined ? { capacity: { gte: params.minCapacity } } : {}),
        ...(params.search
          ? {
              OR: [
                { building: { contains: params.search, mode: 'insensitive' } },
                { roomNumber: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    return toPaginatedResult(rows, limit);
  }

  /**
   * `PATCH /rooms/{id}` (ADMIN). A `status` transition to/from `INACTIVE`
   * is audited as DEACTIVATE/REACTIVATE (same convention as
   * SubjectsService's boolean `is_active`, adapted for this table's
   * 3-state enum); any other status change (e.g. ACTIVE <-> MAINTENANCE)
   * or field edit is a plain UPDATE.
   */
  async update(id: string, dto: UpdateRoomDto, actor: AuthenticatedUser): Promise<Room> {
    const existing = await this.findById(id);

    const room = await this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.room.update({
          where: { id },
          data: {
            building: dto.building,
            floor: dto.floor,
            roomNumber: dto.room_number,
            capacity: dto.capacity,
            status: dto.status,
            accessibilityInfo: dto.accessibility_info as Prisma.InputJsonValue | undefined,
          },
        });

        let action: 'UPDATE' | 'DEACTIVATE' | 'REACTIVATE' = 'UPDATE';
        if (dto.status && dto.status !== existing.status) {
          if (dto.status === RoomStatus.INACTIVE) {
            action = 'DEACTIVATE';
          } else if (existing.status === RoomStatus.INACTIVE) {
            action = 'REACTIVATE';
          }
        }

        await this.auditHook.record(
          {
            actor,
            action,
            entityType: 'Room',
            entityId: updated.id,
            oldValue: existing,
            newValue: updated,
          },
          tx,
        );

        return updated;
      })
      .catch((err) => this.mapUniqueViolation(err, dto.building, dto.room_number));

    return room;
  }

  /** `GET /rooms/{id}/seats`. */
  async listSeats(roomId: string): Promise<RoomSeat[]> {
    await this.findById(roomId);
    return this.prisma.roomSeat.findMany({
      where: { roomId },
      orderBy: [{ rowIndex: 'asc' }, { colIndex: 'asc' }],
    });
  }

  /** `PATCH /rooms/{id}/seats/{seatId}` (ADMIN) — individual seat disable/enable, or mark accessible. */
  async updateSeat(
    roomId: string,
    seatId: string,
    dto: UpdateSeatDto,
    actor: AuthenticatedUser,
  ): Promise<RoomSeat> {
    const existing = await this.prisma.roomSeat.findUnique({ where: { id: seatId } });
    if (!existing || existing.roomId !== roomId) {
      throw new NotFoundException();
    }

    const seat = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.roomSeat.update({
        where: { id: seatId },
        data: { isActive: dto.is_active, isAccessible: dto.is_accessible },
      });

      let action: 'UPDATE' | 'DEACTIVATE' | 'REACTIVATE' = 'UPDATE';
      if (dto.is_active !== undefined && dto.is_active !== existing.isActive) {
        action = dto.is_active ? 'REACTIVATE' : 'DEACTIVATE';
      }

      await this.auditHook.record(
        {
          actor,
          action,
          entityType: 'RoomSeat',
          entityId: updated.id,
          oldValue: existing,
          newValue: updated,
        },
        tx,
      );

      return updated;
    });

    return seat;
  }

  /** `POST /rooms/{id}/availability-blocks` (ADMIN). */
  async createAvailabilityBlock(
    roomId: string,
    dto: CreateAvailabilityBlockDto,
    actor: AuthenticatedUser,
  ): Promise<RoomAvailability> {
    await this.findById(roomId);

    const block = await this.prisma.$transaction(async (tx) => {
      const created = await tx.roomAvailability.create({
        data: {
          roomId,
          date: this.toDate(dto.date),
          startTime: this.toTime(dto.start_time),
          endTime: this.toTime(dto.end_time),
          reason: dto.reason,
        },
      });

      await this.auditHook.record(
        {
          actor,
          action: 'CREATE',
          entityType: 'RoomAvailability',
          entityId: created.id,
          newValue: created,
        },
        tx,
      );

      return created;
    });

    return block;
  }

  /** `GET /rooms/{id}/availability-blocks` — disclosed addition (API_CONTRACT.md documents only the POST; a write-only calendar has no way to be read back otherwise). */
  async listAvailabilityBlocks(
    roomId: string,
    params: { cursor?: string; limit?: number },
  ): Promise<PaginatedResult<RoomAvailability>> {
    await this.findById(roomId);
    const limit = resolveLimit(params.limit);

    const rows = await this.prisma.roomAvailability.findMany({
      ...cursorFindManyArgs(params.cursor, limit),
      where: { roomId },
      orderBy: { date: 'asc' },
    });

    return toPaginatedResult(rows, limit);
  }

  /**
   * `GET /rooms/available` — query `{date, start_time, end_time,
   * min_capacity}` (API_CONTRACT.md). A room qualifies iff: `ACTIVE`,
   * `capacity >= min_capacity` (when given), and no `room_availability`
   * block on that date overlaps `[start_time, end_time)` (same
   * half-open-interval overlap rule as BR-019's session-overlap check —
   * no documented buffer, back-to-back blocks don't conflict). Ordered by
   * capacity ascending (smallest sufficient room first) — a reasonable,
   * undocumented but harmless default; Phase 12's real allocation makes
   * its own choice regardless.
   */
  async findAvailable(params: FindAvailableRoomsParams): Promise<Room[]> {
    const date = this.toDate(params.date);
    const startTime = this.toTime(params.start_time);
    const endTime = this.toTime(params.end_time);

    return this.prisma.room.findMany({
      where: {
        status: RoomStatus.ACTIVE,
        ...(params.min_capacity !== undefined ? { capacity: { gte: params.min_capacity } } : {}),
        availabilityBlocks: {
          none: {
            date,
            startTime: { lt: endTime },
            endTime: { gt: startTime },
          },
        },
      },
      orderBy: { capacity: 'asc' },
    });
  }

  /** `A, B, ... Z, AA, AB, ...` — spreadsheet-style row labeling, generalizing the documented single-letter example past 26 rows. */
  private rowLabel(rowIndex: number): string {
    let n = rowIndex;
    let label = '';
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
  }

  private toDate(dateStr: string): Date {
    return new Date(`${dateStr}T00:00:00Z`);
  }

  private toTime(timeStr: string): Date {
    return new Date(`1970-01-01T${timeStr}Z`);
  }

  private mapUniqueViolation(err: unknown, building: string | undefined, roomNumber: string | undefined): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(
        `Room "${roomNumber}" already exists in building "${building}" (BR: room codes are unique per building).`,
      );
    }
    throw err;
  }
}
