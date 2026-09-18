import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ExamSession,
  ExamSessionStatus,
  NotificationEventType,
  NotificationRecipientType,
  Prisma,
  QuizStatus,
  QuizStudentAssignmentStatus,
} from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { runSerializable } from '../../common/prisma/serializable-transaction';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { NotificationsOutboxService } from '../../common/notifications-outbox/notifications-outbox.service';
import { ConflictEngineService, ConflictCheckResult, ConflictDetail } from '../conflict-engine';
import { QuizzesService } from '../quiz';
import { ExamSessionsAccessRepository } from './exam-sessions-access.repository';
import { CreateExamSessionDto } from './dto/create-exam-session.dto';
import { RescheduleExamSessionDto } from './dto/reschedule-exam-session.dto';
import { CancelExamSessionDto } from './dto/cancel-exam-session.dto';
import { UpdateSessionQuizzesDto } from './dto/update-session-quizzes.dto';

const NON_CANCELLABLE_STATUSES: ExamSessionStatus[] = [
  ExamSessionStatus.IN_PROGRESS,
  ExamSessionStatus.COMPLETED,
  ExamSessionStatus.CANCELLED,
];

/**
 * Owns `exam_sessions` + `exam_session_quizzes`. create, quiz
 * attach/detach, reschedule, cancel — attach/detach and reschedule now run
 * against the REAL Conflict Engine (Phase 10; see conflict-engine.service.ts's
 * header comment for what it checks and what it still doesn't). A session
 * never leaves DRAFT except by cancellation here; the
 * DRAFT -> ASSIGNING_STUDENTS transition (Phase 9's `assign-students`) and
 * everything past it (ARCHITECTURE.md §AD-2 #2) live in the
 * student-assignment module, not here.
 */
