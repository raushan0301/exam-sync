-- AlterTable
ALTER TABLE "quizzes" ALTER COLUMN "duration_minutes" DROP NOT NULL,
ALTER COLUMN "total_marks" DROP NOT NULL,
ALTER COLUMN "question_count" DROP NOT NULL,
ALTER COLUMN "quiz_type" DROP NOT NULL,
ALTER COLUMN "preferred_date" DROP NOT NULL,
ALTER COLUMN "preferred_time" DROP NOT NULL;
