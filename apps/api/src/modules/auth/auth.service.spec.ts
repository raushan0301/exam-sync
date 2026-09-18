import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { AuthAuditService } from './auth-audit.service';
import { LoginAttemptTrackerService } from './login-attempt-tracker.service';

function buildPrismaMock() {
  return {
    user: {
      findUnique: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  } as any;
}

describe('AuthService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let authAudit: { record: jest.Mock };
  let loginAttemptTracker: LoginAttemptTrackerService;
  let service: AuthService;

  const activeUser = {
    id: 'user-1',
    email: 'faculty@example.com',
    passwordHash: 'hashed',
    isActive: true,
    roles: [{ role: { name: 'FACULTY' } }],
  };

  beforeEach(() => {
    prisma = buildPrismaMock();
    authAudit = { record: jest.fn() };
    loginAttemptTracker = new LoginAttemptTrackerService();

    const passwordService = {
      verify: jest.fn(),
    } as unknown as PasswordService;

    service = new AuthService(
      prisma,
      new JwtService(),
      new ConfigService({ jwt: { accessSecret: 'test-secret' } }),
      passwordService,
      authAudit as unknown as AuthAuditService,
      loginAttemptTracker,
    );

    (service as any).passwordService.verify.mockResolvedValue(true);
  });

  describe('login', () => {
    it('rejects an unknown email with the generic error and audits LOGIN_FAILURE_UNKNOWN_EMAIL', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login('nobody@example.com', 'whatever')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authAudit.record).toHaveBeenCalledWith(
        'LOGIN_FAILURE_UNKNOWN_EMAIL',
        expect.objectContaining({ email: 'nobody@example.com' }),
      );
    });

    it('rejects a disabled account with the SAME generic error as unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...activeUser, isActive: false });

      let unknownError: Error | undefined;
      let disabledError: Error | undefined;

      prisma.user.findUnique.mockResolvedValueOnce(null);
      try {
        await service.login('nobody@example.com', 'x');
      } catch (e) {
        unknownError = e as Error;
      }

      prisma.user.findUnique.mockResolvedValueOnce({ ...activeUser, isActive: false });
      try {
        await service.login(activeUser.email, 'x');
      } catch (e) {
        disabledError = e as Error;
      }

      expect(unknownError?.message).toBe(disabledError?.message);
      expect(authAudit.record).toHaveBeenCalledWith(
        'LOGIN_FAILURE_DISABLED_ACCOUNT',
        expect.anything(),
      );
    });

    it('rejects a wrong password and audits LOGIN_FAILURE_BAD_PASSWORD', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      (service as any).passwordService.verify.mockResolvedValue(false);

      await expect(service.login(activeUser.email, 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authAudit.record).toHaveBeenCalledWith(
        'LOGIN_FAILURE_BAD_PASSWORD',
        expect.anything(),
      );
    });

    it('issues a token pair on success and audits LOGIN_SUCCESS', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.login(activeUser.email, 'correct');

      expect(result.access_token).toEqual(expect.any(String));
      expect(result.refresh_token).toEqual(expect.any(String));
      expect(result.expires_in).toBe(15 * 60);
      expect(authAudit.record).toHaveBeenCalledWith('LOGIN_SUCCESS', expect.anything());
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });

    it('never puts the password or password hash into an audit event', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      await service.login(activeUser.email, 'correct');

      for (const call of authAudit.record.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain('correct');
        expect(serialized).not.toContain('hashed');
      }
    });

    it('locks out after repeated failures (brute-force protection)', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      (service as any).passwordService.verify.mockResolvedValue(false);

      for (let i = 0; i < 5; i++) {
        await expect(service.login(activeUser.email, 'wrong')).rejects.toThrow(
          UnauthorizedException,
        );
      }

      // 6th attempt: locked out, even with prisma still returning the user.
      await expect(service.login(activeUser.email, 'wrong')).rejects.toThrow(
        ForbiddenException,
      );
      expect(authAudit.record).toHaveBeenCalledWith('LOGIN_RATE_LIMITED', expect.anything());
    });
  });

  describe('refresh', () => {
    it('rejects an unknown token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh('garbage')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects and revokes the whole chain on reuse of a consumed token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        consumedAt: new Date(),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
      });

      await expect(service.refresh('stolen-token')).rejects.toThrow(UnauthorizedException);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', revokedAt: null } }),
      );
      expect(authAudit.record).toHaveBeenCalledWith(
        'TOKEN_REFRESH_REUSE_DETECTED',
        expect.anything(),
      );
    });

    it('rejects an expired token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        consumedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.refresh('expired-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('revokes all active refresh tokens for the user', async () => {
      await service.logout('user-1');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', revokedAt: null } }),
      );
      expect(authAudit.record).toHaveBeenCalledWith('LOGOUT', expect.objectContaining({
        userId: 'user-1',
      }));
    });
  });
});
