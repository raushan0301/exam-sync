import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function buildContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  function buildGuard(requiredRoles: string[] | undefined) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  }

  it('allows any authenticated user when no @Roles() metadata is present', () => {
    const guard = buildGuard(undefined);
    const ctx = buildContext({ id: 'u1', roles: ['STUDENT'] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows a user whose role matches one of the required roles', () => {
    const guard = buildGuard(['ADMIN', 'FACULTY']);
    const ctx = buildContext({ id: 'u1', roles: ['FACULTY'] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects a user whose role does not match (403, role-level authorization)', () => {
    const guard = buildGuard(['ADMIN']);
    const ctx = buildContext({ id: 'u1', roles: ['STUDENT'] });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects when there is no authenticated user at all', () => {
    const guard = buildGuard(['ADMIN']);
    const ctx = buildContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows a user holding multiple roles where at least one is required', () => {
    const guard = buildGuard(['INVIGILATOR']);
    const ctx = buildContext({ id: 'u1', roles: ['FACULTY', 'INVIGILATOR'] });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
