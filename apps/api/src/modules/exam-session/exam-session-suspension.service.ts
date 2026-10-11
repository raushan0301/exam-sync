import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ExamSessionSuspensionRequest,
  NotificationEventType,
  NotificationRecipientType,
  Prisma,
  SuspensionRequestStatus,
} from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';
import { NotificationsOutboxService } from '../../common/notifications-outbox/notifications-outbox.service';
import {
  cursorFindManyArgs,
  PaginatedResult,
  resolveLimit,
  toPaginatedResult,
} from '../../common/pagination/paginate';
import { FacultyService } from '../faculty';
import { ExamSessionsService, NON_CANCELLABLE_STATUSES } from './exam-sessions.service';
import { ExamSessionOwnershipService } from './exam-session-ownership.service';
import { RequestSuspensionDto } from './dto/request-suspension.dto';
import { ApproveSuspensionDto, RejectSuspensionDto } from './dto/review-suspension.dto';

export interface ListSuspensionRequestsParams {
  cursor?: string;
  limit?: number;
  status?: SuspensionRequestStatus;
  examSessionId?: string;
}

/** A request plus the display labels a reviewer needs, so the UI never shows raw ids. */
export interface SuspensionRequestView extends ExamSessionSuspensionRequest {
  examSessionName: string;
  examSessionDate: Date;
  examSessionStartTime: Date;
  examSessionEndTime: Date;
  examSessionStatus: string;
  facultyName: string;
  facultyEmployeeCode: string;
}

/**
 * Suspension = cancellation behind an approval gate. A faculty owner/co-
 * instructor REQUESTS it with a written reason; an ADMIN approves (which runs
 * `ExamSessionsService.cancelSession` — releasing every quiz, room, invigilator
 * and seating plan, notifying students, and moving the session to History as
 * CANCELLED — in the SAME transaction that marks the request APPROVED) or
 * rejects it with a note (the session is untouched). Faculty no longer cancel
 * directly.
 */
