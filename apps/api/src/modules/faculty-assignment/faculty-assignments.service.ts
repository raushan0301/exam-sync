import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, FacultySubjectBatchAssignment, FacultyAssignmentRole, ImportJob } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { ImportJobsService } from '../../common/import-jobs/import-jobs.service';
import { ImportRowResult } from '../../common/import-jobs/import-jobs.types';
import { parseExcelBuffer } from '../../common/bulk-import/parse-excel';
import { generateExcelTemplate } from '../../common/bulk-import/generate-template';
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
    private readonly importJobsService: ImportJobsService,
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

  /** `GET /faculty-assignments/bulk-import/template` (ADMIN). */
  async generateBulkImportTemplate(): Promise<Buffer> {
    return generateExcelTemplate({
      entityName: 'Faculty Assignment',
      uniqueFieldsNote:
        'Unique combination: employee_code + subject_code + batch (program_code + batch_year + batch_section + batch_subsection) + academic_year + semester.',
      columns: [
        { header: 'employee_code', example: '102303', note: 'Must match an existing faculty member\'s employee code.' },
        { header: 'subject_code', example: 'UCS301', note: 'Must match an existing subject\'s code.' },
        { header: 'program_code', example: 'BE-COE', note: 'Program of the batch. Must match an existing Program\'s code.' },
        { header: 'batch_year', example: '2023-2027', note: 'Cohort label of the batch — a single year ("2026") or a span ("2023-2027").' },
        { header: 'batch_section', example: '4C2', note: 'Coarse section of the batch.' },
        { header: 'batch_subsection', example: '4C24', note: 'Subsection — with program code + year + section it identifies the exact batch.' },
        { header: 'academic_year', example: '2025-2026', note: 'Academic year label, e.g. "2025-2026".' },
        { header: 'semester', example: '5', note: 'Whole number, 1 or higher.' },
        { header: 'role', example: 'PRIMARY_INSTRUCTOR', note: 'PRIMARY_INSTRUCTOR or CO_INSTRUCTOR (PRIMARY / CO also accepted).' },
      ],
    });
  }

  /**
   * `POST /faculty-assignments/bulk-import` (ADMIN). One row per faculty/
   * subject/batch/term assignment. One bad row never blocks the rest; an
   * assignment that already exists fails that row with a message naming it.
   */
  async bulkImport(buffer: Buffer, actor: AuthenticatedUser): Promise<ImportJob> {
    const records = await parseExcelBuffer(buffer, [
      'employee_code',
      'subject_code',
      'program_code',
      'batch_year',
      'batch_section',
      'batch_subsection',
      'academic_year',
      'semester',
      'role',
    ]);

    const clean = (v: string | undefined) => v?.trim() ?? '';
    const uniq = (vals: string[]) => [...new Set(vals.filter(Boolean))];

    // One lookup per entity type for the whole file instead of several per row.
    const [faculty, subjects, programs] = await Promise.all([
      this.prisma.faculty.findMany({
        where: { employeeCode: { in: uniq(records.map((r) => clean(r.employee_code))) } },
        select: { id: true, employeeCode: true },
      }),
      this.prisma.subject.findMany({
        where: { code: { in: uniq(records.map((r) => clean(r.subject_code))) } },
        select: { id: true, code: true },
      }),
      this.prisma.program.findMany({
        where: { code: { in: uniq(records.map((r) => clean(r.program_code))) } },
        select: { id: true, code: true },
      }),
    ]);
    const batches = programs.length
      ? await this.prisma.batch.findMany({
          where: { programId: { in: programs.map((p) => p.id) } },
          select: { id: true, programId: true, year: true, section: true, subsection: true },
        })
      : [];
    const facultyByCode = new Map(faculty.map((f) => [f.employeeCode, f.id]));
    const subjectByCode = new Map(subjects.map((x) => [x.code, x.id]));
    const programByCode = new Map(programs.map((x) => [x.code, x.id]));
    const batchByKey = new Map(batches.map((b) => [`${b.programId}|${b.year}|${b.section}|${b.subsection}`, b.id]));

    return this.runBulk(
      records.map((record, i) => ({
        rowNumber: i + 2, // +1 for 0-index, +1 for the header row
        resolve: (): { dto: CreateFacultyAssignmentDto; label: string } => {
          const employeeCode = clean(record.employee_code);
          const subjectCode = clean(record.subject_code);
          const programCode = clean(record.program_code);
          const year = clean(record.batch_year);
          const section = clean(record.batch_section);
          const subsection = clean(record.batch_subsection);
          const academicYear = clean(record.academic_year);
          const semesterRaw = clean(record.semester);

          const facultyId = facultyByCode.get(employeeCode);
          if (!facultyId) throw new BadRequestException(`Employee code '${employeeCode}' not found`);
          const subjectId = subjectByCode.get(subjectCode);
          if (!subjectId) throw new BadRequestException(`Subject code '${subjectCode}' not found`);
          const programId = programByCode.get(programCode);
          if (!programId) throw new BadRequestException(`Program code '${programCode}' not found`);
          const batchId = batchByKey.get(`${programId}|${year}|${section}|${subsection}`);
          if (!batchId) {
            throw new BadRequestException(
              `No batch found for program '${programCode}', year ${year}, section '${section}', subsection '${subsection}'`,
            );
          }
          if (!academicYear) throw new BadRequestException(`'academic_year' is required`);
          const semester = Number(semesterRaw);
          if (semesterRaw === '' || !Number.isInteger(semester) || semester < 1) {
            throw new BadRequestException(`'semester' must be a whole number, 1 or higher`);
          }
          const role = parseRole(clean(record.role));
          if (!role) {
            throw new BadRequestException(`'role' must be PRIMARY_INSTRUCTOR or CO_INSTRUCTOR (got '${clean(record.role)}')`);
          }

          return {
            dto: { faculty_id: facultyId, subject_id: subjectId, batch_id: batchId, academic_year: academicYear, semester, role },
            label: `${employeeCode} → ${subjectCode} · ${programCode} ${year} ${section}/${subsection} · ${academicYear} sem ${semester}`,
          };
        },
      })),
      actor,
    );
  }

  /**
   * `POST /faculty-assignments/bulk` (ADMIN) — the same assignment for many
   * rows at once (e.g. one faculty + subject across many batches), already
   * resolved to ids by the caller. Same per-row failure behaviour as the
   * Excel import.
   */
  async bulkCreate(rows: CreateFacultyAssignmentDto[], actor: AuthenticatedUser): Promise<ImportJob> {
    const [faculty, subjects, batches] = await Promise.all([
      this.prisma.faculty.findMany({ where: { id: { in: uniq2(rows.map((r) => r.faculty_id)) } }, select: { id: true, employeeCode: true } }),
      this.prisma.subject.findMany({ where: { id: { in: uniq2(rows.map((r) => r.subject_id)) } }, select: { id: true, code: true } }),
      this.prisma.batch.findMany({ where: { id: { in: uniq2(rows.map((r) => r.batch_id)) } }, select: { id: true, year: true, section: true, subsection: true } }),
    ]);
    const facultyLabel = new Map(faculty.map((f) => [f.id, f.employeeCode]));
    const subjectLabel = new Map(subjects.map((x) => [x.id, x.code]));
    const batchLabel = new Map(batches.map((b) => [b.id, `${b.year} ${b.section}/${b.subsection}`]));

    return this.runBulk(
      rows.map((dto, i) => ({
        rowNumber: i + 1,
        resolve: () => {
          if (!facultyLabel.has(dto.faculty_id)) throw new NotFoundException('Faculty member not found');
          if (!subjectLabel.has(dto.subject_id)) throw new NotFoundException('Subject not found');
          if (!batchLabel.has(dto.batch_id)) throw new NotFoundException('Batch not found');
          return {
            dto,
            label: `${facultyLabel.get(dto.faculty_id)} → ${subjectLabel.get(dto.subject_id)} · ${batchLabel.get(dto.batch_id)} · ${dto.academic_year} sem ${dto.semester}`,
          };
        },
      })),
      actor,
    );
  }

  /**
   * Fixed number of queries regardless of row count (the old per-row loop
   * cost ~8 sequential round trips to the remote database PER assignment):
   * one duplicate lookup, one batched insert, one batched audit write.
   * Rows already assigned — in the database or earlier in the same file —
   * fail with a message naming the assignment; a bad row never blocks the rest.
   */
  private async runBulk(
    items: { rowNumber: number; resolve: () => { dto: CreateFacultyAssignmentDto; label: string } }[],
    actor: AuthenticatedUser,
  ): Promise<ImportJob> {
    const failures = new Map<number, string>();
    const created = new Map<number, string>();
    const valid: { rowNumber: number; dto: CreateFacultyAssignmentDto; label: string }[] = [];

    for (const item of items) {
      try {
        valid.push({ rowNumber: item.rowNumber, ...item.resolve() });
      } catch (err) {
        failures.set(item.rowNumber, err instanceof Error ? err.message : 'Unknown error');
      }
    }

    if (valid.length > 0) {
      await this.insertAssignments(valid, actor, created, failures);
    }

    const results: ImportRowResult[] = items.map((item) =>
      created.has(item.rowNumber)
        ? { row: item.rowNumber, status: 'SUCCESS', id: created.get(item.rowNumber) }
        : { row: item.rowNumber, status: 'FAILURE', error: failures.get(item.rowNumber) ?? 'Unknown error' },
    );
    const successCount = created.size;

    return this.importJobsService.create({
      resourceType: 'faculty-assignments',
      totalRows: items.length,
      successCount,
      failureCount: items.length - successCount,
      results,
      createdByUserId: actor.id,
    });
  }

  private async insertAssignments(
    valid: { rowNumber: number; dto: CreateFacultyAssignmentDto; label: string }[],
    actor: AuthenticatedUser,
    created: Map<number, string>,
    failures: Map<number, string>,
  ): Promise<void> {
    const keyOf = (d: CreateFacultyAssignmentDto) =>
      `${d.faculty_id}|${d.subject_id}|${d.batch_id}|${d.academic_year}|${d.semester}`;
    const uniq = <T,>(vals: T[]) => [...new Set(vals)];

    // Superset query (each column IN its own values), then exact-match in memory.
    const existing = await this.prisma.facultySubjectBatchAssignment.findMany({
      where: {
        facultyId: { in: uniq(valid.map((v) => v.dto.faculty_id)) },
        subjectId: { in: uniq(valid.map((v) => v.dto.subject_id)) },
        batchId: { in: uniq(valid.map((v) => v.dto.batch_id)) },
        academicYear: { in: uniq(valid.map((v) => v.dto.academic_year)) },
        semester: { in: uniq(valid.map((v) => v.dto.semester)) },
      },
      select: { facultyId: true, subjectId: true, batchId: true, academicYear: true, semester: true },
    });
    const taken = new Set(
      existing.map((e) => `${e.facultyId}|${e.subjectId}|${e.batchId}|${e.academicYear}|${e.semester}`),
    );

    const toCreate: typeof valid = [];
    for (const v of valid) {
      const key = keyOf(v.dto);
      if (taken.has(key)) {
        failures.set(v.rowNumber, `Already assigned: ${v.label}.`);
      } else {
        taken.add(key); // a repeat later in the same file now counts as already assigned
        toCreate.push(v);
      }
    }
    if (toCreate.length === 0) return;

    try {
      const rows = await this.prisma.$transaction(async (tx) => {
        const inserted = await tx.facultySubjectBatchAssignment.createManyAndReturn({
          data: toCreate.map((v) => ({
            facultyId: v.dto.faculty_id,
            subjectId: v.dto.subject_id,
            batchId: v.dto.batch_id,
            academicYear: v.dto.academic_year,
            semester: v.dto.semester,
            role: v.dto.role,
          })),
        });
        await this.auditHook.recordMany(
          inserted.map((row) => ({
            actor,
            action: 'CREATE' as const,
            entityType: 'FacultySubjectBatchAssignment',
            entityId: row.id,
            newValue: row,
          })),
          tx,
        );
        return inserted;
      });
      const idByKey = new Map(
        rows.map((r) => [`${r.facultyId}|${r.subjectId}|${r.batchId}|${r.academicYear}|${r.semester}`, r.id]),
      );
      for (const v of toCreate) created.set(v.rowNumber, idByKey.get(keyOf(v.dto)) as string);
    } catch {
      // The batched insert is all-or-nothing (e.g. a concurrent request created one of
      // these rows after the duplicate check) — retry row by row so only the offender fails.
      for (const v of toCreate) {
        try {
          created.set(v.rowNumber, (await this.create(v.dto, actor)).id);
        } catch (err) {
          failures.set(
            v.rowNumber,
            err instanceof ConflictException ? `Already assigned: ${v.label}.` : err instanceof Error ? err.message : 'Unknown error',
          );
        }
      }
    }
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

function uniq2(vals: string[]): string[] {
  return [...new Set(vals)];
}

function parseRole(raw: string): FacultyAssignmentRole | null {
  const v = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (v === 'PRIMARY' || v === 'PRIMARY_INSTRUCTOR') return FacultyAssignmentRole.PRIMARY_INSTRUCTOR;
  if (v === 'CO' || v === 'CO_INSTRUCTOR') return FacultyAssignmentRole.CO_INSTRUCTOR;
  return null;
}
