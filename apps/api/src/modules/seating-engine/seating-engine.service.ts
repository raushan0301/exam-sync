import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ExamSessionStatus,
  NotificationEventType,
  NotificationRecipientType,
  Prisma,
  QuizStudentAssignmentStatus,
  SeatingAssignment,
  SeatingPlan,
  SeatingPlanStatus,
} from '@exam-sync/db';
import {
  generateSeating,
  keepAlternateColumns,
  SeatAssignment,
  SeatInput,
  StudentToSeatInput,
  validateSeating,
  ValidateSeatingResult,
} from '@exam-sync/domain-logic';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { NotificationsOutboxService } from '../../common/notifications-outbox/notifications-outbox.service';
import { ExamSessionsService, ExamSessionOwnershipService } from '../exam-session';
import { QuizzesService } from '../quiz';
import { GenerateSeatingDto } from './dto/generate-seating.dto';

export interface SeatingGenerationSummary {
  job_id: string;
  seating_plan_id: string;
  status: SeatingPlanStatus;
  soft_constraint_score: number | null;
  hard_violations: unknown[];
  soft_violations: unknown[];
  /** Set (to `SINGLE_SUBJECT_SPREAD`) when the strategy had nothing to mix in this room and seats were spread by roll number and batch instead. */
  fallback_reason?: string;
}

/**
 * A fallback notice is stored inside the SAME `violation_report` JSON
 * column Phase 13 already persists (no new column — this phase must not
 * introduce schema changes) as one more entry in that array, using the
 * same soft-violation shape with this reserved `type` marker so it's
 * visible on every later read (`GET /seating-jobs/{id}`,
 * `GET /seating-plans/{id}`) without needing separate storage.
 */
const FALLBACK_NOTICE_TYPE = 'SINGLE_SUBJECT_FALLBACK';

/**
 * Owns `seating_plans` + `seating_assignments` (ARCHITECTURE.md §T,
 * IMPLEMENTATION_PLAN.md Phase 13). The actual generation and validation
 * algorithms live in `@exam-sync/domain-logic` as pure functions — this
 * service is thin NestJS wiring: resolve inputs from the DB, call the
 * pure functions, persist the result, and surface the one-subject
 * fallback reason (`FALLBACK_NOTICE_TYPE`) in the response.
 *
 * Cohort resolution (which specific students belong to a given room) is
 * the one genuinely non-trivial piece owned here: Phase 12's Best-Fit
 * Decreasing packer only fixes COUNTS per (room, quiz)
 * (`ExamSessionRoomQuiz`, persisted specifically so this phase could
 * exist) — this service deterministically slices each quiz's full,
 * id-sorted assigned roster across its rooms in a stable, reproducible
 * order (rooms ordered by their own `createdAt`), so the same inputs
 * always resolve to the same per-room cohort.
 */
