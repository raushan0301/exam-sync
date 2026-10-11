import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ExamSessionRoomRequest,
  ExamSessionStatus,
  NotificationEventType,
  NotificationRecipientType,
  Prisma,
  QuizStudentAssignmentStatus,
  RoomRequestStatus,
  RoomRequestTrigger,
  SeatingPlanStatus,
} from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';
import { NotificationsOutboxService } from '../../common/notifications-outbox/notifications-outbox.service';
import { RoomHoldsService } from '../../common/room-holds/room-holds.service';
import { cursorFindManyArgs, PaginatedResult, resolveLimit, toPaginatedResult } from '../../common/pagination/paginate';
import { FacultyService } from '../faculty';
import { ExamSessionsService, ExamSessionOwnershipService } from '../exam-session';
import { RoomSuggestionService, SuggestedRoom } from './room-suggestion.service';
import { packMixed } from './mixed-room-packing';
import { describeLocation, nearestToExistingPlan, PoolRoom } from './room-suggestion-planner';
import { ApproveRoomRequestDto, CreateRoomRequestDto, RejectRoomRequestByAdminDto } from './dto/room-extension.dto';

/** The re-split writes a lot of rows in one go — same generous limit the cancel transaction uses. */
const APPROVE_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

/** Statuses in which more rooms can still be asked for: seating has started but the session has not been finalized. */
const EXTENDABLE_STATUSES: ExamSessionStatus[] = [ExamSessionStatus.SEATING_GENERATION, ExamSessionStatus.READY_FOR_FINALIZATION];

export interface ListRoomRequestsParams {
  cursor?: string;
  limit?: number;
  status?: RoomRequestStatus;
  examSessionId?: string;
}

export interface RequestedRoomView {
  roomId: string;
  label: string;
  capacity: number;
  /** Seats still free for this session in the exam window (counts only usable seats when empty columns are chosen). */
  freeSeats: number;
  available: boolean;
  reason?: string;
}

export interface SessionRoomView {
  roomId: string;
  label: string;
  allocated: number;
  finalized: boolean;
}

/** A request plus the labels a reviewer needs, so the UI never shows raw ids. */
export interface RoomRequestView extends ExamSessionRoomRequest {
  examSessionName: string;
  examSessionDate: Date;
  examSessionStartTime: Date;
  examSessionEndTime: Date;
  examSessionStatus: string;
  facultyName: string;
  facultyEmployeeCode: string;
  requestedRooms: RequestedRoomView[];
  approvedRoomLabels: string[];
  currentRooms: SessionRoomView[];
  studentsToPlace: number;
}

export interface ExtraRoomsState {
  canRequest: boolean;
  blockedReason: string | null;
  pending: RoomRequestView | null;
  /** The most recent decline, so the faculty member can read why. */
  latestRejected: RoomRequestView | null;
  /** Students who are not in a finalized room (they are the ones who may be re-split). */
  studentsToPlace: number;
  fullSeats: number;
  usableSeats: number;
  emptyColumns: boolean;
  /** Extra seats needed, counting only usable seats when empty columns are chosen. */
  seatsNeeded: number;
  trigger: RoomRequestTrigger;
  rooms: SessionRoomView[];
  suggestion: { rooms: SuggestedRoom[]; location: string; spansBuildings: boolean };
  allRooms: { roomId: string; building: string; floor: number; roomNumber: string; capacity: number }[];
}

interface Analysis {
  sessionRooms: { id: string; roomId: string; createdAt: Date; allocatedCapacity: number; label: string; building: string; floor: number }[];
  finalizedRoomIds: Set<string>;
  finalizedStudents: { studentId: string; quizId: string; roomId: string }[];
  totalAssigned: number;
  quizIds: string[];
}

/**
 * "Request more rooms" during seating. While a request is PENDING the session goes back to the Rooms step
 * (ROOM_ALLOCATION) so seating pauses; the asked-for rooms are locked if free. An ADMIN approves — possibly changing the
 * rooms — which adds them and RE-SPLITS the students of every room that is not finalized (so each keeps a mix of
 * subjects), supersedes those rooms' seating plans (they show "not generated yet" and are generated again the normal
 * way), and leaves finalized rooms untouched. Declined or cancelled: the session returns to its previous status exactly
 * as it was.
 */
