import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, FacultySubjectBatchAssignment } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import {
  cursorFindManyArgs,
  PaginatedResult,
  resolveLimit,
  toPaginatedResult,
} from '../../common/pagination/paginate';
import { FacultyService } from '../faculty';
import { SubjectsService, BatchesService } from '../academic-structure';
import { CreateFacultyAssignmentDto } from './dto/create-faculty-assignment.dto';

/**
 * Owns `faculty_subject_batch_assignment` — the source of truth for "who
 * teaches what to whom" (DOMAIN_MODEL.md, BUSINESS_RULES.md BR-007/008/009).
 * This is the acceptance-criteria-defining scenario for this phase:
 * "Faculty A teaches DBMS to Batch A and B; Faculty B teaches DBMS to
 * Batch C" must be representable and queryable — see this class's tests.
 */
@Injectable()
export class FacultyAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly facultyService: FacultyService,
    private readonly subjectsService: SubjectsService,
    private readonly batchesService: BatchesService,
  ) {}

  async create(
    dto: CreateFacultyAssignmentDto,
    actor: AuthenticatedUser,
  ): Promise<FacultySubjectBatchAssignment> {
    // BR-007: only Admin can create these (enforced at the controller via
    // RolesGuard); here we validate the three FK targets actually exist.
    await this.facultyService.findById(dto.faculty_id);
    await this.subjectsService.findById(dto.subject_id);
    await this.batchesService.findById(dto.batch_id);

    const existing = await this.prisma.facultySubjectBatchAssignment.findUnique({
      where: {
        facultyId_subjectId_batchId_academicYear_semester: {
          facultyId: dto.faculty_id,
          subjectId: dto.subject_id,
          batchId: dto.batch_id,
          academicYear: dto.academic_year,
          semester: dto.semester,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        'This exact faculty/subject/batch/academic-year/semester assignment already exists.',
      );
    }

    const assignment = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.facultySubjectBatchAssignment.create({
          data: {
            facultyId: dto.faculty_id,
            subjectId: dto.subject_id,
            batchId: dto.batch_id,
            academicYear: dto.academic_year,
            semester: dto.semester,
            role: dto.role,
          },
        });

        await this.auditHook.record(
          {
            actor,
            action: 'CREATE',
            entityType: 'FacultySubjectBatchAssignment',
            entityId: created.id,
            newValue: created,
          },
          tx,
        );

        return created;
      })
      .catch((err) => this.mapUniqueViolation(err));

    return assignment;
  }

  async findById(id: string): Promise<FacultySubjectBatchAssignment> {
    const assignment = await this.prisma.facultySubjectBatchAssignment.findUnique({ where: { id } });
    if (!assignment) {
      throw new NotFoundException();
    }
    return assignment;
  }

  /**
   * `GET /faculty/{id}/assignments` — `id` here is the Faculty row id (not
   * the user id). No pagination params are in API_CONTRACT.md's terse
   * "list of ... rows" note, but the same cursor-paginated shape used
   * everywhere else in this codebase is applied for consistency.
   */
  async listForFaculty(
    facultyId: string,
    params: { cursor?: string; limit?: number },
  ): Promise<PaginatedResult<FacultySubjectBatchAssignment>> {
    const limit = resolveLimit(params.limit);
    const rows = await this.prisma.facultySubjectBatchAssignment.findMany({
      ...cursorFindManyArgs(params.cursor, limit),
      where: { facultyId },
      orderBy: { createdAt: 'asc' },
    });
    return toPaginatedResult(rows, limit);
  }

  /**
   * `DELETE /faculty-assignments/{id}` — API_CONTRACT.md: "soft — sets an
   * end date, does not hard-delete if historical quizzes reference it."
   * Never a physical DELETE, regardless of whether anything references it
   * yet (nothing does in Phase 5 — quizzes land in Phase 6 — but the
   * soft-only behavior is unconditional, not contingent on checking for
   * references first).
   */
  async end(id: string, actor: AuthenticatedUser): Promise<FacultySubjectBatchAssignment> {
    const existing = await this.findById(id);
    if (existing.endedAt) {
      throw new ConflictException('This assignment has already ended.');
    }

    const ended = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.facultySubjectBatchAssignment.update({
        where: { id },
        data: { endedAt: new Date() },
      });

      await this.auditHook.record(
        {
          actor,
          action: 'DEACTIVATE',
          entityType: 'FacultySubjectBatchAssignment',
          entityId: updated.id,
          oldValue: existing,
          newValue: updated,
        },
        tx,
      );

      return updated;
    });

    return ended;
  }

  /**
   * Cross-module authorization helper (Phase 5's fulfillment of the
   * "Phase 5 extension point" flagged in students-access.repository.ts —
   * see that file). True iff `facultyUserId` (an Authenticated actor's
   * user id) currently has an ACTIVE (endedAt IS NULL) assignment for
   * `batchId`, for any subject.
   */
  async isFacultyTeachingBatch(facultyUserId: string, batchId: string): Promise<boolean> {
    const count = await this.prisma.facultySubjectBatchAssignment.count({
      where: {
        batchId,
        endedAt: null,
        faculty: { userId: facultyUserId },
      },
    });
    return count > 0;
  }

  /**
   * BR-010's implementation: "Faculty may only create a quiz for
   * (subject_id, batch_id) pairs present in their own
   * faculty_subject_batch_assignment rows." True iff `facultyId` (a
   * Faculty row id, NOT a user id — see FacultyService.findByUserId for
   * that mapping) holds an ACTIVE (endedAt IS NULL) assignment for exactly
   * this (subjectId, batchId) pair, any role (PRIMARY_INSTRUCTOR or
   * CO_INSTRUCTOR both count as "assigned to teach").
   *
   * Deliberately strengthened beyond BR-010's literal (subject_id,
   * batch_id)-only wording to ALSO require academicYear/semester to
   * match: `faculty_subject_batch_assignment`'s own uniqueness is
   * inherently scoped by (faculty, subject, batch, academic_year,
   * semester) — checking only (subject, batch) would let a faculty who
   * taught something in a past term indefinitely author quizzes for a
   * subject/batch they are no longer currently assigned to. Flagged as a
   * reasoned strengthening, not a weakening, of the documented rule.
   */
  async hasActiveAssignment(
    facultyId: string,
    subjectId: string,
    batchId: string,
    academicYear: string,
    semester: number,
  ): Promise<boolean> {
    const count = await this.prisma.facultySubjectBatchAssignment.count({
      where: { facultyId, subjectId, batchId, academicYear, semester, endedAt: null },
    });
    return count > 0;
  }

  /**
   * ARCHITECTURE.md §AF: a faculty may GET/PATCH a quiz they didn't create
   * if they hold a CO_INSTRUCTOR assignment "on it" — read as: an active
   * CO_INSTRUCTOR assignment for the quiz's subject and at least one of
   * its target batches.
   */
  async hasActiveCoInstructorAssignment(
    facultyId: string,
    subjectId: string,
    batchIds: string[],
  ): Promise<boolean> {
    const count = await this.prisma.facultySubjectBatchAssignment.count({
      where: {
        facultyId,
        subjectId,
        batchId: { in: batchIds },
        role: 'CO_INSTRUCTOR',
        endedAt: null,
      },
    });
    return count > 0;
  }

  private mapUniqueViolation(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(
        'This exact faculty/subject/batch/academic-year/semester assignment already exists.',
      );
    }
    throw err;
  }
}
