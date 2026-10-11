import 'reflect-metadata';
import { ExamSessionsController } from './exam-sessions.controller';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { ROLE } from '../../common/auth/auth.types';

/**
 * Regression coverage for the faculty-lifecycle-ownership change:
 * RolesGuard (see roles.guard.spec.ts) reads `@Roles()` metadata off the
 * route handler to decide role-level access — asserting that metadata
 * directly is exactly how a caller (ADMIN) losing write access to these
 * routes gets proven, since RolesGuard itself is already covered
 * end-to-end elsewhere. Every one of these previously carried
 * `@Roles(ROLE.ADMIN)` only; this spec is the "admin really did lose
 * write access, not just wasn't tested" regression this change requires.
 */
describe('ExamSessionsController — @Roles metadata (faculty-lifecycle-ownership change)', () => {
  function rolesOf(methodName: keyof ExamSessionsController): string[] | undefined {
    return Reflect.getMetadata(ROLES_KEY, ExamSessionsController.prototype[methodName] as any);
  }

  it('create: FACULTY only — ADMIN no longer has write access', () => {
    expect(rolesOf('create')).toEqual([ROLE.FACULTY]);
  });

  it('updateQuizzes: FACULTY only', () => {
    expect(rolesOf('updateQuizzes')).toEqual([ROLE.FACULTY]);
  });

  it('reschedule: FACULTY only', () => {
    expect(rolesOf('reschedule')).toEqual([ROLE.FACULTY]);
  });

  it('has NO direct cancel route any more — cancellation only happens through an admin-approved suspension request', () => {
    expect((ExamSessionsController.prototype as unknown as Record<string, unknown>).cancel).toBeUndefined();
  });

  it('findOne (GET :id): ADMIN retains read access, alongside FACULTY', () => {
    expect(rolesOf('findOne')).toEqual(expect.arrayContaining([ROLE.ADMIN, ROLE.FACULTY]));
  });

  it('list (GET, new): ADMIN retains read access, alongside FACULTY', () => {
    expect(rolesOf('list')).toEqual(expect.arrayContaining([ROLE.ADMIN, ROLE.FACULTY]));
  });

  it('conflicts (GET :id/conflicts): ADMIN retains read access, alongside FACULTY', () => {
    expect(rolesOf('conflicts')).toEqual(expect.arrayContaining([ROLE.ADMIN, ROLE.FACULTY]));
  });
});
