import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ExamSessionStatus } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes — "low-frequency" per ARCHITECTURE_REVIEW.md §7

/**
 * ARCHITECTURE_REVIEW.md §7 / §10 item 6: "recommend a periodic
 * consistency-check job (cheap, low-frequency) that scans for any quiz
 * attached to >1 non-cancelled session as a backstop against a missed
 * trigger/application bug, logged as an alert if found (should never fire
 * if the primary mechanism works, but costs little to have as a
 * tripwire)."
 *
 * BR-053 ("a quiz can be attached to at most one non-cancelled exam
 * session at a time") is already DB-enforced by a partial unique index on
 * `exam_session_quizzes(quiz_id) WHERE is_active_attachment` (ADR-006,
 * Phase 8) — that constraint makes the violation this job looks for
 * structurally impossible to insert in the first place. This job is
 * explicitly defense-in-depth ("trust but verify"), not the primary
 * enforcement mechanism; it exists to catch a violation that could only
 * arise from a bug in how `is_active_attachment` itself is maintained
 * (e.g. a future code path that flips the flag without going through the
 * constraint-checked insert path), not from a normal race condition.
 *
 * Follows the same in-process `@Interval()` background-job pattern already
 * established by `NotificationRelayService` (ADR-001's "runs inside the
 * API's own Nest lifecycle" exception scope — this is not a new deployable
 * process).
 */
@Injectable()
export class Br053ConsistencyCheckService {
  private readonly logger = new Logger('BR053ConsistencyCheck');

  constructor(private readonly prisma: PrismaService) {}

  @Interval(CHECK_INTERVAL_MS)
  async check(): Promise<void> {
    const violations = await this.prisma.examSessionQuiz.groupBy({
      by: ['quizId'],
      where: {
        isActiveAttachment: true,
        examSession: { status: { not: ExamSessionStatus.CANCELLED } },
      },
      _count: { quizId: true },
      having: { quizId: { _count: { gt: 1 } } },
    });

    if (violations.length > 0) {
      this.logger.error(
        `BR-053 TRIPWIRE: ${violations.length} quiz(zes) found attached to more than one non-cancelled exam session — the partial unique index on exam_session_quizzes(quiz_id) WHERE is_active_attachment should make this impossible. quizIds=${JSON.stringify(
          violations.map((v) => v.quizId),
        )}`,
      );
    }
  }
}
