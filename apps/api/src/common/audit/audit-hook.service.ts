import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@exam-sync/db';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { getCurrentRequestId } from '../observability/request-context';
import { redactSensitiveFields } from './redact';
import { deriveAcademicYear } from './derive-academic-year';

export interface AuditWriteEvent {
  actor: AuthenticatedUser;
  action: AuditAction;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
}

/**
 * The audit-on-write SEAM (IMPLEMENTATION_PLAN.md Phase 2 DoD), upgraded
 * in Phase 20 to its final form: every call still uses the exact same
 * `record(event, tx?)` signature established Phase 2 onward (only `tx`
 * is new — every prior call site now threads its own transaction's `tx`
 * through so the audit row commits atomically with the domain change,
 * per BR-048), but this now actually INSERTs into `audit_logs`
 * (ARCHITECTURE.md §AJ) instead of only logging.
 *
 * Sensitive-field redaction: `oldValue`/`newValue` are caller-supplied
 * Prisma row snapshots that may contain fields never meant to leave the
 * service layer (e.g. `passwordHash`) — see `redact.ts`. This is applied
 * unconditionally, before either persistence or the structured log line,
 * per the Phase 20 authorization's explicit instruction not to expose
 * sensitive information through logs or audit records.
 */
@Injectable()
export class AuditHookService {
  private readonly logger = new Logger('AuditOnWrite');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * `tx` — defaults to the injected `PrismaService`, same optional-tx
   * pattern already established by `QuizApprovalHistoryService.record`
   * and `NotificationsOutboxService.queue`. Every call site that writes
   * inside its own `$transaction`/`runSerializable` block must pass that
   * block's `tx` here so the audit row is part of the same atomic write
   * (BR-048) — a caller that omits `tx` gets a separate, non-atomic
   * write, which is only correct for the (rare) call site that has no
   * enclosing transaction of its own.
   */
  async record(
    event: AuditWriteEvent,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const oldValue = redactSensitiveFields(event.oldValue);
    const newValue = redactSensitiveFields(event.newValue);

    this.logger.log(
      JSON.stringify({
        actorId: event.actor.id,
        actorEmail: event.actor.email,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        reason: event.reason ?? null,
        requestId: getCurrentRequestId() ?? null,
      }),
    );

    await tx.auditLog.create({
      data: {
        actorId: event.actor.id,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        oldValue: oldValue === undefined ? Prisma.JsonNull : (oldValue as Prisma.InputJsonValue),
        newValue: newValue === undefined ? Prisma.JsonNull : (newValue as Prisma.InputJsonValue),
        reason: event.reason ?? null,
        requestId: getCurrentRequestId() ?? null,
        academicYear: deriveAcademicYear(event.newValue) ?? deriveAcademicYear(event.oldValue),
      },
    });
  }
}
