import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ExamSessionStatus, QuizStatus, QuizStudentAssignmentStatus } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { ExamSessionsService, ExamSessionOwnershipService } from '../exam-session';
import { ConflictEngineService } from '../conflict-engine';
import { RoomsService } from '../rooms';
import { QuizzesService, QuizOwnershipService } from '../quiz';

/** Never a real exam_session id — passed as the `examSessionId` a conflict check excludes, so a quiz-stage check (no real session yet) excludes nothing and compares against every booking. */
const NIL_EXAM_SESSION_ID = '00000000-0000-0000-0000-000000000000';

export type RoomSuggestionStrategy = 'FEWEST_ROOMS' | 'SEQUENTIAL' | 'BALANCED_SPREAD';

export interface SuggestedRoom {
  roomId: string;
  building: string;
  floor: number;
  roomNumber: string;
  capacity: number;
  allocated: number;
}

export interface RoomSuggestionResult {
  strategy: RoomSuggestionStrategy;
  label: string;
  description: string;
  roomCount: number;
  totalCapacity: number;
  utilizationPercent: number;
  rooms: SuggestedRoom[];
}

export interface AvailableRoomOption {
  roomId: string;
  building: string;
  floor: number;
  roomNumber: string;
  capacity: number;
}

export interface RoomSuggestionResponse {
  totalStudents: number;
  /** True when even every available room together can't seat totalStudents — no strategy below can fully satisfy the request. */
  shortfall: boolean;
  availableRoomCount: number;
  strategies: RoomSuggestionResult[];
  /** EVERY available room for this date/time (not just the ones a strategy happened to pick) — building/room-number order, for a manual "pick any room" dropdown. */
  allRooms: AvailableRoomOption[];
}

/**
 * Room-level PREVIEW used before a faculty submits a room request
 * (`RoomAllocationService.request`) — distinct from that service's own
 * seat-level Best-Fit Decreasing PACKER, which still owns the real,
 * final, per-quiz-group allocation once admin approves. This service
 * only answers "how many rooms, and which ones" at a coarse room level,
 * computed from REAL active-seat capacity and REAL live availability
 * (ACTIVE status + no `room_availability` block + no overlapping
 * `exam_session_rooms` booking, via `ConflictEngineService.checkRoomAllocation`
 * — the same check `allocate` itself uses), so the three strategies below
 * are never suggesting a room that is actually unavailable.
 */
