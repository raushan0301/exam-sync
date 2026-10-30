import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  NotificationEventType,
  NotificationRecipientType,
  Prisma,
  Quiz,
  QuizApprovalAction,
  QuizApprovalHistory,
  QuizStatus,
} from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { NotificationsOutboxService } from '../../common/notifications-outbox/notifications-outbox.service';
import { RoomHoldsService } from '../../common/room-holds/room-holds.service';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';
import {
  cursorFindManyArgs,
  PaginatedResult,
  resolveLimit,
  toPaginatedResult,
} from '../../common/pagination/paginate';
import { SubjectsService, BatchesService } from '../academic-structure';
import { FacultyService } from '../faculty';
import { FacultyAssignmentsService } from '../faculty-assignment';
import { EnrollmentsService } from '../enrollment';
import { QuizOwnershipService } from './quiz-ownership.service';
import { QuizAccessRepository } from './quiz-access.repository';
import { QuizApprovalHistoryService } from './quiz-approval-history.service';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';
import { RejectQuizDto } from './dto/reject-quiz.dto';

export interface ListQuizzesParams {
  cursor?: string;
  limit?: number;
  status?: QuizStatus;
  subjectId?: string;
  facultyId?: string;
}

/**
 * `GET /quizzes` response shape — `examSession` denormalizes whether this
 * quiz is CURRENTLY actively attached to an exam session (`null` if not),
 * so callers (the "New Exam Session" picker, "My Quizzes") can show an
 * approved-but-already-scheduled quiz as scheduled/in-progress/completed
 * instead of letting a faculty start a second session for the same quiz.
 * Detaching a quiz (isActiveAttachment: false) clears this back to null,
 * matching FR-021/the attach-establishes-ownership design already in
 * exam-sessions.service.ts.
 */
export interface QuizWithSchedule extends Quiz {
  examSession: { id: string; status: string } | null;
}

export interface QuizAllocatedRoom {
  id: string;
  building: string;
  floor: number;
  roomNumber: string;
  capacity: number;
  allocatedCapacity: number;
}

/**
 * `GET /quizzes/{id}` response shape — same `examSession` attachment
 * `list()` already enriches with, PLUS (once one exists) its FINAL
 * allocated rooms (`exam_session_rooms`, via `RoomAllocationService`) —
 * distinct from this quiz's own `requestedRoomIds` (a preliminary,
 * faculty-picked recommendation): once an exam session is built from
 * this quiz and an admin actually approves room allocation there, THESE
 * are the real, booked rooms.
 */
export interface QuizDetail extends Quiz {
  examSession: { id: string; status: string; rooms: QuizAllocatedRoom[] } | null;
  /** Seats currently held for this quiz (approved, rooms not allocated yet) — main rooms and, when locked, the backup. */
  roomHolds: QuizRoomHold[];
}

export interface QuizRoomHold {
  roomId: string;
  kind: 'MAIN' | 'BACKUP';
  seatsHeld: number;
  holdDate: Date;
  startTime: Date;
  endTime: Date;
}

/**
 * Owns `quizzes` + `quiz_batches`. Phase 6 built the DRAFT/SUBMITTED
 * lifecycle; Phase 7 adds APPROVED/REJECTED, resubmission
 * (REJECTED -> SUBMITTED again), and the `quiz_approval_history` ledger.
 * BR-015's "editing an APPROVED quiz reverts it to DRAFT" rule remains
 * explicitly OUT of scope — APPROVED quizzes are not editable at all yet
 * (see `update`'s status check) since nothing downstream (Phase 8+
 * exam sessions) exists yet to make that revert-and-reapprove flow
 * meaningful; inventing it now would be scope creep beyond what Phase 7
 * asks for.
 */
