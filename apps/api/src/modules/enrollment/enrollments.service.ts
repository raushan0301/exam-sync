import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StudentSubjectEnrollment, EnrollmentStatus } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';
import { ImportJobsService } from '../../common/import-jobs/import-jobs.service';
import { ImportRowResult } from '../../common/import-jobs/import-jobs.types';
import { StudentsService } from '../students';
import { SubjectsService, BatchesService } from '../academic-structure';
import { FacultyAssignmentsService } from '../faculty-assignment';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';

/**
 * Owns `student_subject_enrollment` — the source of truth for quiz
 * eligibility (PRD.md FR-012, BUSINESS_RULES.md BR-004/005/006). This
 * service's `isEnrolled` method is the literal implementation of BR-005
 * ("batch membership alone does NOT grant subject eligibility") and is the
 * most safety-critical piece of this phase — see its tests.
 */
@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly studentsService: StudentsService,
    private readonly subjectsService: SubjectsService,
    private readonly batchesService: BatchesService,
    private readonly facultyAssignmentsService: FacultyAssignmentsService,
    private readonly importJobsService: ImportJobsService,
  ) {}

  async create(
    dto: CreateEnrollmentDto,
    actor: AuthenticatedUser,
  ): Promise<StudentSubjectEnrollment> {
    await this.studentsService.findById(dto.student_id);
    await this.subjectsService.findById(dto.subject_id);
    // `batch_id` is intentionally NOT validated against the student's
    // *current* batch — see StudentSubjectEnrollment's schema comment
    // (EC-017: independent, point-in-time snapshot). Only that the batch
    // itself exists is checked here.
    await this.batchesService.findById(dto.batch_id);

    const existing = await this.prisma.studentSubjectEnrollment.findUnique({
      where: {
        studentId_subjectId_academicYear_semester: {
          studentId: dto.student_id,
          subjectId: dto.subject_id,
          academicYear: dto.academic_year,
          semester: dto.semester,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        'This student is already enrolled in this subject for this academic year/semester.',
      );
    }

    const enrollment = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.studentSubjectEnrollment.create({
          data: {
            studentId: dto.student_id,
            subjectId: dto.subject_id,
            batchId: dto.batch_id,
            academicYear: dto.academic_year,
            semester: dto.semester,
          },
        });

        await this.auditHook.record(
          {
            actor,
            action: 'CREATE',
            entityType: 'StudentSubjectEnrollment',
            entityId: created.id,
            newValue: created,
          },
          tx,
        );

        return created;
      })
      .catch((err) => this.mapUniqueViolation(err));

    return enrollment;
  }

  async findById(id: string): Promise<StudentSubjectEnrollment> {
    const enrollment = await this.prisma.studentSubjectEnrollment.findUnique({ where: { id } });
    if (!enrollment) {
      throw new NotFoundException();
    }
    return enrollment;
  }

  /**
   * `GET /students/{id}/enrollments` (self / ADMIN / teaching FACULTY).
   * Unlike StudentsAccessRepository's "teaches this student's CURRENT
   * batch" rule, this reuses the exact same
   * `isFacultyTeachingBatch(actor, student.batchId)` check for consistency
   * — a faculty member either has visibility into a student's academic
   * life or they don't; there is no reason for the two endpoints to apply
   * different rules for "is this my student."
   */
  async listForStudent(
    studentId: string,
    actor: AuthenticatedUser,
  ): Promise<StudentSubjectEnrollment[]> {
    const student = await this.studentsService.findById(studentId);

    const isSelf = student.userId === actor.id;
    const isAdmin = actor.roles.includes(ROLE.ADMIN);
    const isTeachingFaculty =
      !isSelf &&
      !isAdmin &&
      actor.roles.includes(ROLE.FACULTY) &&
      (await this.facultyAssignmentsService.isFacultyTeachingBatch(actor.id, student.batchId));

    if (!isSelf && !isAdmin && !isTeachingFaculty) {
      // 404, not 403 — same IDOR-safe pattern as StudentsAccessRepository;
      // this endpoint is nested under /students/{id}, so an unauthorized
      // caller must not learn whether the student id even exists.
      throw new NotFoundException();
    }

    return this.prisma.studentSubjectEnrollment.findMany({
      where: { studentId },
      orderBy: { enrolledAt: 'asc' },
    });
  }

  /**
   * `PATCH /enrollments/{id}` (ADMIN only, per API_CONTRACT.md — unlike
   * creation, which also allows FACULTY). No enrollment-status state
   * machine is defined anywhere in the documentation (FR-011 just lists
   * the five values), so any status is accepted; entering/leaving DROPPED
   * sets/clears `droppedAt` as the one piece of bookkeeping the schema
   * itself calls for (BR-006 references `dropped_at`).
   */
  async update(
    id: string,
    dto: UpdateEnrollmentDto,
    actor: AuthenticatedUser,
  ): Promise<StudentSubjectEnrollment> {
    const existing = await this.findById(id);

    const enteringDropped = dto.status === EnrollmentStatus.DROPPED;
    const leavingDropped = existing.status === EnrollmentStatus.DROPPED && !enteringDropped;
    const droppedAt = enteringDropped ? new Date() : leavingDropped ? null : existing.droppedAt;

    const enrollment = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.studentSubjectEnrollment.update({
        where: { id },
        data: { status: dto.status, droppedAt },
      });

      await this.auditHook.record(
        {
          actor,
          action: dto.status === EnrollmentStatus.DROPPED ? 'DEACTIVATE' : 'UPDATE',
          entityType: 'StudentSubjectEnrollment',
          entityId: updated.id,
          oldValue: existing,
          newValue: updated,
        },
        tx,
      );

      return updated;
    });

    return enrollment;
  }

  /**
   * BR-005's literal implementation: "Batch membership alone does NOT
   * grant subject eligibility — only an ENROLLED enrollment row does."
   * This is the function PRD.md FR-012 (quiz eligibility) and Phase 6+
   * will call; it deliberately does NOT accept or consult a batch_id —
   * only a matching, currently-ENROLLED enrollment row proves eligibility.
   */
  async isEnrolled(
    studentId: string,
    subjectId: string,
    academicYear: string,
    semester: number,
  ): Promise<boolean> {
    const enrollment = await this.prisma.studentSubjectEnrollment.findUnique({
      where: {
        studentId_subjectId_academicYear_semester: {
          studentId,
          subjectId,
          academicYear,
          semester,
        },
      },
    });
    return enrollment?.status === EnrollmentStatus.ENROLLED;
  }

  /**
   * Bulk counterpart to `isEnrolled`, added for Phase 9 (Student
   * Assignment): "derive eligible students from enrollment" (BR-005
   * applied concretely — ARCHITECTURE.md §P) for a whole quiz at once,
   * rather than one student at a time. Matches on the ENROLLED
   * enrollment row's OWN `batchId` (the point-in-time snapshot, EC-017),
   * not the student's current batch — same rule `isEnrolled` follows,
   * just evaluated against a set of target batches instead of a single
   * known student.
   */
  async findEligibleStudentIds(
    subjectId: string,
    batchIds: string[],
    academicYear: string,
    semester: number,
  ): Promise<string[]> {
    if (batchIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.studentSubjectEnrollment.findMany({
      where: {
        subjectId,
        academicYear,
        semester,
        status: EnrollmentStatus.ENROLLED,
        batchId: { in: batchIds },
      },
      select: { studentId: true },
    });
    return rows.map((r) => r.studentId);
  }

  /**
   * `POST /enrollments/bulk` (ADMIN only). Mirrors students.service.ts's
   * bulkImport structure exactly (Phase 3 precedent): synchronous
   * processing, one bad row never blocks the rest (EC-044), reported via
   * the same generic ImportJob/ImportJobsService.
   */
  async bulkCreate(
    rows: CreateEnrollmentDto[],
    actor: AuthenticatedUser,
  ) {
    const results: ImportRowResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      try {
        const enrollment = await this.create(rows[i], actor);
        results.push({ row: rowNumber, status: 'SUCCESS', id: enrollment.id });
        successCount++;
      } catch (err) {
        results.push({
          row: rowNumber,
          status: 'FAILURE',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
        failureCount++;
      }
    }

    return this.importJobsService.create({
      resourceType: 'enrollments',
      totalRows: rows.length,
      successCount,
      failureCount,
      results,
      createdByUserId: actor.id,
    });
  }

  private mapUniqueViolation(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(
        'This student is already enrolled in this subject for this academic year/semester.',
      );
    }
    throw err;
  }
}
