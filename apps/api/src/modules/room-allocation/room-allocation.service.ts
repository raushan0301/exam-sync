import { packMixed } from './mixed-room-packing';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ExamSession,
  ExamSessionStatus,
  NotificationEventType,
  NotificationRecipientType,
  Prisma,
  QuizStudentAssignmentStatus,
} from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { NotificationsOutboxService } from '../../common/notifications-outbox/notifications-outbox.service';
import { RoomHoldsService } from '../../common/room-holds/room-holds.service';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';
import { ExamSessionsService, ExamSessionOwnershipService } from '../exam-session';
import { ConflictEngineService, ConflictDetail } from '../conflict-engine';
import { RoomsService } from '../rooms';
import { QuizzesService, QuizOwnershipService } from '../quiz';
import { AllocateRoomsDto } from './dto/allocate-rooms.dto';
import { RequestRoomsDto, RejectRoomRequestDto } from './dto/request-rooms.dto';

/** Never a real exam_session id — see room-suggestion.service.ts's own copy of this constant for why. */
const NIL_EXAM_SESSION_ID = '00000000-0000-0000-0000-000000000000';

function addMinutes(time: Date, minutes: number): Date {
  return new Date(time.getTime() + minutes * 60_000);
}

export interface RoomAvailabilityRow {
  roomId: string;
  building: string;
  floor: number;
  roomNumber: string;
  capacity: number;
  available: boolean;
  reason?: string;
  /** Only populated when `available` is false — same-or-greater-capacity ACTIVE rooms with no conflict, for the admin to swap in. */
  alternatives?: { roomId: string; building: string; floor: number; roomNumber: string; capacity: number }[];
}

export interface StudentScheduleConflict {
  studentId: string;
  conflictingExamSessionId: string;
  message: string;
}

export interface RoomAvailabilityPreview {
  requestedRooms: RoomAvailabilityRow[];
  backupRoom: RoomAvailabilityRow | null;
  strategy: string | null;
  /** Quiz-stage only — eligible students (by enrollment) already ASSIGNED elsewhere at an overlapping time (BR-019), checked against the quiz's preferred_date/preferred_time so this surfaces BEFORE approval, not only later when actually attaching to a real exam session. Always [] for the exam-session-stage preview (real ASSIGNED students are what's being checked there in the first place). */
  studentConflicts: StudentScheduleConflict[];
}

interface StudentGroup {
  quizId: string;
  count: number;
}

interface Placement {
  roomId: string;
  quizId: string;
  count: number;
}

/**
 * Owns `exam_session_rooms` (ARCHITECTURE.md §S, IMPLEMENTATION_PLAN.md
 * Phase 12: "Best-Fit Decreasing allocation algorithm, exam_session_rooms").
 *
 * State-machine note (disclosed interpretation): ARCHITECTURE.md's Exam
 * Session table has TWO transitions bracketing this phase —
 * ASSIGNING_STUDENTS→ROOM_ALLOCATION ("Admin", precondition "assignment
 * job complete") and ROOM_ALLOCATION→SEATING_GENERATION ("Admin",
 * precondition "rooms allocated, capacity sufficient"). No separate
 * endpoint exists anywhere in API_CONTRACT.md for the first transition —
 * Phase 9's `assign-students` is already synchronous, so "assignment job
 * complete" is true the instant that call returns, which is exactly when
 * a session sits at ASSIGNING_STUDENTS. This service therefore treats
 * `allocate` as requiring status ASSIGNING_STUDENTS and, on success,
 * moves the session straight to SEATING_GENERATION in the SAME
 * transaction — both documented transitions collapse into one atomic
 * step because nothing observable ever distinguishes a durably-persisted
 * ROOM_ALLOCATION state (a failed attempt rolls the whole transaction
 * back to ASSIGNING_STUDENTS regardless of any intermediate value).
 * Calling `allocate` again afterward correctly 409s (not
 * ASSIGNING_STUDENTS) — the same session-level idempotency guard
 * established in every prior phase.
 */