@Injectable()
export class RoomSuggestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly examSessionsService: ExamSessionsService,
    private readonly examSessionOwnershipService: ExamSessionOwnershipService,
    private readonly conflictEngine: ConflictEngineService,
    private readonly roomsService: RoomsService,
    private readonly quizzesService: QuizzesService,
    private readonly quizOwnershipService: QuizOwnershipService,
  ) {}

  async suggest(examSessionId: string, actor: AuthenticatedUser): Promise<RoomSuggestionResponse> {
    const session = await this.examSessionsService.findById(examSessionId);
    if (!(await this.examSessionOwnershipService.isOwnerOrCoInstructor(examSessionId, actor))) {
      throw new NotFoundException();
    }
    if (
      session.status !== ExamSessionStatus.ASSIGNING_STUDENTS &&
      session.status !== ExamSessionStatus.ROOM_ALLOCATION
    ) {
      throw new ConflictException(
        `Room suggestions are only meaningful while a session has ASSIGNED students and no finalized allocation (current status "${session.status}").`,
      );
    }

    const totalStudents = await this.prisma.quizStudentAssignment.count({
      where: { examSessionId, status: QuizStudentAssignmentStatus.ASSIGNED },
    });
    if (totalStudents === 0) {
      throw new ConflictException('This session has no ASSIGNED students to size room suggestions for.');
    }

    return this.buildResponse(totalStudents, session.sessionDate, session.startTime, session.endTime, examSessionId);
  }

  /**
   * Quiz-stage suggestion (this feature's own extension): faculty sees
   * this right after entering `student_count` + `preferred_date`/
   * `preferred_time` on the quiz, before any exam session exists. Sized
   * against the quiz's declared headcount (an estimate, not real
   * enrollment) and the quiz's preferred slot — the same three
   * strategies, so the visual/explanation stays consistent with the
   * exam-session-stage suggestion faculty will see again later once real
   * students are ASSIGNED.
   */
  async suggestForQuiz(quizId: string, actor: AuthenticatedUser): Promise<RoomSuggestionResponse> {
    const quiz = await this.quizzesService.findById(quizId);
    if (!(await this.quizOwnershipService.isOwnerOrCoInstructor(quiz, actor))) {
      throw new NotFoundException();
    }
    if (quiz.status !== QuizStatus.DRAFT && quiz.status !== QuizStatus.REJECTED) {
      throw new ConflictException(
        `Room suggestions are only meaningful before a quiz is submitted for approval (current status "${quiz.status}").`,
      );
    }
    if (!quiz.studentCount) {
      throw new ConflictException('Set student_count on the quiz before requesting room suggestions.');
    }
    if (!quiz.preferredDate || !quiz.preferredTime) {
      throw new ConflictException('Set preferred_date and preferred_time on the quiz before requesting room suggestions.');
    }

    return this.buildResponse(quiz.studentCount, quiz.preferredDate, quiz.preferredTime, addMinutes(quiz.preferredTime, quiz.durationMinutes ?? 120), NIL_EXAM_SESSION_ID);
  }

  private async buildResponse(
    totalStudents: number,
    sessionDate: Date,
    startTime: Date,
    endTime: Date,
    excludeExamSessionId: string,
  ): Promise<RoomSuggestionResponse> {
    const candidates = await this.roomsService.findAvailable({
      date: sessionDate.toISOString().slice(0, 10),
      start_time: startTime.toISOString().slice(11, 16),
      end_time: endTime.toISOString().slice(11, 16),
    });

    // findAvailable only checks room.status + room_availability blocks —
    // it does NOT check exam_session_rooms bookings (see its own doc
    // comment). Re-check every candidate against real bookings via the
    // same Conflict Engine `allocate` itself uses, so a room already
    // allocated to another overlapping session is never "suggested".
    const conflictResult = await this.conflictEngine.checkRoomAllocation({
      examSessionId: excludeExamSessionId,
      roomIds: candidates.map((r) => r.id),
      sessionDate,
      startTime,
      endTime,
    });
    const conflictingRoomIds = new Set(conflictResult.hard.map((d) => d.roomId).filter(Boolean));
    const available = candidates.filter((r) => !conflictingRoomIds.has(r.id));

    const seatCounts = await this.getActiveSeatCounts(available.map((r) => r.id));
    const pool = available.map((r) => ({
      roomId: r.id,
      building: r.building,
      floor: r.floor,
      roomNumber: r.roomNumber,
      capacity: seatCounts.get(r.id) ?? 0,
    }));

    const totalAvailableCapacity = pool.reduce((sum, r) => sum + r.capacity, 0);
    const shortfall = totalAvailableCapacity < totalStudents;

    const allRooms: AvailableRoomOption[] = [...pool]
      .sort((a, b) => a.building.localeCompare(b.building) || a.floor - b.floor || a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))
      .map((r) => ({ roomId: r.roomId, building: r.building, floor: r.floor, roomNumber: r.roomNumber, capacity: r.capacity }));

    return {
      totalStudents,
      shortfall,
      availableRoomCount: pool.length,
      strategies: [
        this.fewestRooms(pool, totalStudents),
        this.sequential(pool, totalStudents),
        this.balancedSpread(pool, totalStudents),
      ],
      allRooms,
    };
  }

  private async getActiveSeatCounts(roomIds: string[]): Promise<Map<string, number>> {
    if (roomIds.length === 0) return new Map();
    const grouped = await this.prisma.roomSeat.groupBy({
      by: ['roomId'],
      where: { roomId: { in: roomIds }, isActive: true },
      _count: { id: true },
    });
    const counts = new Map<string, number>(roomIds.map((id) => [id, 0]));
    for (const g of grouped) counts.set(g.roomId, g._count.id);
    return counts;
  }

  private summarize(
    strategy: RoomSuggestionStrategy,
    label: string,
    description: string,
    rooms: SuggestedRoom[],
  ): RoomSuggestionResult {
    const totalCapacity = rooms.reduce((sum, r) => sum + r.capacity, 0);
    const totalAllocated = rooms.reduce((sum, r) => sum + r.allocated, 0);
    return {
      strategy,
      label,
      description,
      roomCount: rooms.length,
      totalCapacity,
      utilizationPercent: totalCapacity === 0 ? 0 : Math.round((totalAllocated / totalCapacity) * 100),
      rooms,
    };
  }

  /** Fewest classes possible: largest-capacity rooms first, fill each to capacity, stop as soon as enough seats exist. */
  private fewestRooms(
    pool: { roomId: string; building: string; floor: number; roomNumber: string; capacity: number }[],
    totalStudents: number,
  ): RoomSuggestionResult {
    const sorted = [...pool].sort((a, b) => b.capacity - a.capacity);
    const rooms = this.greedyFill(sorted, totalStudents, 'MAX_FILL');
    return this.summarize(
      'FEWEST_ROOMS',
      'Fewest Classes',
      'Uses the largest available rooms first, filling each one before moving to the next. Minimizes how many classrooms you need, but packs students in tightly.',
      rooms,
    );
  }

  /** Adjacent/contiguous rooms: building then room-number order, fill each to capacity — easier for students/invigilators to find. */
  private sequential(
    pool: { roomId: string; building: string; floor: number; roomNumber: string; capacity: number }[],
    totalStudents: number,
  ): RoomSuggestionResult {
    const sorted = [...pool].sort(
      (a, b) => a.building.localeCompare(b.building) || a.floor - b.floor || a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }),
    );
    const rooms = this.greedyFill(sorted, totalStudents, 'MAX_FILL');
    return this.summarize(
      'SEQUENTIAL',
      'Sequential (Adjacent Rooms)',
      'Picks rooms in building/floor/room-number order, so the chosen classes are next to each other — easier for students to find and for invigilators to cover. May use more rooms than the fewest-classes option.',
      rooms,
    );
  }

  /** Anti-cheating friendly: fewest rooms that fit, but spread students evenly rather than filling each to the brim. */
  private balancedSpread(
    pool: { roomId: string; building: string; floor: number; roomNumber: string; capacity: number }[],
    totalStudents: number,
  ): RoomSuggestionResult {
    const sorted = [...pool].sort((a, b) => b.capacity - a.capacity);
    const minimalSet = this.greedyFill(sorted, totalStudents, 'MAX_FILL');
    if (minimalSet.length === 0) {
      return this.summarize(
        'BALANCED_SPREAD',
        'Balanced Spread',
        'Uses the same minimal set of rooms as "Fewest Classes" but spreads students evenly across them instead of filling each to the brim — leaves more empty seats between students in every room, reducing the opportunity to copy from a neighbor.',
        [],
      );
    }
    // Redistribute the same total evenly across the same room set,
    // capped at each room's own capacity (a room can never hold more
    // than it physically has).
    let remaining = totalStudents;
    const withShare = minimalSet.map((r) => ({ ...r, share: 0 }));
    // Simple even split with remainder handed out one at a time, largest-capacity room first.
    const base = Math.floor(totalStudents / withShare.length);
    for (const r of withShare) {
      r.share = Math.min(base, r.capacity);
      remaining -= r.share;
    }
    for (const r of withShare) {
      if (remaining <= 0) break;
      const room = r.capacity > r.share ? r : null;
      if (room) {
        const add = Math.min(remaining, room.capacity - room.share);
        room.share += add;
        remaining -= add;
      }
    }
    const rooms = withShare.map((r) => ({
      roomId: r.roomId,
      building: r.building,
      floor: r.floor,
      roomNumber: r.roomNumber,
      capacity: r.capacity,
      allocated: r.share,
    }));
    return this.summarize(
      'BALANCED_SPREAD',
      'Balanced Spread',
      'Uses the same minimal set of rooms as "Fewest Classes" but spreads students evenly across them instead of filling each to the brim — leaves more empty seats between students in every room, reducing the opportunity to copy from a neighbor.',
      rooms,
    );
  }

  private greedyFill(
    sorted: { roomId: string; building: string; floor: number; roomNumber: string; capacity: number }[],
    totalStudents: number,
    _mode: 'MAX_FILL',
  ): SuggestedRoom[] {
    const rooms: SuggestedRoom[] = [];
    let remaining = totalStudents;
    for (const r of sorted) {
      if (remaining <= 0) break;
      if (r.capacity <= 0) continue;
      const allocated = Math.min(remaining, r.capacity);
      rooms.push({ roomId: r.roomId, building: r.building, floor: r.floor, roomNumber: r.roomNumber, capacity: r.capacity, allocated });
      remaining -= allocated;
    }
    return rooms;
  }
}

/** Adds minutes to a time-of-day Date (1970-01-01 base, same convention `toTime` uses elsewhere) — used to derive an end time from a quiz's preferred_time + duration_minutes when no exam session (with its own explicit end_time) exists yet. */
function addMinutes(time: Date, minutes: number): Date {
  return new Date(time.getTime() + minutes * 60_000);
}
