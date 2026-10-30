import { ConflictException, Injectable } from '@nestjs/common';
import {
  NotificationEventType,
  NotificationRecipientType,
  Prisma,
  RoomHold,
  RoomHoldKind,
  RoomHoldStatus,
  RoomStatus,
} from '@exam-sync/db';
import { keepAlternateColumns } from '@exam-sync/domain-logic';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsOutboxService } from '../notifications-outbox/notifications-outbox.service';

type Client = PrismaService | Prisma.TransactionClient;

/** The exam window a hold (or a session) covers: one date, from start to end time-of-day. */
export interface HoldWindow {
  date: Date;
  start: Date;
  end: Date;
}

export interface QuizForHold {
  id: string;
  title: string;
  studentCount: number | null;
  preferredDate: Date | null;
  preferredTime: Date | null;
  durationMinutes: number | null;
  requestedRoomIds: string[];
  backupRoomId: string | null;
  backupRoomLocked: boolean;
  emptyColumnsPlanned: boolean | null;
}

/** Another quiz's seats held in a room for an overlapping time — the room is shared, not full. */
export interface SharedHold {
  quizId: string;
  quizTitle: string;
  seats: number;
}

export interface RoomIssue {
  roomId: string;
  message: string;
}

const DEFAULT_DURATION_MINUTES = 120;
const END_OF_DAY_MS = Date.UTC(1970, 0, 1, 23, 59, 59);

/** The quiz's own slot: preferred date + time, lasting its duration (capped at the end of that day). */
export function quizWindow(quiz: Pick<QuizForHold, 'preferredDate' | 'preferredTime' | 'durationMinutes'>): HoldWindow | null {
  if (!quiz.preferredDate || !quiz.preferredTime) return null;
  const end = new Date(Math.min(quiz.preferredTime.getTime() + (quiz.durationMinutes ?? DEFAULT_DURATION_MINUTES) * 60_000, END_OF_DAY_MS));
  return { date: quiz.preferredDate, start: quiz.preferredTime, end };
}

export function sameWindow(a: HoldWindow, b: HoldWindow): boolean {
  return a.date.getTime() === b.date.getTime() && a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime();
}

/**
 * Seat-based room holds for APPROVED quizzes (see the `RoomHold` model). A hold keeps seats of a room free for a
 * quiz from approval until the rooms are allocated to its exam session, so another quiz cannot be approved into the
 * same seats in that window. Holds count SEATS, not whole rooms: several quizzes meant for one combined exam may
 * hold the same room as long as their seats fit. A hold ends when the rooms are allocated (CONSUMED), when it is
 * released (session created for another time, session cancelled), or by itself once its exam window has passed.
 */
