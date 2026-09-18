import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ExamSession,
  ExamSessionStatus,
  ImportJob,
  Prisma,
  QuizStudentAssignment,
  QuizStudentAssignmentStatus,
} from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { runSerializable } from '../../common/prisma/serializable-transaction';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { ImportJobsService } from '../../common/import-jobs/import-jobs.service';
import { ImportRowResult } from '../../common/import-jobs/import-jobs.types';
import { PaginatedResult, PaginationParams, cursorFindManyArgs, resolveLimit, toPaginatedResult } from '../../common/pagination/paginate';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { ExamSessionsService } from '../exam-session';
import { ConflictEngineService } from '../conflict-engine';
import { QuizzesService } from '../quiz';
import { StudentsService } from '../students';
import { EnrollmentsService } from '../enrollment';
import { AddRosterEntryDto } from './dto/add-roster-entry.dto';
import { RemoveRosterEntryDto } from './dto/remove-roster-entry.dto';

/** Either the top-level PrismaService or an interactive-transaction client. */
type PrismaOrTx = PrismaService | Prisma.TransactionClient;

/** Chunk size for the assignment-generation loop (EC-034: "chunked into sub-transactions ... e.g., batches of 500" — the doc gives this as an example, not a mandated exact number; 200 keeps each transaction small while still batching). */
const ASSIGNMENT_CHUNK_SIZE = 200;

/**
 * Owns `quiz_student_assignments` (ARCHITECTURE.md §P, IMPLEMENTATION_PLAN.md
 * Phase 9). No real queue infrastructure exists yet (workers/* are Phase 0
 * skeletons; BullMQ/Redis land in Phase 15) — same disclosed precedent as
 * Phase 3's `ImportJobsService`: eligibility-derivation processing here is
 * synchronous-but-chunked, and the response shape (`{job_id, ...}` via
 * `ImportJobsService`) already matches what a real async queue would
 * produce, so callers won't need to change when Phase 15 lands.
 *
 * Phase 10 wires the REAL Conflict Engine's BR-019 check into BOTH
 * assignment-creation paths here (`assignStudents`, `addRosterEntry`) —
 * not just into exam-session attach/reschedule. BR-019's invariant is
 * ultimately about `quiz_student_assignment` rows (ARCHITECTURE.md §Q:
 * "student has ANOTHER quiz_student_assignment ... overlapping"); checking
 * only at attach-time would leave a real race open — two sessions with no
 * assignments yet can each pass an attach-time check, then each
 * `assign-students` independently, producing two genuinely-overlapping
 * assignments neither attach-time check ever saw. Each per-quiz batch (and
 * each manual add) therefore re-checks and writes atomically inside a
 * `SERIALIZABLE` transaction (`runSerializable`), same as
 * exam-sessions.service.ts. Anything past the ASSIGNING_STUDENTS state
 * (ROOM_ALLOCATION onward) remains Phase 11+, out of scope here.
 */
