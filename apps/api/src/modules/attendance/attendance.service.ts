import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Attendance, ExamSessionStatus, Prisma, QuizStudentAssignmentStatus, SeatingPlanStatus } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
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
import { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

export interface ListAttendanceParams {
  cursor?: string;
  limit?: number;
}

/**
 * `Attendance` plus the human-readable bits the overview table needs —
 * the raw row carries only `quizStudentAssignmentId`/`seatId`, which is
 * meaningless in a UI without a separate lookup this endpoint's callers
 * don't otherwise have a reason to make.
 */
export interface AttendanceOverviewRow extends Attendance {
  quizStudentAssignment: { student: { name: string; rollNumber: string }; quiz: { title: string } };
  seat: { seatLabel: string };
}

/** No dedicated Nest exception class exists for `423 Locked` (this Nest version's `HttpStatus` enum has no `LOCKED` member) — API_CONTRACT.md's literal `423 Locked` (BR-035) needs the exact code, not the closest built-in (`ConflictException` is 409), so a plain `HttpException` carries it. */
function lockedException(message: string): HttpException {
  return new HttpException(message, 423);
}

/**
 * Owns `attendance` + `attendance_history` (ARCHITECTURE.md §X/§Y,
 * IMPLEMENTATION_PLAN.md Phase 17: "manual + seat-based marking, locking,
 * modification history").
 *
 * Authorization (ARCHITECTURE.md §AF): "Faculty can only mark attendance
 * for `exam_invigilators` rows where they are assigned to that room/
 * session ... default: invigilator-of-record only" — applied identically
 * to `mark` (create) and `update` (modify): the acting faculty must hold
 * an `exam_invigilators` row for the SAME (exam_session_id, room_id) as
 * the attendance row in question. ADMIN bypasses this for `update`
 * (API_CONTRACT.md: `PATCH /attendance/{id}` is "FACULTY/ADMIN") but NOT
 * for `mark` (API_CONTRACT.md's `POST .../attendance` row lists ONLY
 * "FACULTY (invigilator-of-record)", no ADMIN override — a deliberate,
 * literal reading of the two rows' genuinely different documented actor
 * sets, the same "different error sets, not an oversight" posture
 * `QuizzesService.reject`'s own doc comment uses for approve vs reject).
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly examSessionsService: ExamSessionsService,
    private readonly facultyService: FacultyService,
    private readonly studentsService: StudentsService,
  ) {}

  /**
   * `POST /exam-sessions/{id}/attendance`. BR-032 (session IN_PROGRESS +
   * active ASSIGNED assignment), BR-033/EC-027 (duplicate → 409 via both
   * an app-level pre-check AND the `UNIQUE(quiz_student_assignment_id)`
   * backstop), BR-036 (never for CANCELLED — defense in depth alongside
   * BR-032, since a CANCELLED session can never actually BE IN_PROGRESS
   * per the state machine's "any pre-IN_PROGRESS state -> CANCELLED"
   * rule, but this is checked explicitly anyway, same posture as
   * `InvigilationService.assign`'s own CANCELLED guard).
   *
   * `seat_id` is never client-supplied (unlike the DDL sketch's raw
   * column list might suggest) — the request body is exactly
   * `{student_id, status, method}` per API_CONTRACT.md, so the server
   * derives it from the student's own `seating_assignments` row for the
   * quiz being sat (ARCHITECTURE.md §X's own validation rule: "`seat_id`
   * must match the student's `seating_assignments` row for that plan" —
   * trivially true when the server, not the client, is the one setting
   * it).
   */
  async mark(examSessionId: string, dto: MarkAttendanceDto, actor: AuthenticatedUser): Promise<Attendance> {
    const session = await this.examSessionsService.findById(examSessionId);
    if (session.status === ExamSessionStatus.CANCELLED) {
      throw new ConflictException('Attendance cannot be marked for a CANCELLED exam session (BR-036).');
    }
    if (session.status !== ExamSessionStatus.IN_PROGRESS) {
      throw new UnprocessableEntityException(
        `Exam session is in status "${session.status}" — attendance can only be marked while IN_PROGRESS (BR-032).`,
      );
    }

    const assignment = await this.prisma.quizStudentAssignment.findFirst({
      where: { examSessionId, studentId: dto.student_id, status: QuizStudentAssignmentStatus.ASSIGNED },
      orderBy: { createdAt: 'asc' },
    });
    if (!assignment) {
      throw new NotFoundException('This student has no active assignment in this exam session (BR-032).');
    }

    const existing = await this.prisma.attendance.findUnique({
      where: { quizStudentAssignmentId: assignment.id },
    });
    if (existing) {
      throw new ConflictException('Attendance has already been recorded for this student in this quiz (BR-033).');
    }

    const seatingAssignment = await this.prisma.seatingAssignment.findFirst({
      where: {
        quizId: assignment.quizId,
        studentId: dto.student_id,
        seatingPlan: { examSessionId, status: SeatingPlanStatus.FINALIZED },
      },
      include: { seat: true },
    });
    if (!seatingAssignment) {
      throw new ConflictException('No finalized seat assignment exists for this student in this session.');
    }

    const actingFaculty = await this.requireInvigilatorOfRecord(examSessionId, seatingAssignment.seat.roomId, actor);

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.attendance
        .create({
          data: {
            quizStudentAssignmentId: assignment.id,
            seatId: seatingAssignment.seatId,
            status: dto.status,
            method: dto.method,
            markedByFacultyId: actingFaculty.id,
          },
        })
        .catch((err) => this.mapUniqueViolation(err));

      await this.auditHook.record(
        {
          actor,
          action: 'CREATE',
          entityType: 'Attendance',
          entityId: row.id,
          newValue: row,
        },
        tx,
      );

      return row;
    });

    return created;
  }

  /**
   * `PATCH /attendance/{id}`. BR-035: a change to an already-`locked` row
   * requires `reason` (else `423 Locked`, API_CONTRACT.md's exact code)
   * and always produces an `attendance_history` row; a change BEFORE
   * lock also produces a history row (same append-only audit trail, just
   * without the mandatory-reason gate) — see this class's header comment
   * for why both pre- and post-lock changes are logged, not only the
   * post-lock case ARCHITECTURE.md's prose emphasizes. A no-op PATCH
   * (status unchanged) writes no history row — nothing actually changed
   * to record.
   */
  async update(attendanceId: string, dto: UpdateAttendanceDto, actor: AuthenticatedUser): Promise<Attendance> {
    const existing = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: { seat: true, quizStudentAssignment: true },
    });
    if (!existing) {
      throw new NotFoundException();
    }

    const isAdmin = actor.roles.includes(ROLE.ADMIN);
    const actingFaculty = isAdmin
      ? null
      : await this.requireInvigilatorOfRecord(
          existing.quizStudentAssignment.examSessionId,
          existing.seat.roomId,
          actor,
        );

    if (dto.status === existing.status) {
      // No actual change — nothing to justify with a reason, regardless
      // of lock state (BR-035's reason requirement gates a CHANGE, not a
      // resubmission of the current value).
      return existing;
    }

    if (existing.locked && !dto.reason) {
      throw lockedException('This attendance record is locked — a reason is required to change it (BR-035).');
    }

    const changedByFacultyId = actingFaculty
      ? actingFaculty.id
      : (await this.facultyService.findByUserId(actor.id))?.id ?? existing.markedByFacultyId;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.attendance.update({
        where: { id: attendanceId },
        data: { status: dto.status },
      });
      await tx.attendanceHistory.create({
        data: {
          attendanceId,
          changedByFacultyId,
          oldStatus: existing.status,
          newStatus: dto.status,
          reason: dto.reason ?? null,
        },
      });

      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'Attendance',
          entityId: attendanceId,
          oldValue: { status: existing.status },
          newValue: { status: row.status },
          reason: dto.reason,
        },
        tx,
      );

      return row;
    });

    return updated;
  }

  /**
   * `GET /exam-sessions/{id}/attendance` — ADMIN sees every row; FACULTY
   * sees only rows whose seat is in a room they invigilate FOR THIS
   * SESSION (ARCHITECTURE.md §AF "own room"). A faculty invigilating no
   * room in this session simply gets an empty page — the same "filter,
   * never 403, for a relationship-scoped list" posture
   * `NotificationsService.listMine` already established, rather than an
   * explicit forbidden error for a merely-empty result set.
   */
  async listForSession(
    examSessionId: string,
    actor: AuthenticatedUser,
    params: ListAttendanceParams,
  ): Promise<PaginatedResult<AttendanceOverviewRow>> {
    await this.examSessionsService.findById(examSessionId);
    const limit = resolveLimit(params.limit);

    const isAdmin = actor.roles.includes(ROLE.ADMIN);
    let roomFilter: Prisma.AttendanceWhereInput = {};
    if (!isAdmin) {
      const actingFaculty = await this.facultyService.findByUserId(actor.id);
      const roomIds = actingFaculty
        ? (
            await this.prisma.examInvigilator.findMany({
              where: { examSessionId, facultyId: actingFaculty.id },
              select: { roomId: true },
            })
          ).map((r) => r.roomId)
        : [];
      roomFilter = { seat: { roomId: { in: roomIds } } };
    }

    const rows = await this.prisma.attendance.findMany({
      where: { quizStudentAssignment: { examSessionId }, ...roomFilter },
      orderBy: { markedAt: 'desc' },
      include: {
        quizStudentAssignment: {
          select: { student: { select: { name: true, rollNumber: true } }, quiz: { select: { title: true } } },
        },
        seat: { select: { seatLabel: true } },
      },
      ...cursorFindManyArgs(params.cursor, limit),
    });
    return toPaginatedResult(rows as AttendanceOverviewRow[], limit);
  }

  /** `GET /students/{id}/attendance-history` — self/ADMIN, 404-not-403 (same IDOR posture as every other resource-level check). */
  async getHistoryForStudent(
    studentId: string,
    actor: AuthenticatedUser,
    params: ListAttendanceParams,
  ): Promise<PaginatedResult<Attendance & { history: unknown[] }>> {
    const student = await this.studentsService.findById(studentId);
    const isAdmin = actor.roles.includes(ROLE.ADMIN);
    if (!isAdmin && student.userId !== actor.id) {
      throw new NotFoundException();
    }

    const limit = resolveLimit(params.limit);
    const rows = await this.prisma.attendance.findMany({
      where: { quizStudentAssignment: { studentId } },
      include: { history: { orderBy: { changedAt: 'asc' } } },
      orderBy: { markedAt: 'desc' },
      ...cursorFindManyArgs(params.cursor, limit),
    });
    return toPaginatedResult(rows as (Attendance & { history: unknown[] })[], limit);
  }

  /** BR-020-style resource-level check: 403 (a real authorization failure on an authenticated, correctly-roled FACULTY), not 404 — mirrors `QuizzesService.assertNotSelfReview`'s BR-014 posture, not `ScopedRepository`'s IDOR posture (there is no ambiguity here about whether the resource "exists"). */
  private async requireInvigilatorOfRecord(
    examSessionId: string,
    roomId: string,
    actor: AuthenticatedUser,
  ): Promise<{ id: string }> {
    const actingFaculty = await this.facultyService.findByUserId(actor.id);
    if (!actingFaculty) {
      throw new ForbiddenException('Only an invigilator-of-record for this room may perform this action.');
    }
    const invigilatorRow = await this.prisma.examInvigilator.findFirst({
      where: { examSessionId, roomId, facultyId: actingFaculty.id },
      select: { facultyId: true },
    });
    if (!invigilatorRow) {
      throw new ForbiddenException('Only an invigilator-of-record for this room may perform this action.');
    }
    return actingFaculty;
  }

  private mapUniqueViolation(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Attendance has already been recorded for this student in this quiz (BR-033).');
    }
    throw err;
  }
}
