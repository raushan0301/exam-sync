import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ExamSessionStatus, QuizStatus, QuizStudentAssignmentStatus } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { ExamSessionsService, ExamSessionOwnershipService } from '../exam-session';
import { ConflictEngineService } from '../conflict-engine';
import { RoomsService } from '../rooms';
import { RoomHoldsService } from '../../common/room-holds/room-holds.service';
import { fewestRoomsPlan, PoolRoom, RoomPlan, spreadEvenly, togetherPlan } from './room-suggestion-planner';
import { QuizzesService, QuizOwnershipService } from '../quiz';

/** Never a real exam_session id — passed as the `examSessionId` a conflict check excludes, so a quiz-stage check (no real session yet) excludes nothing and compares against every booking. */
const NIL_EXAM_SESSION_ID = '00000000-0000-0000-0000-000000000000';

/** SEQUENTIAL was retired (the building/floor rule now applies to every strategy); old saved requests may still carry it. */
export type RoomSuggestionStrategy = 'FEWEST_ROOMS' | 'BALANCED_SPREAD';

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
  /** "Building B · floors 0–1" — where these rooms are. */
  location: string;
  spansBuildings: boolean;
  /**
   * Present ONLY when fewer rooms are possible by giving up "stay in one building, floor by floor":
   * the person is asked which they prefer. Absent means staying together costs nothing extra.
   */
  alternative?: RoomSuggestionAlternative;
}

