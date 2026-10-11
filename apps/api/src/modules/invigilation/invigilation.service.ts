import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ExamInvigilator,
  ExamSessionStatus,
  NotificationEventType,
  NotificationRecipientType,
  Prisma,
} from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { NotificationsOutboxService } from '../../common/notifications-outbox/notifications-outbox.service';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';
import {
  cursorFindManyArgs,
  PaginatedResult,
  resolveLimit,
  toPaginatedResult,
} from '../../common/pagination/paginate';
import { ExamSessionsService, ExamSessionOwnershipService } from '../exam-session';
import { FacultyService } from '../faculty';
import { ConflictEngineService } from '../conflict-engine';
import { CreateInvigilatorDto } from './dto/create-invigilator.dto';

export interface ListDutiesParams {
  cursor?: string;
  limit?: number;
}

/**
 * `ExamInvigilator` plus the human-readable bits the frontend needs to
 * display a duty without a separate lookup — an invigilator assigned to
 * someone ELSE's session cannot call `GET /exam-sessions/{id}` themselves
 * (`ExamSessionsAccessRepository` only grants the creating faculty, not
 * co-instructors or invigilators), so this denormalizes the session
 * name/schedule and room label directly onto each row instead.
 */
export interface InvigilatorDuty extends ExamInvigilator {
  examSession: { name: string; sessionDate: Date; startTime: Date; endTime: Date; status: ExamSessionStatus };
  room: { building: string; roomNumber: string };
}

/**
 * Owns `exam_invigilators` (ARCHITECTURE.md §W, IMPLEMENTATION_PLAN.md
 * Phase 16: "exam_invigilators, overlap prevention").
 *
 * BR-030: a faculty member may invigilate any room regardless of subject
 * taught — no subject/batch authorization check exists here, unlike quiz
 * creation (BR-010). The only constraint is BR-020/BR-031 (no faculty
 * double-booked across overlapping session time windows), enforced by
 * `ConflictEngineService.checkInvigilatorAssignment`.
 *
 * No session-status precondition is documented for this action (unlike
 * room allocation's `ASSIGNING_STUDENTS` gate or seating's own status
 * chain) — ARCHITECTURE.md's Exam Session state machine table (§AD-2) has
 * no "assign invigilator" row at all, so invigilator assignment is
 * modeled here as an action orthogonal to the session's own state
 * machine, not one of its transitions. The one guard actually applied —
 * rejecting a CANCELLED session — is a disclosed, narrow addition: nothing
 * documents it explicitly, but assigning a real person's time to a
 * session that can never run is a plain waste with no legitimate use
 * case, and EC-024/§AC's "cascades logically" language for cancelled
 * sessions treats their child records (including invigilators) as
 * already-historical, not as a target for new writes.
 */
