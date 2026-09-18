-- CreateEnum
CREATE TYPE "QuizApprovalAction" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'RESUBMITTED');

-- CreateTable
CREATE TABLE "quiz_approval_history" (
    "id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "action" "QuizApprovalAction" NOT NULL,
    "actor_id" UUID NOT NULL,
    "reason" TEXT,
    "previous_status" "QuizStatus" NOT NULL,
    "new_status" "QuizStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_approval_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quiz_approval_history_quiz_id_idx" ON "quiz_approval_history"("quiz_id");

-- AddForeignKey
ALTER TABLE "quiz_approval_history" ADD CONSTRAINT "quiz_approval_history_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_approval_history" ADD CONSTRAINT "quiz_approval_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BR-012 (hand-added — Prisma has no declarative CHECK-constraint syntax):
-- "A rejected quiz must contain a rejection reason." Enforced here at the
-- DB level, not merely in the application layer (IMPLEMENTATION_PLAN.md
-- Phase 7's explicit backend-work instruction). The application also
-- validates this before ever reaching the DB (422, not a raw constraint
-- error) — this is the backstop, matching BUSINESS_RULES.md's "DB
-- constraints + service-level validation" dual-layer philosophy used
-- throughout this codebase.
ALTER TABLE "quiz_approval_history" ADD CONSTRAINT "quiz_approval_history_reason_required_on_reject"
  CHECK (action != 'REJECTED' OR reason IS NOT NULL);
