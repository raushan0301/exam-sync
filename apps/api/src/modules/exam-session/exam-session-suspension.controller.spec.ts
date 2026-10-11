import 'reflect-metadata';
import { ExamSessionSuspensionController } from './exam-session-suspension.controller';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { ROLE } from '../../common/auth/auth.types';

/** Who may do what: faculty ASK, admin DECIDES — the whole point of the approval gate. */
describe('ExamSessionSuspensionController — @Roles metadata', () => {
  const rolesOf = (name: keyof ExamSessionSuspensionController) =>
    Reflect.getMetadata(ROLES_KEY, ExamSessionSuspensionController.prototype[name] as any);

  it('request: FACULTY only — an admin cannot file one, and nobody else can', () => {
    expect(rolesOf('request')).toEqual([ROLE.FACULTY]);
  });

  it('approve and reject: ADMIN only — a faculty member can never approve their own request', () => {
    expect(rolesOf('approve')).toEqual([ROLE.ADMIN]);
    expect(rolesOf('reject')).toEqual([ROLE.ADMIN]);
  });

  it('list: ADMIN and FACULTY (scoped to their own requests in the service)', () => {
    expect(rolesOf('list')).toEqual([ROLE.ADMIN, ROLE.FACULTY]);
  });
});