@Injectable()
export class SeatingEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly examSessionsService: ExamSessionsService,
    private readonly quizzesService: QuizzesService,
    private readonly notificationsOutbox: NotificationsOutboxService,
    private readonly examSessionOwnershipService: ExamSessionOwnershipService,
  ) {}

  /**
   * `POST /exam-sessions/{id}/seating/generate` (ADMIN). Only permitted
   * while the session is `SEATING_GENERATION` (Phase 12's own terminal
   * status on successful room allocation). EC-032: a DRAFT/FINALIZED plan
   * already existing for (session, room) short-circuits generation and
   * returns THAT plan's summary instead of creating a duplicate.
   */
  async generate(
    examSessionId: string,
    dto: GenerateSeatingDto,
    actor: AuthenticatedUser,
  ): Promise<SeatingGenerationSummary> {
    const session = await this.examSessionsService.findById(examSessionId);
    if (!(await this.examSessionOwnershipService.isOwnerOrCoInstructor(examSessionId, actor))) {
      throw new NotFoundException(); // IDOR-safe — mirrors quizzes.service.ts's own PATCH convention.
    }

    // EC-032 idempotency is checked FIRST, before the session-status guard
    // below: a session with even ONE room's plan already VALIDATED may
    // already have advanced past SEATING_GENERATION (see
    // `maybeAdvanceSessionToReadyForFinalization`) by the time a second,
    // genuinely-duplicate request for that SAME room arrives — that
    // request must still short-circuit to the existing plan, not 409 on a
    // status check that's really about gating NEW generation, not repeats
    // of an already-completed one.
    const existing = await this.prisma.seatingPlan.findFirst({
      where: {
        examSessionId,
        roomId: dto.room_id,
        status: { in: [SeatingPlanStatus.DRAFT, SeatingPlanStatus.VALIDATED, SeatingPlanStatus.FINALIZED] },
      },
    });
    if (existing) {
      return this.toSummary(existing);
    }

    if (session.status !== ExamSessionStatus.SEATING_GENERATION) {
      throw new ConflictException(
        `Exam session is in status "${session.status}" and seating can only be generated while SEATING_GENERATION.`,
      );
    }

    const examSessionRoom = await this.prisma.examSessionRoom.findUnique({
      where: { roomId_examSessionId: { roomId: dto.room_id, examSessionId } },
    });
    if (!examSessionRoom) {
      throw new NotFoundException('This room is not allocated to this exam session.');
    }

    return this.createPlan(examSessionId, examSessionRoom.id, dto.room_id, dto.strategy, actor, dto.skip_alternate_columns === true);
  }

  /**
   * `POST /exam-sessions/{id}/seating/regenerate` (FACULTY, ownership-
   * gated) — lets the owning/co-instructing faculty pick a different
   * strategy for a room BEFORE finalizing (`generate`'s own EC-032
   * idempotency short-circuit means calling `generate` again for the same
   * room just returns the SAME plan, strategy ignored — there was
   * previously no way to change it once a DRAFT/VALIDATED/FAILED plan
   * existed). Marks the room's current plan SUPERSEDED (an until-now
   * unused `SeatingPlanStatus` value already in the schema) and creates a
   * fresh one via the same `createPlan` path `generate` uses. Blocked once
   * the room's plan is already FINALIZED — that lock is intentional
   * (ARCHITECTURE.md §V: finalization is a one-way door) and regeneration
   * must not be able to undo it.
   */
  async regenerate(
    examSessionId: string,
    dto: GenerateSeatingDto,
    actor: AuthenticatedUser,
  ): Promise<SeatingGenerationSummary> {
    await this.examSessionsService.findById(examSessionId);
    if (!(await this.examSessionOwnershipService.isOwnerOrCoInstructor(examSessionId, actor))) {
      throw new NotFoundException(); // IDOR-safe — mirrors quizzes.service.ts's own PATCH convention.
    }
    await this.assertSeatingNotPaused(examSessionId);

    const examSessionRoom = await this.prisma.examSessionRoom.findUnique({
      where: { roomId_examSessionId: { roomId: dto.room_id, examSessionId } },
    });
    if (!examSessionRoom) {
      throw new NotFoundException('This room is not allocated to this exam session.');
    }

    const existing = await this.prisma.seatingPlan.findFirst({
      where: { examSessionId, roomId: dto.room_id },
      orderBy: { generatedAt: 'desc' },
    });
    if (!existing) {
      throw new ConflictException('No seating plan has been generated for this room yet — use generate instead.');
    }
    if (existing.status === SeatingPlanStatus.FINALIZED) {
      throw new ConflictException('This room\'s seating plan has already been finalized and cannot be regenerated.');
    }

    await this.prisma.$transaction(async (tx) => {
      const superseded = await tx.seatingPlan.update({
        where: { id: existing.id },
        data: { status: SeatingPlanStatus.SUPERSEDED, version: { increment: 1 } },
      });
      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'SeatingPlan',
          entityId: existing.id,
          oldValue: { status: existing.status },
          newValue: { status: superseded.status },
        },
        tx,
      );
    });

    return this.createPlan(examSessionId, examSessionRoom.id, dto.room_id, dto.strategy, actor, dto.skip_alternate_columns === true);
  }

  /** Shared by `generate` and `regenerate`: build the cohort, run the pure generator, persist + validate the result, and advance the session if this was the last room needed. */
  private async createPlan(
    examSessionId: string,
    examSessionRoomId: string,
    roomId: string,
    strategy: GenerateSeatingDto['strategy'],
    actor: AuthenticatedUser,
    skipAlternateColumns = false,
  ): Promise<SeatingGenerationSummary> {
    const { students, seats } = await this.resolveCohort(examSessionId, examSessionRoomId, roomId);

    if (skipAlternateColumns) {
      const usable = keepAlternateColumns(seats.filter((s) => s.isActive)).length;
      if (students.length > usable) {
        throw new ConflictException(
          `Leaving every second column empty leaves ${usable} usable seats, but ${students.length} students need seating in this room. Turn the empty-column option off, or allocate another room.`,
        );
      }
    }

    const generated = generateSeating({
      seats,
      students,
      strategy,
      seed: `${examSessionId}:${roomId}`,
      skipAlternateColumns,
    });

    const plan = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.seatingPlan.create({
          data: { examSessionId, roomId, strategy, status: SeatingPlanStatus.DRAFT },
        });

        if (generated.assignments.length > 0) {
          await tx.seatingAssignment.createMany({
            data: generated.assignments.map((a) => ({
              seatingPlanId: created.id,
              seatId: a.seatId,
              studentId: a.studentId,
              quizId: a.quizId,
            })),
          });
        }

        // ADR-004: validation re-scans PERSISTED rows from scratch,
        // independent of the generator's own in-memory result.
        const persistedAssignments = await tx.seatingAssignment.findMany({
          where: { seatingPlanId: created.id },
          select: { seatId: true, studentId: true, quizId: true },
        });

        const validation = validateSeating({ seats, assignments: persistedAssignments, students });

        const fallbackNotice = generated.fallbackReason
          ? [
              {
                type: FALLBACK_NOTICE_TYPE,
                message: `Everyone in this room sits the same subject, so seats were spread by roll number and batch instead (${generated.fallbackReason}).`,
                seatIdA: '',
                seatIdB: '',
                fallback_reason: generated.fallbackReason,
              },
            ]
          : [];

        const updated =
          validation.hardViolations.length > 0
            ? await tx.seatingPlan.update({
                where: { id: created.id },
                data: {
                  status: SeatingPlanStatus.FAILED,
                  violationReport: toJson([...validation.hardViolations, ...fallbackNotice]),
                },
              })
            : await tx.seatingPlan.update({
                where: { id: created.id },
                data: {
                  status: SeatingPlanStatus.VALIDATED,
                  softConstraintScore: validation.softConstraintScore,
                  violationReport: toJson([...validation.softViolations, ...fallbackNotice]),
                },
              });

        await this.auditHook.record(
          {
            actor,
            action: 'CREATE',
            entityType: 'SeatingPlan',
            entityId: updated.id,
            newValue: { status: updated.status, roomId, strategy },
          },
          tx,
        );

        return { plan: updated, validation };
      })
      .catch((err) => this.mapUniqueViolation(err));

    if (plan.plan.status === SeatingPlanStatus.VALIDATED) {
      await this.maybeAdvanceSessionToReadyForFinalization(examSessionId);
    }

    return this.toSummaryWithViolations(plan.plan, plan.validation, generated.fallbackReason);
  }

  /** `GET /exam-sessions/{id}/seating/current?room_id=` — the room's latest non-superseded plan id (or null), scoped like `GET /exam-sessions/{id}`. */
  async currentPlan(
    examSessionId: string,
    roomId: string,
    actor: AuthenticatedUser,
  ): Promise<{ seating_plan_id: string | null }> {
    await this.examSessionsService.findByIdScoped(examSessionId, actor);
    const plan = await this.prisma.seatingPlan.findFirst({
      where: { examSessionId, roomId, status: { not: SeatingPlanStatus.SUPERSEDED } },
      orderBy: { generatedAt: 'desc' },
      select: { id: true },
    });
    return { seating_plan_id: plan?.id ?? null };
  }

  /**
   * `GET /seating-plans/{id}` — ADMIN or a FACULTY who owns/co-instructs
   * an actively-attached quiz in the plan's exam session (reuses
   * `ExamSessionsService.findByIdScoped`, the exact same scoping rule
   * Phase 8 established for `GET /exam-sessions/{id}`). STUDENT-own-seat
   * viewing (API_CONTRACT.md: "via `/students/{id}/schedule`") is NOT
   * implemented here — that endpoint doesn't exist in this codebase yet
   * (same disclosed deferral Phase 8 made for STUDENT access generally).
   */
  async findByIdScoped(planId: string, actor: AuthenticatedUser) {
    const plan = await this.findById(planId);
    await this.examSessionsService.findByIdScoped(plan.examSessionId, actor);

    const assignments = await this.prisma.seatingAssignment.findMany({
      where: { seatingPlanId: planId },
      include: { seat: true, student: true, quiz: { select: { id: true, title: true } } },
    });

    return { ...plan, assignments };
  }

  /**
   * `GET /seating-jobs/{id}` (ADMIN, FACULTY) — this phase's synchronous,
   * single-room generation already produces its own natural job-like
   * record (the `SeatingPlan` itself); no separate job abstraction is
   * layered on top. SeatingPanel.tsx polls this immediately after a
   * faculty member generates seating for their own session, so it must be
   * reachable by the owning/co-instructing faculty, not admin-only — same
   * ADMIN-unscoped/FACULTY-scoped-404 pattern as `findByIdScoped`.
   */
  async getJob(planId: string, actor: AuthenticatedUser): Promise<SeatingGenerationSummary> {
    const plan = await this.findById(planId);
    await this.examSessionsService.findByIdScoped(plan.examSessionId, actor);
    return this.toSummary(plan);
  }

  /**
   * `POST /seating-plans/{id}/finalize` (ADMIN). ADR-004: "the FINALIZE
   * API must re-run validation synchronously at finalize time, not trust
   * a stale VALIDATED status" — so this re-resolves the cohort and
   * re-validates fresh, rather than trusting the plan's own
   * `violationReport` from generation time (BR-026, BR-027).
   */
  async finalize(planId: string, actor: AuthenticatedUser): Promise<SeatingPlan> {
    const plan = await this.findById(planId);
    if (!(await this.examSessionOwnershipService.isOwnerOrCoInstructor(plan.examSessionId, actor))) {
      throw new NotFoundException(); // IDOR-safe — mirrors quizzes.service.ts's own PATCH convention.
    }
    if (plan.status !== SeatingPlanStatus.VALIDATED) {
      throw new ConflictException(
        `Seating plan is in status "${plan.status}" and can only be finalized from VALIDATED.`,
      );
    }
    await this.assertSeatingNotPaused(plan.examSessionId);

    const { students, seats } = await this.resolveCohort(plan.examSessionId, undefined, plan.roomId);
    const persistedAssignments = await this.prisma.seatingAssignment.findMany({
      where: { seatingPlanId: planId },
      select: { seatId: true, studentId: true, quizId: true },
    });

    const validation = validateSeating({ seats, assignments: persistedAssignments, students });
    if (validation.hardViolations.length > 0) {
      throw new ConflictException({
        message: 'This seating plan has hard constraint violations and cannot be finalized (BR-026).',
        details: validation.hardViolations,
      });
    }

    const room = await this.prisma.room.findUniqueOrThrow({ where: { id: plan.roomId } });
    const roomLabel = `${room.building}-${room.roomNumber}`;
    // Exam name/date/time go into the SEAT_ASSIGNED notification so a student sees WHICH exam the seat is for.
    const session = await this.examSessionsService.findById(plan.examSessionId);
    const seatLabels = new Map(
      (
        await this.prisma.roomSeat.findMany({
          where: { id: { in: persistedAssignments.map((a) => a.seatId) } },
          select: { id: true, seatLabel: true },
        })
      ).map((s) => [s.id, s.seatLabel]),
    );
    const studentUserIds = new Map(
      (
        await this.prisma.student.findMany({
          where: { id: { in: persistedAssignments.map((a) => a.studentId) } },
          select: { id: true, userId: true },
        })
      ).map((s) => [s.id, s.userId]),
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      // Atomic conditional update, not a plain `update` — the VALIDATED
      // check above is a separate read outside this transaction, so two
      // concurrent `finalize` calls on the same plan could both pass it
      // before either commits. Guarding the WHERE on `status: VALIDATED`
      // means only the first transaction's write actually matches; the
      // second gets `count: 0` and cleanly 409s instead of both
      // committing and double-queuing every SEAT_ASSIGNED notification
      // plus a duplicate audit row.
      const { count } = await tx.seatingPlan.updateMany({
        where: { id: planId, status: SeatingPlanStatus.VALIDATED },
        data: { status: SeatingPlanStatus.FINALIZED, finalizedAt: new Date() },
      });
      if (count === 0) {
        throw new ConflictException('This seating plan was already finalized by a concurrent request.');
      }
      const finalized = await tx.seatingPlan.findUniqueOrThrow({ where: { id: planId } });

      for (const assignment of persistedAssignments) {
        const recipientId = studentUserIds.get(assignment.studentId);
        if (!recipientId) {
          continue;
        }
        await this.notificationsOutbox.queue(tx, {
          recipientType: NotificationRecipientType.STUDENT,
          recipientId,
          eventType: NotificationEventType.SEAT_ASSIGNED,
          entityId: `${finalized.id}:${assignment.studentId}`,
          entityVersion: finalized.finalizedAt?.toISOString() ?? finalized.id,
          payload: {
            seating_plan_id: finalized.id,
            exam_session_id: finalized.examSessionId,
            room_label: roomLabel,
            seat_label: seatLabels.get(assignment.seatId) ?? assignment.seatId,
            quiz_id: assignment.quizId,
            session_name: session?.name ?? null,
            session_date: session?.sessionDate ? new Date(session.sessionDate).toISOString().slice(0, 10) : null,
            start_time: session?.startTime ?? null,
          },
        });
      }

      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'SeatingPlan',
          entityId: planId,
          oldValue: { status: plan.status },
          newValue: { status: finalized.status },
        },
        tx,
      );

      return finalized;
    });

    return updated;
  }

  /** Seating is paused while a "more rooms" request waits for the admin: its students are about to be re-split, so nothing may be generated or finalized. */
  private async assertSeatingNotPaused(examSessionId: string): Promise<void> {
    const pending = await this.prisma.examSessionRoomRequest.findFirst({ where: { examSessionId, status: 'PENDING' }, select: { id: true } });
    if (pending) {
      throw new ConflictException('Seating is paused while a request for more rooms waits for admin approval. Cancel the request to carry on.');
    }
  }

  private async findById(planId: string): Promise<SeatingPlan> {
    const plan = await this.prisma.seatingPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new NotFoundException();
    }
    return plan;
  }

  /**
   * Resolves the deterministic per-room cohort. Callable either with a
   * known `examSessionRoomId` (generation path) or by looking it up via
   * `roomId` (+ optionally excluding nothing special — finalize path,
   * which already knows the room but not the `ExamSessionRoom` row id).
   */
  private async resolveCohort(
    examSessionId: string,
    examSessionRoomId: string | undefined,
    roomId: string,
  ): Promise<{ students: StudentToSeatInput[]; seats: SeatInput[] }> {
    const resolvedExamSessionRoomId =
      examSessionRoomId ??
      (
        await this.prisma.examSessionRoom.findUniqueOrThrow({
          where: { roomId_examSessionId: { roomId, examSessionId } },
        })
      ).id;

    const thisRoomBreakdown = await this.prisma.examSessionRoomQuiz.findMany({
      where: { examSessionRoomId: resolvedExamSessionRoomId },
    });

    const students: StudentToSeatInput[] = [];
    const seenStudentIds = new Set<string>();

    // After a "more rooms" request the exact students of each room are recorded (so finalized rooms can never shift while
    // the others are re-split). Rooms without such rows — every session that never had extra rooms — derive their students
    // the original way below.
    const explicitMembers = await this.prisma.examSessionRoomStudent.findMany({
      where: { examSessionRoomId: resolvedExamSessionRoomId },
      orderBy: [{ quizId: 'asc' }, { studentId: 'asc' }],
    });
    if (explicitMembers.length > 0) {
      const subjectByQuiz = new Map<string, string>();
      for (const quizId of new Set(explicitMembers.map((m) => m.quizId))) {
        subjectByQuiz.set(quizId, (await this.quizzesService.findById(quizId)).subjectId);
      }
      for (const member of explicitMembers) {
        if (seenStudentIds.has(member.studentId)) continue; // BR-025: one seat per plan
        seenStudentIds.add(member.studentId);
        students.push({
          studentId: member.studentId,
          quizId: member.quizId,
          subjectId: subjectByQuiz.get(member.quizId) ?? '',
          batchId: '', // filled in below
          requiresAccessibleSeat: false,
        });
      }
    }

    for (const entry of explicitMembers.length > 0 ? [] : thisRoomBreakdown) {
      const allRoomsForQuiz = await this.prisma.examSessionRoomQuiz.findMany({
        where: { quizId: entry.quizId, examSessionRoom: { examSessionId } },
        include: { examSessionRoom: true },
      });
      allRoomsForQuiz.sort(
        (a, b) =>
          a.examSessionRoom.createdAt.getTime() - b.examSessionRoom.createdAt.getTime() ||
          a.examSessionRoomId.localeCompare(b.examSessionRoomId),
      );

      let offset = 0;
      for (const row of allRoomsForQuiz) {
        if (row.examSessionRoomId === resolvedExamSessionRoomId) {
          break;
        }
        offset += row.studentCount;
      }

      const assignedStudents = await this.prisma.quizStudentAssignment.findMany({
        where: { examSessionId, quizId: entry.quizId, status: QuizStudentAssignmentStatus.ASSIGNED },
        orderBy: { studentId: 'asc' },
        select: { studentId: true },
      });
      const slice = assignedStudents.slice(offset, offset + entry.studentCount);

      const quiz = await this.quizzesService.findById(entry.quizId);
      for (const { studentId } of slice) {
        // A student appearing via more than one quiz in the SAME room's
        // cohort is a rare, accepted edge case — BR-025 permits them only
        // ONE seat per plan regardless, so the first occurrence wins.
        if (seenStudentIds.has(studentId)) {
          continue;
        }
        seenStudentIds.add(studentId);
        students.push({
          studentId,
          quizId: entry.quizId,
          subjectId: quiz.subjectId,
          batchId: '', // filled in below
          requiresAccessibleSeat: false, // BR-028: no data source yet — see domain-logic/seating/types.ts
        });
      }
    }

    if (students.length > 0) {
      const studentRows = await this.prisma.student.findMany({
        where: { id: { in: students.map((s) => s.studentId) } },
        select: { id: true, batchId: true, rollNumber: true },
      });
      const rowById = new Map(studentRows.map((s) => [s.id, s]));
      for (const s of students) {
        s.batchId = rowById.get(s.studentId)?.batchId ?? '';
        s.rollNumber = rowById.get(s.studentId)?.rollNumber;
      }
    }

    const seatRows = await this.prisma.roomSeat.findMany({ where: { roomId } });
    const seats: SeatInput[] = seatRows.map((s) => ({
      id: s.id,
      rowIndex: s.rowIndex,
      colIndex: s.colIndex,
      isActive: s.isActive,
      isAccessible: s.isAccessible,
    }));

    return { students, seats };
  }

  /**
   * ARCHITECTURE.md §AD-2 #2: ROOM_ALLOCATION→SEATING_GENERATION already
   * happened in Phase 12; the NEXT transition
   * (SEATING_GENERATION→READY_FOR_FINALIZATION) requires ALL of the
   * session's allocated rooms to have a VALIDATED (or FINALIZED) plan AND
   * at least one invigilator assigned — see
   * `ExamSessionsService.maybeAdvanceToReadyForFinalization`'s own
   * comment for why that check lives there instead (shared with
   * `InvigilationService`, since either a plan or an invigilator
   * assignment can be the LAST piece that makes a session ready).
   */
  private async maybeAdvanceSessionToReadyForFinalization(examSessionId: string): Promise<void> {
    await this.examSessionsService.maybeAdvanceToReadyForFinalization(examSessionId);
  }

  private toSummary(plan: SeatingPlan): SeatingGenerationSummary {
    const stored = (plan.violationReport as Array<Record<string, unknown>>) ?? [];
    const fallbackNotice = stored.find((v) => v.type === FALLBACK_NOTICE_TYPE);

    return {
      job_id: plan.id,
      seating_plan_id: plan.id,
      status: plan.status,
      soft_constraint_score: plan.softConstraintScore ? Number(plan.softConstraintScore) : null,
      hard_violations: plan.status === SeatingPlanStatus.FAILED ? stripFallbackNotice(stored) : [],
      soft_violations: plan.status === SeatingPlanStatus.VALIDATED ? stripFallbackNotice(stored) : [],
      fallback_reason: fallbackNotice ? (fallbackNotice.fallback_reason as string) : undefined,
    };
  }

  private toSummaryWithViolations(
    plan: SeatingPlan,
    validation: ValidateSeatingResult,
    fallbackReason?: string,
  ): SeatingGenerationSummary {
    return {
      job_id: plan.id,
      seating_plan_id: plan.id,
      status: plan.status,
      soft_constraint_score: plan.status === SeatingPlanStatus.VALIDATED ? validation.softConstraintScore : null,
      hard_violations: validation.hardViolations,
      soft_violations: validation.softViolations,
      fallback_reason: fallbackReason,
    };
  }

  private mapUniqueViolation(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(
        'A seating plan for this room already exists for this session (EC-032).',
      );
    }
    throw err;
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function stripFallbackNotice(stored: Array<Record<string, unknown>>): unknown[] {
  return stored.filter((v) => v.type !== FALLBACK_NOTICE_TYPE);
}

// Re-exported only for the controller's return-type convenience; not part of the public module surface.
export type { SeatAssignment, SeatingAssignment };
