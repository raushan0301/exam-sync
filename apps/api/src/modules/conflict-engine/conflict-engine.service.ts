import { Injectable, Logger } from '@nestjs/common';
import { ExamSessionStatus, Prisma, QuizStudentAssignmentStatus, RoomStatus } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QuizzesService } from '../quiz';
import { EnrollmentsService } from '../enrollment';
import {
  ConflictCheckResult,
  ConflictDetail,
  InvigilatorAssignmentCheckInput,
  RoomAllocationCheckInput,
  SessionAssemblyCheckInput,
} from './conflict-engine.types';

/** Either the top-level PrismaService or an interactive-transaction client — both expose the same model delegates. */
type PrismaOrTx = PrismaService | Prisma.TransactionClient;

/**
 * ============================================================================
 * PHASE 10 — THE REAL CONFLICT ENGINE (replaces the Phase 8 stub in place)
 * ============================================================================
 * ARCHITECTURE.md §Q's `ConflictEngine.check(context)`. Same class, same
 * module, same `checkSessionAssembly` signature the Phase 8 stub and every
 * caller (exam-sessions.service.ts) already used — only this file's
 * internals change, exactly as Phase 8's header comment promised.
 *
 * Implemented for real (BR-019, student overlap):
 *   For every quiz under consideration (already-attached + newly-adding),
 *   derive its ELIGIBLE roster from enrollment (subject + one of the
 *   quiz's batches + academic_year/semester — the same BR-005 derivation
 *   Phase 9's `EnrollmentsService.findEligibleStudentIds` uses), THEN
 *   check whether any of those students already holds an ACTIVE
 *   (`ASSIGNED`) `quiz_student_assignment` in a DIFFERENT, non-CANCELLED
 *   exam session whose time window overlaps the session under
 *   consideration. This runs proactively at session-assembly time
 *   (attach, reschedule) — BEFORE `assign-students` (Phase 9) has
 *   necessarily run for THIS session, using the quiz's derivable eligible
 *   roster as the candidate set, checked against students' assignments
 *   from OTHER, already-assembled sessions.
 *
 *   Overlap = same `session_date`, with `[start_time, end_time)` ranges
 *   intersecting (`existing.start < new.end AND existing.end > new.start`)
 *   — no documented buffer/gap time; back-to-back (touching, not
 *   overlapping) sessions are allowed (EC-001).
 *
 * Phase 12 adds `checkRoomAllocation` (BR-018 room double-booking, BR-022
 * room unavailable) — a separate method, not folded into
 * `checkSessionAssembly`, since its candidates are rooms, not quizzes; see
 * its own doc comment.
 *
 * Phase 16 adds `checkInvigilatorAssignment` (BR-020/BR-031, faculty
 * double-booking as an invigilator) now that `exam_invigilators` exists as
 * a data source — see that method's own doc comment. Seating-related
 * WARNING types remain a separate, already-built concern (Phase 13/14's
 * own `packages/domain-logic` validators, not this class).
 *
 * Callers needing the SERIALIZABLE check-then-write atomicity ADR-003
 * mandates for this specific race (docs/adr/003, "student assignment ...
 * SERIALIZABLE isolation for that specific check-then-insert sequence")
 * pass the transaction client explicitly via `client` — see
 * `exam-sessions.service.ts`'s `attachAndDetachQuizzes`/`reschedule`
 * (wrapped in `common/prisma/serializable-transaction.ts`'s
 * `runSerializable`). The read-only dry-run (`GET
 * /exam-sessions/{id}/conflicts`) omits `client`, defaulting to the plain
 * connection — it never commits anything, so `SERIALIZABLE` buys nothing
 * there (ADR-003: "must be scoped to the minimum necessary statement(s)").
 */
@Injectable()
export class ConflictEngineService {
  private readonly logger = new Logger(ConflictEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quizzesService: QuizzesService,
    private readonly enrollmentsService: EnrollmentsService,
  ) {}

