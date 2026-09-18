-- CreateEnum
CREATE TYPE "SeatingStrategy" AS ENUM ('SEQUENTIAL', 'RANDOMIZED', 'ALTERNATE_SUBJECT', 'ALTERNATE_BATCH', 'SUBJECT_BATCH_MIX', 'ANTI_CHEATING');

-- CreateEnum
CREATE TYPE "SeatingPlanStatus" AS ENUM ('DRAFT', 'VALIDATED', 'FAILED', 'FINALIZED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "exam_session_room_quizzes" (
    "id" UUID NOT NULL,
    "exam_session_room_id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "student_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_session_room_quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seating_plans" (
    "id" UUID NOT NULL,
    "exam_session_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "strategy" "SeatingStrategy" NOT NULL,
    "status" "SeatingPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "soft_constraint_score" DECIMAL(4,3),
    "violation_report" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMP(3),

    CONSTRAINT "seating_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seating_assignments" (
    "id" UUID NOT NULL,
    "seating_plan_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "seat_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seating_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exam_session_room_quizzes_exam_session_room_id_quiz_id_key" ON "exam_session_room_quizzes"("exam_session_room_id", "quiz_id");

-- CreateIndex
CREATE INDEX "seating_plans_exam_session_id_room_id_idx" ON "seating_plans"("exam_session_id", "room_id");

-- CreateIndex
CREATE INDEX "seating_assignments_seating_plan_id_idx" ON "seating_assignments"("seating_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "seating_assignments_seating_plan_id_seat_id_key" ON "seating_assignments"("seating_plan_id", "seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "seating_assignments_seating_plan_id_student_id_key" ON "seating_assignments"("seating_plan_id", "student_id");

-- AddForeignKey
ALTER TABLE "exam_session_room_quizzes" ADD CONSTRAINT "exam_session_room_quizzes_exam_session_room_id_fkey" FOREIGN KEY ("exam_session_room_id") REFERENCES "exam_session_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_room_quizzes" ADD CONSTRAINT "exam_session_room_quizzes_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_plans" ADD CONSTRAINT "seating_plans_exam_session_id_fkey" FOREIGN KEY ("exam_session_id") REFERENCES "exam_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_plans" ADD CONSTRAINT "seating_plans_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_assignments" ADD CONSTRAINT "seating_assignments_seating_plan_id_fkey" FOREIGN KEY ("seating_plan_id") REFERENCES "seating_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_assignments" ADD CONSTRAINT "seating_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_assignments" ADD CONSTRAINT "seating_assignments_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_assignments" ADD CONSTRAINT "seating_assignments_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "room_seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EC-032: idempotency guard — at most one DRAFT-or-FINALIZED seating plan
-- per (exam_session_id, room_id) at a time (hand-added: Prisma has no
-- declarative partial-unique-index syntax, same technique already used
-- for BR-053 in Phase 8 and BR-018 in Phase 12). A second `generate` call
-- while one already exists in either status must be rejected/short-
-- circuited by the application before ever reaching this constraint —
-- this is the DB-level backstop, not the primary UX path.
CREATE UNIQUE INDEX "seating_plans_active_per_room"
  ON "seating_plans" ("exam_session_id", "room_id")
  WHERE "status" IN ('DRAFT', 'FINALIZED');
