import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  Incident,
  IncidentAction,
  IncidentHistory,
  IncidentSeverity,
  IncidentStatus,
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
import { ExamSessionsService } from '../exam-session';
import { FacultyService } from '../faculty';
import { StudentsService } from '../students';
import { RoomsService } from '../rooms';
import { QuizzesService } from '../quiz';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { UpdateIncidentStatusDto } from './dto/update-incident-status.dto';

export interface ListIncidentsParams {
  cursor?: string;
  limit?: number;
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  examSessionId?: string;
}

/** Valid `(action, fromStatuses)` pairs — the exact graph from ARCHITECTURE.md §AD-2 #6: `OPEN -> UNDER_REVIEW -> {RESOLVED, DISMISSED, ESCALATED}`; `ESCALATED -> UNDER_REVIEW` (re-review). RESOLVED/DISMISSED are terminal — no action moves out of them ("no reopen path exists by design", EC-031). */
const VALID_FROM_STATUSES: Record<IncidentAction, IncidentStatus[]> = {
  [IncidentAction.CREATE]: [], // not a client-invokable action — see UpdateIncidentStatusDto's own comment
  [IncidentAction.INVESTIGATE]: [IncidentStatus.OPEN, IncidentStatus.ESCALATED],
  [IncidentAction.ESCALATE]: [IncidentStatus.UNDER_REVIEW],
  [IncidentAction.RESOLVE]: [IncidentStatus.UNDER_REVIEW],
  [IncidentAction.DISMISS]: [IncidentStatus.UNDER_REVIEW],
};

const ACTION_TARGET_STATUS: Record<IncidentAction, IncidentStatus | null> = {
  [IncidentAction.CREATE]: IncidentStatus.OPEN,
  [IncidentAction.INVESTIGATE]: IncidentStatus.UNDER_REVIEW,
  [IncidentAction.ESCALATE]: IncidentStatus.ESCALATED,
  [IncidentAction.RESOLVE]: IncidentStatus.RESOLVED,
  [IncidentAction.DISMISS]: IncidentStatus.DISMISSED,
};

/**
 * Owns `incidents` + `incident_history` (ARCHITECTURE.md §Z/§AA/§AD-2 #6,
 * IMPLEMENTATION_PLAN.md Phase 18: "incident CRUD, workflow, severity,
 * escalation").
 *
 * BR-037 authorization (create): the acting faculty must hold an
 * `exam_invigilators` row for the incident's `exam_session_id` — and, if
 * the incident names a specific room (directly via `room_id`, or
 * implicitly via `seat_id`), for THAT room specifically. Mirrors
 * `AttendanceService`'s own invigilator-of-record check (Phase 17,
 * `requireInvigilatorOfRecord`), applied here to the more general
 * "assigned to the relevant session/room" wording BR-037 uses.
 *
 * BR-041/ADR-007 (DEC-009): nothing in this class ever returns incident
 * data to a STUDENT actor — `list`/`getHistory` are ADMIN/FACULTY-only by
 * construction (role-gated at the controller AND scoped here), and no
 * student-facing read path exists anywhere in this phase. `disclose()`
 * only flips `disclosed_at`/`disclosed_by_admin_id` for a future phase to
 * consult — it never notifies the student and is never called by any
 * other code path in this class (ships inert, per that ADR).
 */
