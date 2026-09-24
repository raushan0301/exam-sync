import 'reflect-metadata';
import { RoomAllocationController } from './room-allocation.controller';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { ROLE } from '../../common/auth/auth.types';

/**
 * Regression coverage for the room-request/admin-approval change: FACULTY
 * suggests + requests rooms, ADMIN reviews live availability and
 * approves/rejects — see `RoomAllocationService`'s own header comment.
 */
describe('RoomAllocationController — @Roles metadata', () => {
  it('suggest: FACULTY only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, RoomAllocationController.prototype.suggest)).toEqual([ROLE.FACULTY]);
  });

  it('request: FACULTY only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, RoomAllocationController.prototype.request)).toEqual([ROLE.FACULTY]);
  });

  it('preview: ADMIN + FACULTY', () => {
    expect(Reflect.getMetadata(ROLES_KEY, RoomAllocationController.prototype.preview)).toEqual([
      ROLE.ADMIN,
      ROLE.FACULTY,
    ]);
  });

  it('allocatePreApproved: FACULTY only — self-service using the quiz-approval-time approved rooms', () => {
    expect(Reflect.getMetadata(ROLES_KEY, RoomAllocationController.prototype.allocatePreApproved)).toEqual([
      ROLE.FACULTY,
    ]);
  });

  it('allocate: ADMIN only — the approval step', () => {
    expect(Reflect.getMetadata(ROLES_KEY, RoomAllocationController.prototype.allocate)).toEqual([ROLE.ADMIN]);
  });

  it('reject: ADMIN only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, RoomAllocationController.prototype.reject)).toEqual([ROLE.ADMIN]);
  });
});
