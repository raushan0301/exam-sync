import 'reflect-metadata';
import { InvigilationController } from './invigilation.controller';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { ROLE } from '../../common/auth/auth.types';

/** Regression coverage for the faculty-lifecycle-ownership change — see exam-sessions.controller.spec.ts's header comment for why @Roles metadata is the right thing to assert here. */
describe('InvigilationController — @Roles metadata (faculty-lifecycle-ownership change)', () => {
  it('assign: FACULTY only — ADMIN no longer has write access', () => {
    expect(Reflect.getMetadata(ROLES_KEY, InvigilationController.prototype.assign)).toEqual([
      ROLE.FACULTY,
    ]);
  });

  it('remove: FACULTY only — lets the owning faculty correct a wrong/outdated assignment', () => {
    expect(Reflect.getMetadata(ROLES_KEY, InvigilationController.prototype.remove)).toEqual([
      ROLE.FACULTY,
    ]);
  });

  it('listForSession: ADMIN (unscoped) + FACULTY (scoped) — recovers InvigilatorPanel\'s list across a page reload', () => {
    expect(Reflect.getMetadata(ROLES_KEY, InvigilationController.prototype.listForSession)).toEqual([
      ROLE.ADMIN,
      ROLE.FACULTY,
    ]);
  });
});