  async checkSessionAssembly(
    input: SessionAssemblyCheckInput,
    client: PrismaOrTx = this.prisma,
  ): Promise<ConflictCheckResult> {
    const hard: ConflictDetail[] = [];

    const eligibleStudentIds = await this.collectEligibleStudentIds(input.quizIds);

    if (eligibleStudentIds.size > 0) {
      const overlaps = await client.quizStudentAssignment.findMany({
        where: {
          studentId: { in: [...eligibleStudentIds] },
          status: QuizStudentAssignmentStatus.ASSIGNED,
          examSessionId: { not: input.examSessionId },
          examSession: {
            status: { not: ExamSessionStatus.CANCELLED },
            sessionDate: input.sessionDate,
            startTime: { lt: input.endTime },
            endTime: { gt: input.startTime },
          },
        },
        select: { studentId: true, examSessionId: true },
        distinct: ['studentId'],
      });

      for (const overlap of overlaps) {
        hard.push({
          type: 'STUDENT_OVERLAP',
          studentId: overlap.studentId,
          conflictingExamSessionId: overlap.examSessionId,
          message: `Student "${overlap.studentId}" already has an active assignment in exam session "${overlap.examSessionId}", whose time window overlaps this session (BR-019).`,
        });
      }
    }

    this.logger.debug(
      `checkSessionAssembly for session ${input.examSessionId}: ${eligibleStudentIds.size} eligible student(s) considered, ${hard.length} hard conflict(s) found.`,
    );

    return { hard, warnings: [] };
  }

  /**
   * Phase 12 (BR-018 room double-booking, BR-022 room unavailable). Called
   * by `RoomAllocationService.allocate` AFTER it has row-locked the
   * candidate rooms (`SELECT ... FOR UPDATE`, ADR-003 mechanism B) — this
   * check's own `client` (the same locked transaction) then sees a
   * consistent snapshot, so a concurrent allocator blocked on that same
   * lock will, once unblocked, re-run this check against the now-committed
   * state and correctly detect the conflict the DB's EXCLUDE constraint
   * would otherwise only catch at commit time (this is the fast, clean-409
   * pre-check; the constraint remains the final backstop regardless).
   *
   * Capacity (BR-021) is deliberately NOT checked here — it depends on the
   * Best-Fit Decreasing packing outcome across ALL candidate rooms taken
   * together, not on any single room in isolation, so it stays a
   * `RoomAllocationService`-level check (EC-011), not a per-room Conflict
   * Engine type.
   */
  async checkRoomAllocation(
    input: RoomAllocationCheckInput,
    client: PrismaOrTx = this.prisma,
  ): Promise<ConflictCheckResult> {
    const hard: ConflictDetail[] = [];

    if (input.roomIds.length === 0) {
      return { hard, warnings: [] };
    }

    const rooms = await client.room.findMany({
      where: { id: { in: input.roomIds } },
      include: {
        availabilityBlocks: {
          where: {
            date: input.sessionDate,
            startTime: { lt: input.endTime },
            endTime: { gt: input.startTime },
          },
        },
      },
    });

    for (const room of rooms) {
      if (room.status !== RoomStatus.ACTIVE) {
        hard.push({
          type: 'ROOM_UNAVAILABLE',
          roomId: room.id,
          message: `Room "${room.id}" is not ACTIVE (status "${room.status}") and cannot be allocated (BR-022).`,
        });
        continue;
      }
      if (room.availabilityBlocks.length > 0) {
        hard.push({
          type: 'ROOM_UNAVAILABLE',
          roomId: room.id,
          message: `Room "${room.id}" has a blocked availability window overlapping this session (BR-022).`,
        });
        continue;
      }
    }

    if (input.roomIds.length > 0) {
      const overlaps = await client.examSessionRoom.findMany({
        where: {
          roomId: { in: input.roomIds },
          examSessionId: { not: input.examSessionId },
          sessionDate: input.sessionDate,
          startTime: { lt: input.endTime },
          endTime: { gt: input.startTime },
        },
        select: { roomId: true, examSessionId: true },
      });

      for (const overlap of overlaps) {
        hard.push({
          type: 'ROOM_OVERLAP',
          roomId: overlap.roomId,
          conflictingExamSessionId: overlap.examSessionId,
          message: `Room "${overlap.roomId}" is already allocated to exam session "${overlap.examSessionId}", whose time window overlaps this session (BR-018).`,
        });
      }
    }

    this.logger.debug(
      `checkRoomAllocation for session ${input.examSessionId}: ${input.roomIds.length} candidate room(s) considered, ${hard.length} hard conflict(s) found.`,
    );

    return { hard, warnings: [] };
  }