@Injectable()
export class RoomAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly examSessionsService: ExamSessionsService,
    private readonly conflictEngine: ConflictEngineService,
    private readonly roomsService: RoomsService,
    private readonly examSessionOwnershipService: ExamSessionOwnershipService,
    private readonly quizzesService: QuizzesService,
    private readonly quizOwnershipService: QuizOwnershipService,
    private readonly roomHolds: RoomHoldsService,
    private readonly notificationsOutbox: NotificationsOutboxService,
  ) {}

  /**
   * `POST /exam-sessions/{id}/rooms/request` (FACULTY, ownership-gated).
   * Records the faculty's candidate room set (built from
   * `RoomSuggestionService`, or hand-picked) and moves the session
   * ASSIGNING_STUDENTS -> ROOM_ALLOCATION — this does NOT allocate
   * anything; `allocate` (now ADMIN-only) is the actual approval step,
   * restoring the two-transition FSM ARCHITECTURE.md originally
   * documented (see this class's own header comment on why they were
   * previously collapsed into one).
   */
  async request(examSessionId: string, dto: RequestRoomsDto, actor: AuthenticatedUser): Promise<ExamSession> {
    const session = await this.examSessionsService.findById(examSessionId);
    if (!(await this.examSessionOwnershipService.isOwnerOrCoInstructor(examSessionId, actor))) {
      throw new NotFoundException();
    }
    if (session.status !== ExamSessionStatus.ASSIGNING_STUDENTS) {
      throw new ConflictException(
        `Exam session is in status "${session.status}" and a room request can only be submitted while ASSIGNING_STUDENTS.`,
      );
    }
    if (dto.backup_room_id && dto.room_ids.includes(dto.backup_room_id)) {
      throw new BadRequestException('backup_room_id cannot also appear in room_ids.');
    }

    const idsToVerify = dto.backup_room_id ? [...dto.room_ids, dto.backup_room_id] : dto.room_ids;
    const existingRooms = await this.prisma.room.findMany({ where: { id: { in: idsToVerify } }, select: { id: true } });
    if (existingRooms.length !== new Set(idsToVerify).size) {
      throw new NotFoundException('One or more requested rooms do not exist.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.examSession.update({
        where: { id: examSessionId },
        data: {
          status: ExamSessionStatus.ROOM_ALLOCATION,
          requestedRoomIds: dto.room_ids,
          backupRoomId: dto.backup_room_id ?? null,
          roomAllocationStrategy: dto.strategy ?? null,
          roomRejectionReason: null,
          ...(dto.empty_columns !== undefined ? { emptyColumnsPlanned: dto.empty_columns } : {}),
          version: { increment: 1 },
        },
      });

      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'ExamSession',
          entityId: examSessionId,
          oldValue: { status: session.status },
          newValue: { status: result.status, requestedRoomIds: dto.room_ids, backupRoomId: dto.backup_room_id ?? null },
        },
        tx,
      );

      return result;
    });

    return updated;
  }

  /**
   * `GET /exam-sessions/{id}/rooms/preview` (ADMIN unscoped, FACULTY
   * owner/co-instructor). Live-checks every requested room + the backup
   * room against the SAME Conflict Engine check `allocate` itself runs
   * (BR-018/BR-022 — room status, availability blocks, real
   * `exam_session_rooms` overlaps) so the admin sees exactly what would
   * happen if they approved as-is, and gets a same-or-greater-capacity
   * available alternative for anything that would fail.
   */
  async getAvailabilityPreview(examSessionId: string, actor: AuthenticatedUser): Promise<RoomAvailabilityPreview> {
    const session = await this.examSessionsService.findById(examSessionId);
    const isAdmin = actor.roles.includes('ADMIN');
    if (!isAdmin && !(await this.examSessionOwnershipService.isOwnerOrCoInstructor(examSessionId, actor))) {
      throw new NotFoundException();
    }
    if (session.status !== ExamSessionStatus.ROOM_ALLOCATION) {
      throw new ConflictException(
        `This session has no pending room request to preview (current status "${session.status}").`,
      );
    }

    return this.buildAvailabilityPreview(
      examSessionId,
      session.requestedRoomIds,
      session.backupRoomId,
      session.roomAllocationStrategy,
      session.sessionDate,
      session.startTime,
      session.endTime,
    );
  }

  /**
   * `GET /quizzes/{id}/rooms/conflicts` (ADMIN unscoped, FACULTY owner) —
   * same live availability/alternatives preview as
   * `getAvailabilityPreview`, but for a quiz's own `requestedRoomIds`
   * (RoomSuggestionService.suggestForQuiz's output, submitted via
   * `requestForQuiz`) BEFORE any exam session exists — shown on the
   * admin approval queue alongside approve/reject, per this feature's own
   * request that room conflicts be visible at quiz-approval time, not
   * only later at the exam-session stage.
   */
  async getQuizRoomConflicts(quizId: string, actor: AuthenticatedUser): Promise<RoomAvailabilityPreview> {
    const quiz = await this.quizzesService.findById(quizId);
    const isAdmin = actor.roles.includes('ADMIN');
    if (!isAdmin && !(await this.quizOwnershipService.isOwnerOrCoInstructor(quiz, actor))) {
      throw new NotFoundException();
    }
    if (!quiz.preferredDate || !quiz.preferredTime) {
      if (quiz.requestedRoomIds.length === 0) {
        return { requestedRooms: [], backupRoom: null, strategy: null, studentConflicts: [] };
      }
      throw new ConflictException('This quiz has no preferred_date/preferred_time set.');
    }

    const sessionDate = quiz.preferredDate;
    const startTime = quiz.preferredTime;
    const endTime = addMinutes(quiz.preferredTime, quiz.durationMinutes ?? 120);

    // Once this quiz has a real, actively-attached exam session (created
    // after approval, auto-filled with this same preferred date/time —
    // see ExamSessionsService's quiz-approval auto-fill), the students
    // ASSIGNED there are THIS quiz's own booking, not a rival one — they
    // must be excluded the same way a real exam session excludes itself.
    // Before that attachment exists, NIL_EXAM_SESSION_ID (matches no real
    // session) correctly excludes nothing, so every other booking is
    // still compared against.
    const activeAttachment = await this.prisma.examSessionQuiz.findFirst({
      where: { quizId, isActiveAttachment: true },
      select: { examSessionId: true },
    });
    const excludeExamSessionId = activeAttachment?.examSessionId ?? NIL_EXAM_SESSION_ID;

    // BR-019 (student overlap), checked against the quiz's OWN preferred
    // slot rather than a real exam session — so this surfaces at
    // quiz-approval time, before the same check would otherwise only run
    // later when actually attaching to an exam session (see
    // ExamSessionsService.attachAndDetachQuizzes).
    const scheduleResult = await this.conflictEngine.checkSessionAssembly({
      examSessionId: excludeExamSessionId,
      quizIds: [quizId],
      sessionDate,
      startTime,
      endTime,
    });
    const studentConflicts: StudentScheduleConflict[] = scheduleResult.hard
      .filter((d) => d.type === 'STUDENT_OVERLAP' && d.studentId && d.conflictingExamSessionId)
      .map((d) => ({ studentId: d.studentId!, conflictingExamSessionId: d.conflictingExamSessionId!, message: d.message }));

    if (quiz.requestedRoomIds.length === 0) {
      return { requestedRooms: [], backupRoom: null, strategy: null, studentConflicts };
    }

    const roomPreview = await this.buildAvailabilityPreview(
      excludeExamSessionId,
      quiz.requestedRoomIds,
      quiz.backupRoomId,
      quiz.roomAllocationStrategy,
      sessionDate,
      startTime,
      endTime,
    );
    return { ...roomPreview, studentConflicts };
  }

  private async buildAvailabilityPreview(
    excludeExamSessionId: string,
    requestedRoomIds: string[],
    backupRoomId: string | null,
    strategy: string | null,
    sessionDate: Date,
    startTime: Date,
    endTime: Date,
  ): Promise<RoomAvailabilityPreview> {
    const allIds = backupRoomId ? [...requestedRoomIds, backupRoomId] : requestedRoomIds;
    const rooms = await this.prisma.room.findMany({ where: { id: { in: allIds } } });
    const roomsById = new Map(rooms.map((r) => [r.id, r]));

    const conflictResult = await this.conflictEngine.checkRoomAllocation({
      examSessionId: excludeExamSessionId,
      roomIds: allIds,
      sessionDate,
      startTime,
      endTime,
    });
    const conflictByRoom = new Map(conflictResult.hard.filter((d) => d.roomId).map((d) => [d.roomId as string, d.message]));

    const availableAlternativesPool = await this.roomsService.findAvailable({
      date: sessionDate.toISOString().slice(0, 10),
      start_time: startTime.toISOString().slice(11, 16),
      end_time: endTime.toISOString().slice(11, 16),
    });
    const altConflicts = await this.conflictEngine.checkRoomAllocation({
      examSessionId: excludeExamSessionId,
      roomIds: availableAlternativesPool.map((r) => r.id),
      sessionDate,
      startTime,
      endTime,
    });
    const conflictingAltIds = new Set(altConflicts.hard.map((d) => d.roomId).filter(Boolean));
    const trulyAvailable = availableAlternativesPool.filter(
      (r) => !conflictingAltIds.has(r.id) && !allIds.includes(r.id),
    );

    const toRow = (roomId: string): RoomAvailabilityRow => {
      const room = roomsById.get(roomId);
      if (!room) {
        return { roomId, building: '—', floor: 0, roomNumber: '—', capacity: 0, available: false, reason: 'Room no longer exists.' };
      }
      const conflictMessage = conflictByRoom.get(roomId);
      const row: RoomAvailabilityRow = {
        roomId: room.id,
        building: room.building,
        floor: room.floor,
        roomNumber: room.roomNumber,
        capacity: room.capacity,
        available: !conflictMessage,
        reason: conflictMessage,
      };
      if (conflictMessage) {
        row.alternatives = trulyAvailable
          .filter((r) => r.capacity >= room.capacity)
          .sort((a, b) => a.capacity - b.capacity)
          .slice(0, 3)
          .map((r) => ({ roomId: r.id, building: r.building, floor: r.floor, roomNumber: r.roomNumber, capacity: r.capacity }));
      }
      return row;
    };

    return {
      requestedRooms: requestedRoomIds.map(toRow),
      backupRoom: backupRoomId ? toRow(backupRoomId) : null,
      strategy,
      studentConflicts: [],
    };
  }

  /**
   * `POST /quizzes/{id}/rooms/request` (FACULTY, ownership-gated). Saves
   * the faculty's chosen room set (from `RoomSuggestionService.suggestForQuiz`,
   * or hand-picked) onto the quiz itself — DRAFT/REJECTED only, no status
   * change. Purely informational until the admin reviews it via
   * `getQuizRoomConflicts` and approves/rejects the quiz as normal.
   */
  async requestForQuiz(quizId: string, dto: RequestRoomsDto, actor: AuthenticatedUser) {
    const quiz = await this.quizzesService.findById(quizId);
    const isAdmin = actor.roles.includes('ADMIN');
    if (!isAdmin && !(await this.quizOwnershipService.isOwnerOrCoInstructor(quiz, actor))) {
      throw new NotFoundException();
    }
    // ADMIN may also swap a room while reviewing (quiz.status SUBMITTED) —
    // the faculty-owned DRAFT/REJECTED case stays their own to edit.
    const validStatus = isAdmin
      ? quiz.status === 'DRAFT' || quiz.status === 'REJECTED' || quiz.status === 'SUBMITTED'
      : quiz.status === 'DRAFT' || quiz.status === 'REJECTED';
    if (!validStatus) {
      throw new ConflictException(
        `A room request can only be submitted/changed while the quiz is DRAFT, REJECTED${isAdmin ? ', or SUBMITTED' : ''} (current status "${quiz.status}").`,
      );
    }
    if (dto.backup_room_id && dto.room_ids.includes(dto.backup_room_id)) {
      throw new BadRequestException('backup_room_id cannot also appear in room_ids.');
    }

    const idsToVerify = dto.backup_room_id ? [...dto.room_ids, dto.backup_room_id] : dto.room_ids;
    const existingRooms = await this.prisma.room.findMany({ where: { id: { in: idsToVerify } }, select: { id: true } });
    if (existingRooms.length !== new Set(idsToVerify).size) {
      throw new NotFoundException('One or more requested rooms do not exist.');
    }

    return this.prisma.quiz.update({
      where: { id: quizId },
      data: {
        requestedRoomIds: dto.room_ids,
        backupRoomId: dto.backup_room_id ?? null,
        // Whether the backup is locked too once approved; the faculty picks, an ADMIN may change it while reviewing.
        backupRoomLocked: dto.backup_room_id ? (dto.backup_locked ?? quiz.backupRoomLocked) : false,
        emptyColumnsPlanned: dto.empty_columns ?? quiz.emptyColumnsPlanned,
        roomAllocationStrategy: dto.strategy ?? null,
        // A FACULTY resubmission supersedes whatever the admin last said
        // about the OLD request — only an ADMIN's own edit sets a note.
        roomAdjustmentNote: isAdmin ? (dto.admin_note ?? null) : null,
      },
    });
  }

  /**
   * `POST /exam-sessions/{id}/rooms/reject` (ADMIN). Sends a pending room
   * request back to the faculty — ROOM_ALLOCATION -> ASSIGNING_STUDENTS,
   * clearing the request so a fresh `request()` is required, with the
   * reason stored on the session for the faculty to see.
   */
  async reject(examSessionId: string, dto: RejectRoomRequestDto, actor: AuthenticatedUser): Promise<ExamSession> {
    const session = await this.examSessionsService.findById(examSessionId);
    if (session.status !== ExamSessionStatus.ROOM_ALLOCATION) {
      throw new ConflictException(
        `This session has no pending room request to reject (current status "${session.status}").`,
      );
    }
    await this.assertNoPendingExtraRoomRequest(examSessionId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.examSession.update({
        where: { id: examSessionId },
        data: {
          status: ExamSessionStatus.ASSIGNING_STUDENTS,
          requestedRoomIds: [],
          backupRoomId: null,
          roomRejectionReason: dto.reason,
          version: { increment: 1 },
        },
      });

      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'ExamSession',
          entityId: examSessionId,
          oldValue: { status: session.status },
          newValue: { status: result.status, roomRejectionReason: dto.reason },
        },
        tx,
      );

      return result;
    });

    return updated;
  }

  /**
   * `POST /exam-sessions/{id}/rooms/allocate` (ADMIN — the approval
   * step). Candidate rooms default to the faculty's `requestedRoomIds`
   * (approve-as-is) but the admin may override with `dto.room_ids`
   * (swap) or `dto.auto`/`dto.candidate_room_ids` (algorithmic). Every
   * candidate room is then row-locked (`SELECT ... FOR UPDATE`, ADR-003
   * mechanism (a): "row lock on candidate room rows during allocation")
   * inside one transaction, re-checked for real conflicts (BR-018/
   * BR-022, via the Conflict Engine), capacity-checked in aggregate
   * (BR-021, EC-011 — all-or-nothing on shortfall), then packed with
   * Best-Fit Decreasing (ARCHITECTURE.md §S) and persisted. The
   * `EXCLUDE` constraint on `exam_session_rooms` (BR-018) is the final
   * backstop underneath all of this, per ADR-003's tiered strategy —
   * reachable only if the lock itself is somehow bypassed, defended
   * against here too (see `mapExclusionViolation`).
   */
  async allocate(
    examSessionId: string,
    dto: AllocateRoomsDto,
    actor: AuthenticatedUser,
  ): Promise<ExamSession> {
    const session = await this.examSessionsService.findById(examSessionId);
    if (session.status !== ExamSessionStatus.ROOM_ALLOCATION) {
      throw new ConflictException(
        `Exam session is in status "${session.status}" and rooms can only be allocated while ROOM_ALLOCATION (pending a faculty room request).`,
      );
    }
    await this.assertNoPendingExtraRoomRequest(examSessionId);

    const groups = await this.getStudentGroupsByQuiz(examSessionId);
    const totalStudents = groups.reduce((sum, g) => sum + g.count, 0);
    if (totalStudents === 0) {
      throw new ConflictException('This session has no ASSIGNED students to allocate rooms for.');
    }

    const candidateRoomIds = await this.resolveCandidateRoomIds(dto, session);
    if (candidateRoomIds.length === 0) {
      throw new BadRequestException('At least one candidate room is required.');
    }

    return this.performAllocation(examSessionId, session, groups, totalStudents, candidateRoomIds, actor);
  }

  /**
   * `POST /exam-sessions/{id}/rooms/allocate-preapproved` (FACULTY,
   * ownership-gated) — this feature's own extension, self-service for the
   * common case where an ADMIN already reviewed and approved these exact
   * rooms once, at quiz-approval time (`Quiz.requestedRoomIds`/
   * `backupRoomId`, via `QuizRoomConflictPanel`'s admin review). Re-running
   * a SECOND full request → admin-review → approve cycle for rooms a human
   * already signed off on is pure friction, so this skips straight from
   * ASSIGNING_STUDENTS to the real allocation — but ONLY when every
   * actively-attached quiz's own approved room set is used verbatim (no
   * swap, no new room); anything else still needs the full `request`/
   * `allocate` admin-reviewed path, since that's genuinely unvetted.
   */
  async allocatePreApproved(examSessionId: string, actor: AuthenticatedUser): Promise<ExamSession> {
    const session = await this.examSessionsService.findById(examSessionId);
    if (!(await this.examSessionOwnershipService.isOwnerOrCoInstructor(examSessionId, actor))) {
      throw new NotFoundException();
    }
    if (session.status !== ExamSessionStatus.ASSIGNING_STUDENTS) {
      throw new ConflictException(
        `Rooms can only be allocated while ASSIGNING_STUDENTS (current status "${session.status}").`,
      );
    }

    const attachments = await this.prisma.examSessionQuiz.findMany({
      where: { examSessionId, isActiveAttachment: true },
      include: { quiz: true },
    });
    if (attachments.length === 0) {
      throw new ConflictException('This session has no attached quiz to pull an approved room from.');
    }
    if (attachments.some((a) => a.quiz.requestedRoomIds.length === 0)) {
      throw new ConflictException(
        'One or more attached quizzes has no admin-approved room request — use the manual room request instead.',
      );
    }

    let candidateRoomIds = [...new Set(attachments.flatMap((a) => a.quiz.requestedRoomIds))];

    const groups = await this.getStudentGroupsByQuiz(examSessionId);
    const totalStudents = groups.reduce((sum, g) => sum + g.count, 0);
    if (totalStudents === 0) {
      throw new ConflictException('This session has no ASSIGNED students to allocate rooms for.');
    }

    // A held main room that is gone now (inactive, blocked, taken by another session) is replaced by the quiz's backup
    // room automatically, when that backup is itself fine. Both the faculty and the admins are told.
    const slot = { date: session.sessionDate, start: session.startTime, end: session.endTime };
    const failing = new Set((await this.roomHolds.roomIssues(this.prisma, candidateRoomIds, slot, examSessionId)).map((i) => i.roomId));
    const swaps: { quizTitle: string; ownerFacultyId: string; unavailableRoomId: string; backupRoomId: string }[] = [];
    if (failing.size > 0) {
      const backupIds = [...new Set(attachments.map((a) => a.quiz.backupRoomId).filter((id): id is string => !!id))];
      const backupFailing = new Set((await this.roomHolds.roomIssues(this.prisma, backupIds, slot, examSessionId)).map((i) => i.roomId));
      for (const { quiz } of attachments) {
        const lost = quiz.requestedRoomIds.filter((id) => failing.has(id));
        if (lost.length === 0 || !quiz.backupRoomId || backupFailing.has(quiz.backupRoomId) || candidateRoomIds.includes(quiz.backupRoomId)) continue;
        candidateRoomIds = [...candidateRoomIds.filter((id) => id !== lost[0]), quiz.backupRoomId];
        failing.delete(lost[0]);
        swaps.push({ quizTitle: quiz.title, ownerFacultyId: quiz.createdByFacultyId, unavailableRoomId: lost[0], backupRoomId: quiz.backupRoomId });
      }
    }

    return this.performAllocation(
      examSessionId,
      session,
      groups,
      totalStudents,
      candidateRoomIds,
      actor,
      swaps.length > 0 ? (tx) => this.notifyBackupUsed(tx, session, swaps) : undefined,
    );
  }

  private async performAllocation(
    examSessionId: string,
    session: ExamSession,
    groups: StudentGroup[],
    totalStudents: number,
    candidateRoomIds: string[],
    actor: AuthenticatedUser,
    afterInTransaction?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<ExamSession> {
    const updatedSession = await this.prisma
      .$transaction(async (tx) => {
        // ADR-003 mechanism (a): row-lock every candidate room BEFORE any
        // conflict/capacity check, so a concurrent allocator racing for
        // the same room blocks here and re-observes our committed state
        // once we finish, rather than both proceeding on stale reads.
        const lockedRooms = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM rooms WHERE id = ANY(${candidateRoomIds}::uuid[]) FOR UPDATE`,
        );
        if (lockedRooms.length !== candidateRoomIds.length) {
          throw new NotFoundException('One or more candidate rooms do not exist.');
        }

        const conflictResult = await this.conflictEngine.checkRoomAllocation(
          {
            examSessionId,
            roomIds: candidateRoomIds,
            sessionDate: session.sessionDate,
            startTime: session.startTime,
            endTime: session.endTime,
          },
          tx,
        );
        if (conflictResult.hard.length > 0) {
          throw new ConflictException({
            message: 'One or more candidate rooms are unavailable.',
            details: conflictResult.hard,
          });
        }

        // Seats other quizzes hold in these rooms (for an overlapping time) are not available to this session;
        // this session's own quizzes' holds are the ones being turned into the real allocation.
        const sessionQuizIds = groups.map((g) => g.quizId);
        const heldByOthers = await this.roomHolds.heldSeatsByRoom(
          tx,
          candidateRoomIds,
          { date: session.sessionDate, start: session.startTime, end: session.endTime },
          sessionQuizIds,
        );
        const activeSeatCounts = new Map(
          [...(await this.getActiveSeatCounts(tx, candidateRoomIds)).entries()].map(([roomId, seats]) => [
            roomId,
            Math.max(0, seats - (heldByOthers.get(roomId) ?? 0)),
          ]),
        );
        const totalCapacity = candidateRoomIds.reduce(
          (sum, id) => sum + (activeSeatCounts.get(id) ?? 0),
          0,
        );
        if (totalCapacity < totalStudents) {
          const shortfallDetail: ConflictDetail = {
            type: 'ROOM_UNAVAILABLE',
            message: `Shortfall: ${totalStudents - totalCapacity} student(s), no additional capacity in the selected rooms (${totalCapacity} active seat(s) available for ${totalStudents} student(s)).`,
          };
          throw new ConflictException({
            message: 'Insufficient room capacity for this session — allocation aborted (EC-011).',
            details: [shortfallDetail],
          });
        }

        // Several subjects in several rooms: give every room a mix of every subject (so seating has something
        // to mix). One subject, or a single room, keeps the Best-Fit Decreasing packer.
        const placements =
          groups.length >= 2 && candidateRoomIds.length >= 2
            ? packMixed(
                groups,
                candidateRoomIds.map((id) => ({ roomId: id, capacity: activeSeatCounts.get(id) ?? 0 })),
              )
            : this.bestFitDecreasing(groups, candidateRoomIds, activeSeatCounts);
        const perRoomTotals = new Map<string, number>();
        const placementsByRoom = new Map<string, Placement[]>();
        for (const p of placements) {
          perRoomTotals.set(p.roomId, (perRoomTotals.get(p.roomId) ?? 0) + p.count);
          const existing = placementsByRoom.get(p.roomId);
          if (existing) {
            existing.push(p);
          } else {
            placementsByRoom.set(p.roomId, [p]);
          }
        }

        for (const [roomId, allocatedCapacity] of perRoomTotals) {
          const examSessionRoom = await tx.examSessionRoom.create({
            data: {
              examSessionId,
              roomId,
              allocatedCapacity,
              sessionDate: session.sessionDate,
              startTime: session.startTime,
              endTime: session.endTime,
            },
          });

          // Phase 13 needs this per-(room, quiz) breakdown — otherwise a
          // session whose cohort was split across multiple rooms (EC-005)
          // has no way to recover which students belong in which room;
          // the aggregate `allocatedCapacity` above is ambiguous once more
          // than one quiz/room is involved. Persists exactly what the
          // packer above already computed, nothing new decided here.
          for (const placement of placementsByRoom.get(roomId) ?? []) {
            await tx.examSessionRoomQuiz.create({
              data: {
                examSessionRoomId: examSessionRoom.id,
                quizId: placement.quizId,
                studentCount: placement.count,
              },
            });
          }
        }

        // The real booking now exists, so the seats held for these quizzes have done their job.
        await this.roomHolds.consumeForQuizzes(tx, sessionQuizIds);

        // The "empty columns?" answer given when rooms were requested becomes the seating default: any "yes" wins,
        // "no" when every quiz said no, left unset when nobody was asked.
        const planned = await tx.quiz.findMany({ where: { id: { in: sessionQuizIds } }, select: { emptyColumnsPlanned: true } });
        const answers = planned.map((q) => q.emptyColumnsPlanned).filter((a): a is boolean => a !== null);
        const emptyColumnsPlanned = session.emptyColumnsPlanned ?? (answers.length === 0 ? null : answers.some(Boolean));

        const updated = await tx.examSession.update({
          where: { id: examSessionId },
          data: {
            status: ExamSessionStatus.SEATING_GENERATION,
            requestedRoomIds: [],
            backupRoomId: null,
            roomRejectionReason: null,
            emptyColumnsPlanned,
            version: { increment: 1 },
          },
        });

        await this.auditHook.record(
          {
            actor,
            action: 'UPDATE',
            entityType: 'ExamSession',
            entityId: examSessionId,
            oldValue: { status: session.status },
            newValue: { status: updated.status, roomIds: candidateRoomIds },
          },
          tx,
        );

        if (afterInTransaction) await afterInTransaction(tx);

        return updated;
      })
      .catch((err) => this.mapExclusionViolation(err));

    return updatedSession;
  }

  /** A session sent back to the Rooms step by a "more rooms" request is decided under Room Requests, never through the first-allocation actions. */
  private async assertNoPendingExtraRoomRequest(examSessionId: string): Promise<void> {
    const pending = await this.prisma.examSessionRoomRequest.findFirst({
      where: { examSessionId, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) {
      throw new ConflictException('This session is waiting on a "more rooms" request — approve or decline it under Room Requests.');
    }
  }

  /** Tells the quiz's faculty member and every admin which backup room replaced which unavailable room. */
  private async notifyBackupUsed(
    tx: Prisma.TransactionClient,
    session: ExamSession,
    swaps: { quizTitle: string; ownerFacultyId: string; unavailableRoomId: string; backupRoomId: string }[],
  ): Promise<void> {
    const rooms = await tx.room.findMany({
      where: { id: { in: swaps.flatMap((s) => [s.unavailableRoomId, s.backupRoomId]) } },
      select: { id: true, building: true, roomNumber: true },
    });
    const label = (id: string) => {
      const room = rooms.find((r) => r.id === id);
      return room ? `${room.building}-${room.roomNumber}` : '';
    };
    const admins = await tx.user.findMany({ where: { roles: { some: { role: { name: ROLE.ADMIN } } } }, select: { id: true } });
    const faculty = await tx.faculty.findMany({
      where: { id: { in: swaps.map((s) => s.ownerFacultyId) } },
      select: { id: true, userId: true },
    });
    for (const swap of swaps) {
      const payload = {
        exam_session_id: session.id,
        session_name: session.name,
        quiz_title: swap.quizTitle,
        unavailable_room: label(swap.unavailableRoomId),
        backup_room: label(swap.backupRoomId),
      };
      const owner = faculty.find((f) => f.id === swap.ownerFacultyId);
      const recipients: { type: NotificationRecipientType; id: string }[] = [
        ...(owner ? [{ type: NotificationRecipientType.FACULTY, id: owner.userId }] : []),
        ...admins.map((a) => ({ type: NotificationRecipientType.ADMIN, id: a.id })),
      ];
      for (const recipient of recipients) {
        await this.notificationsOutbox.queue(tx, {
          recipientType: recipient.type,
          recipientId: recipient.id,
          eventType: NotificationEventType.BACKUP_ROOM_USED,
          entityId: `${session.id}:${swap.unavailableRoomId}`,
          entityVersion: swap.backupRoomId,
          payload,
        });
      }
    }
  }

  private async resolveCandidateRoomIds(
    dto: AllocateRoomsDto,
    session: ExamSession,
  ): Promise<string[]> {
    if (!dto.auto) {
      if (dto.room_ids && dto.room_ids.length > 0) {
        return dto.room_ids;
      }
      // Admin approving the faculty's request as-is, with no swap.
      if (session.requestedRoomIds.length > 0) {
        return session.requestedRoomIds;
      }
      throw new BadRequestException('room_ids is required when not using auto allocation.');
    }

    if (dto.candidate_room_ids && dto.candidate_room_ids.length > 0) {
      return dto.candidate_room_ids;
    }

    const available = await this.roomsService.findAvailable({
      date: session.sessionDate.toISOString().slice(0, 10),
      start_time: session.startTime.toISOString().slice(11, 16),
      end_time: session.endTime.toISOString().slice(11, 16),
    });
    return available.map((r) => r.id);
  }

  /** `quiz_student_assignment` rows grouped by quiz (== subject), sorted largest-first for Best-Fit Decreasing. */
  private async getStudentGroupsByQuiz(examSessionId: string): Promise<StudentGroup[]> {
    const grouped = await this.prisma.quizStudentAssignment.groupBy({
      by: ['quizId'],
      where: { examSessionId, status: QuizStudentAssignmentStatus.ASSIGNED },
      _count: { studentId: true },
    });
    return grouped
      .map((g) => ({ quizId: g.quizId, count: g._count.studentId }))
      .sort((a, b) => b.count - a.count);
  }

  private async getActiveSeatCounts(
    tx: Prisma.TransactionClient,
    roomIds: string[],
  ): Promise<Map<string, number>> {
    const grouped = await tx.roomSeat.groupBy({
      by: ['roomId'],
      where: { roomId: { in: roomIds }, isActive: true },
      _count: { id: true },
    });
    const counts = new Map<string, number>(roomIds.map((id) => [id, 0]));
    for (const g of grouped) {
      counts.set(g.roomId, g._count.id);
    }
    return counts;
  }

  /**
   * ARCHITECTURE.md §S: for each student group (largest subject first),
   * place it in the candidate room leaving the least remaining capacity
   * that still fits the WHOLE group ("best fit"); if no single room fits
   * the whole remaining chunk, split it — consuming the room with the
   * MOST remaining capacity first, to minimize how many rooms a split
   * group spans (EC-005: "class larger than any single room" is an
   * explicitly allowed scenario, though §S gives no exact split
   * algorithm — this is a disclosed, reasonable choice). Deterministic:
   * candidate rooms are iterated in the caller-supplied order (itself
   * either the admin's explicit `room_ids` or `findAvailable`'s
   * capacity-ascending order), with ties broken by that same stable order.
   */
  private bestFitDecreasing(
    groups: StudentGroup[],
    roomIds: string[],
    capacities: Map<string, number>,
  ): Placement[] {
    const remaining = new Map(roomIds.map((id) => [id, capacities.get(id) ?? 0]));
    const placements: Placement[] = [];

    for (const group of groups) {
      let toPlace = group.count;
      while (toPlace > 0) {
        const candidates = roomIds
          .map((id) => ({ id, cap: remaining.get(id) ?? 0 }))
          .filter((r) => r.cap > 0);
        if (candidates.length === 0) {
          break; // Should be unreachable — aggregate capacity was pre-checked — but never infinite-loop.
        }

        const exactFit = candidates
          .filter((r) => r.cap >= toPlace)
          .sort((a, b) => a.cap - b.cap)[0];

        if (exactFit) {
          placements.push({ roomId: exactFit.id, quizId: group.quizId, count: toPlace });
          remaining.set(exactFit.id, exactFit.cap - toPlace);
          toPlace = 0;
        } else {
          const largest = candidates.sort((a, b) => b.cap - a.cap)[0];
          placements.push({ roomId: largest.id, quizId: group.quizId, count: largest.cap });
          remaining.set(largest.id, 0);
          toPlace -= largest.cap;
        }
      }
    }

    return placements;
  }

  /**
   * ADR-003 Implementation Notes: map raw constraint-violation errors to a
   * clean 409, never let them leak. The EXCLUDE constraint's violation
   * surfaces as a `PrismaClientUnknownRequestError` (Prisma has no
   * dedicated error code for EXCLUDE, unlike `P2002` for UNIQUE) carrying
   * Postgres's own `23P01 exclusion_violation` in its message — this is
   * the final backstop, reachable only if the row lock were somehow
   * bypassed; every normal path is already caught by
   * `checkRoomAllocation` above.
   */
  private mapExclusionViolation(err: unknown): never {
    if (
      err instanceof Prisma.PrismaClientUnknownRequestError &&
      (err.message.includes('23P01') || err.message.includes('exclusion constraint'))
    ) {
      throw new ConflictException(
        'One or more candidate rooms were concurrently allocated to an overlapping session (BR-018).',
      );
    }
    throw err;
  }
}
