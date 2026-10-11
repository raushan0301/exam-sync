import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StudentSubjectEnrollment, EnrollmentStatus, ImportJob } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';
import { ImportJobsService } from '../../common/import-jobs/import-jobs.service';
import { ImportRowResult } from '../../common/import-jobs/import-jobs.types';
import { parseExcelBuffer } from '../../common/bulk-import/parse-excel';
import { generateExcelTemplate } from '../../common/bulk-import/generate-template';
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
    const uniq = (vals: string[]) => [...new Set(vals)];
    const [students, subjects, batches] = await Promise.all([
      this.prisma.student.findMany({ where: { id: { in: uniq(rows.map((r) => r.student_id)) } }, select: { id: true } }),
      this.prisma.subject.findMany({ where: { id: { in: uniq(rows.map((r) => r.subject_id)) } }, select: { id: true } }),
      this.prisma.batch.findMany({ where: { id: { in: uniq(rows.map((r) => r.batch_id)) } }, select: { id: true } }),
    ]);
    const studentIds = new Set(students.map((x) => x.id));
    const subjectIds = new Set(subjects.map((x) => x.id));
    const batchIds = new Set(batches.map((x) => x.id));

    return this.runBulk(
      rows.map((dto, i) => ({
        rowNumber: i + 1,
        resolve: () => {
          if (!studentIds.has(dto.student_id)) throw new NotFoundException('Student not found');
          if (!subjectIds.has(dto.subject_id)) throw new NotFoundException('Subject not found');
          if (!batchIds.has(dto.batch_id)) throw new NotFoundException('Batch not found');
          return dto;
        },
      })),
      actor,
    );
  }

  /**
   * Fixed number of queries regardless of row count (the old per-row loop
   * cost ~7 sequential round trips to the remote database PER enrollment):
   * one duplicate lookup, one batched insert, one batched audit write.
   * One bad row never blocks the rest (EC-044).
   */
  private async runBulk(
    items: { rowNumber: number; resolve: () => CreateEnrollmentDto }[],
    actor: AuthenticatedUser,
  ): Promise<ImportJob> {
    const failures = new Map<number, string>();
    const created = new Map<number, string>();
    const valid: { rowNumber: number; dto: CreateEnrollmentDto }[] = [];

    for (const item of items) {
      try {
        valid.push({ rowNumber: item.rowNumber, dto: item.resolve() });
      } catch (err) {
        failures.set(item.rowNumber, err instanceof Error ? err.message : 'Unknown error');
      }
    }

    if (valid.length > 0) {
      await this.insertEnrollments(valid, actor, created, failures);
    }

    const results: ImportRowResult[] = items.map((item) =>
      created.has(item.rowNumber)
        ? { row: item.rowNumber, status: 'SUCCESS', id: created.get(item.rowNumber) }
        : { row: item.rowNumber, status: 'FAILURE', error: failures.get(item.rowNumber) ?? 'Unknown error' },
    );

    return this.importJobsService.create({
      resourceType: 'enrollments',
      totalRows: items.length,
      successCount: created.size,
      failureCount: items.length - created.size,
      results,
      createdByUserId: actor.id,
    });
  }

  private async insertEnrollments(
    valid: { rowNumber: number; dto: CreateEnrollmentDto }[],
    actor: AuthenticatedUser,
    created: Map<number, string>,
    failures: Map<number, string>,
  ): Promise<void> {
    const ALREADY = 'This student is already enrolled in this subject for this academic year/semester.';
    const keyOf = (d: CreateEnrollmentDto) => `${d.student_id}|${d.subject_id}|${d.academic_year}|${d.semester}`;
    const uniq = <T,>(vals: T[]) => [...new Set(vals)];

    // Superset query (each column IN its own values), then exact-match in memory.
    const existing = await this.prisma.studentSubjectEnrollment.findMany({
      where: {
        studentId: { in: uniq(valid.map((v) => v.dto.student_id)) },
        subjectId: { in: uniq(valid.map((v) => v.dto.subject_id)) },
        academicYear: { in: uniq(valid.map((v) => v.dto.academic_year)) },
        semester: { in: uniq(valid.map((v) => v.dto.semester)) },
      },
      select: { studentId: true, subjectId: true, academicYear: true, semester: true },
    });
    const taken = new Set(existing.map((e) => `${e.studentId}|${e.subjectId}|${e.academicYear}|${e.semester}`));

    const toCreate: typeof valid = [];
    for (const v of valid) {
      const key = keyOf(v.dto);
      if (taken.has(key)) {
        failures.set(v.rowNumber, ALREADY);
      } else {
        taken.add(key); // a repeat later in the same file now counts as already enrolled
        toCreate.push(v);
      }
    }
    if (toCreate.length === 0) return;

    try {
      const rows = await this.prisma.$transaction(async (tx) => {
        const inserted = await tx.studentSubjectEnrollment.createManyAndReturn({
          data: toCreate.map((v) => ({
            studentId: v.dto.student_id,
            subjectId: v.dto.subject_id,
            batchId: v.dto.batch_id,
            academicYear: v.dto.academic_year,
            semester: v.dto.semester,
          })),
        });
        await this.auditHook.recordMany(
          inserted.map((row) => ({
            actor,
            action: 'CREATE' as const,
            entityType: 'StudentSubjectEnrollment',
            entityId: row.id,
            newValue: row,
          })),
          tx,
        );
        return inserted;
      });
      const idByKey = new Map(rows.map((r) => [`${r.studentId}|${r.subjectId}|${r.academicYear}|${r.semester}`, r.id]));
      for (const v of toCreate) created.set(v.rowNumber, idByKey.get(keyOf(v.dto)) as string);
    } catch {
      // The batched insert is all-or-nothing (e.g. a concurrent request enrolled one of
      // these after the duplicate check) — retry row by row so only the offender fails.
      for (const v of toCreate) {
        try {
          created.set(v.rowNumber, (await this.create(v.dto, actor)).id);
        } catch (err) {
          failures.set(v.rowNumber, err instanceof Error ? err.message : 'Unknown error');
        }
      }
    }
  }

  /** `GET /enrollments/bulk-import/template` (ADMIN). */
  async generateBulkImportTemplate(): Promise<Buffer> {
    return generateExcelTemplate({
      entityName: 'Enrollment',
      uniqueFieldsNote: 'Unique combination: roll_number + subject_code + academic_year + semester. One row per student per subject.',
      columns: [
        { header: 'roll_number', example: '102303986', note: 'Must match an existing student\'s roll number.' },
        { header: 'subject_code', example: 'UCS301', note: 'Must match an existing subject\'s code.' },
        { header: 'academic_year', example: '2025-2026', note: 'Academic year label, e.g. "2025-2026".' },
        { header: 'semester', example: '5', note: 'Whole number, 1 or higher.' },
      ],
    });
  }

  /**
   * `POST /enrollments/bulk-import` (ADMIN) — one row per student per subject.
   * The enrollment's batch is the student's CURRENT batch (the point-in-time
   * snapshot rule, EC-017, is applied at enrollment time). One bad row never
   * blocks the rest (EC-044); an already-enrolled row is a per-row FAILURE,
   * same as every other bulk import.
   */
  async bulkImport(buffer: Buffer, actor: AuthenticatedUser): Promise<ImportJob> {
    const records = await parseExcelBuffer(buffer, ['roll_number', 'subject_code', 'academic_year', 'semester']);

    // Two lookups for the whole file instead of two per row.
    const rollNumbers = [...new Set(records.map((r) => r.roll_number?.trim()).filter(Boolean))];
    const subjectCodes = [...new Set(records.map((r) => r.subject_code?.trim()).filter(Boolean))];
    const [students, subjects] = await Promise.all([
      this.prisma.student.findMany({
        where: { rollNumber: { in: rollNumbers } },
        select: { id: true, rollNumber: true, batchId: true },
      }),
      this.prisma.subject.findMany({
        where: { code: { in: subjectCodes } },
        select: { id: true, code: true },
      }),
    ]);
    const studentByRoll = new Map(students.map((s) => [s.rollNumber, s]));
    const subjectByCode = new Map(subjects.map((s) => [s.code, s]));

    return this.runBulk(
      records.map((record, i) => ({
        rowNumber: i + 2, // +1 for 0-index, +1 for the header row
        resolve: (): CreateEnrollmentDto => {
          const rollNumber = record.roll_number?.trim() ?? '';
          const subjectCode = record.subject_code?.trim() ?? '';
          const academicYear = record.academic_year?.trim() ?? '';
          const semesterRaw = record.semester?.trim() ?? '';

          const student = studentByRoll.get(rollNumber);
          if (!student) {
            throw new BadRequestException(`Roll number '${rollNumber}' not found`);
          }
          const subject = subjectByCode.get(subjectCode);
          if (!subject) {
            throw new BadRequestException(`Subject code '${subjectCode}' not found`);
          }
          if (!academicYear) {
            throw new BadRequestException(`'academic_year' is required`);
          }
          const semester = Number(semesterRaw);
          if (semesterRaw === '' || !Number.isInteger(semester) || semester < 1) {
            throw new BadRequestException(`'semester' must be a whole number, 1 or higher`);
          }
          return {
            student_id: student.id,
            subject_id: subject.id,
            batch_id: student.batchId,
            academic_year: academicYear,
            semester,
          };
        },
      })),
      actor,
    );
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
