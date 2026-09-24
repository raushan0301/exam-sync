import 'reflect-metadata';
import { QuizRoomRequestController } from './quiz-room-request.controller';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { ROLE } from '../../common/auth/auth.types';

/** @Roles metadata regression coverage — see RoomAllocationService's own header comment for the request/review/approve flow this mirrors at the quiz stage. */
describe('QuizRoomRequestController — @Roles metadata', () => {
  it('suggest: FACULTY only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, QuizRoomRequestController.prototype.suggest)).toEqual([ROLE.FACULTY]);
  });

  it('request: FACULTY (own DRAFT/REJECTED) or ADMIN (may swap while SUBMITTED)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, QuizRoomRequestController.prototype.request)).toEqual([
      ROLE.FACULTY,
      ROLE.ADMIN,
    ]);
  });

  it('conflicts: ADMIN + FACULTY', () => {
    expect(Reflect.getMetadata(ROLES_KEY, QuizRoomRequestController.prototype.conflicts)).toEqual([
      ROLE.ADMIN,
      ROLE.FACULTY,
    ]);
  });
});
