import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ExamSession, ExamSessionStatus, SeatingPlanStatus } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { ExamSessionsService, ExamSessionOwnershipService } from '../exam-session';

/**
 * DISCLOSED SCOPE NOTE (Phase 17): this class exists ONLY because BR-032
 * ("attendance can only be recorded ... in a session that is
 * `IN_PROGRESS`") is otherwise permanently unreachable through the
 * application. ARCHITECTURE.md §AD-2's Exam Session state machine
 * documents `READY_FOR_FINALIZATION -> FINALIZED -> NOTIFIED ->
 * IN_PROGRESS -> COMPLETED`, but no prior phase built ANY of these
 * transitions: Phase 13 only ever built the per-room
 * `POST /seating-plans/{id}/finalize` (never a session-level rollup);
 * Phase 15's own report explicitly flagged `NOTIFIED` as consequently
 * unreachable; nothing built `IN_PROGRESS`/`COMPLETED` at all. None of
 * `finalize`/`start`/`complete` below is a documented API_CONTRACT.md
 * endpoint — they are undocumented, narrowly-scoped administrative
 * plumbing added here as the minimum necessary to make Phase 17's own
 * documented deliverable (attendance marking, gated by exactly this
 * state) actually exercisable, not a reinvention of Phases 8/13/15's own
 * business logic. `FINALIZED` and `NOTIFIED` are intentionally collapsed
 * into a single `start()` call rather than three separate endpoints:
 * neither value is read or branched on anywhere else in this codebase
 * (confirmed by inspection before writing this), their respective
 * documented "side effects" already happened per-room in Phases 13/15
 * before this call's own precondition can even be satisfied, and
 * inventing three near-empty endpoints for states nothing else observes
 * would be complexity with no behavioral payoff.
 *
 * FACULTY-LIFECYCLE-OWNERSHIP FIX: `start`/`complete` were originally
 * ADMIN-only (written before that later change moved every other
 * exam-session lifecycle action to FACULTY). Left as ADMIN-only, they
 * became a dead end: ADMIN lost write access to session lifecycle
 * actions everywhere else, but FACULTY was never granted these two — so
 * a session could reach READY_FOR_FINALIZATION and then get stuck there
 * forever, for everyone. Fixed to FACULTY-only + ownership-scoped here,
 * matching every other action in this feature.
 */
@Injectable()
export class ExamSessionLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly examSessionsService: ExamSessionsService,
    private readonly examSessionOwnershipService: ExamSessionOwnershipService,
  ) {}

  /**
   * `POST /exam-sessions/{id}/start` (FACULTY, ownership-gated —
   * see class header). Precondition: session is `READY_FOR_FINALIZATION` AND
   * every room allocated to it already has a `FINALIZED` seating plan
   * (the real "all seating plans -> FINALIZED" completeness check the
   * documented `READY_FOR_FINALIZATION -> FINALIZED` transition
   * describes, verified here rather than re-implemented, since Phase 13's
   * own per-plan `finalize()` already did the actual finalizing).
   */
  async start(examSessionId: string, actor: AuthenticatedUser): Promise<ExamSession> {
    const session = await this.examSessionsService.findById(examSessionId);
    if (!(await this.examSessionOwnershipService.isOwnerOrCoInstructor(examSessionId, actor))) {
      throw new NotFoundException(); // IDOR-safe — mirrors quizzes.service.ts's own PATCH convention.
    }
    if (session.status !== ExamSessionStatus.READY_FOR_FINALIZATION) {
      throw new ConflictException(
        `Exam session is in status "${session.status}" and can only be started from READY_FOR_FINALIZATION.`,
      );
    }

    const allocatedRooms = await this.prisma.examSessionRoom.findMany({
      where: { examSessionId },
      select: { roomId: true },
    });
    const plans = await this.prisma.seatingPlan.findMany({
      where: { examSessionId },
      select: { roomId: true, status: true },
    });
    const finalizedRoomIds = new Set(
      plans.filter((p) => p.status === SeatingPlanStatus.FINALIZED).map((p) => p.roomId),
    );
    const notReady = allocatedRooms.filter((r) => !finalizedRoomIds.has(r.roomId));
    if (allocatedRooms.length === 0 || notReady.length > 0) {
      throw new ConflictException({
        message: 'Every allocated room must have a FINALIZED seating plan before the session can start.',
        details: notReady.map((r) => ({ type: 'SEATING_NOT_FINALIZED', roomId: r.roomId })),
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.examSession.update({
        where: { id: examSessionId },
        data: { status: ExamSessionStatus.IN_PROGRESS, version: { increment: 1 } },
      });

      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'ExamSession',
          entityId: examSessionId,
          oldValue: { status: session.status },
          newValue: { status: result.status },
        },
        tx,
      );

      return result;
    });

    return updated;
  }

  /**
   * `POST /exam-sessions/{id}/complete` (FACULTY, ownership-gated —
   * see class header). Side effect (BR-034, ARCHITECTURE.md §Y step 3):
   * every `attendance` row belonging to this session is locked in the
   * SAME transaction as the status flip — the documented "batch job"
   * runs synchronously here rather than as a separate async job, the same
   * trade-off already made for Room Allocation/Seating's own synchronous,
   * bounded-size operations.
   */
  async complete(examSessionId: string, actor: AuthenticatedUser): Promise<ExamSession> {
    const session = await this.examSessionsService.findById(examSessionId);
    if (!(await this.examSessionOwnershipService.isOwnerOrCoInstructor(examSessionId, actor))) {
      throw new NotFoundException(); // IDOR-safe — mirrors quizzes.service.ts's own PATCH convention.
    }
    if (session.status !== ExamSessionStatus.IN_PROGRESS) {
      throw new ConflictException(
        `Exam session is in status "${session.status}" and can only be completed from IN_PROGRESS.`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.examSession.update({
        where: { id: examSessionId },
        data: { status: ExamSessionStatus.COMPLETED, version: { increment: 1 } },
      });
      await tx.attendance.updateMany({
        where: { quizStudentAssignment: { examSessionId } },
        data: { locked: true },
      });

      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'ExamSession',
          entityId: examSessionId,
          oldValue: { status: session.status },
          newValue: { status: result.status },
        },
        tx,
      );

      return result;
    });

    return updated;
  }
}
