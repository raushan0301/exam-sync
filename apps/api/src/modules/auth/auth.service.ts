import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PasswordService } from './password.service';
import { AuthAuditService } from './auth-audit.service';
import { LoginAttemptTrackerService } from './login-attempt-tracker.service';
import { JwtAccessPayload } from '../../common/auth/auth.types';

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes (ARCHITECTURE.md §AG)

/**
 * Generic message returned for every login failure path (unknown email,
 * wrong password, disabled account). Distinguishing these to the caller
 * would enable account enumeration (ARCHITECTURE.md §AG "sensitive
 * information leakage" + this task's explicit "account enumeration"
 * concern) — the *real* reason is still recorded server-side via
 * AuthAuditService for operators.
 */
const GENERIC_LOGIN_ERROR = 'Invalid email or password.';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly passwordService: PasswordService,
    private readonly auditService: AuthAuditService,
    private readonly loginAttemptTracker: LoginAttemptTrackerService,
  ) {}

  async login(email: string, password: string, ctx: RequestContext = {}): Promise<TokenPair> {
    if (this.loginAttemptTracker.isLocked(email)) {
      await this.auditService.record('LOGIN_RATE_LIMITED', { email, ...ctx });
      throw new ForbiddenException(
        'Too many failed login attempts. Please try again later.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: { include: { role: true } } },
    });

    if (!user) {
      this.loginAttemptTracker.recordFailure(email);
      await this.auditService.record('LOGIN_FAILURE_UNKNOWN_EMAIL', { email, ...ctx });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    if (!user.isActive) {
      this.loginAttemptTracker.recordFailure(email);
      await this.auditService.record('LOGIN_FAILURE_DISABLED_ACCOUNT', {
        userId: user.id,
        email,
        ...ctx,
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const passwordValid = await this.passwordService.verify(user.passwordHash, password);
    if (!passwordValid) {
      this.loginAttemptTracker.recordFailure(email);
      await this.auditService.record('LOGIN_FAILURE_BAD_PASSWORD', {
        userId: user.id,
        email,
        ...ctx,
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    this.loginAttemptTracker.recordSuccess(email);
    await this.auditService.record('LOGIN_SUCCESS', { userId: user.id, email, ...ctx });

    return this.issueTokenPair(user.id);
  }

  async refresh(rawRefreshToken: string, ctx: RequestContext = {}): Promise<TokenPair> {
    const tokenHash = this.hashToken(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing) {
      await this.auditService.record('TOKEN_REFRESH_FAILURE', { ...ctx });
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (existing.revokedAt || existing.consumedAt) {
      // A consumed-or-revoked token being presented again is the classic
      // refresh-token-theft signal: someone captured an old token from the
      // rotation chain. Revoke every token this user holds so the
      // legitimate session is also forced to re-authenticate — the safe
      // default when theft is suspected (ARCHITECTURE.md §AG rotating
      // refresh tokens; this is the reuse-detection half of that design).
      await this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.auditService.record('TOKEN_REFRESH_REUSE_DETECTED', {
        userId: existing.userId,
        ...ctx,
      });
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      await this.auditService.record('TOKEN_REFRESH_FAILURE', {
        userId: existing.userId,
        ...ctx,
      });
      throw new UnauthorizedException('Refresh token expired.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: existing.userId } });
    if (!user || !user.isActive) {
      await this.auditService.record('TOKEN_REFRESH_FAILURE', {
        userId: existing.userId,
        ...ctx,
      });
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const pair = await this.issueTokenPair(user.id);

    const newTokenHash = this.hashToken(pair.refresh_token);
    const newRow = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: newTokenHash },
    });

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { consumedAt: new Date(), replacedById: newRow?.id },
    });

    await this.auditService.record('TOKEN_REFRESH_SUCCESS', { userId: user.id, ...ctx });

    return pair;
  }

  /** Revokes every active refresh token for the user (full session logout). */
  async logout(userId: string, ctx: RequestContext = {}): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.auditService.record('LOGOUT', { userId, ...ctx });
  }

  /**
   * `POST /auth/change-password` — the only way to clear `mustChangePassword`
   * (see JwtAuthGuard's enforcement). Requires the current password (proves
   * the caller actually has it, not just a still-valid access token) and
   * revokes every other refresh token this user holds, the same
   * "assume compromise, force re-auth everywhere" response used for
   * detected refresh-token reuse above — a password change is exactly the
   * moment a session on a device that shouldn't have access anymore should
   * be cut off.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ctx: RequestContext = {},
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const currentValid = await this.passwordService.verify(user.passwordHash, currentPassword);
    if (!currentValid) {
      await this.auditService.record('PASSWORD_CHANGE_FAILURE', { userId, ...ctx });
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const newPasswordHash = await this.passwordService.hash(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash, mustChangePassword: false },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.auditService.record('PASSWORD_CHANGE_SUCCESS', { userId, ...ctx });
  }

  private async issueTokenPair(userId: string): Promise<TokenPair> {
    const payload: JwtAccessPayload = { sub: userId };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });

    const rawRefreshToken = crypto.randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(rawRefreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return {
      access_token: accessToken,
      refresh_token: rawRefreshToken,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  /**
   * Refresh tokens are opaque random strings, hashed with SHA-256 before
   * storage — never stored raw (mirrors password-hash discipline: a DB leak
   * must not yield directly usable tokens). SHA-256, not Argon2id: refresh
   * tokens are already high-entropy random values, not low-entropy human
   * passwords, so a fast cryptographic hash is the correct tool here, not a
   * deliberately slow one.
   */
  private hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }
}
