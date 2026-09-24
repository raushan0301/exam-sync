import 'reflect-metadata';
import { SeatingEngineController } from './seating-engine.controller';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { ROLE } from '../../common/auth/auth.types';

/** Regression coverage for the faculty-lifecycle-ownership change — see exam-sessions.controller.spec.ts's header comment for why @Roles metadata is the right thing to assert here. */
describe('SeatingEngineController — @Roles metadata (faculty-lifecycle-ownership change)', () => {
  it('generate: FACULTY only — ADMIN no longer has write access', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SeatingEngineController.prototype.generate)).toEqual([
      ROLE.FACULTY,
    ]);
  });

  it('regenerate: FACULTY only — lets the owning faculty change strategy before finalizing', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SeatingEngineController.prototype.regenerate)).toEqual([
      ROLE.FACULTY,
    ]);
  });

  it('finalize: FACULTY only — ADMIN no longer has write access', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SeatingEngineController.prototype.finalize)).toEqual([
      ROLE.FACULTY,
    ]);
  });

  it('getJob: ADMIN (unscoped) + FACULTY (scoped) — SeatingPanel.tsx polls this right after a faculty member generates their own seating, so it cannot be ADMIN-only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SeatingEngineController.prototype.getJob)).toEqual([
      ROLE.ADMIN,
      ROLE.FACULTY,
    ]);
  });
});
