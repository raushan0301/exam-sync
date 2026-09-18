import { Injectable } from '@nestjs/common';
import { Prisma, QuizApprovalAction, QuizApprovalHistory, QuizStatus } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface RecordApprovalHistoryInput {
  quizId: string;
  action: QuizApprovalAction;
  actorId: string;
  reason?: string | null;
  previousStatus: QuizStatus;
  newStatus: QuizStatus;
}

/**
 * Owns `quiz_approval_history` (BUSINESS_RULES.md BR-013: "Every approval/
 * rejection/resubmission decision is appended ... existing history rows
 * are never updated or deleted").
 *
 * This class deliberately exposes ONLY `record` and `listForQuiz` — no
 * `update`, no `delete`, no method that could ever mutate an existing row.
 * This is the "structurally impossible via any code path" requirement from
 * IMPLEMENTATION_PLAN.md Phase 7's own test note, verified by
 * quiz-approval-history.service.spec.ts's repository-layer inspection test
 * (which asserts this class's own prototype has no such method, and that
 * its source never calls `prisma.quizApprovalHistory.update` or `.delete`).
 */
@Injectable()
export class QuizApprovalHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `tx` — Phase 15 (ADR-005/BR-042) needs this write, the quiz status
   * update, and the notification-outbox write to commit atomically, so
   * this now accepts an optional transaction client, same pattern already
   * established by `ConflictEngineService.checkSessionAssembly`'s `tx`
   * parameter. Defaults to the injected `PrismaService` so existing
   * non-transactional call sites are unaffected.
   */
  async record(
    input: RecordApprovalHistoryInput,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<QuizApprovalHistory> {
    return tx.quizApprovalHistory.create({
      data: {
        quizId: input.quizId,
        action: input.action,
        actorId: input.actorId,
        reason: input.reason ?? null,
        previousStatus: input.previousStatus,
        newStatus: input.newStatus,
      },
    });
  }

  async listForQuiz(quizId: string): Promise<QuizApprovalHistory[]> {
    return this.prisma.quizApprovalHistory.findMany({
      where: { quizId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
