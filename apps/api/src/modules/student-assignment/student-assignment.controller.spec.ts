import 'reflect-metadata';
import { StudentAssignmentController } from './student-assignment.controller';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { ROLE } from '../../common/auth/auth.types';

/** Regression coverage for the faculty-lifecycle-ownership change — see exam-sessions.controller.spec.ts's header comment for why @Roles metadata is the right thing to assert here. */
describe('StudentAssignmentController — @Roles metadata (faculty-lifecycle-ownership change)', () => {
  it('assignStudents: FACULTY only — ADMIN no longer has write access', () => {
    expect(Reflect.getMetadata(ROLES_KEY, StudentAssignmentController.prototype.assignStudents)).toEqual([
      ROLE.FACULTY,
    ]);
  });

  it('addRosterEntry: FACULTY only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, StudentAssignmentController.prototype.addRosterEntry)).toEqual([
      ROLE.FACULTY,
    ]);
  });

  it('removeRosterEntry: FACULTY only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, StudentAssignmentController.prototype.removeRosterEntry)).toEqual([
      ROLE.FACULTY,
    ]);
  });

  it('roster (GET): ADMIN retains read access, alongside FACULTY — unchanged', () => {
    expect(Reflect.getMetadata(ROLES_KEY, StudentAssignmentController.prototype.roster)).toEqual(
      expect.arrayContaining([ROLE.ADMIN, ROLE.FACULTY]),
    );
  });
});