@Injectable()
export class RoomExtensionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly notificationsOutbox: NotificationsOutboxService,
    private readonly roomHolds: RoomHoldsService,
    private readonly examSessionsService: ExamSessionsService,
    private readonly ownershipService: ExamSessionOwnershipService,
    private readonly facultyService: FacultyService,
    private readonly suggestionService: RoomSuggestionService,
  ) {}

  // ---------------------------------------------------------------- state (faculty)

  /** `GET /exam-sessions/{id}/rooms/extra` — everything the "Request more rooms" dialog needs. */
  async state(examSessionId: string, actor: AuthenticatedUser, emptyColumnsParam?: boolean): Promise<ExtraRoomsState> {
    const session = await this.examSessionsService.findById(examSessionId);
    if (!(await this.ownershipService.isOwnerOrCoInstructor(examSessionId, actor))) {
      throw new NotFoundException();
    }

    const analysis = await this.analyze(this.prisma, examSessionId);
    const nonFinal = analysis.sessionRooms.filter((r) => !analysis.finalizedRoomIds.has(r.roomId));
    const emptyColumns = emptyColumnsParam ?? session.emptyColumnsPlanned ?? false;

    const pendingRow = await this.prisma.examSessionRoomRequest.findFirst({ where: { examSessionId, status: RoomRequestStatus.PENDING } });
    const rejectedRow = await this.prisma.examSessionRoomRequest.findFirst({
      where: { examSessionId, status: RoomRequestStatus.REJECTED },
      orderBy: { createdAt: 'desc' },
    });

    const studentsToPlace = analysis.totalAssigned - analysis.finalizedStudents.length;
    const fullSeats = sumValues(await this.roomHolds.usableSeatCounts(this.prisma, nonFinal.map((r) => r.roomId), false));
    const usableSeats = sumValues(await this.roomHolds.usableSeatCounts(this.prisma, nonFinal.map((r) => r.roomId), emptyColumns));
    const seatsNeeded = Math.max(0, studentsToPlace - (emptyColumns ? usableSeats : fullSeats));

    let blockedReason: string | null = null;
    if (!EXTENDABLE_STATUSES.includes(session.status) && !pendingRow) {
      blockedReason = `More rooms can only be requested during seating (this session is "${session.status}").`;
    } else if (!pendingRow && nonFinal.length === 0) {
      blockedReason = 'Every room\'s seating is already finalized, so students have been told their seats — no more rooms can be added.';
    }

    const existingPlaces = analysis.sessionRooms.map((r) => ({ building: r.building, floor: r.floor }));
    const pool = (
      await this.suggestionService.availablePool(
        session.sessionDate,
        session.startTime,
        session.endTime,
        examSessionId,
        emptyColumns,
        analysis.quizIds,
      )
    ).filter((r) => !analysis.sessionRooms.some((s) => s.roomId === r.roomId));
    const plan = nearestToExistingPlan(pool, existingPlaces, seatsNeeded);

    return {
      canRequest: blockedReason === null && !pendingRow,
      blockedReason,
      pending: pendingRow ? await this.toView(pendingRow, analysis) : null,
      latestRejected: rejectedRow ? await this.toView(rejectedRow, analysis) : null,
      studentsToPlace,
      fullSeats,
      usableSeats,
      emptyColumns,
      seatsNeeded,
      trigger: this.triggerFor(studentsToPlace, fullSeats, usableSeats, emptyColumns),
      rooms: this.roomViews(analysis),
      suggestion: {
        rooms: plan.rooms.map((r) => ({ roomId: r.roomId, building: r.building, floor: r.floor, roomNumber: r.roomNumber, capacity: r.capacity, allocated: r.allocated })),
        location: plan.location || describeLocation([]),
        spansBuildings: plan.spansBuildings,
      },
      allRooms: [...pool]
        .sort((a, b) => a.building.localeCompare(b.building) || a.floor - b.floor || a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))
        .map((r) => ({ roomId: r.roomId, building: r.building, floor: r.floor, roomNumber: r.roomNumber, capacity: r.capacity })),
    };
  }

  private triggerFor(studentsToPlace: number, fullSeats: number, usableSeats: number, emptyColumns: boolean): RoomRequestTrigger {
    if (studentsToPlace > fullSeats) return RoomRequestTrigger.TOO_MANY_STUDENTS;
    if (emptyColumns && studentsToPlace > usableSeats) return RoomRequestTrigger.NO_ROOM_FOR_EMPTY_COLUMNS;
    return RoomRequestTrigger.OTHER;
  }

  // ---------------------------------------------------------------- create / cancel (faculty)

  /** `POST /exam-sessions/{id}/room-requests` (FACULTY, owner/co-instructor). */
  async create(examSessionId: string, dto: CreateRoomRequestDto, actor: AuthenticatedUser): Promise<ExamSessionRoomRequest> {
    const session = await this.examSessionsService.findById(examSessionId);
    const faculty = await this.facultyService.findByUserId(actor.id);
    if (!faculty) throw new ForbiddenException('Only a faculty member can request more rooms.');
    if (!(await this.ownershipService.isOwnerOrCoInstructor(examSessionId, actor))) throw new NotFoundException();

    if (!EXTENDABLE_STATUSES.includes(session.status)) {
      throw new ConflictException(`More rooms can only be requested during seating (this session is "${session.status}").`);
    }
    const pending = await this.prisma.examSessionRoomRequest.findFirst({ where: { examSessionId, status: RoomRequestStatus.PENDING }, select: { id: true } });
    if (pending) throw new ConflictException('A request for more rooms is already waiting for admin approval for this session.');

    const analysis = await this.analyze(this.prisma, examSessionId);
    const nonFinal = analysis.sessionRooms.filter((r) => !analysis.finalizedRoomIds.has(r.roomId));
    if (nonFinal.length === 0) {
      throw new ConflictException('Every room\'s seating is already finalized, so students have been told their seats — no more rooms can be added.');
    }
    if (dto.room_ids.some((id) => analysis.sessionRooms.some((r) => r.roomId === id))) {
      throw new ConflictException('One of the requested rooms is already allocated to this session.');
    }
    const found = await this.prisma.room.findMany({ where: { id: { in: dto.room_ids } }, select: { id: true } });
    if (found.length !== dto.room_ids.length) throw new NotFoundException('One or more requested rooms do not exist.');

    const emptyColumns = dto.empty_columns ?? session.emptyColumnsPlanned ?? false;
    const studentsToPlace = analysis.totalAssigned - analysis.finalizedStudents.length;
    const fullSeats = sumValues(await this.roomHolds.usableSeatCounts(this.prisma, nonFinal.map((r) => r.roomId), false));
    const usableSeats = sumValues(await this.roomHolds.usableSeatCounts(this.prisma, nonFinal.map((r) => r.roomId), emptyColumns));
    const trigger = this.triggerFor(studentsToPlace, fullSeats, usableSeats, emptyColumns);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const request = await tx.examSessionRoomRequest.create({
          data: {
            examSessionId,
            requestedByFacultyId: faculty.id,
            reason: dto.reason.trim(),
            trigger,
            previousStatus: session.status,
            emptyColumns,
            requestedRoomIds: dto.room_ids,
          },
        });

        // Lock the asked-for rooms that are free at this time (held against one of the session's quizzes, tagged with the request).
        if (analysis.quizIds.length > 0) {
          await this.roomHolds.lockForRequest(tx, {
            requestId: request.id,
            quizId: analysis.quizIds[0],
            sessionQuizIds: analysis.quizIds,
            roomIds: dto.room_ids,
            window: { date: session.sessionDate, start: session.startTime, end: session.endTime },
            sessionId: examSessionId,
            emptyColumns,
          });
        }

        // Back to the Rooms step: seating is paused until an admin decides.
        await tx.examSession.update({ where: { id: examSessionId }, data: { status: ExamSessionStatus.ROOM_ALLOCATION, version: { increment: 1 } } });

        await this.notifyAdmins(tx, request, session.name, faculty.name);
        await this.auditHook.record(
          {
            actor,
            action: 'CREATE',
            entityType: 'ExamSessionRoomRequest',
            entityId: request.id,
            newValue: { examSessionId, requestedRoomIds: dto.room_ids, trigger },
          },
          tx,
        );
        return request;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A request for more rooms is already waiting for admin approval for this session.');
      }
      throw err;
    }
  }

  /** `POST /room-requests/{id}/cancel` (FACULTY) — withdraw a pending request; the session returns to seating as it was. */
  async cancel(id: string, actor: AuthenticatedUser): Promise<ExamSessionRoomRequest> {
    const request = await this.findPending(id);
    if (!actor.roles.includes(ROLE.ADMIN) && !(await this.ownershipService.isOwnerOrCoInstructor(request.examSessionId, actor))) {
      throw new NotFoundException();
    }
    return this.endWithoutRooms(request, RoomRequestStatus.CANCELLED, null, actor, 'REQUEST_CANCELLED', null);
  }

  // ---------------------------------------------------------------- list / view

  /** `GET /room-requests` — an ADMIN sees all, a faculty member their own. */
  async list(actor: AuthenticatedUser, params: ListRoomRequestsParams): Promise<PaginatedResult<RoomRequestView>> {
    let requestedByFacultyId: string | undefined;
    if (!actor.roles.includes(ROLE.ADMIN)) {
      const faculty = await this.facultyService.findByUserId(actor.id);
      requestedByFacultyId = faculty?.id ?? '00000000-0000-0000-0000-000000000000';
    }
    const limit = resolveLimit(params.limit);
    const rows = await this.prisma.examSessionRoomRequest.findMany({
      where: {
        ...(requestedByFacultyId ? { requestedByFacultyId } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.examSessionId ? { examSessionId: params.examSessionId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      ...cursorFindManyArgs(params.cursor, limit),
    });
    const views: RoomRequestView[] = [];
    for (const row of rows) views.push(await this.toView(row));
    return toPaginatedResult(views, limit);
  }

  /** `GET /room-requests/{id}` — the request with live availability, plus (for an admin) the free rooms that could replace the asked-for ones. */
  async get(id: string, actor: AuthenticatedUser): Promise<RoomRequestView & { options: { roomId: string; building: string; floor: number; roomNumber: string; capacity: number }[] }> {
    const row = await this.prisma.examSessionRoomRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    if (!actor.roles.includes(ROLE.ADMIN)) {
      const faculty = await this.facultyService.findByUserId(actor.id);
      if (!faculty || faculty.id !== row.requestedByFacultyId) throw new NotFoundException();
    }
    const view = await this.toView(row);
    const session = await this.examSessionsService.findById(row.examSessionId);
    const analysis = await this.analyze(this.prisma, row.examSessionId);
    const pool = (
      await this.suggestionService.availablePool(session.sessionDate, session.startTime, session.endTime, row.examSessionId, row.emptyColumns ?? false, analysis.quizIds)
    ).filter((r) => !analysis.sessionRooms.some((s) => s.roomId === r.roomId));
    return {
      ...view,
      options: [...pool]
        .sort((a, b) => a.building.localeCompare(b.building) || a.floor - b.floor || a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))
        .map((r) => ({ roomId: r.roomId, building: r.building, floor: r.floor, roomNumber: r.roomNumber, capacity: r.capacity })),
    };
  }

  // ---------------------------------------------------------------- admin decisions

  /** `POST /room-requests/{id}/reject` (ADMIN). */
  async reject(id: string, dto: RejectRoomRequestByAdminDto, actor: AuthenticatedUser): Promise<ExamSessionRoomRequest> {
    const request = await this.findPending(id);
    return this.endWithoutRooms(request, RoomRequestStatus.REJECTED, dto.note.trim(), actor, 'REQUEST_DECLINED', NotificationEventType.ROOM_REQUEST_REJECTED);
  }

  /**
   * `POST /room-requests/{id}/approve` (ADMIN). Adds the rooms (the admin may have changed them) and re-splits every student
   * who is not in a FINALIZED room across the not-finalized rooms plus the new ones, so each room keeps a mix of subjects.
   */
  async approve(id: string, dto: ApproveRoomRequestDto, actor: AuthenticatedUser): Promise<ExamSessionRoomRequest> {
    const request = await this.findPending(id);
    const session = await this.examSessionsService.findById(request.examSessionId);
    if (session.status !== ExamSessionStatus.ROOM_ALLOCATION) {
      throw new ConflictException(`This session is "${session.status}" now, so the request can no longer be applied.`);
    }
    const chosen = dto.room_ids?.length ? dto.room_ids : request.requestedRoomIds;
    const note = dto.note?.trim() || null;
    const slot = { date: session.sessionDate, start: session.startTime, end: session.endTime };

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM rooms WHERE id = ANY(${chosen}::uuid[]) FOR UPDATE`);

      const analysis = await this.analyze(tx, request.examSessionId);
      if (chosen.some((rid) => analysis.sessionRooms.some((r) => r.roomId === rid))) {
        throw new ConflictException('One of the chosen rooms is already allocated to this session.');
      }
      const issues = await this.roomHolds.roomIssues(tx, chosen, slot, request.examSessionId);
      if (issues.length > 0) {
        throw new ConflictException({
          message: 'Some of the chosen rooms are not available — swap them before approving.',
          details: issues.map((i) => ({ type: 'ROOM_UNAVAILABLE', roomId: i.roomId, message: i.message })),
        });
      }

      const nonFinal = analysis.sessionRooms.filter((r) => !analysis.finalizedRoomIds.has(r.roomId));
      if (nonFinal.length === 0) {
        throw new ConflictException('Every room\'s seating is finalized now, so no rooms can be added.');
      }

      // Students still to place: every ASSIGNED student who is not in a finalized room, per quiz, in a stable order.
      const finalizedIds = new Set(analysis.finalizedStudents.map((s) => `${s.quizId}:${s.studentId}`));
      const assigned = await tx.quizStudentAssignment.findMany({
        where: { examSessionId: request.examSessionId, status: QuizStudentAssignmentStatus.ASSIGNED },
        select: { quizId: true, studentId: true },
        orderBy: { studentId: 'asc' },
      });
      const remainingByQuiz = new Map<string, string[]>();
      for (const a of assigned) {
        if (finalizedIds.has(`${a.quizId}:${a.studentId}`)) continue;
        remainingByQuiz.set(a.quizId, [...(remainingByQuiz.get(a.quizId) ?? []), a.studentId]);
      }
      const groups = [...remainingByQuiz.entries()].map(([quizId, list]) => ({ quizId, count: list.length }));
      const totalRemaining = groups.reduce((sum, g) => sum + g.count, 0);

      // Room capacity: active seats minus seats OTHER sessions' quizzes hold (this session's own quizzes' locks are ours).
      const targetRoomIds = [...nonFinal.map((r) => r.roomId), ...chosen];
      const seatCounts = await this.roomHolds.usableSeatCounts(tx, targetRoomIds, false);
      const heldByOthers = await this.roomHolds.heldSeatsByRoom(tx, targetRoomIds, slot, analysis.quizIds);
      const capacity = (roomId: string) => Math.max(0, (seatCounts.get(roomId) ?? 0) - (heldByOthers.get(roomId) ?? 0));
      const totalCapacity = targetRoomIds.reduce((sum, rid) => sum + capacity(rid), 0);
      if (totalCapacity < totalRemaining) {
        throw new ConflictException({
          message: `Still not enough seats: ${totalRemaining} students to place and only ${totalCapacity} seats in the not-finalized rooms plus the chosen ones. Add another room.`,
          details: [{ type: 'ROOM_UNAVAILABLE', message: `${totalRemaining - totalCapacity} seats short.` }],
        });
      }

      // Finalized rooms keep their students — record exactly who they are, so the re-split can never shift them.
      for (const room of analysis.sessionRooms.filter((r) => analysis.finalizedRoomIds.has(r.roomId))) {
        const members = analysis.finalizedStudents.filter((s) => s.roomId === room.roomId);
        await tx.examSessionRoomStudent.createMany({
          data: members.map((m) => ({ examSessionRoomId: room.id, quizId: m.quizId, studentId: m.studentId })),
          skipDuplicates: true,
        });
      }

      // Re-split across the not-finalized rooms + the new ones; every room stays in play and keeps a mix of subjects.
      const placements = totalRemaining === 0 ? [] : packMixed(groups, targetRoomIds.map((roomId) => ({ roomId, capacity: capacity(roomId) })), { useAllRooms: true });

      const nonFinalRoomRowIds = nonFinal.map((r) => r.id);
      await tx.examSessionRoomQuiz.deleteMany({ where: { examSessionRoomId: { in: nonFinalRoomRowIds } } });
      await tx.examSessionRoomStudent.deleteMany({ where: { examSessionRoomId: { in: nonFinalRoomRowIds } } });

      const orderedRoomIds = targetRoomIds; // existing rooms in creation order, then the new ones
      const queues = new Map(remainingByQuiz); // quiz -> students still to hand out, in id order
      const totalsByRoom = new Map<string, number>();
      const rowIdByRoom = new Map(analysis.sessionRooms.map((r) => [r.roomId, r.id]));

      for (const roomId of orderedRoomIds) {
        const mine = placements.filter((p) => p.roomId === roomId);
        const total = mine.reduce((sum, p) => sum + p.count, 0);
        totalsByRoom.set(roomId, total);
        if (total === 0 && !rowIdByRoom.has(roomId)) continue; // a new room that ended up with nobody is not created

        let roomRowId = rowIdByRoom.get(roomId);
        if (!roomRowId) {
          const created = await tx.examSessionRoom.create({
            data: { examSessionId: request.examSessionId, roomId, allocatedCapacity: total, sessionDate: session.sessionDate, startTime: session.startTime, endTime: session.endTime },
          });
          roomRowId = created.id;
          rowIdByRoom.set(roomId, roomRowId);
        } else {
          await tx.examSessionRoom.update({ where: { id: roomRowId }, data: { allocatedCapacity: total } });
        }

        for (const placement of mine) {
          const queue = queues.get(placement.quizId) ?? [];
          const slice = queue.splice(0, placement.count);
          await tx.examSessionRoomQuiz.create({ data: { examSessionRoomId: roomRowId, quizId: placement.quizId, studentCount: placement.count } });
          await tx.examSessionRoomStudent.createMany({ data: slice.map((studentId) => ({ examSessionRoomId: roomRowId!, quizId: placement.quizId, studentId })), skipDuplicates: true });
        }
      }

      // The not-finalized rooms' old seating no longer matches their students: supersede it (they show "not generated yet").
      await tx.seatingPlan.updateMany({
        where: { examSessionId: request.examSessionId, roomId: { in: nonFinal.map((r) => r.roomId) }, status: { notIn: [SeatingPlanStatus.SUPERSEDED, SeatingPlanStatus.FINALIZED] } },
        data: { status: SeatingPlanStatus.SUPERSEDED, version: { increment: 1 } },
      });

      // Locks: the ones for rooms the admin swapped out are freed; the rest become the real allocation.
      await this.roomHolds.releaseForRequest(tx, request.id, 'SWAPPED', request.requestedRoomIds.filter((rid) => !chosen.includes(rid)));
      await this.roomHolds.consumeForRequest(tx, request.id);

      const updatedSession = await tx.examSession.update({
        where: { id: request.examSessionId },
        data: { status: ExamSessionStatus.SEATING_GENERATION, emptyColumnsPlanned: request.emptyColumns ?? session.emptyColumnsPlanned, version: { increment: 1 } },
      });

      const { count } = await tx.examSessionRoomRequest.updateMany({
        where: { id: request.id, status: RoomRequestStatus.PENDING },
        data: { status: RoomRequestStatus.APPROVED, approvedRoomIds: chosen, reviewedByAdminId: actor.id, reviewNote: note, reviewedAt: new Date() },
      });
      if (count === 0) throw new ConflictException('This request was already reviewed by someone else.');

      const labels = await this.roomLabels(tx, chosen);
      await this.notifyFaculty(tx, request, session.name, NotificationEventType.ROOM_REQUEST_APPROVED, { rooms: chosen.map((rid) => labels.get(rid) ?? '').filter(Boolean).join(', '), note });
      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'ExamSessionRoomRequest',
          entityId: request.id,
          oldValue: { status: RoomRequestStatus.PENDING },
          newValue: { status: RoomRequestStatus.APPROVED, approvedRoomIds: chosen, sessionStatus: updatedSession.status },
        },
        tx,
      );
      return tx.examSessionRoomRequest.findUniqueOrThrow({ where: { id: request.id } });
    }, APPROVE_TRANSACTION_OPTIONS);
  }

  // ---------------------------------------------------------------- internals

  /** Decline / cancel: free the locks and put the session back to exactly the status it had. */
  private async endWithoutRooms(
    request: ExamSessionRoomRequest,
    status: RoomRequestStatus,
    note: string | null,
    actor: AuthenticatedUser,
    holdReason: string,
    notify: NotificationEventType | null,
  ): Promise<ExamSessionRoomRequest> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.examSessionRoomRequest.updateMany({
        where: { id: request.id, status: RoomRequestStatus.PENDING },
        data: {
          status,
          ...(status === RoomRequestStatus.REJECTED ? { reviewedByAdminId: actor.id, reviewNote: note, reviewedAt: new Date() } : {}),
        },
      });
      if (count === 0) throw new ConflictException('This request was already reviewed or withdrawn.');

      await this.roomHolds.releaseForRequest(tx, request.id, holdReason);
      // Only restore when the session is still waiting on this request (it may have been cancelled meanwhile).
      await tx.examSession.updateMany({
        where: { id: request.examSessionId, status: ExamSessionStatus.ROOM_ALLOCATION },
        data: { status: request.previousStatus, version: { increment: 1 } },
      });

      if (notify) {
        const session = await tx.examSession.findUniqueOrThrow({ where: { id: request.examSessionId }, select: { name: true } });
        await this.notifyFaculty(tx, request, session.name, notify, { note });
      }
      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'ExamSessionRoomRequest',
          entityId: request.id,
          oldValue: { status: RoomRequestStatus.PENDING },
          newValue: { status, sessionStatus: request.previousStatus },
          reason: note ?? undefined,
        },
        tx,
      );
      return tx.examSessionRoomRequest.findUniqueOrThrow({ where: { id: request.id } });
    });
  }

  private async findPending(id: string): Promise<ExamSessionRoomRequest> {
    const request = await this.prisma.examSessionRoomRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException();
    if (request.status !== RoomRequestStatus.PENDING) {
      throw new ConflictException(`This request is already ${request.status.toLowerCase()}.`);
    }
    return request;
  }

  /** The session's rooms with who is finalized, and the finalized students (from their persisted seating). */
  private async analyze(client: PrismaService | Prisma.TransactionClient, examSessionId: string): Promise<Analysis> {
    const rooms = await client.examSessionRoom.findMany({
      where: { examSessionId },
      include: { room: { select: { building: true, floor: true, roomNumber: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const plans = await client.seatingPlan.findMany({
      where: { examSessionId, status: SeatingPlanStatus.FINALIZED },
      select: { id: true, roomId: true },
    });
    const finalizedRoomIds = new Set(plans.map((p) => p.roomId));
    const assignments = plans.length
      ? await client.seatingAssignment.findMany({ where: { seatingPlanId: { in: plans.map((p) => p.id) } }, select: { studentId: true, quizId: true, seatingPlanId: true } })
      : [];
    const roomByPlan = new Map(plans.map((p) => [p.id, p.roomId]));
    const quizIds = (
      await client.examSessionQuiz.findMany({ where: { examSessionId, isActiveAttachment: true }, select: { quizId: true } })
    ).map((a) => a.quizId);
    const totalAssigned = await client.quizStudentAssignment.count({ where: { examSessionId, status: QuizStudentAssignmentStatus.ASSIGNED } });

    return {
      sessionRooms: rooms.map((r) => ({
        id: r.id,
        roomId: r.roomId,
        createdAt: r.createdAt,
        allocatedCapacity: r.allocatedCapacity,
        label: `${r.room.building}-${r.room.roomNumber}`,
        building: r.room.building,
        floor: r.room.floor,
      })),
      finalizedRoomIds,
      finalizedStudents: assignments.map((a) => ({ studentId: a.studentId, quizId: a.quizId, roomId: roomByPlan.get(a.seatingPlanId)! })),
      totalAssigned,
      quizIds,
    };
  }

  private roomViews(analysis: Analysis): SessionRoomView[] {
    return analysis.sessionRooms.map((r) => ({
      roomId: r.roomId,
      label: r.label,
      allocated: r.allocatedCapacity,
      finalized: analysis.finalizedRoomIds.has(r.roomId),
    }));
  }

  private async roomLabels(client: PrismaService | Prisma.TransactionClient, roomIds: string[]): Promise<Map<string, string>> {
    const rooms = await client.room.findMany({ where: { id: { in: roomIds } }, select: { id: true, building: true, roomNumber: true } });
    return new Map(rooms.map((r) => [r.id, `${r.building}-${r.roomNumber}`]));
  }

  /** A request with the labels a reviewer needs and the live availability of the asked-for rooms. */
  private async toView(row: ExamSessionRoomRequest, knownAnalysis?: Analysis): Promise<RoomRequestView> {
    const session = await this.prisma.examSession.findUniqueOrThrow({
      where: { id: row.examSessionId },
      select: { name: true, sessionDate: true, startTime: true, endTime: true, status: true },
    });
    const faculty = await this.prisma.faculty.findUniqueOrThrow({ where: { id: row.requestedByFacultyId }, select: { name: true, employeeCode: true } });
    const analysis = knownAnalysis ?? (await this.analyze(this.prisma, row.examSessionId));
    const slot = { date: session.sessionDate, start: session.startTime, end: session.endTime };

    const roomIds = [...new Set([...row.requestedRoomIds, ...row.approvedRoomIds])];
    const rooms = await this.prisma.room.findMany({ where: { id: { in: roomIds } }, select: { id: true, building: true, roomNumber: true, capacity: true } });
    const labels = new Map(rooms.map((r) => [r.id, `${r.building}-${r.roomNumber}`]));
    const issues = row.status === RoomRequestStatus.PENDING ? await this.roomHolds.roomIssues(this.prisma, row.requestedRoomIds, slot, row.examSessionId) : [];
    const issueByRoom = new Map(issues.map((i) => [i.roomId, i.message]));
    const emptyColumns = row.emptyColumns ?? false;
    const usable = await this.roomHolds.usableSeatCounts(this.prisma, row.requestedRoomIds, emptyColumns);
    const held = await this.roomHolds.heldSeatsByRoom(this.prisma, row.requestedRoomIds, slot, analysis.quizIds);

    return {
      ...row,
      examSessionName: session.name,
      examSessionDate: session.sessionDate,
      examSessionStartTime: session.startTime,
      examSessionEndTime: session.endTime,
      examSessionStatus: session.status,
      facultyName: faculty.name,
      facultyEmployeeCode: faculty.employeeCode,
      requestedRooms: row.requestedRoomIds.map((roomId) => ({
        roomId,
        label: labels.get(roomId) ?? 'a room',
        capacity: rooms.find((r) => r.id === roomId)?.capacity ?? 0,
        freeSeats: Math.max(0, (usable.get(roomId) ?? 0) - (held.get(roomId) ?? 0)),
        available: !issueByRoom.has(roomId),
        reason: issueByRoom.get(roomId),
      })),
      approvedRoomLabels: row.approvedRoomIds.map((roomId) => labels.get(roomId) ?? 'a room'),
      currentRooms: this.roomViews(analysis),
      studentsToPlace: analysis.totalAssigned - analysis.finalizedStudents.length,
    };
  }

  private async notifyAdmins(tx: Prisma.TransactionClient, request: ExamSessionRoomRequest, sessionName: string, facultyName: string): Promise<void> {
    const admins = await tx.user.findMany({ where: { roles: { some: { role: { name: ROLE.ADMIN } } } }, select: { id: true } });
    for (const admin of admins) {
      await this.notificationsOutbox.queue(tx, {
        recipientType: NotificationRecipientType.ADMIN,
        recipientId: admin.id,
        eventType: NotificationEventType.ROOM_REQUEST_SUBMITTED,
        entityId: request.id,
        entityVersion: RoomRequestStatus.PENDING,
        payload: {
          request_id: request.id,
          exam_session_id: request.examSessionId,
          session_name: sessionName,
          faculty_name: facultyName,
          reason: request.reason,
          room_count: request.requestedRoomIds.length,
        },
      });
    }
  }

  private async notifyFaculty(
    tx: Prisma.TransactionClient,
    request: ExamSessionRoomRequest,
    sessionName: string,
    eventType: NotificationEventType,
    extra: { rooms?: string; note?: string | null },
  ): Promise<void> {
    const faculty = await tx.faculty.findUnique({ where: { id: request.requestedByFacultyId }, select: { userId: true } });
    if (!faculty) return;
    await this.notificationsOutbox.queue(tx, {
      recipientType: NotificationRecipientType.FACULTY,
      recipientId: faculty.userId,
      eventType,
      entityId: request.id,
      entityVersion: eventType,
      payload: { request_id: request.id, exam_session_id: request.examSessionId, session_name: sessionName, ...extra },
    });
  }
}

function sumValues(map: Map<string, number>): number {
  return [...map.values()].reduce((a, b) => a + b, 0);
}

export type { PoolRoom };