@Injectable()
export class InvigilationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly examSessionsService: ExamSessionsService,
    private readonly facultyService: FacultyService,
    private readonly conflictEngine: ConflictEngineService,
    private readonly examSessionOwnershipService: ExamSessionOwnershipService,
    private readonly notificationsOutbox: NotificationsOutboxService,
  ) {}

  /**
   * `POST /exam-sessions/{id}/invigilators` (ADMIN). The target `room_id`
   * must actually be allocated to this session (`exam_session_rooms`) —
   * undocumented as an explicit BR, but the only sensible reading of
   * "invigilator for a room within a session" (FR-035): a room the
   * session never uses cannot meaningfully have an invigilator for it.
   *
   * Concurrency (BR-020/BR-031, EC-014 "checked at insert time, not just
   * initially"): the target FACULTY row is locked (`SELECT ... FOR
   * UPDATE`) before the conflict check runs, inside the same transaction
   * as the insert — mirrors `RoomAllocationService.allocate`'s "lock
   * first, check second, write third" structure (ADR-003 mechanism (a)),
   * with the faculty row standing in for the room row as the thing being
   * serialized on. Locking the faculty row itself (rather than their
   * EXISTING `exam_invigilators` rows, as ARCHITECTURE.md §W's prose
   * literally suggests) is a deliberate refinement: a faculty member's
   * FIRST-ever invigilation assignment has no existing row to lock, so
   * two concurrent first-assignments for the same faculty would both pass
   * an empty-row-set lock and race straight through — locking the parent
   * `faculty` row closes that gap regardless of how many prior
   * assignments exist.
   */
  async assign(
    examSessionId: string,
    dto: CreateInvigilatorDto,
    actor: AuthenticatedUser,
  ): Promise<ExamInvigilator> {
    const session = await this.examSessionsService.findById(examSessionId);
    if (!(await this.examSessionOwnershipService.isOwnerOrCoInstructor(examSessionId, actor))) {
      throw new NotFoundException(); // IDOR-safe — mirrors quizzes.service.ts's own PATCH convention.
    }
    if (session.status === ExamSessionStatus.CANCELLED) {
      throw new ConflictException('This exam session is CANCELLED and cannot receive new invigilator assignments.');
    }

    const assignedFaculty = await this.facultyService.findById(dto.faculty_id);

    const allocatedRoom = await this.prisma.examSessionRoom.findUnique({
      where: { roomId_examSessionId: { roomId: dto.room_id, examSessionId } },
    });
    if (!allocatedRoom) {
      throw new NotFoundException('This room is not allocated to this exam session.');
    }

    const created = await this.prisma
      .$transaction(async (tx) => {
        const lockedFaculty = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM faculty WHERE id = ${dto.faculty_id}::uuid FOR UPDATE`,
        );
        if (lockedFaculty.length === 0) {
          throw new NotFoundException();
        }

        const existing = await tx.examInvigilator.findUnique({
          where: {
            examSessionId_roomId_facultyId: {
              examSessionId,
              roomId: dto.room_id,
              facultyId: dto.faculty_id,
            },
          },
        });
        if (existing) {
          throw new ConflictException('This faculty is already assigned as an invigilator for this room and session.');
        }

        const conflictResult = await this.conflictEngine.checkInvigilatorAssignment(
          {
            facultyId: dto.faculty_id,
            examSessionId,
            roomId: dto.room_id,
            sessionDate: session.sessionDate,
            startTime: session.startTime,
            endTime: session.endTime,
          },
          tx,
        );
        if (conflictResult.hard.length > 0) {
          throw new ConflictException({
            message: 'This faculty is already invigilating an overlapping session (BR-031).',
            details: conflictResult.hard,
          });
        }

        const invigilator = await tx.examInvigilator.create({
          data: {
            examSessionId,
            roomId: dto.room_id,
            facultyId: dto.faculty_id,
            role: dto.role,
          },
        });

        await this.auditHook.record(
          {
            actor,
            action: 'CREATE',
            entityType: 'ExamInvigilator',
            entityId: invigilator.id,
            newValue: invigilator,
          },
          tx,
        );

        // Tell the faculty member (BR-042: same transaction as the assignment, via the outbox).
        await this.notificationsOutbox.queue(tx, {
          recipientType: NotificationRecipientType.FACULTY,
          recipientId: assignedFaculty.userId,
          eventType: NotificationEventType.INVIGILATOR_ASSIGNED,
          entityId: invigilator.id,
          entityVersion: 'ASSIGNED',
          payload: {
            exam_session_id: examSessionId,
            session_name: session.name,
            session_date: session.sessionDate.toISOString().slice(0, 10),
            start_time: session.startTime.toISOString().slice(11, 16),
            end_time: session.endTime.toISOString().slice(11, 16),
            room_label: await this.roomLabel(tx, dto.room_id),
            role: dto.role,
          },
        });

        return invigilator;
      })
      .catch((err) => this.mapUniqueViolation(err));

    // Outside the transaction, same pattern SeatingEngineService uses
    // after validating/finalizing a plan — this assignment may be the
    // LAST piece (every room already had a validated/finalized seating
    // plan, just not an invigilator yet) that makes the session ready to
    // finalize; a no-op read-only check otherwise.
    await this.examSessionsService.maybeAdvanceToReadyForFinalization(examSessionId);

    return created;
  }

  /**
   * `DELETE /exam-sessions/{id}/invigilators/{invigilatorId}` (FACULTY,
   * ownership-gated) — undocumented addition alongside `listForSession`:
   * there was previously no way to change an assignment at all once made
   * (wrong faculty, wrong room, wrong role) short of leaving it wrong.
   * Hard-deletes the row (no soft-delete column on `ExamInvigilator`,
   * unlike e.g. `QuizStudentAssignment`'s CANCELLED status) — the generic
   * audit hook still records the removal. To actually change who's
   * invigilating, the caller removes the wrong assignment then calls
   * `assign` again with the corrected room/faculty/role.
   */
  async remove(examSessionId: string, invigilatorId: string, actor: AuthenticatedUser): Promise<void> {
    const session = await this.examSessionsService.findById(examSessionId);
    if (!(await this.examSessionOwnershipService.isOwnerOrCoInstructor(examSessionId, actor))) {
      throw new NotFoundException(); // IDOR-safe — mirrors quizzes.service.ts's own PATCH convention.
    }

    const invigilator = await this.prisma.examInvigilator.findUnique({
      where: { id: invigilatorId },
      include: { faculty: { select: { userId: true } } },
    });
    if (!invigilator || invigilator.examSessionId !== examSessionId) {
      throw new NotFoundException();
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.examInvigilator.delete({ where: { id: invigilatorId } });
      // AuditAction has no DELETE member (this codebase's audit log is
      // otherwise append-only over soft-deletes/status changes) — UPDATE
      // with a null newValue is the closest honest mapping for this one
      // genuinely hard-deleted row.
      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'ExamInvigilator',
          entityId: invigilatorId,
          oldValue: invigilator,
          newValue: null,
        },
        tx,
      );
      await this.notificationsOutbox.queue(tx, {
        recipientType: NotificationRecipientType.FACULTY,
        recipientId: invigilator.faculty.userId,
        eventType: NotificationEventType.INVIGILATOR_REMOVED,
        entityId: invigilator.id,
        entityVersion: 'REMOVED',
        payload: {
          exam_session_id: examSessionId,
          session_name: session.name,
          room_label: await this.roomLabel(tx, invigilator.roomId),
          cause: 'REMOVED',
        },
      });
    });
  }

  /** "B-107" — the same building-roomNumber label other notifications use. */
  private async roomLabel(tx: Prisma.TransactionClient, roomId: string): Promise<string> {
    const room = await tx.room.findUnique({ where: { id: roomId }, select: { building: true, roomNumber: true } });
    return room ? `${room.building}-${room.roomNumber}` : '';
  }

  /**
   * `GET /exam-sessions/{id}/invigilators` — ADMIN (unscoped) or the
   * owning/co-instructing FACULTY (scoped, via
   * `ExamSessionsService.findByIdScoped` — same rule every other
   * session-scoped GET in this feature uses). Added alongside the
   * faculty-lifecycle-ownership change's own UI work: `InvigilatorPanel`
   * previously had no way to recover its "current assignments" list
   * across a page reload (its own doc comment disclosed this — the
   * assignments were always saved server-side, just never re-listable).
   */
  async listForSession(
    examSessionId: string,
    actor: AuthenticatedUser,
    params: ListDutiesParams,
  ): Promise<PaginatedResult<ExamInvigilator>> {
    await this.examSessionsService.findByIdScoped(examSessionId, actor);

    const limit = resolveLimit(params.limit);
    const rows = await this.prisma.examInvigilator.findMany({
      where: { examSessionId },
      orderBy: { assignedAt: 'desc' },
      ...cursorFindManyArgs(params.cursor, limit),
    });
    return toPaginatedResult(rows, limit);
  }

  /**
   * `GET /faculty/{id}/invigilation-duties` — self (the faculty's own
   * duties) or ADMIN. 404, not 403, for anyone else — same IDOR-safe
   * posture as every other resource-level check in this codebase
   * (`QuizzesService.getApprovalHistory`'s own doc comment describes the
   * identical pattern).
   */
  async listDuties(
    facultyId: string,
    actor: AuthenticatedUser,
    params: ListDutiesParams,
  ): Promise<PaginatedResult<InvigilatorDuty>> {
    const isAdmin = actor.roles.includes(ROLE.ADMIN);
    if (!isAdmin) {
      const actingFaculty = await this.facultyService.findByUserId(actor.id);
      if (!actingFaculty || actingFaculty.id !== facultyId) {
        throw new NotFoundException();
      }
    } else {
      // Still validate the faculty exists for an ADMIN caller, so a
      // nonexistent id 404s rather than silently returning an empty page.
      await this.facultyService.findById(facultyId);
    }

    const limit = resolveLimit(params.limit);
    const rows = await this.prisma.examInvigilator.findMany({
      where: { facultyId },
      orderBy: { assignedAt: 'desc' },
      include: {
        examSession: { select: { name: true, sessionDate: true, startTime: true, endTime: true, status: true } },
        room: { select: { building: true, roomNumber: true } },
      },
      ...cursorFindManyArgs(params.cursor, limit),
    });
    return toPaginatedResult(rows as InvigilatorDuty[], limit);
  }

  /** Maps a concurrent unique-constraint race on `(exam_session_id, room_id, faculty_id)` to a clean 409 — the app-level `existing` check above is the primary UX path; this is the ADR-003-style backstop for the tiny window between that read and the insert. */
  private mapUniqueViolation(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('This faculty is already assigned as an invigilator for this room and session.');
    }
    throw err;
  }
}