@Injectable()
export class QuizzesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly subjectsService: SubjectsService,
    private readonly batchesService: BatchesService,
    private readonly facultyService: FacultyService,
    private readonly facultyAssignmentsService: FacultyAssignmentsService,
    private readonly ownershipService: QuizOwnershipService,
    private readonly accessRepository: QuizAccessRepository,
    private readonly approvalHistoryService: QuizApprovalHistoryService,
    private readonly notificationsOutbox: NotificationsOutboxService,
    private readonly enrollmentsService: EnrollmentsService,
    private readonly roomHolds: RoomHoldsService,
  ) {}

  /**
   * `GET /quizzes/eligible-student-count` — real enrollment count for the
   * exact (subject, batches, academic_year, semester) combination the
   * quiz-creation form has picked so far, so `student_count` can be
   * auto-filled with a real number instead of a guess. Same derivation
   * `EnrollmentsService.findEligibleStudentIds` already uses for Phase 9's
   * bulk student assignment (BR-005) — this quiz doesn't exist yet, so
   * there's nothing to scope this to beyond the raw enrollment data.
   */
  async getEligibleStudentCount(
    subjectId: string,
    batchIds: string[],
    academicYear: string,
    semester: number,
  ): Promise<{ count: number }> {
    const ids = await this.enrollmentsService.findEligibleStudentIds(subjectId, batchIds, academicYear, semester);
    return { count: ids.length };
  }

  async create(dto: CreateQuizDto, actor: AuthenticatedUser): Promise<Quiz> {
    const actingFaculty = await this.requireActingFaculty(actor);

    await this.subjectsService.findById(dto.subject_id);
    for (const batchId of dto.batch_ids) {
      await this.batchesService.findById(batchId);
    }

    // BR-010, checked at creation for every targeted batch — one
    // unauthorized batch in the set blocks the whole creation (no partial
    // quiz spanning batches the faculty isn't assigned to for any of).
    await this.assertAssignedToAll(
      actingFaculty.id,
      dto.subject_id,
      dto.batch_ids,
      dto.academic_year,
      dto.semester,
    );

    const quiz = await this.prisma.$transaction(async (tx) => {
      const created = await tx.quiz.create({
        data: {
          title: dto.title,
          subjectId: dto.subject_id,
          createdByFacultyId: actingFaculty.id,
          academicYear: dto.academic_year,
          semester: dto.semester,
          durationMinutes: dto.duration_minutes,
          studentCount: dto.student_count,
          instructions: dto.instructions,
          quizType: dto.quiz_type,
          preferredDate: this.toDate(dto.preferred_date),
          preferredTime: this.toTime(dto.preferred_time),
        },
      });

      await tx.quizBatch.createMany({
        data: dto.batch_ids.map((batchId) => ({ quizId: created.id, batchId })),
      });

      await this.auditHook.record(
        {
          actor,
          action: 'CREATE',
          entityType: 'Quiz',
          entityId: created.id,
          newValue: created,
        },
        tx,
      );

      return created;
    });

    return quiz;
  }

  /** Unscoped lookup — used internally and by ADMIN-facing paths. */
  async findById(id: string): Promise<Quiz> {
    const quiz = await this.prisma.quiz.findUnique({ where: { id } });
    if (!quiz) {
      throw new NotFoundException();
    }
    return quiz;
  }

  /** `GET /quizzes/{id}` — ADMIN or owner/co-instructor FACULTY (404-not-403, IDOR-safe). */
  async findByIdScoped(id: string, actor: AuthenticatedUser): Promise<QuizDetail> {
    const quiz = await this.accessRepository.findScoped(id, actor);

    const attachment = await this.prisma.examSessionQuiz.findFirst({
      where: { quizId: id, isActiveAttachment: true },
      select: {
        examSession: {
          select: {
            id: true,
            status: true,
            allocatedRooms: { select: { allocatedCapacity: true, room: true } },
          },
        },
      },
    });

    const examSession = attachment
      ? {
          id: attachment.examSession.id,
          status: attachment.examSession.status,
          rooms: attachment.examSession.allocatedRooms.map((r) => ({
            id: r.room.id,
            building: r.room.building,
            floor: r.room.floor,
            roomNumber: r.room.roomNumber,
            capacity: r.room.capacity,
            allocatedCapacity: r.allocatedCapacity,
          })),
        }
      : null;

    const holds = await this.roomHolds.activeHoldsForQuiz(this.prisma, id);
    const roomHolds: QuizRoomHold[] = holds.map((h) => ({
      roomId: h.roomId,
      kind: h.kind,
      seatsHeld: h.seatsHeld,
      holdDate: h.holdDate,
      startTime: h.startTime,
      endTime: h.endTime,
    }));

    return { ...quiz, examSession, roomHolds };
  }

  async getBatchIds(quizId: string): Promise<string[]> {
    const rows = await this.prisma.quizBatch.findMany({ where: { quizId }, select: { batchId: true } });
    return rows.map((r) => r.batchId);
  }

  /**
   * `GET /quizzes` — "scoped by role". ADMIN sees everything (subject to
   * the optional status/subject_id/faculty_id filters). FACULTY sees only
   * quizzes they own or co-instruct (BR-046) — any faculty_id filter they
   * pass is ignored rather than trusted, since honoring it would let a
   * faculty probe another faculty's quiz list by id.
   */
  async list(params: ListQuizzesParams, actor: AuthenticatedUser): Promise<PaginatedResult<QuizWithSchedule>> {
    const limit = resolveLimit(params.limit);
    const isAdmin = actor.roles.includes(ROLE.ADMIN);

    let scopeWhere: Prisma.QuizWhereInput = {};
    if (!isAdmin) {
      const actingFaculty = await this.requireActingFaculty(actor);
      const coInstructorAssignments = await this.prisma.facultySubjectBatchAssignment.findMany({
        where: { facultyId: actingFaculty.id, role: 'CO_INSTRUCTOR', endedAt: null },
        select: { subjectId: true, batchId: true },
      });

      scopeWhere = {
        OR: [
          { createdByFacultyId: actingFaculty.id },
          ...coInstructorAssignments.map(({ subjectId, batchId }) => ({
            subjectId,
            batches: { some: { batchId } },
          })),
        ],
      };
    }

    const where: Prisma.QuizWhereInput = {
      AND: [
        scopeWhere,
        {
          status: params.status,
          subjectId: params.subjectId,
          ...(isAdmin && params.facultyId ? { createdByFacultyId: params.facultyId } : {}),
        },
      ],
    };

    const rows = await this.prisma.quiz.findMany({
      ...cursorFindManyArgs(params.cursor, limit),
      where,
      orderBy: { createdAt: 'asc' },
    });

    const attachments = rows.length
      ? await this.prisma.examSessionQuiz.findMany({
          where: { quizId: { in: rows.map((q) => q.id) }, isActiveAttachment: true },
          select: { quizId: true, examSession: { select: { id: true, status: true } } },
        })
      : [];
    const examSessionByQuizId = new Map(attachments.map((a) => [a.quizId, a.examSession]));

    const enriched: QuizWithSchedule[] = rows.map((q) => ({ ...q, examSession: examSessionByQuizId.get(q.id) ?? null }));

    return toPaginatedResult(enriched, limit);
  }

  /**
   * `PATCH /quizzes/{id}` — FACULTY owner/co-instructor only (contract
   * does not grant ADMIN this endpoint — enforced at the controller via
   * `@Roles(FACULTY)`, not repeated here). Requires the caller's
   * last-known `version` (BR-051); a mismatch is 409, never a silent
   * overwrite. Editable in DRAFT (Phase 6) and now REJECTED (Phase 7,
   * FR-021: "Faculty may edit a REJECTED quiz and resubmit") — still
   * locked for SUBMITTED and APPROVED, since no field-level lock list is
   * specified anywhere in the docs for those states and inventing one
   * would be exactly the kind of undocumented business rule this project
   * avoids.
   */
  async update(
    id: string,
    dto: UpdateQuizDto,
    ifMatchVersion: number,
    actor: AuthenticatedUser,
  ): Promise<Quiz> {
    const existing = await this.findById(id);

    if (!(await this.ownershipService.isOwnerOrCoInstructor(existing, actor))) {
      throw new NotFoundException(); // IDOR-safe — mirrors every other resource-level check in this codebase.
    }

    if (existing.status !== QuizStatus.DRAFT && existing.status !== QuizStatus.REJECTED) {
      throw new ConflictException(
        `Quiz is in status "${existing.status}" and can only be edited while DRAFT or REJECTED.`,
      );
    }

    if (existing.version !== ifMatchVersion) {
      throw new ConflictException('Quiz has been modified since it was last read (version mismatch).');
    }

    const targetSubjectId = dto.subject_id ?? existing.subjectId;
    const targetBatchIds = dto.batch_ids ?? (await this.getBatchIds(id));

    if (dto.subject_id) {
      await this.subjectsService.findById(dto.subject_id);
    }
    if (dto.batch_ids) {
      for (const batchId of dto.batch_ids) {
        await this.batchesService.findById(batchId);
      }
    }
    if (dto.subject_id || dto.batch_ids) {
      // Re-authorize the (possibly new) subject/batch targeting against
      // whichever faculty is making this specific edit — see
      // quiz-ownership.service.ts's note on why this applies to the actor,
      // not necessarily the original creator.
      const actingFaculty = await this.requireActingFaculty(actor);
      await this.assertAssignedToAll(
        actingFaculty.id,
        targetSubjectId,
        targetBatchIds,
        existing.academicYear,
        existing.semester,
      );
    }

    const quiz = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.quiz.update({
        where: { id },
        data: {
          title: dto.title,
          subjectId: dto.subject_id,
          academicYear: dto.academic_year,
          semester: dto.semester,
          durationMinutes: dto.duration_minutes,
          studentCount: dto.student_count,
          instructions: dto.instructions,
          quizType: dto.quiz_type,
          preferredDate: this.toDate(dto.preferred_date),
          preferredTime: this.toTime(dto.preferred_time),
          version: { increment: 1 },
        },
      });

      if (dto.batch_ids) {
        await tx.quizBatch.deleteMany({ where: { quizId: id } });
        await tx.quizBatch.createMany({
          data: dto.batch_ids.map((batchId) => ({ quizId: id, batchId })),
        });
      }

      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'Quiz',
          entityId: updated.id,
          oldValue: existing,
          newValue: updated,
        },
        tx,
      );

      return updated;
    });

    return quiz;
  }

  /**
   * `POST /quizzes/{id}/submit` — FACULTY **owner only** (not
   * co-instructor — the contract's Auth column for this specific endpoint
   * says "FACULTY (owner)", a narrower grant than PATCH/GET's
   * owner-or-co-instructor). Re-validates BR-010 ("re-validated at both
   * creation AND submission time, since assignment may have changed") and
   * enforces completeness (422) before transitioning to SUBMITTED.
   *
   * Phase 7 extends this to also accept a REJECTED quiz (FR-021
   * resubmission — DEC-003, formally still OPEN but implemented per its
   * own documented "(A) unlimited resubmissions" v1 recommendation, the
   * same way this codebase has treated other OPEN-but-recommended
   * decisions in prior phases; PRD.md FR-021 cross-references this as
   * "DEC-011", which is actually about QR attendance — a documentation
   * cross-reference slip, not a different decision). The resulting
   * `quiz_approval_history` action is `SUBMITTED` when coming from DRAFT
   * and `RESUBMITTED` when coming from REJECTED — same target status
   * (SUBMITTED) either way.
   */
  async submit(id: string, actor: AuthenticatedUser): Promise<Quiz> {
    const existing = await this.findById(id);
    const actingFaculty = await this.requireActingFaculty(actor);

    if (existing.createdByFacultyId !== actingFaculty.id) {
      // Deliberately 403, not 404, here: unlike GET/PATCH (which hide
      // existence from an unrelated faculty), a co-instructor legitimately
      // knows this quiz exists (they can view/edit it) — the contract's
      // own wording is "403 reauthorization fails", not a 404, for this
      // specific endpoint.
      throw new ForbiddenException('Only the quiz\'s creating faculty may submit it.');
    }

    if (existing.status !== QuizStatus.DRAFT && existing.status !== QuizStatus.REJECTED) {
      throw new ConflictException(
        `Quiz is in status "${existing.status}" and cannot be submitted from this state.`,
      );
    }

    const batchIds = await this.getBatchIds(id);
    const stillAssigned = await this.assertAssignedToAll(
      actingFaculty.id,
      existing.subjectId,
      batchIds,
      existing.academicYear,
      existing.semester,
      /* throwOnFailure */ false,
    );
    if (!stillAssigned) {
      throw new ForbiddenException(
        'Faculty is no longer assigned to one or more of this quiz\'s subject/batch pairs.',
      );
    }

    const missingFields = this.findMissingRequiredFields(existing);
    if (missingFields.length > 0) {
      throw new UnprocessableEntityException(
        `Quiz is missing required fields before it can be submitted: ${missingFields.join(', ')}.`,
      );
    }

    const quiz = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.quiz.update({
        where: { id },
        data: { status: QuizStatus.SUBMITTED, version: { increment: 1 } },
      });

      await this.approvalHistoryService.record(
        {
          quizId: updated.id,
          action: existing.status === QuizStatus.REJECTED ? 'RESUBMITTED' : 'SUBMITTED',
          actorId: actor.id,
          previousStatus: existing.status,
          newStatus: QuizStatus.SUBMITTED,
        },
        tx,
      );

      // Admin previously had no notification-feed signal that a quiz
      // needs review — only a live "Pending Quiz Approvals" dashboard
      // counter, nothing in the inbox — same "notify every ADMIN" pattern
      // IncidentsService.notifyAdmins already established for BR-038.
      await this.notifyAdmins(tx, updated);

      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'Quiz',
          entityId: updated.id,
          oldValue: existing,
          newValue: updated,
        },
        tx,
      );

      return updated;
    });

    return quiz;
  }

  /** The admin's note about the room request, saved atomically with the decision; no note given leaves the existing one untouched. */
  private roomNoteData(note?: string): { roomAdjustmentNote?: string } {
    const trimmed = note?.trim();
    return trimmed ? { roomAdjustmentNote: trimmed } : {};
  }

  /**
   * `POST /quizzes/{id}/approve` — ADMIN only (role-level, via
   * `@Roles(ADMIN)` at the controller). Requires the caller's last-known
   * `version` via `If-Match`, same mechanism as PATCH — EC-047: "the
   * approve action must include the version the admin was viewing; if the
   * quiz changed since ... the approve request 409s rather than approving
   * unseen content." Quiz must be SUBMITTED.
   *
   * BR-014, defense in depth beyond the role gate: even an ADMIN who is
   * ALSO (via some other account state) the quiz's creating faculty is
   * blocked — "no self-approval path exists, not just discouraged."
   */
  async approve(id: string, ifMatchVersion: number, actor: AuthenticatedUser, roomNote?: string): Promise<Quiz> {
    const existing = await this.findById(id);
    await this.assertNotSelfReview(existing, actor);

    if (existing.status !== QuizStatus.SUBMITTED) {
      throw new ConflictException(`Quiz is in status "${existing.status}" and cannot be approved.`);
    }
    if (existing.version !== ifMatchVersion) {
      throw new ConflictException('Quiz has been modified since it was last read (version mismatch).');
    }

    const owningFaculty = await this.facultyService.findById(existing.createdByFacultyId);

    const quiz = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.quiz.update({
        where: { id },
        data: { status: QuizStatus.APPROVED, version: { increment: 1 }, ...this.roomNoteData(roomNote) },
      });

      // Approval keeps the requested rooms' seats free for this quiz's exam window until a session allocates them.
      // If another quiz already holds those seats this throws 409 and the whole approval rolls back — swap a room, then approve.
      await this.roomHolds.placeForApprovedQuiz(tx, updated);

      await this.approvalHistoryService.record(
        {
          quizId: updated.id,
          action: QuizApprovalAction.APPROVED,
          actorId: actor.id,
          previousStatus: existing.status,
          newStatus: QuizStatus.APPROVED,
        },
        tx,
      );

      await this.notificationsOutbox.queue(tx, {
        recipientType: NotificationRecipientType.FACULTY,
        recipientId: owningFaculty.userId,
        eventType: NotificationEventType.QUIZ_APPROVED,
        entityId: updated.id,
        entityVersion: updated.version,
        payload: { quiz_id: updated.id, quiz_title: updated.title },
      });

      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'Quiz',
          entityId: updated.id,
          oldValue: existing,
          newValue: updated,
        },
        tx,
      );

      return updated;
    });

    return quiz;
  }

  /**
   * `POST /quizzes/{id}/reject` — ADMIN only. `reason` is required
   * (422, not the ValidationPipe's usual 400 — API_CONTRACT.md literally
   * specifies 422 for this failure, so `reason` is optional at the DTO
   * shape level and checked here instead; BR-012 is additionally enforced
   * at the DB level via a CHECK constraint on `quiz_approval_history` —
   * see that table's schema comment — so this is defense in depth, not
   * the only layer). No `version`/`If-Match` requirement here:
   * API_CONTRACT.md's reject row lists only "422 missing reason", unlike
   * approve's row which explicitly lists the 409 version-mismatch
   * behavior — a deliberate, literal reading of the two rows' genuinely
   * different documented error sets, not an oversight.
   *
   * Same BR-014 self-review defense-in-depth as approve — the rule's
   * spirit ("faculty cannot approve their own quiz") plausibly extends to
   * "cannot make any approval-workflow decision on their own quiz",
   * applied symmetrically here.
   */
  async reject(id: string, dto: RejectQuizDto, actor: AuthenticatedUser): Promise<Quiz> {
    const existing = await this.findById(id);
    await this.assertNotSelfReview(existing, actor);

    if (existing.status !== QuizStatus.SUBMITTED) {
      throw new ConflictException(`Quiz is in status "${existing.status}" and cannot be rejected.`);
    }
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new UnprocessableEntityException('A rejection reason is required (BR-012).');
    }

    const owningFaculty = await this.facultyService.findById(existing.createdByFacultyId);

    const quiz = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.quiz.update({
        where: { id },
        data: { status: QuizStatus.REJECTED, version: { increment: 1 }, ...this.roomNoteData(dto.room_note) },
      });

      await this.approvalHistoryService.record(
        {
          quizId: updated.id,
          action: QuizApprovalAction.REJECTED,
          actorId: actor.id,
          reason: dto.reason,
          previousStatus: existing.status,
          newStatus: QuizStatus.REJECTED,
        },
        tx,
      );

      await this.notificationsOutbox.queue(tx, {
        recipientType: NotificationRecipientType.FACULTY,
        recipientId: owningFaculty.userId,
        eventType: NotificationEventType.QUIZ_REJECTED,
        entityId: updated.id,
        entityVersion: updated.version,
        payload: { quiz_id: updated.id, quiz_title: updated.title, reason: dto.reason },
      });

      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'Quiz',
          entityId: updated.id,
          oldValue: existing,
          newValue: updated,
          reason: dto.reason,
        },
        tx,
      );

      return updated;
    });

    return quiz;
  }

  /**
   * `GET /quizzes/{id}/approval-history` — ADMIN, or the **owning**
   * FACULTY specifically (API_CONTRACT.md's literal wording is "owning
   * FACULTY", narrower than GET/PATCH's owner-or-co-instructor rule — a
   * co-instructor does not get visibility into the approval decision
   * trail here). 404, not 403, for anyone else — IDOR-safe, consistent
   * with every other resource-level check in this codebase.
   */
  async getApprovalHistory(id: string, actor: AuthenticatedUser): Promise<QuizApprovalHistory[]> {
    const quiz = await this.findById(id);
    const isAdmin = actor.roles.includes(ROLE.ADMIN);

    if (!isAdmin) {
      const actingFaculty = await this.facultyService.findByUserId(actor.id);
      if (!actingFaculty || quiz.createdByFacultyId !== actingFaculty.id) {
        throw new NotFoundException();
      }
    }

    return this.approvalHistoryService.listForQuiz(id);
  }

  /** BR-014's defense-in-depth check, shared by approve and reject. */
  private async assertNotSelfReview(quiz: Quiz, actor: AuthenticatedUser): Promise<void> {
    const actingFaculty = await this.facultyService.findByUserId(actor.id);
    if (actingFaculty && quiz.createdByFacultyId === actingFaculty.id) {
      throw new ForbiddenException('An approval decision cannot be made by the quiz\'s own creator.');
    }
  }

  /**
   * Prisma requires a full ISO-8601 value (a JS Date) for a `@db.Date`
   * column, not a bare "YYYY-MM-DD" string, even though that's all the
   * column itself stores — passing the raw class-validator-approved
   * `@IsDateString()` string through directly throws
   * `PrismaClientValidationError: premature end of input` at request time
   * (a real bug this phase's e2e suite caught, not just typechecked around).
   */
  private toDate(dateStr: string | undefined): Date | undefined {
    return dateStr ? new Date(`${dateStr}T00:00:00Z`) : undefined;
  }

  private toTime(timeStr: string | undefined): Date | undefined {
    return timeStr ? new Date(`1970-01-01T${timeStr}Z`) : undefined;
  }

  private findMissingRequiredFields(quiz: Quiz): string[] {
    const missing: string[] = [];
    if (quiz.durationMinutes === null) missing.push('duration_minutes');
    if (quiz.studentCount === null) missing.push('student_count');
    if (quiz.quizType === null) missing.push('quiz_type');
    if (quiz.preferredDate === null) missing.push('preferred_date');
    if (quiz.preferredTime === null) missing.push('preferred_time');
    return missing;
  }

  private async requireActingFaculty(actor: AuthenticatedUser) {
    const faculty = await this.facultyService.findByUserId(actor.id);
    if (!faculty) {
      throw new ForbiddenException('This action requires an active faculty account.');
    }
    return faculty;
  }

  /** Overload-style helper: throws 403 by default, or returns a boolean when `throwOnFailure` is false. */
  private async assertAssignedToAll(
    facultyId: string,
    subjectId: string,
    batchIds: string[],
    academicYear: string,
    semester: number,
    throwOnFailure = true,
  ): Promise<boolean> {
    for (const batchId of batchIds) {
      const assigned = await this.facultyAssignmentsService.hasActiveAssignment(
        facultyId,
        subjectId,
        batchId,
        academicYear,
        semester,
      );
      if (!assigned) {
        if (throwOnFailure) {
          // Human-readable, not raw UUIDs — this message is shown verbatim
          // to the faculty member (frontend's specificForbiddenMessage()
          // opts this specific 403 out of the app's generic "access
          // denied" text), so it needs to actually help them fix their own
          // input, not just repeat back ids they didn't type themselves.
          const [subject, batch] = await Promise.all([
            this.subjectsService.findById(subjectId),
            this.batchesService.findById(batchId),
          ]);
          throw new ForbiddenException(
            `You are not assigned to teach "${subject.code} — ${subject.name}" for batch ` +
              `"${batch.section}/${batch.subsection} (${batch.year})" in ${academicYear}, semester ${semester}.`,
          );
        }
        return false;
      }
    }
    return true;
  }

  /** Fans out an immediate notification to every ADMIN user — same pattern as `IncidentsService.notifyAdmins` (BR-038). */
  private async notifyAdmins(tx: Prisma.TransactionClient, quiz: Quiz): Promise<void> {
    const admins = await tx.user.findMany({
      where: { roles: { some: { role: { name: ROLE.ADMIN } } } },
      select: { id: true },
    });
    for (const admin of admins) {
      await this.notificationsOutbox.queue(tx, {
        recipientType: NotificationRecipientType.ADMIN,
        recipientId: admin.id,
        eventType: NotificationEventType.QUIZ_SUBMITTED,
        entityId: quiz.id,
        entityVersion: quiz.version,
        payload: { quiz_id: quiz.id, quiz_title: quiz.title },
      });
    }
  }
}