@Injectable()
export class ExamSessionSuspensionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly notificationsOutbox: NotificationsOutboxService,
    private readonly examSessionsService: ExamSessionsService,
    private readonly ownershipService: ExamSessionOwnershipService,
    private readonly facultyService: FacultyService,
  ) {}

  /** `POST /exam-sessions/{id}/suspension-request` (FACULTY, owner/co-instructor only). */
  async request(examSessionId: string, dto: RequestSuspensionDto, actor: AuthenticatedUser): Promise<ExamSessionSuspensionRequest> {
    const session = await this.examSessionsService.findById(examSessionId);
    const faculty = await this.facultyService.findByUserId(actor.id);
    if (!faculty) {
      throw new ForbiddenException('Only a faculty member can request a session suspension.');
    }
    if (!(await this.ownershipService.isOwnerOrCoInstructor(examSessionId, actor))) {
      throw new NotFoundException(); // IDOR-safe — same convention as every other owner-gated session action.
    }
    if (NON_CANCELLABLE_STATUSES.includes(session.status)) {
      throw new ConflictException(`Exam session is in status "${session.status}" and cannot be suspended.`);
    }

    const pending = await this.prisma.examSessionSuspensionRequest.findFirst({
      where: { examSessionId, status: SuspensionRequestStatus.PENDING },
      select: { id: true },
    });
    if (pending) {
      throw new ConflictException('A suspension request for this session is already waiting for admin review.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.examSessionSuspensionRequest.create({
          data: { examSessionId, requestedByFacultyId: faculty.id, reason: dto.reason.trim() },
        });

        const admins = await tx.user.findMany({
          where: { roles: { some: { role: { name: ROLE.ADMIN } } } },
          select: { id: true },
        });
        for (const admin of admins) {
          await this.notificationsOutbox.queue(tx, {
            recipientType: NotificationRecipientType.ADMIN,
            recipientId: admin.id,
            eventType: NotificationEventType.SUSPENSION_REQUESTED,
            entityId: created.id,
            entityVersion: created.status,
            payload: {
              request_id: created.id,
              session_id: session.id,
              session_name: session.name,
              faculty_name: faculty.name,
              reason: created.reason,
            },
          });
        }

        await this.auditHook.record(
          { actor, action: 'CREATE', entityType: 'ExamSessionSuspensionRequest', entityId: created.id, newValue: created, reason: created.reason },
          tx,
        );
        return created;
      });
    } catch (err) {
      // Two concurrent requests both passed the check above — the partial unique index caught the second.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A suspension request for this session is already waiting for admin review.');
      }
      throw err;
    }
  }

  /** `GET /suspension-requests` — ADMIN sees all, FACULTY only the ones they filed. */
  async list(actor: AuthenticatedUser, params: ListSuspensionRequestsParams): Promise<PaginatedResult<SuspensionRequestView>> {
    let requestedByFacultyId: string | undefined;
    if (!actor.roles.includes(ROLE.ADMIN)) {
      const faculty = await this.facultyService.findByUserId(actor.id);
      // No faculty record -> nothing filed: an empty page, not an error (same posture as incidents).
      requestedByFacultyId = faculty?.id ?? '00000000-0000-0000-0000-000000000000';
    }

    const limit = resolveLimit(params.limit);
    const rows = await this.prisma.examSessionSuspensionRequest.findMany({
      where: {
        ...(requestedByFacultyId ? { requestedByFacultyId } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.examSessionId ? { examSessionId: params.examSessionId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        examSession: { select: { name: true, sessionDate: true, startTime: true, endTime: true, status: true } },
        requestedByFaculty: { select: { name: true, employeeCode: true } },
      },
      ...cursorFindManyArgs(params.cursor, limit),
    });

    const views: SuspensionRequestView[] = rows.map((row) => {
      const { examSession, requestedByFaculty, ...request } = row;
      return {
        ...request,
        examSessionName: examSession.name,
        examSessionDate: examSession.sessionDate,
        examSessionStartTime: examSession.startTime,
        examSessionEndTime: examSession.endTime,
        examSessionStatus: examSession.status,
        facultyName: requestedByFaculty.name,
        facultyEmployeeCode: requestedByFaculty.employeeCode,
      };
    });
    return toPaginatedResult(views, limit);
  }

  /**
   * `POST /suspension-requests/{id}/approve` (ADMIN). Cancels the session AND marks the
   * request APPROVED in one transaction — if the session can no longer be cancelled
   * (it has since started or finished) nothing changes and the admin is told why.
   */
  async approve(id: string, dto: ApproveSuspensionDto, actor: AuthenticatedUser): Promise<ExamSessionSuspensionRequest> {
    const request = await this.findPending(id);
    const note = dto.note?.trim() || null;

    await this.examSessionsService.cancelSession(request.examSessionId, request.reason, actor, async (tx) => {
      const { count } = await tx.examSessionSuspensionRequest.updateMany({
        where: { id, status: SuspensionRequestStatus.PENDING },
        data: { status: SuspensionRequestStatus.APPROVED, reviewedByAdminId: actor.id, reviewNote: note, reviewedAt: new Date() },
      });
      if (count === 0) {
        throw new ConflictException('This suspension request was already reviewed by someone else.');
      }
      await this.notifyFaculty(tx, request, NotificationEventType.SUSPENSION_APPROVED, SuspensionRequestStatus.APPROVED, note);
      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'ExamSessionSuspensionRequest',
          entityId: id,
          oldValue: { status: SuspensionRequestStatus.PENDING },
          newValue: { status: SuspensionRequestStatus.APPROVED },
          reason: note ?? request.reason,
        },
        tx,
      );
    });

    return this.prisma.examSessionSuspensionRequest.findUniqueOrThrow({ where: { id } });
  }

  /** `POST /suspension-requests/{id}/reject` (ADMIN). The session is left exactly as it was. */
  async reject(id: string, dto: RejectSuspensionDto, actor: AuthenticatedUser): Promise<ExamSessionSuspensionRequest> {
    const request = await this.findPending(id);
    const note = dto.note.trim();

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.examSessionSuspensionRequest.updateMany({
        where: { id, status: SuspensionRequestStatus.PENDING },
        data: { status: SuspensionRequestStatus.REJECTED, reviewedByAdminId: actor.id, reviewNote: note, reviewedAt: new Date() },
      });
      if (count === 0) {
        throw new ConflictException('This suspension request was already reviewed by someone else.');
      }
      await this.notifyFaculty(tx, request, NotificationEventType.SUSPENSION_REJECTED, SuspensionRequestStatus.REJECTED, note);
      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'ExamSessionSuspensionRequest',
          entityId: id,
          oldValue: { status: SuspensionRequestStatus.PENDING },
          newValue: { status: SuspensionRequestStatus.REJECTED },
          reason: note,
        },
        tx,
      );
      return tx.examSessionSuspensionRequest.findUniqueOrThrow({ where: { id } });
    });
  }

  private async findPending(id: string) {
    const request = await this.prisma.examSessionSuspensionRequest.findUnique({
      where: { id },
      include: { examSession: { select: { name: true } }, requestedByFaculty: { select: { userId: true, name: true } } },
    });
    if (!request) {
      throw new NotFoundException();
    }
    if (request.status !== SuspensionRequestStatus.PENDING) {
      throw new ConflictException(`This suspension request was already ${request.status.toLowerCase()}.`);
    }
    return request;
  }

  private async notifyFaculty(
    tx: Prisma.TransactionClient,
    request: { id: string; examSessionId: string; examSession: { name: string }; requestedByFaculty: { userId: string } },
    eventType: NotificationEventType,
    status: SuspensionRequestStatus,
    note: string | null,
  ): Promise<void> {
    await this.notificationsOutbox.queue(tx, {
      recipientType: NotificationRecipientType.FACULTY,
      recipientId: request.requestedByFaculty.userId,
      eventType,
      entityId: request.id,
      entityVersion: status,
      payload: {
        request_id: request.id,
        session_id: request.examSessionId,
        session_name: request.examSession.name,
        note,
      },
    });
  }
}