export interface RoomSuggestionAlternative {
  label: string;
  description: string;
  roomCount: number;
  totalCapacity: number;
  utilizationPercent: number;
  rooms: SuggestedRoom[];
  location: string;
  spansBuildings: boolean;
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
  /** True when room sizes count only the usable seats (every second column left empty). */
  emptyColumns: boolean;
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
    private readonly roomHolds: RoomHoldsService,
  ) {}

  async suggest(examSessionId: string, actor: AuthenticatedUser, emptyColumns = false): Promise<RoomSuggestionResponse> {
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

    const attachedQuizIds = (
      await this.prisma.examSessionQuiz.findMany({ where: { examSessionId, isActiveAttachment: true }, select: { quizId: true } })
    ).map((a) => a.quizId);
    return this.buildResponse(totalStudents, session.sessionDate, session.startTime, session.endTime, examSessionId, emptyColumns, attachedQuizIds);
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
  async suggestForQuiz(quizId: string, actor: AuthenticatedUser, emptyColumns = false): Promise<RoomSuggestionResponse> {
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

    return this.buildResponse(quiz.studentCount, quiz.preferredDate, quiz.preferredTime, addMinutes(quiz.preferredTime, quiz.durationMinutes ?? 120), NIL_EXAM_SESSION_ID, emptyColumns, [quiz.id]);
  }

  /**
   * Rooms free for a window, each with the seats still free in it: active, not blocked, not booked by another session,
   * counting only usable seats (kept columns when empty columns are planned) minus seats other quizzes hold. Shared by the
   * suggestions and by the "more rooms" request, so both see the same availability.
   */
  async availablePool(
    sessionDate: Date,
    startTime: Date,
    endTime: Date,
    excludeExamSessionId: string,
    emptyColumns: boolean,
    ownQuizIds: string[],
  ): Promise<PoolRoom[]> {
    const candidates = await this.roomsService.findAvailable({
      date: sessionDate.toISOString().slice(0, 10),
      start_time: startTime.toISOString().slice(11, 16),
      end_time: endTime.toISOString().slice(11, 16),
    });

    // findAvailable only checks room.status + room_availability blocks (it does NOT check exam_session_rooms bookings).
    // Re-check every candidate against real bookings via the same Conflict Engine `allocate` itself uses, so a room already
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

    const seatCounts = await this.roomHolds.usableSeatCounts(this.prisma, available.map((r) => r.id), emptyColumns);
    // Seats other quizzes already hold (for an overlapping time) are not free to suggest.
    const heldByOthers = await this.roomHolds.heldSeatsByRoom(
      this.prisma,
      available.map((r) => r.id),
      { date: sessionDate, start: startTime, end: endTime },
      ownQuizIds,
    );
    return available
      .map((r) => ({
        roomId: r.id,
        building: r.building,
        floor: r.floor,
        roomNumber: r.roomNumber,
        capacity: Math.max(0, (seatCounts.get(r.id) ?? 0) - (heldByOthers.get(r.id) ?? 0)),
      }))
      .filter((r) => r.capacity > 0);
  }

  private async buildResponse(
    totalStudents: number,
    sessionDate: Date,
    startTime: Date,
    endTime: Date,
    excludeExamSessionId: string,
    emptyColumns: boolean,
    /** Quizzes whose held seats still count as free here: the quiz being planned, or the quizzes attached to this session. */
    ownQuizIds: string[],
  ): Promise<RoomSuggestionResponse> {
    const pool = await this.availablePool(sessionDate, startTime, endTime, excludeExamSessionId, emptyColumns, ownQuizIds);

    const totalAvailableCapacity = pool.reduce((sum, r) => sum + r.capacity, 0);
    const shortfall = totalAvailableCapacity < totalStudents;

    const allRooms: AvailableRoomOption[] = [...pool]
      .sort((a, b) => a.building.localeCompare(b.building) || a.floor - b.floor || a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))
      .map((r) => ({ roomId: r.roomId, building: r.building, floor: r.floor, roomNumber: r.roomNumber, capacity: r.capacity }));

    return {
      totalStudents,
      emptyColumns,
      shortfall,
      availableRoomCount: pool.length,
      strategies: [this.fewestRooms(pool, totalStudents), this.balancedSpread(pool, totalStudents)],
      allRooms,
    };
  }

  /** Common summary numbers for a plan, shared by the main result and its alternative. */
  private figures(plan: RoomPlan) {
    const totalCapacity = plan.rooms.reduce((sum, r) => sum + r.capacity, 0);
    const totalAllocated = plan.rooms.reduce((sum, r) => sum + r.allocated, 0);
    return {
      roomCount: plan.rooms.length,
      totalCapacity,
      utilizationPercent: totalCapacity === 0 ? 0 : Math.round((totalAllocated / totalCapacity) * 100),
      rooms: plan.rooms.map((r) => ({
        roomId: r.roomId,
        building: r.building,
        floor: r.floor,
        roomNumber: r.roomNumber,
        capacity: r.capacity,
        allocated: r.allocated,
      })),
      location: plan.location,
      spansBuildings: plan.spansBuildings,
    };
  }

  /** The alternative is offered only when it needs FEWER rooms than staying together. */
  private alternativeFor(
    together: RoomPlan,
    fewest: RoomPlan,
    label: string,
    description: string,
  ): RoomSuggestionAlternative | undefined {
    if (fewest.rooms.length === 0 || fewest.rooms.length >= together.rooms.length) return undefined;
    return { label, description, ...this.figures(fewest) };
  }

  /** Fewest classes while staying together: one building if it fits, floors filled from the ground up. */
  private fewestRooms(pool: PoolRoom[], totalStudents: number): RoomSuggestionResult {
    const together = togetherPlan(pool, totalStudents);
    return {
      strategy: 'FEWEST_ROOMS',
      label: 'Fewest Classes',
      description:
        'Stays in one building if it fits and fills each floor, ground first, before using the next — filling each room before moving on. Packs students in tightly.',
      ...this.figures(together),
      alternative: this.alternativeFor(
        together,
        fewestRoomsPlan(pool, totalStudents),
        'Fewest rooms overall',
        'Uses the largest rooms wherever they are — fewer rooms, but they may be in different buildings or floors.',
      ),
    };
  }

  /** Same rooms as "Fewest Classes" but students spread evenly rather than filling each to the brim — more empty seats in every room. */
  private balancedSpread(pool: PoolRoom[], totalStudents: number): RoomSuggestionResult {
    const together = spreadEvenly(togetherPlan(pool, totalStudents), totalStudents);
    const fewest = spreadEvenly(fewestRoomsPlan(pool, totalStudents), totalStudents);
    return {
      strategy: 'BALANCED_SPREAD',
      label: 'Balanced Spread',
      description:
        'Uses the same rooms as "Fewest Classes" (one building, floor by floor) but spreads students evenly across them instead of filling each to the brim — more empty seats between students, so less chance to copy from a neighbour.',
      ...this.figures(together),
      alternative: this.alternativeFor(
        together,
        fewest,
        'Fewest rooms overall',
        'Spreads students evenly over the fewest possible rooms, wherever they are — fewer rooms, but they may be in different buildings or floors.',
      ),
    };
  }
}

/** Adds minutes to a time-of-day Date (1970-01-01 base, same convention `toTime` uses elsewhere) — used to derive an end time from a quiz's preferred_time + duration_minutes when no exam session (with its own explicit end_time) exists yet. */
function addMinutes(time: Date, minutes: number): Date {
  return new Date(time.getTime() + minutes * 60_000);
}
