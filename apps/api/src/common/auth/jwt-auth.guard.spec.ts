import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ALLOW_PASSWORD_CHANGE_REQUIRED_KEY } from './allow-password-change-required.decorator';

function buildContext(headers: Record<string, string> = {}): { ctx: ExecutionContext; request: any } {
  const request: any = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

function buildReflector(metadata: Record<string, boolean | undefined>) {
  return {
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  } as unknown as Reflector;
}

const activeUser = {
  id: 'user-1',
  email: 'faculty@example.com',
  isActive: true,
  mustChangePassword: false,
  roles: [{ role: { name: 'FACULTY' } }],
};

describe('JwtAuthGuard', () => {
  let jwtService: { verifyAsync: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };

  function buildGuard(metadata: Record<string, boolean | undefined> = {}) {
    return new JwtAuthGuard(
      jwtService as unknown as JwtService,
      new ConfigService({ jwt: { accessSecret: 'test-secret' } }),
      prisma as any,
      buildReflector(metadata),
    );
  }

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1' }) };
    prisma = { user: { findUnique: jest.fn().mockResolvedValue(activeUser) } };
  });

  it('bypasses everything for a @Public() route', async () => {
    const guard = buildGuard({ [IS_PUBLIC_KEY]: true });
    const { ctx } = buildContext();

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header', async () => {
    const guard = buildGuard();
    const { ctx } = buildContext();

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an invalid/expired token without distinguishing why', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('bad signature'));
    const guard = buildGuard();
    const { ctx } = buildContext({ authorization: 'Bearer garbage' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a disabled or deleted user', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...activeUser, isActive: false });
    const guard = buildGuard();
    const { ctx } = buildContext({ authorization: 'Bearer valid' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('attaches the authenticated user (including mustChangePassword) on success', async () => {
    const guard = buildGuard();
    const { ctx, request } = buildContext({ authorization: 'Bearer valid' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'user-1',
      email: 'faculty@example.com',
      roles: ['FACULTY'],
      mustChangePassword: false,
    });
  });

  it('blocks every route with a 403 PASSWORD_CHANGE_REQUIRED when mustChangePassword is true', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...activeUser, mustChangePassword: true });
    const guard = buildGuard(); // no @AllowWhenPasswordChangeRequired() metadata
    const { ctx } = buildContext({ authorization: 'Bearer valid' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    try {
      await guard.canActivate(ctx);
    } catch (err) {
      expect((err as ForbiddenException).getResponse()).toEqual(
        expect.objectContaining({ code: 'PASSWORD_CHANGE_REQUIRED' }),
      );
    }
  });

  it('still allows a route explicitly marked @AllowWhenPasswordChangeRequired() even when mustChangePassword is true', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...activeUser, mustChangePassword: true });
    const guard = buildGuard({ [ALLOW_PASSWORD_CHANGE_REQUIRED_KEY]: true });
    const { ctx, request } = buildContext({ authorization: 'Bearer valid' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user.mustChangePassword).toBe(true);
  });
});
