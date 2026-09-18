-- CreateEnum
CREATE TYPE "ExamSessionStatus" AS ENUM ('DRAFT', 'ASSIGNING_STUDENTS', 'ROOM_ALLOCATION', 'SEATING_GENERATION', 'READY_FOR_FINALIZATION', 'FINALIZED', 'NOTIFIED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "exam_sessions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "session_date" DATE NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "status" "ExamSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_admin_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_session_quizzes" (
    "exam_session_id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "is_active_attachment" BOOLEAN NOT NULL DEFAULT true,
    "attached_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detached_at" TIMESTAMP(3),

    CONSTRAINT "exam_session_quizzes_pkey" PRIMARY KEY ("exam_session_id","quiz_id")
);

-- CreateIndex
CREATE INDEX "exam_sessions_status_idx" ON "exam_sessions"("status");

-- CreateIndex
CREATE INDEX "exam_session_quizzes_quiz_id_idx" ON "exam_session_quizzes"("quiz_id");

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_quizzes" ADD CONSTRAINT "exam_session_quizzes_exam_session_id_fkey" FOREIGN KEY ("exam_session_id") REFERENCES "exam_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_quizzes" ADD CONSTRAINT "exam_session_quizzes_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BR-053 (hand-added — Prisma has no declarative partial/filtered-unique-
-- index syntax, same limitation already worked around for
-- QuizApprovalHistory's CHECK constraint in Phase 7). ADR-006's own
-- recommended implementation, verbatim: "denormalize a boolean
-- is_active_attachment ... with UNIQUE(quiz_id) WHERE is_active_attachment
-- = true as the real DB-enforced constraint." This is the actual
-- data-integrity guarantee — the application also checks this before
-- attaching (see exam-sessions.service.ts's attachQuizzes), but this
-- index is what makes it impossible to violate even under a race between
-- two concurrent attach requests for the same quiz.
CREATE UNIQUE INDEX "exam_session_quizzes_quiz_id_active_key"
  ON "exam_session_quizzes" ("quiz_id")
  WHERE "is_active_attachment" = true;