@Injectable()
export class StudentAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly importJobsService: ImportJobsService,
    private readonly examSessionsService: ExamSessionsService,
    private readonly conflictEngine: ConflictEngineService,
    private readonly quizzesService: QuizzesService,
    private readonly studentsService: StudentsService,
    private readonly enrollmentsService: EnrollmentsService,
  ) {}

  /**
   * `POST /exam-sessions/{id}/assign-students` — ADMIN only (enforced at
   * the controller). ARCHITECTURE.md §AD-2's DRAFT->ASSIGNING_STUDENTS
   * transition: only permitted while the session is DRAFT and has at
   * least one actively-attached quiz (both attach-time invariants from
   * Phase 8 guarantee every attached quiz is already APPROVED). For each
   * attached quiz, derives its eligible roster (BR-005, via
   * `EnrollmentsService.findEligibleStudentIds`) and upserts an ASSIGNED
   * `quiz_student_assignment` row per (quiz, student) pair — idempotent by
   * construction (`UNIQUE(quiz_id, student_id)`): re-running against an
   * already-assigned pair is a no-op, and a previously-CANCELLED pair
   * (e.g. from a roster removal before this ran) is reactivated. Once
   * generation completes, the session transitions DRAFT -> ASSIGNING_STUDENTS;
   * calling this again on the same session afterward correctly 409s (not
   * DRAFT), which is this endpoint's own idempotency guard at the session
   * level.
   */
  async assignStudents(
    examSessionId: string,
    actor: AuthenticatedUser,
  ): Promise<{ importJob: ImportJob; examSession: ExamSession }> {
    const session = await this.examSessionsService.findById(examSessionId);
    if (session.status !== ExamSessionStatus.DRAFT) {
      throw new ConflictException(
        `Exam session is in status "${session.status}" and students can only be assigned while DRAFT.`,
      );
    }

    const attachments = await this.prisma.examSessionQuiz.findMany({
      where: { examSessionId, isActiveAttachment: true },
      select: { quizId: true },
    });
    if (attachments.length === 0) {
      throw new ConflictException('At least one quiz must be attached before assigning students.');
    }

    const results: ImportRowResult[] = [];
    let successCount = 0;
    let failureCount = 0;
    let rowNumber = 0;

    for (const { quizId } of attachments) {
      const quiz = await this.quizzesService.findById(quizId);
      const batchIds = await this.quizzesService.getBatchIds(quizId);
      const eligibleStudentIds = await this.enrollmentsService.findEligibleStudentIds(
        quiz.subjectId,
        batchIds,
        quiz.academicYear,
        quiz.semester,
      );

      // Check-then-write, atomically, per quiz: the real BR-019 check
      // (against this quiz's whole eligible roster) and every one of that
      // quiz's assignment upserts happen inside ONE SERIALIZABLE
      // transaction, so a concurrent assign-students/roster-add for a
      // DIFFERENT, overlapping-time session touching the same student
      // can't race past this one undetected (ADR-003).
      const quizResults = await runSerializable(this.prisma, async (tx) => {
        const conflictResult = await this.conflictEngine.checkSessionAssembly(
          {
            examSessionId,
            quizIds: [quizId],
            sessionDate: session.sessionDate,
            startTime: session.startTime,
            endTime: session.endTime,
          },
          tx,
        );
        const conflictedStudentIds = new Set(
          conflictResult.hard.filter((d) => d.type === 'STUDENT_OVERLAP').map((d) => d.studentId),
        );

        const rows: ImportRowResult[] = [];
        for (const chunk of this.chunk(eligibleStudentIds, ASSIGNMENT_CHUNK_SIZE)) {
          for (const studentId of chunk) {
            if (conflictedStudentIds.has(studentId)) {
              rows.push({
                row: 0, // renumbered below, once merged across all quizzes
                status: 'FAILURE',
                error: `Student "${studentId}" already has an overlapping active assignment elsewhere (BR-019).`,
              });
              continue;
            }
            try {
              await this.upsertAssignment(quizId, examSessionId, studentId, tx);
              rows.push({ row: 0, status: 'SUCCESS', id: `${quizId}:${studentId}` });
            } catch (err) {
              rows.push({
                row: 0,
                status: 'FAILURE',
                error: err instanceof Error ? err.message : 'Unknown error',
              });
            }
          }
        }
        return rows;
      });

      for (const row of quizResults) {
        rowNumber += 1;
        results.push({ ...row, row: rowNumber });
        if (row.status === 'SUCCESS') {
          successCount++;
        } else {
          failureCount++;
        }
      }
    }

    const updatedSession = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.examSession.update({
        where: { id: examSessionId },
        data: { status: ExamSessionStatus.ASSIGNING_STUDENTS, version: { increment: 1 } },
      });

      await this.auditHook.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'ExamSession',
          entityId: examSessionId,
          oldValue: { status: session.status },
          newValue: { status: updated.status, assignmentsCreated: successCount },
        },
        tx,
      );

      return updated;
    });

    const importJob = await this.importJobsService.create({
      resourceType: 'quiz_student_assignments',
      totalRows: rowNumber,
      successCount,
      failureCount,
      results,
      createdByUserId: actor.id,
    });

    return { importJob, examSession: updatedSession };
  }

  /**
   * `GET /exam-sessions/{id}/roster` — ADMIN or a FACULTY who owns at
   * least one actively-attached quiz (reuses `ExamSessionsService`'s own
   * scoped-GET rule, §exam-sessions-access.repository.ts — a faculty who
   * clears that gate sees the WHOLE roster, same session-level granularity
   * already established by `GET /exam-sessions/{id}` in Phase 8, not
   * filtered further to just their own quiz's assignees).
   */
  async getRoster(
    examSessionId: string,
    actor: AuthenticatedUser,
    params: PaginationParams & { status?: QuizStudentAssignmentStatus },
  ): Promise<PaginatedResult<QuizStudentAssignment>> {
    await this.examSessionsService.findByIdScoped(examSessionId, actor);

    const limit = resolveLimit(params.limit);
    const rows = await this.prisma.quizStudentAssignment.findMany({
      where: { examSessionId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { id: 'asc' },
      ...cursorFindManyArgs(params.cursor, limit),
    });

    return toPaginatedResult(rows, limit);
  }

  /**
   * `POST /exam-sessions/{id}/roster/{student_id}` — ADMIN only. Manual
   * add (EC-015: late arrival / waitlist promotion). Still enforces BR-005
   * eligibility (enrolled in the target quiz's subject, within one of its
   * batches, for that quiz's academic_year/semester) — "manual" means
   * admin-triggered, not a bypass of eligibility itself; nothing in the
   * documentation suggests an admin can assign an ineligible student.
   * Idempotent: re-adding an already-ASSIGNED pair is a no-op; a
   * previously-CANCELLED pair is reactivated (EC-015's own "recovery path
   * for late additions" framing).
   */
  async addRosterEntry(
    examSessionId: string,
    studentId: string,
    dto: AddRosterEntryDto,
    actor: AuthenticatedUser,
  ): Promise<QuizStudentAssignment> {
    const session = await this.examSessionsService.findById(examSessionId);
    if (session.status === ExamSessionStatus.CANCELLED) {
      throw new ConflictException('Exam session is CANCELLED and its roster cannot be modified.');
    }

    const activeAttachment = await this.prisma.examSessionQuiz.findFirst({
      where: { examSessionId, quizId: dto.quiz_id, isActiveAttachment: true },
    });
    if (!activeAttachment) {
      throw new NotFoundException('Quiz is not actively attached to this exam session.');
    }

    const student = await this.studentsService.findById(studentId);
    const quiz = await this.quizzesService.findById(dto.quiz_id);
    const batchIds = await this.quizzesService.getBatchIds(dto.quiz_id);
    const eligibleStudentIds = await this.enrollmentsService.findEligibleStudentIds(
      quiz.subjectId,
      batchIds,
      quiz.academicYear,
      quiz.semester,
    );
    if (!eligibleStudentIds.includes(student.id)) {
      throw new ConflictException(
        `Student "${student.id}" is not eligible for quiz "${dto.quiz_id}" (not ENROLLED in its subject/batch for this academic_year/semester — BR-005).`,
      );
    }

    const existing = await this.prisma.quizStudentAssignment.findUnique({
      where: { quizId_studentId: { quizId: dto.quiz_id, studentId: student.id } },
    });

    if (existing?.status === QuizStudentAssignmentStatus.ASSIGNED) {
      return existing; // Idempotent no-op — already actively assigned.
    }

    // BR-019 check-then-write, atomically (same reasoning as
    // `assignStudents` — this is the other place a new
    // `quiz_student_assignment` row gets created).
    const assignment = await runSerializable(this.prisma, async (tx) => {
      const conflictResult = await this.conflictEngine.checkSessionAssembly(
        {
          examSessionId,
          quizIds: [dto.quiz_id],
          sessionDate: session.sessionDate,
          startTime: session.startTime,
          endTime: session.endTime,
        },
        tx,
      );
      const conflicted = conflictResult.hard.find(
        (d) => d.type === 'STUDENT_OVERLAP' && d.studentId === student.id,
      );
      if (conflicted) {
        throw new ConflictException({ message: conflicted.message, details: [conflicted] });
      }

      const created = await this.upsertAssignment(dto.quiz_id, examSessionId, student.id, tx);

      await this.auditHook.record(
        {
          actor,
          action: existing ? 'REACTIVATE' : 'CREATE',
          entityType: 'QuizStudentAssignment',
          entityId: created.id,
          oldValue: existing ?? undefined,
          newValue: created,
        },
        tx,
      );

      return created;
    });

    return assignment;
  }

  /**
   * `DELETE /exam-sessions/{id}/roster/{student_id}` — ADMIN only, reason
   * required (EC-016: "cancels assignment", status -> CANCELLED, never a
   * physical delete — BR-006's "not deleted" and this table's schema
   * comment mirroring `ExamSessionQuiz.detachedAt`).
   */
  async removeRosterEntry(
    examSessionId: string,
    studentId: string,
    dto: RemoveRosterEntryDto,
    actor: AuthenticatedUser,
  ): Promise<QuizStudentAssignment> {
    await this.examSessionsService.findById(examSessionId); // 404 if the session itself doesn't exist

    const existing = await this.prisma.quizStudentAssignment.findUnique({
      where: { quizId_studentId: { quizId: dto.quiz_id, studentId } },
    });
    if (!existing || existing.examSessionId !== examSessionId) {
      throw new NotFoundException();
    }
    if (existing.status === QuizStudentAssignmentStatus.CANCELLED) {
      throw new ConflictException('This assignment is already cancelled.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.quizStudentAssignment.update({
        where: { id: existing.id },
        data: { status: QuizStudentAssignmentStatus.CANCELLED, cancelledAt: new Date() },
      });

      await this.auditHook.record(
        {
          actor,
          action: 'DEACTIVATE',
          entityType: 'QuizStudentAssignment',
          entityId: changed.id,
          oldValue: existing,
          newValue: changed,
          reason: dto.reason,
        },
        tx,
      );

      return changed;
    });

    return updated;
  }

  /**
   * Create-or-reactivate a single (quiz, student) assignment.
   * `UNIQUE(quiz_id, student_id)` (ADR-003 item (b)) is the actual
   * duplicate-assignment guard under concurrency — this upsert relies on
   * it rather than a separate app-level lock, translating a genuine race
   * (two concurrent calls for the same pair) into a `ConflictException`
   * instead of an unhandled 500.
   */
  private async upsertAssignment(
    quizId: string,
    examSessionId: string,
    studentId: string,
    client: PrismaOrTx = this.prisma,
  ): Promise<QuizStudentAssignment> {
    try {
      return await client.quizStudentAssignment.upsert({
        where: { quizId_studentId: { quizId, studentId } },
        create: { quizId, examSessionId, studentId, status: QuizStudentAssignmentStatus.ASSIGNED },
        update: {
          status: QuizStudentAssignmentStatus.ASSIGNED,
          assignedAt: new Date(),
          cancelledAt: null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          `Student "${studentId}" is already assigned to quiz "${quizId}".`,
        );
      }
      throw err;
    }
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }
}
