-- Quiz: replace total_marks/question_count with a single expected-headcount field
ALTER TABLE "quizzes" ADD COLUMN "student_count" INTEGER;
ALTER TABLE "quizzes" DROP COLUMN "total_marks";
ALTER TABLE "quizzes" DROP COLUMN "question_count";

-- Exam sessions: faculty room request + admin backup room + strategy/rejection metadata
ALTER TABLE "exam_sessions" ADD COLUMN "requested_room_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
ALTER TABLE "exam_sessions" ADD COLUMN "backup_room_id" UUID;
ALTER TABLE "exam_sessions" ADD COLUMN "room_allocation_strategy" TEXT;
ALTER TABLE "exam_sessions" ADD COLUMN "room_rejection_reason" TEXT;

ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_backup_room_id_fkey"
  FOREIGN KEY ("backup_room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