@Injectable()
export class ExamSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly conflictEngine: ConflictEngineService,
    private readonly quizzesService: QuizzesService,
    private readonly accessRepository: ExamSessionsAccessRepository,
    private readonly notificationsOutbox: NotificationsOutboxService,
  ) {}

  /**
   * Every currently-ASSIGNED student on this session, resolved to their
   * `users.id` (the id notifications are addressed to — see
   * `NotificationsOutboxService`'s `recipientId` doc comment) — the
   * recipient set for reschedule/cancel notifications (FR-041). Queried
   * against `tx` so it reflects the same transaction snapshot as the
   * change being notified about.
   */
  private async resolveAssignedStudentUserIds(
    examSessionId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string[]> {
    const assignments = await tx.quizStudentAssignment.findMany({
      where: { examSessionId, status: QuizStudentAssignmentStatus.ASSIGNED },
      select: { studentId: true },
      distinct: ['studentId'],
    });
    if (assignments.length === 0) {
      return [];
    }
    const students = await tx.student.findMany({
      where: { id: { in: assignments.map((a) => a.studentId) } },
      select: { userId: true },
    });
    return students.map((s) => s.userId);
  }

  async create(dto: CreateExamSessionDto, actor: AuthenticatedUser): Promise<ExamSession> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.examSession.create({
        data: {
          name: dto.name,
          sessionDate: this.toDate(dto.session_date),
          startTime: this.toTime(dto.start_time),
          endTime: this.toTime(dto.end_time),
          createdByAdminId: actor.id,
        },
      });

      await this.auditHook.record(
        {
          actor,
          action: 'CREATE',
          entityType: 'ExamSession',
          entityId: session.id,
          newValue: session,
        },
        tx,
      );

      return session;
    });
  }

  async findById(id: string): Promise<ExamSession> {
    const session = await this.prisma.examSession.findUnique({ where: { id } });
    if (!session) {
      throw new NotFoundException();
    }
    return session;
  }

  /** `GET /exam-sessions/{id}` — scoped (ADMIN or a faculty who owns an attached quiz). */
  async findByIdScoped(id: string, actor: AuthenticatedUser): Promise<ExamSession> {
    return this.accessRepository.findScoped(id, actor);
  }

  /**
   * "full detail incl. quizzes, rooms, status" (API_CONTRACT.md) —
   * `rooms` now included (Phase 12 created `exam_session_rooms`; Phase
   * 8's own comment here explicitly deferred this exact field until the
   * data existed, so this is closing a disclosed gap, not scope creep).
   * Queried directly via `this.prisma` rather than importing
   * RoomAllocationModule, the same pattern already used for `quizzes`
   * above (no new cross-module dependency for one read-only join).
   */
  async getDetail(id: string, actor: AuthenticatedUser) {
    const session = await this.findByIdScoped(id, actor);
    const [attachments, roomAllocations] = await Promise.all([
      this.prisma.examSessionQuiz.findMany({
        where: { examSessionId: id, isActiveAttachment: true },
        include: { quiz: true },
      }),
      this.prisma.examSessionRoom.findMany({
        where: { examSessionId: id },
        include: { room: true },
      }),
    ]);

    return {
      ...session,
      quizzes: attachments.map((a) => a.quiz),
      rooms: roomAllocations.map((a) => ({ ...a.room, allocatedCapacity: a.allocatedCapacity })),
    };
  }

  /**
   * `PATCH /exam-sessions/{id}/quizzes` — BR-016 (ADMIN only, enforced at
   * the controller), BR-011/BR-017 (only APPROVED quizzes attachable),
   * BR-053 (at most one active session per quiz, DB-backstopped by the
   * partial unique index — see this table's schema comment). Only
   * permitted while the session is DRAFT.
   *
   * Collects ALL hard-conflict violations across the whole `add` batch
   * before failing — API_CONTRACT.md's documented error shape is a single
   * `409 {details: [...]}` (plural), not fail-fast on the first bad quiz.
   *
   * BR-011/BR-017 (unapproved quiz) and BR-053 (already attached
   * elsewhere) are cheap, single-row-backed checks (the latter is also
   * DB-constraint-backstopped, ADR-006) and are resolved BEFORE opening
   * any transaction. The real Conflict Engine's BR-019 student-overlap
   * check (Phase 10) is different in kind — a genuine cross-entity
   * check-then-act race (ADR-003) — so it, and the actual attach/detach
   * writes, run together inside ONE `SERIALIZABLE` transaction
   * (`runSerializable`): if two admins concurrently attach
   * overlapping-eligible-roster quizzes to two different sessions,
   * Postgres's serializable snapshot isolation guarantees at most one
   * commits; the loser retries (transparent, `P2034`) and re-observes the
   * winner's now-committed assignment, correctly failing with a clean 409
   * instead of both silently succeeding.
   */
  async attachAndDetachQuizzes(
    id: string,
    dto: UpdateSessionQuizzesDto,
    actor: AuthenticatedUser,
  ): Promise<ExamSession> {
    const session = await this.findById(id);
    if (session.status !== ExamSessionStatus.DRAFT) {
      throw new ConflictException(
        `Exam session is in status "${session.status}" and its quizzes can only be changed while DRAFT.`,
      );
    }

    const currentlyAttached = await this.prisma.examSessionQuiz.findMany({
      where: { examSessionId: id, isActiveAttachment: true },
      select: { quizId: true },
    });
    const currentlyAttachedIds = new Set(currentlyAttached.map((r) => r.quizId));

    const hardConflicts: ConflictDetail[] = [];
    const quizzesToActuallyAdd: string[] = [];

    for (const quizId of dto.add) {
      if (currentlyAttachedIds.has(quizId)) {
        continue; // Already attached to THIS session — idempotent no-op, not an error.
      }

      const quiz = await this.quizzesService.findById(quizId); // throws NotFoundException itself if missing

      if (quiz.status !== QuizStatus.APPROVED) {
        hardConflicts.push({
          type: 'UNAPPROVED_QUIZ',
          quizId,
          message: `Quiz "${quizId}" is in status "${quiz.status}", not APPROVED, and cannot be attached (BR-011/BR-017).`,
        });
        continue;
      }

      const activeElsewhere = await this.prisma.examSessionQuiz.findFirst({
        where: { quizId, isActiveAttachment: true, examSessionId: { not: id } },
      });
      if (activeElsewhere) {
        hardConflicts.push({
          type: 'QUIZ_ALREADY_ATTACHED_ELSEWHERE',
          quizId,
          message: `Quiz "${quizId}" is already actively attached to a different exam session (BR-053).`,
        });
        continue;
      }

      quizzesToActuallyAdd.push(quizId);
    }

    if (hardConflicts.length > 0) {
      throw new ConflictException({
        message: 'One or more quizzes could not be attached due to hard conflicts.',
        details: hardConflicts,
      });
    }

    const updated = await runSerializable(this.prisma, async (tx) => {
      if (quizzesToActuallyAdd.length > 0) {
        const conflictResult: ConflictCheckResult = await this.conflictEngine.checkSessionAssembly(
          {
            examSessionId: id,
            quizIds: [...currentlyAttachedIds, ...quizzesToActuallyAdd],
            sessionDate: session.sessionDate,
            startTime: session.startTime,
            endTime: session.endTime,
          },
          tx,
        );
        if (conflictResult.hard.length > 0) {
          throw new ConflictException({
            message: 'One or more quizzes could not be attached due to hard conflicts.',
            details: conflictResult.hard,
          });
        }
      }

      for (const quizId of dto.remove) {
        if (currentlyAttachedIds.has(quizId)) {
          await tx.examSessionQuiz.update({
            where: { examSessionId_quizId: { examSessionId: id, quizId } },
            data: { isActiveAttachment: false, detachedAt: new Date() },
          });
        }
      }

      for (const quizId of quizzesToActuallyAdd) {
        // upsert, not a plain create: a quiz previously attached-then-
        // detached from THIS SAME session already has a row at this
        // composite PK (examSessionId, quizId) with isActiveAttachment
        // now false — re-attaching it is an update, not a fresh insert.
        try {
          await tx.examSessionQuiz.upsert({
            where: { examSessionId_quizId: { examSessionId: id, quizId } },
            create: { examSessionId: id, quizId, isActiveAttachment: true },
            update: { isActiveAttachment: true, detachedAt: null, attachedAt: new Date() },
          });
        } catch (err) {
          // ADR-003 Implementation Notes: map raw constraint-violation
          // errors to a clean 409, never let them leak to the caller.
          // Backstops BR-053 under a race the app-level pre-check above
          // (necessarily run outside this transaction) can't itself see.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new ConflictException({
              message: 'One or more quizzes could not be attached due to hard conflicts.',
              details: [
                {
                  type: 'QUIZ_ALREADY_ATTACHED_ELSEWHERE',
                  quizId,
                  message: `Quiz "${quizId}" was concurrently attached to a different exam session (BR-053).`,
                },
              ],
            });
          }
          throw err;
        }
      }

      const updatedSession = await tx.examSession.update({
        where: { id },
        data: { version: { increment: 1 } },
      });

      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'ExamSession',
          entityId: id,
          oldValue: { attached: [...currentlyAttachedIds] },
          newValue: { added: quizzesToActuallyAdd, removed: dto.remove },
        },
        tx,
      );

      return updatedSession;
    });

    return updated;
  }

  /**
   * `POST /exam-sessions/{id}/reschedule` (EC-021: "Conflict Engine
   * re-runs against the new time window before the reschedule commits").
   * Only permitted while DRAFT (same reasoning as quiz attach/detach —
   * nothing downstream exists yet to invalidate for a later-stage
   * session, so DRAFT-only is the safe default now).
   *
   * The attached-quiz read, the BR-019 re-check against the NEW time
   * window, and the write all happen inside ONE `SERIALIZABLE`
   * transaction (same reasoning as `attachAndDetachQuizzes`) — a
   * reschedule can newly conflict with a session some OTHER concurrent
   * transaction is simultaneously assembling, and only `SERIALIZABLE`
   * isolation (not a plain read-then-write) makes that race safe.
   */
  async reschedule(
    id: string,
    dto: RescheduleExamSessionDto,
    actor: AuthenticatedUser,
  ): Promise<ExamSession> {
    const session = await this.findById(id);
    if (session.status !== ExamSessionStatus.DRAFT) {
      throw new ConflictException(
        `Exam session is in status "${session.status}" and cannot be rescheduled.`,
      );
    }

    const newSessionDate = this.toDate(dto.session_date);
    const newStartTime = this.toTime(dto.start_time);
    const newEndTime = this.toTime(dto.end_time);

    const updated = await runSerializable(this.prisma, async (tx) => {
      const attachedQuizIds = (
        await tx.examSessionQuiz.findMany({
          where: { examSessionId: id, isActiveAttachment: true },
          select: { quizId: true },
        })
      ).map((r) => r.quizId);

      const result = await this.conflictEngine.checkSessionAssembly(
        {
          examSessionId: id,
          quizIds: attachedQuizIds,
          sessionDate: newSessionDate,
          startTime: newStartTime,
          endTime: newEndTime,
        },
        tx,
      );
      if (result.hard.length > 0) {
        throw new ConflictException({
          message: 'Rescheduling would introduce hard conflicts.',
          details: result.hard,
        });
      }

      const rescheduled = await tx.examSession.update({
        where: { id },
        data: {
          sessionDate: newSessionDate,
          startTime: newStartTime,
          endTime: newEndTime,
          version: { increment: 1 },
        },
      });

      const recipientUserIds = await this.resolveAssignedStudentUserIds(id, tx);
      for (const recipientId of recipientUserIds) {
        await this.notificationsOutbox.queue(tx, {
          recipientType: NotificationRecipientType.STUDENT,
          recipientId,
          eventType: NotificationEventType.EXAM_SESSION_RESCHEDULED,
          entityId: rescheduled.id,
          entityVersion: rescheduled.version,
          payload: {
            session_id: rescheduled.id,
            session_name: rescheduled.name,
            session_date: dto.session_date,
            start_time: dto.start_time,
            end_time: dto.end_time,
          },
        });
      }

      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'ExamSession',
          entityId: id,
          oldValue: session,
          newValue: rescheduled,
        },
        tx,
      );

      return rescheduled;
    });

    return updated;
  }

  /**
   * `POST /exam-sessions/{id}/cancel` — `reason` required
   * (ARCHITECTURE.md §AD-2: "CANCELLED reason mandatory and audited").
   * Releases every actively-attached quiz (ADR-006: cancellation is what
   * frees a quiz to be attached to a different session later) in the SAME
   * transaction as the status change — application-transaction
   * discipline, per this phase's schema comment on `isActiveAttachment`.
   * "cascades notifications" (API_CONTRACT.md) is now implemented here
   * (Phase 15) — every currently-ASSIGNED student is notified in the SAME
   * transaction as the status change (BR-042), fanned out via the
   * `critical` priority lane (ARCHITECTURE.md §AN: "session cancellations"
   * — see `common/queue/queue.constants.ts`).
   */
  async cancel(id: string, dto: CancelExamSessionDto, actor: AuthenticatedUser): Promise<ExamSession> {
    const session = await this.findById(id);
    if (NON_CANCELLABLE_STATUSES.includes(session.status)) {
      throw new ConflictException(
        `Exam session is in status "${session.status}" and cannot be cancelled.`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.examSessionQuiz.updateMany({
        where: { examSessionId: id, isActiveAttachment: true },
        data: { isActiveAttachment: false, detachedAt: new Date() },
      });

      const cancelled = await tx.examSession.update({
        where: { id },
        data: { status: ExamSessionStatus.CANCELLED, version: { increment: 1 } },
      });

      const recipientUserIds = await this.resolveAssignedStudentUserIds(id, tx);
      for (const recipientId of recipientUserIds) {
        await this.notificationsOutbox.queue(tx, {
          recipientType: NotificationRecipientType.STUDENT,
          recipientId,
          eventType: NotificationEventType.EXAM_SESSION_CANCELLED,
          entityId: cancelled.id,
          entityVersion: cancelled.version,
          payload: { session_id: cancelled.id, session_name: cancelled.name, reason: dto.reason },
        });
      }

      await this.auditHook.record(
        {
          actor,
          action: 'DEACTIVATE',
          entityType: 'ExamSession',
          entityId: id,
          oldValue: session,
          newValue: cancelled,
          reason: dto.reason,
        },
        tx,
      );

      return cancelled;
    });

    return updated;
  }

  /** `GET /exam-sessions/{id}/conflicts` — ADMIN-only dry-run, no commit. */
  async getConflicts(id: string): Promise<ConflictCheckResult> {
    const session = await this.findById(id);
    const attachedQuizIds = (
      await this.prisma.examSessionQuiz.findMany({
        where: { examSessionId: id, isActiveAttachment: true },
        select: { quizId: true },
      })
    ).map((r) => r.quizId);

    return this.conflictEngine.checkSessionAssembly({
      examSessionId: id,
      quizIds: attachedQuizIds,
      sessionDate: session.sessionDate,
      startTime: session.startTime,
      endTime: session.endTime,
    });
  }

  private toDate(dateStr: string): Date {
    return new Date(`${dateStr}T00:00:00Z`);
  }

  private toTime(timeStr: string): Date {
    return new Date(`1970-01-01T${timeStr}Z`);
  }
}
