import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { AuthAuditService } from './auth-audit.service';
import { LoginAttemptTrackerService } from './login-attempt-tracker.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';

/**
 * AuthModule — Phase 1 (replaces the Phase 0 empty skeleton).
 *
 * Owns: users, roles, permissions, user_roles, role_permissions,
 * refresh_tokens, auth_audit_events (ARCHITECTURE.md §AC) and the
 * /auth/* + /users/* routes (API_CONTRACT.md).
 *
 * Registers JwtAuthGuard and RolesGuard as global APP_GUARDs — every route
 * in the application requires authentication by default from this point
 * on, unless explicitly marked @Public() (AGENT_DEVELOPMENT_RULES.md rule
 * 5: never bypass authorization; the safe default is "requires auth").
 * ThrottlerGuard is also global, providing the per-IP half of rate limiting
 * everywhere, with a stricter override on /auth/login specifically.
 */
@Module({
  imports: [
    JwtModule.register({}),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: 60_000,
            limit: 100, // generous default; /auth/login overrides to 5/min via @Throttle()
          },
        ],
        // See AppConfig.security.disableRateLimitForTests — never set outside
        // the e2e test harness; production/dev always keep rate limiting on.
        skipIf: () => config.get<boolean>('security.disableRateLimitForTests') === true,
      }),
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [
    AuthService,
    PasswordService,
    AuthAuditService,
    LoginAttemptTrackerService,
    UsersService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  // PasswordService exported starting Phase 3: student account provisioning
  // (students.service.ts) needs to hash a generated temporary password
  // through the exact same, single hashing implementation as login —
  // never a second, ad hoc hashing call site.
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