  /**
   * Phase 16 (BR-020/BR-031: "the same faculty cannot be listed as
   * invigilator for two rooms whose sessions overlap in time"). Called by
   * `InvigilationService.assign` AFTER it has row-locked the target
   * faculty (`SELECT ... FOR UPDATE` on the `faculty` row itself — see
   * that service's own doc comment for why the faculty row, not the
   * `exam_invigilators` rows, is what gets locked), same tiered pattern
   * as `checkRoomAllocation`.
   *
   * Deliberately checks ACROSS sessions, INCLUDING the same
   * `examSessionId` under consideration — a faculty assigned to invigilate
   * one room of a session cannot ALSO invigilate a second room of that
   * SAME session (its rooms all share one time window, so that's exactly
   * the double-booking BR-031 forbids too), not just a different session.
   * The one exclusion is the literal exact duplicate
   * (`examSessionId`+`roomId` both matching the candidate) — reassigning
   * the identical (session, room, faculty) triple is a 409 the caller
   * handles as its own distinct "already assigned" case, not a
   * FACULTY_OVERLAP conflict.
   */
  async checkInvigilatorAssignment(
    input: InvigilatorAssignmentCheckInput,
    client: PrismaOrTx = this.prisma,
  ): Promise<ConflictCheckResult> {
    const hard: ConflictDetail[] = [];

    const overlaps = await client.examInvigilator.findMany({
      where: {
        facultyId: input.facultyId,
        NOT: { examSessionId: input.examSessionId, roomId: input.roomId },
        examSession: {
          status: { not: ExamSessionStatus.CANCELLED },
          sessionDate: input.sessionDate,
          startTime: { lt: input.endTime },
          endTime: { gt: input.startTime },
        },
      },
      select: { examSessionId: true, roomId: true },
    });

    for (const overlap of overlaps) {
      hard.push({
        type: 'FACULTY_OVERLAP',
        facultyId: input.facultyId,
        roomId: overlap.roomId,
        conflictingExamSessionId: overlap.examSessionId,
        message: `Faculty "${input.facultyId}" is already invigilating room "${overlap.roomId}" in exam session "${overlap.examSessionId}", whose time window overlaps this assignment (BR-031).`,
      });
    }

    this.logger.debug(
      `checkInvigilatorAssignment for faculty ${input.facultyId}: ${overlaps.length} hard conflict(s) found.`,
    );

    return { hard, warnings: [] };
  }

  /** Union of each quiz's eligible roster (BR-005), derived from enrollment — not from any existing assignment rows. */
  private async collectEligibleStudentIds(quizIds: string[]): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const quizId of quizIds) {
      const quiz = await this.quizzesService.findById(quizId);
      const batchIds = await this.quizzesService.getBatchIds(quizId);
      const eligible = await this.enrollmentsService.findEligibleStudentIds(
        quiz.subjectId,
        batchIds,
        quiz.academicYear,
        quiz.semester,
      );
      eligible.forEach((studentId) => ids.add(studentId));
    }
    return ids;
  }
}