@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly notificationsOutbox: NotificationsOutboxService,
    private readonly examSessionsService: ExamSessionsService,
    private readonly facultyService: FacultyService,
    private readonly studentsService: StudentsService,
    private readonly roomsService: RoomsService,
    private readonly quizzesService: QuizzesService,
  ) {}

  /**
   * `POST /incidents` (FACULTY). EC-029: NOT gated by exam session status
   * (unlike attendance's BR-032) — a session need only EXIST, it may be
   * DRAFT, COMPLETED, or even CANCELLED (historical incidents can be
   * filed retroactively; nothing in BUSINESS_RULES.md or EDGE_CASES.md
   * blocks this the way BR-036 blocks attendance on a cancelled session).
   */
  async create(dto: CreateIncidentDto, actor: AuthenticatedUser): Promise<Incident> {
    await this.examSessionsService.findById(dto.exam_session_id); // 404 if the session doesn't exist; EC-029 — no status check beyond existence

    const actingFaculty = await this.facultyService.findByUserId(actor.id);
    if (!actingFaculty) {
      throw new ForbiddenException('Only an assigned Faculty/Invigilator may file an incident (BR-037).');
    }

    if (dto.quiz_id) {
      await this.quizzesService.findById(dto.quiz_id);
    }
    if (dto.student_id) {
      await this.studentsService.findById(dto.student_id);
    }
    if (dto.room_id) {
      await this.roomsService.findById(dto.room_id);
    }
    let seat: { id: string; roomId: string } | null = null;
    if (dto.seat_id) {
      seat = await this.prisma.roomSeat.findUnique({ where: { id: dto.seat_id }, select: { id: true, roomId: true } });
      if (!seat) {
        throw new NotFoundException('Seat not found.');
      }
      if (dto.room_id && seat.roomId !== dto.room_id) {
        throw new UnprocessableEntityException('seat_id does not belong to the given room_id.');
      }
    }

    const effectiveRoomId = dto.room_id ?? seat?.roomId;
    await this.requireInvigilatorOfRecord(dto.exam_session_id, effectiveRoomId, actingFaculty.id);

    const created = await this.prisma.$transaction(async (tx) => {
      const incident = await tx.incident.create({
        data: {
          examSessionId: dto.exam_session_id,
          quizId: dto.quiz_id ?? null,
          studentId: dto.student_id ?? null,
          roomId: dto.room_id ?? null,
          seatId: dto.seat_id ?? null,
          reportedByFacultyId: actingFaculty.id,
          incidentType: dto.incident_type,
          severity: dto.severity,
          description: dto.description,
          evidenceMetadata: (dto.evidence_metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      });

      await tx.incidentHistory.create({
        data: {
          incidentId: incident.id,
          actorId: actor.id,
          action: IncidentAction.CREATE,
          oldStatus: null,
          newStatus: IncidentStatus.OPEN,
          notes: null,
        },
      });

      // BR-038: CRITICAL severity triggers an immediate Admin notification
      // at creation time, in the SAME transaction as the write (BR-042
      // outbox discipline) — queued into the critical lane automatically,
      // since INCIDENT_STATUS_UPDATED is already routed there
      // (`common/queue/queue.constants.ts`, pre-sized in Phase 15/16
      // specifically for this caller).
      if (dto.severity === IncidentSeverity.CRITICAL) {
        await this.notifyAdmins(tx, incident, `A CRITICAL incident was reported: ${dto.incident_type}.`);
      }

      await this.auditHook.record(
        {
          actor,
          action: 'CREATE',
          entityType: 'Incident',
          entityId: incident.id,
          newValue: incident,
        },
        tx,
      );

      return incident;
    });

    return created;
  }

  /**
   * `PATCH /incidents/{id}/status` (ADMIN). BR-039: every transition
   * writes an `incident_history` row; `incidents.status` is a cache, not
   * the source of truth. Invalid transitions (e.g. RESOLVED -> anything)
   * 409, never silently accepted or auto-corrected — "no reopen path
   * exists by design" (EC-031).
   */
  async updateStatus(id: string, dto: UpdateIncidentStatusDto, actor: AuthenticatedUser): Promise<Incident> {
    const existing = await this.findById(id);

    const validFrom = VALID_FROM_STATUSES[dto.action];
    if (!validFrom.includes(existing.status)) {
      throw new ConflictException(
        `Incident is in status "${existing.status}" — action "${dto.action}" is not a valid transition from there.`,
      );
    }

    const requiresResolution = dto.action === IncidentAction.RESOLVE || dto.action === IncidentAction.DISMISS;
    if (requiresResolution && !dto.resolution) {
      throw new UnprocessableEntityException(
        `A "resolution" is required for the ${dto.action} action (BR-039/API_CONTRACT.md).`,
      );
    }

    const newStatus = ACTION_TARGET_STATUS[dto.action] as IncidentStatus;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.incident.update({
        where: { id },
        data: {
          status: newStatus,
          ...(requiresResolution
            ? { resolution: dto.resolution, resolvedByAdminId: actor.id, resolvedAt: new Date() }
            : {}),
        },
      });

      await tx.incidentHistory.create({
        data: {
          incidentId: id,
          actorId: actor.id,
          action: dto.action,
          oldStatus: existing.status,
          newStatus,
          notes: dto.notes ?? null,
        },
      });

      // ARCHITECTURE.md §AA/§Z's escalation rule + EC-030: an explicit
      // ESCALATE always triggers the same immediate Admin notification
      // CRITICAL severity does at creation, regardless of the incident's
      // own severity value.
      if (dto.action === IncidentAction.ESCALATE) {
        await this.notifyAdmins(tx, row, `Incident escalated: ${existing.incidentType}.`);
      }

      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'Incident',
          entityId: id,
          oldValue: { status: existing.status },
          newValue: { status: row.status },
          reason: dto.resolution ?? dto.notes,
        },
        tx,
      );

      return row;
    });

    return updated;
  }

  /**
   * `GET /incidents` — ADMIN (all), FACULTY (own reported only). STUDENT
   * has no access at all (no `@Roles` combination that includes STUDENT
   * is ever wired to this method's controller route — BR-041).
   */
  async list(actor: AuthenticatedUser, params: ListIncidentsParams): Promise<PaginatedResult<Incident>> {
    const isAdmin = actor.roles.includes(ROLE.ADMIN);
    let reportedByFacultyId: string | undefined;
    if (!isAdmin) {
      const actingFaculty = await this.facultyService.findByUserId(actor.id);
      // No faculty account -> no reported incidents; matches
      // `AttendanceService.listForSession`'s "empty page, not an error"
      // posture for a relationship-scoped list with nothing to show.
      reportedByFacultyId = actingFaculty?.id ?? '00000000-0000-0000-0000-000000000000';
    }

    const limit = resolveLimit(params.limit);
    const rows = await this.prisma.incident.findMany({
      where: {
        ...(reportedByFacultyId ? { reportedByFacultyId } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.severity ? { severity: params.severity } : {}),
        ...(params.examSessionId ? { examSessionId: params.examSessionId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      ...cursorFindManyArgs(params.cursor, limit),
    });
    return toPaginatedResult(rows, limit);
  }

  /** `GET /incidents/{id}/history` (ADMIN only, per API_CONTRACT.md). */
  async getHistory(id: string): Promise<IncidentHistory[]> {
    await this.findById(id);
    return this.prisma.incidentHistory.findMany({
      where: { incidentId: id },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * `POST /incidents/{id}/disclose` (ADMIN only) — ADR-007's explicit,
   * per-incident, admin-triggered disclosure capability (DEC-009). Ships
   * INERT per that ADR: this is the only place `disclosed_at`/
   * `disclosed_by_admin_id` are ever set, nothing calls this
   * automatically, and it never queues a notification — DEC-009 (whether
   * this capability should ever actually be exercised, by whom, and
   * under what trigger) remains an OPEN policy question the codebase
   * must not silently decide. Idempotent: re-disclosing an
   * already-disclosed incident is a no-op success, not an error.
   */
  async disclose(id: string, actor: AuthenticatedUser): Promise<Incident> {
    const existing = await this.findById(id);
    if (existing.disclosedAt) {
      return existing;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.incident.update({
        where: { id },
        data: { disclosedAt: new Date(), disclosedByAdminId: actor.id },
      });

      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'Incident',
          entityId: id,
          oldValue: { disclosedAt: null },
          newValue: { disclosedAt: row.disclosedAt },
        },
        tx,
      );

      return row;
    });

    return updated;
  }

  async findById(id: string): Promise<Incident> {
    const incident = await this.prisma.incident.findUnique({ where: { id } });
    if (!incident) {
      throw new NotFoundException();
    }
    return incident;
  }

  /**
   * BR-037: the acting faculty must be an invigilator for `examSessionId`
   * — and, if `roomId` is known (explicit or derived from `seat_id`),
   * specifically for that room. 403, not 404 — a real authorization
   * failure on an authenticated, correctly-roled FACULTY, same posture as
   * `AttendanceService.requireInvigilatorOfRecord`.
   */
  private async requireInvigilatorOfRecord(
    examSessionId: string,
    roomId: string | undefined,
    facultyId: string,
  ): Promise<void> {
    const invigilatorRow = await this.prisma.examInvigilator.findFirst({
      where: { examSessionId, facultyId, ...(roomId ? { roomId } : {}) },
      select: { facultyId: true },
    });
    if (!invigilatorRow) {
      throw new ForbiddenException('Only an assigned Faculty/Invigilator for this session/room may file an incident (BR-037).');
    }
  }

  /** Fans out an immediate, critical-lane notification to every ADMIN user (BR-038). */
  private async notifyAdmins(tx: Prisma.TransactionClient, incident: Incident, message: string): Promise<void> {
    const admins = await tx.user.findMany({
      where: { roles: { some: { role: { name: ROLE.ADMIN } } } },
      select: { id: true },
    });
    for (const admin of admins) {
      await this.notificationsOutbox.queue(tx, {
        recipientType: NotificationRecipientType.ADMIN,
        recipientId: admin.id,
        eventType: NotificationEventType.INCIDENT_STATUS_UPDATED,
        entityId: incident.id,
        entityVersion: incident.status,
        payload: {
          incident_id: incident.id,
          exam_session_id: incident.examSessionId,
          severity: incident.severity,
          status: incident.status,
          message,
        },
      });
    }
  }
}
