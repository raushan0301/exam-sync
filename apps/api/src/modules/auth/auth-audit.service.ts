import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export type AuthAuditEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE_UNKNOWN_EMAIL'
  | 'LOGIN_FAILURE_BAD_PASSWORD'
  | 'LOGIN_FAILURE_DISABLED_ACCOUNT'
  | 'LOGIN_RATE_LIMITED'
  | 'TOKEN_REFRESH_SUCCESS'
  | 'TOKEN_REFRESH_FAILURE'
  | 'TOKEN_REFRESH_REUSE_DETECTED'
  | 'LOGOUT';

export interface AuthAuditContext {
  userId?: string;
  email?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Phase-1-scoped authentication audit trail (IMPLEMENTATION_PLAN.md Phase 1
 * item "Authentication audit events"). This is intentionally narrower than
 * the general-purpose audit_logs table (BUSINESS_RULES.md BR-048), which is
 * explicitly Phase 20's scope and covers all domain state changes, not just
 * auth events — this service must not be treated as a substitute for that.
 *
 * Every write here is deliberately best-effort/non-blocking with respect to
 * the caller's request: a failure to write an audit row must never prevent
 * a legitimate login/logout/refresh from completing (unlike BR-048's
 * same-transaction requirement for domain state changes, auth events are
 * informational/security-monitoring, not integrity-critical state).
 */
@Injectable()
export class AuthAuditService {
  private readonly logger = new Logger(AuthAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(eventType: AuthAuditEventType, context: AuthAuditContext = {}): Promise<void> {
    try {
      await this.prisma.authAuditEvent.create({
        data: {
          eventType,
          userId: context.userId,
          email: context.email,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: context.metadata as any,
        },
      });
    } catch (err) {
      // Never let audit-write failure break the auth flow, and never log
      // the password or token values that might be present in `context`
      // (they aren't, by construction of the callers — see auth.service.ts).
      this.logger.error(`Failed to record auth audit event ${eventType}: ${(err as Error).message}`);
    }
  }
}
