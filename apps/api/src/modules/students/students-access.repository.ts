import { Injectable } from '@nestjs/common';
import { Student } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScopedRepository } from '../../common/authorization/scoped-repository';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';
import { FacultyAssignmentsService } from '../faculty-assignment';

/**
 * Resource-level authorization for `GET /students/{id}`
 * (API_CONTRACT.md: "ADMIN, FACULTY (if teaches them), or the student
 * themself — resource-level check"; BUSINESS_RULES.md BR-045).
 *
 * Built on Phase 1's ScopedRepository (ADR-008) rather than an ad hoc
 * inline check — a 404 (not 403) is returned to an unauthorized caller,
 * matching EC-038's expected behavior and hiding whether the id even
 * exists.
 *
 * PHASE 5: the "FACULTY (if teaches them)" branch, previously stubbed here
 * (Phase 3 left this exact TODO), is now implemented using
 * FacultyAssignmentsService.isFacultyTeachingBatch — a faculty member is
 * authorized if they hold an ACTIVE assignment for this student's CURRENT
 * batch (any subject). This is deliberately about the student's *current*
 * batch, not a per-enrollment historical batch snapshot (see
 * StudentSubjectEnrollment's own schema comment on why that field is
 * independent) — "does this faculty teach this student's class" is the
 * natural reading of "if teaches them" for a student *profile* lookup, as
 * opposed to a specific enrollment record.
 */
@Injectable()
export class StudentsAccessRepository extends ScopedRepository<Student> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facultyAssignmentsService: FacultyAssignmentsService,
  ) {
    super();
  }

  protected async findByIdUnscoped(id: string): Promise<Student | null> {
    return this.prisma.student.findUnique({ where: { id } });
  }

  protected async isOwnedByActor(entity: Student, actor: AuthenticatedUser): Promise<boolean> {
    if (entity.userId === actor.id) {
      return true;
    }
    if (actor.roles.includes(ROLE.FACULTY)) {
      return this.facultyAssignmentsService.isFacultyTeachingBatch(actor.id, entity.batchId);
    }
    return false;
  }

  protected isAdminBypass(actor: AuthenticatedUser): boolean {
    return actor.roles.includes(ROLE.ADMIN);
  }
}