@Injectable()
export class RoomHoldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsOutbox: NotificationsOutboxService,
  ) {}

  /** Seats a room can actually offer: all active seats, or only the kept columns when empty columns are planned. */
  async usableSeatCounts(client: Client, roomIds: string[], emptyColumns: boolean): Promise<Map<string, number>> {
    const counts = new Map<string, number>(roomIds.map((id) => [id, 0]));
    if (roomIds.length === 0) return counts;
    if (!emptyColumns) {
      const grouped = await client.roomSeat.groupBy({
        by: ['roomId'],
        where: { roomId: { in: roomIds }, isActive: true },
        _count: { id: true },
      });
      for (const g of grouped) counts.set(g.roomId, g._count.id);
      return counts;
    }
    const seats = await client.roomSeat.findMany({
      where: { roomId: { in: roomIds }, isActive: true },
      select: { roomId: true, colIndex: true },
    });
    const byRoom = new Map<string, { colIndex: number }[]>(roomIds.map((id) => [id, []]));
    for (const seat of seats) byRoom.get(seat.roomId)?.push(seat);
    for (const [roomId, list] of byRoom) counts.set(roomId, keepAlternateColumns(list).length);
    return counts;
  }

  /** ACTIVE holds whose exam window has not passed yet (a hold lapses by itself once its window is over). */
  private stillRunning(now = new Date()): Prisma.RoomHoldWhereInput {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const timeNow = new Date(Date.UTC(1970, 0, 1, now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()));
    return { status: RoomHoldStatus.ACTIVE, OR: [{ holdDate: { gt: today } }, { holdDate: today, endTime: { gt: timeNow } }] };
  }

  /** Seats already held in each room for an overlapping window, by quizzes other than `excludeQuizIds`. */
  async heldSeatsByRoom(
    client: Client,
    roomIds: string[],
    window: HoldWindow,
    excludeQuizIds: string[] = [],
  ): Promise<Map<string, number>> {
    const held = new Map<string, number>(roomIds.map((id) => [id, 0]));
    if (roomIds.length === 0) return held;
    const rows = await client.roomHold.findMany({
      where: {
        AND: [
          this.stillRunning(),
          {
            roomId: { in: roomIds },
            holdDate: window.date,
            startTime: { lt: window.end },
            endTime: { gt: window.start },
            quizId: { notIn: excludeQuizIds },
          },
        ],
      },
      select: { roomId: true, seatsHeld: true },
    });
    for (const row of rows) held.set(row.roomId, (held.get(row.roomId) ?? 0) + row.seatsHeld);
    return held;
  }

  /** Running holds on one day for the timeline: per room and time window, the seats held and by which quizzes. */
  async runningHoldsOnDay(
    client: Client,
    roomIds: string[],
    day: Date,
  ): Promise<{ roomId: string; start: Date; end: Date; seats: number; quizTitles: string[] }[]> {
    if (roomIds.length === 0) return [];
    const rows = await client.roomHold.findMany({
      where: { AND: [this.stillRunning(), { roomId: { in: roomIds }, holdDate: day }] },
      select: { roomId: true, startTime: true, endTime: true, seatsHeld: true, quiz: { select: { title: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const merged = new Map<string, { roomId: string; start: Date; end: Date; seats: number; quizTitles: string[] }>();
    for (const row of rows) {
      const key = `${row.roomId}|${row.startTime.getTime()}|${row.endTime.getTime()}`;
      const entry = merged.get(key) ?? { roomId: row.roomId, start: row.startTime, end: row.endTime, seats: 0, quizTitles: [] };
      entry.seats += row.seatsHeld;
      if (!entry.quizTitles.includes(row.quiz.title)) entry.quizTitles.push(row.quiz.title);
      merged.set(key, entry);
    }
    return [...merged.values()];
  }

  /** Who else holds seats in each room for an overlapping window (one entry per quiz), so the screens can say the room is shared. */
  async sharedHoldsByRoom(
    client: Client,
    roomIds: string[],
    window: HoldWindow,
    excludeQuizIds: string[] = [],
  ): Promise<Map<string, SharedHold[]>> {
    const shared = new Map<string, SharedHold[]>();
    if (roomIds.length === 0) return shared;
    const rows = await client.roomHold.findMany({
      where: {
        AND: [
          this.stillRunning(),
          {
            roomId: { in: roomIds },
            holdDate: window.date,
            startTime: { lt: window.end },
            endTime: { gt: window.start },
            quizId: { notIn: excludeQuizIds },
          },
        ],
      },
      select: { roomId: true, quizId: true, seatsHeld: true, quiz: { select: { title: true } } },
      orderBy: { createdAt: 'asc' },
    });
    for (const row of rows) {
      const list = shared.get(row.roomId) ?? [];
      const existing = list.find((h) => h.quizId === row.quizId);
      if (existing) existing.seats += row.seatsHeld;
      else list.push({ quizId: row.quizId, quizTitle: row.quiz.title, seats: row.seatsHeld });
      shared.set(row.roomId, list);
    }
    return shared;
  }

  /** Problems that make a room unusable in the window (not active, blocked, or already allocated to another session). */
  async roomIssues(client: Client, roomIds: string[], window: HoldWindow, excludeSessionId?: string): Promise<RoomIssue[]> {
    if (roomIds.length === 0) return [];
    const issues: RoomIssue[] = [];
    const rooms = await client.room.findMany({
      where: { id: { in: roomIds } },
      include: { availabilityBlocks: { where: { date: window.date, startTime: { lt: window.end }, endTime: { gt: window.start } } } },
    });
    const label = (r: { building: string; roomNumber: string }) => `${r.building} · Room ${r.roomNumber}`;
    const unusable = new Set<string>();
    for (const room of rooms) {
      if (room.status !== RoomStatus.ACTIVE) {
        issues.push({ roomId: room.id, message: `Room "${label(room)}" is not active (status "${room.status}").` });
        unusable.add(room.id);
      } else if (room.availabilityBlocks.length > 0) {
        issues.push({ roomId: room.id, message: `Room "${label(room)}" is blocked for part of this time.` });
        unusable.add(room.id);
      }
    }
    const allocated = await client.examSessionRoom.findMany({
      where: {
        roomId: { in: roomIds.filter((id) => !unusable.has(id)) },
        sessionDate: window.date,
        startTime: { lt: window.end },
        endTime: { gt: window.start },
        ...(excludeSessionId ? { examSessionId: { not: excludeSessionId } } : {}),
      },
      select: { roomId: true },
    });
    const byId = new Map(rooms.map((r) => [r.id, r]));
    for (const row of allocated) {
      const room = byId.get(row.roomId);
      issues.push({ roomId: row.roomId, message: `Room "${room ? label(room) : row.roomId}" is already allocated to another exam session at this time.` });
    }
    return issues;
  }

  /**
   * Holds the seats for a quiz being approved. Inside the approval transaction, under a row lock on the rooms, so two
   * approvals racing for the same seats cannot both succeed. Throws 409 (rolling the approval back) when a room is
   * unusable or the seats are not free — the admin then swaps a room and approves again.
   */
  async placeForApprovedQuiz(tx: Prisma.TransactionClient, quiz: QuizForHold): Promise<RoomHold[]> {
    const window = quizWindow(quiz);
    if (quiz.requestedRoomIds.length === 0 || !quiz.studentCount || !window) return [];

    await this.releaseForQuizzes(tx, [quiz.id], 'REPLACED', { notify: false }); // approving again replaces earlier holds

    const mainIds = quiz.requestedRoomIds;
    const backupId = quiz.backupRoomLocked && quiz.backupRoomId && !mainIds.includes(quiz.backupRoomId) ? quiz.backupRoomId : null;
    const allIds = backupId ? [...mainIds, backupId] : mainIds;

    await tx.$queryRaw(Prisma.sql`SELECT id FROM rooms WHERE id = ANY(${allIds}::uuid[]) FOR UPDATE`);

    const issues = await this.roomIssues(tx, allIds, window);
    if (issues.length > 0) {
      throw new ConflictException({
        message: 'Some of the requested rooms cannot be held for this quiz — swap them before approving.',
        details: issues.map((i) => ({ type: 'ROOM_UNAVAILABLE', roomId: i.roomId, message: i.message })),
      });
    }

    const usable = await this.usableSeatCounts(tx, allIds, quiz.emptyColumnsPlanned === true);
    const heldByOthers = await this.heldSeatsByRoom(tx, allIds, window, [quiz.id]);
    const free = new Map(allIds.map((id) => [id, Math.max(0, (usable.get(id) ?? 0) - (heldByOthers.get(id) ?? 0))]));

    const totalFree = mainIds.reduce((sum, id) => sum + (free.get(id) ?? 0), 0);
    if (totalFree < quiz.studentCount) {
      throw new ConflictException({
        message: `Only ${totalFree} free seats in the requested rooms for ${quiz.studentCount} students — other quizzes already hold the rest. Swap or add a room before approving.`,
        details: mainIds.map((id) => ({ type: 'ROOM_UNAVAILABLE', roomId: id, message: `${free.get(id) ?? 0} free of ${usable.get(id) ?? 0} usable seats.` })),
      });
    }

    const shares = apportion(quiz.studentCount, mainIds.map((id) => free.get(id) ?? 0));
    const created: RoomHold[] = [];
    for (const [i, roomId] of mainIds.entries()) {
      if (shares[i] > 0) created.push(await this.createHold(tx, roomId, quiz.id, RoomHoldKind.MAIN, shares[i], window));
    }
    if (backupId) {
      // The backup must be able to stand in for the biggest main room.
      const needed = Math.max(...shares);
      const backupFree = free.get(backupId) ?? 0;
      if (backupFree < needed) {
        throw new ConflictException({
          message: `The backup room has only ${backupFree} free seats but must be able to replace a main room (${needed} seats). Choose another backup room or don't lock it.`,
          details: [{ type: 'ROOM_UNAVAILABLE', roomId: backupId, message: `${backupFree} free seats.` }],
        });
      }
      created.push(await this.createHold(tx, backupId, quiz.id, RoomHoldKind.BACKUP, needed, window));
    }
    return created;
  }

  private createHold(tx: Prisma.TransactionClient, roomId: string, quizId: string, kind: RoomHoldKind, seatsHeld: number, window: HoldWindow) {
    return tx.roomHold.create({
      data: { roomId, quizId, kind, seatsHeld, holdDate: window.date, startTime: window.start, endTime: window.end },
    });
  }

  /** ACTIVE holds of a quiz (not yet allocated, released or lapsed). */
  activeHoldsForQuiz(client: Client, quizId: string): Promise<RoomHold[]> {
    return client.roomHold.findMany({ where: { AND: [this.stillRunning(), { quizId }] }, orderBy: { createdAt: 'asc' } });
  }

  /** Marks ACTIVE holds RELEASED and, when asked, tells each quiz's faculty member why. Returns the quiz ids that had holds. */
  async releaseForQuizzes(
    tx: Prisma.TransactionClient,
    quizIds: string[],
    reason: string,
    options: { notify: boolean },
  ): Promise<string[]> {
    if (quizIds.length === 0) return [];
    const active = await tx.roomHold.findMany({ where: { quizId: { in: quizIds }, status: RoomHoldStatus.ACTIVE } });
    if (active.length === 0) return [];
    await tx.roomHold.updateMany({
      where: { id: { in: active.map((h) => h.id) } },
      data: { status: RoomHoldStatus.RELEASED, releaseReason: reason, releasedAt: new Date() },
    });
    const releasedQuizIds = [...new Set(active.map((h) => h.quizId))];
    if (options.notify) {
      const quizzes = await tx.quiz.findMany({
        where: { id: { in: releasedQuizIds } },
        select: { id: true, title: true, createdByFacultyId: true },
      });
      const faculty = await tx.faculty.findMany({
        where: { id: { in: quizzes.map((q) => q.createdByFacultyId) } },
        select: { id: true, userId: true },
      });
      const userByFaculty = new Map(faculty.map((f) => [f.id, f.userId]));
      for (const quiz of quizzes) {
        const recipientId = userByFaculty.get(quiz.createdByFacultyId);
        const sample = active.find((h) => h.quizId === quiz.id)!;
        if (!recipientId) continue;
        await this.notificationsOutbox.queue(tx, {
          recipientType: NotificationRecipientType.FACULTY,
          recipientId,
          eventType: NotificationEventType.ROOM_HOLD_RELEASED,
          entityId: quiz.id,
          entityVersion: `${reason}:${sample.id}`,
          payload: {
            quiz_id: quiz.id,
            quiz_title: quiz.title,
            hold_date: sample.holdDate.toISOString().slice(0, 10),
            start_time: sample.startTime.toISOString().slice(11, 16),
            reason,
          },
        });
      }
    }
    return releasedQuizIds;
  }

  /**
   * Locks seats for a pending "more rooms" request: for each requested room that is usable in the window, all of its currently
   * free seats are held (under a row lock) against one of the session's quizzes, tagged with the request. Rooms that are not
   * usable are simply not locked — the admin sees them flagged. Returns the ids of the rooms that were locked.
   */
  async lockForRequest(
    tx: Prisma.TransactionClient,
    params: { requestId: string; quizId: string; sessionQuizIds: string[]; roomIds: string[]; window: HoldWindow; sessionId: string; emptyColumns: boolean },
  ): Promise<string[]> {
    if (params.roomIds.length === 0) return [];
    await tx.$queryRaw(Prisma.sql`SELECT id FROM rooms WHERE id = ANY(${params.roomIds}::uuid[]) FOR UPDATE`);
    const issues = await this.roomIssues(tx, params.roomIds, params.window, params.sessionId);
    const bad = new Set(issues.map((i) => i.roomId));
    const lockable = params.roomIds.filter((id) => !bad.has(id));
    const usable = await this.usableSeatCounts(tx, lockable, params.emptyColumns);
    const held = await this.heldSeatsByRoom(tx, lockable, params.window, params.sessionQuizIds);
    const locked: string[] = [];
    for (const roomId of lockable) {
      const free = (usable.get(roomId) ?? 0) - (held.get(roomId) ?? 0);
      if (free <= 0) continue;
      await tx.roomHold.create({
        data: {
          roomId,
          quizId: params.quizId,
          requestId: params.requestId,
          kind: RoomHoldKind.MAIN,
          seatsHeld: free,
          holdDate: params.window.date,
          startTime: params.window.start,
          endTime: params.window.end,
        },
      });
      locked.push(roomId);
    }
    return locked;
  }

  /** A request ended without the rooms being added (declined, cancelled, or the admin swapped them): its locks are freed. */
  async releaseForRequest(tx: Prisma.TransactionClient, requestId: string, reason: string, onlyRoomIds?: string[]): Promise<void> {
    await tx.roomHold.updateMany({
      where: { requestId, status: RoomHoldStatus.ACTIVE, ...(onlyRoomIds ? { roomId: { in: onlyRoomIds } } : {}) },
      data: { status: RoomHoldStatus.RELEASED, releaseReason: reason, releasedAt: new Date() },
    });
  }

  /** The request was approved: the rooms are real allocations now, so its locks are used up. */
  async consumeForRequest(tx: Prisma.TransactionClient, requestId: string): Promise<void> {
    await tx.roomHold.updateMany({
      where: { requestId, status: RoomHoldStatus.ACTIVE },
      data: { status: RoomHoldStatus.CONSUMED, releasedAt: new Date() },
    });
  }

  /** The rooms were allocated to a session: the real booking takes over, so the holds are used up. */
  async consumeForQuizzes(tx: Prisma.TransactionClient, quizIds: string[]): Promise<void> {
    if (quizIds.length === 0) return;
    await tx.roomHold.updateMany({
      where: { quizId: { in: quizIds }, status: RoomHoldStatus.ACTIVE },
      data: { status: RoomHoldStatus.CONSUMED, releasedAt: new Date() },
    });
  }
}

/** Splits `amount` into integer parts proportional to `weights` (largest remainder; ties to the earlier entry); a part never exceeds its weight while amount <= sum(weights). */
export function apportion(amount: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (amount * w) / sum);
  const parts = exact.map((x) => Math.floor(x));
  let left = amount - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, remainder: x - Math.floor(x) })).sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (parts[i] < weights[i]) {
      parts[i] += 1;
      left -= 1;
    }
  }
  return parts;
}
