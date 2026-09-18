-- CreateEnum
CREATE TYPE "QuizStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "quizzes" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "created_by_faculty_id" UUID NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "total_marks" DECIMAL(65,30) NOT NULL,
    "question_count" INTEGER NOT NULL,
    "instructions" TEXT,
    "quiz_type" TEXT NOT NULL,
    "preferred_date" DATE NOT NULL,
    "preferred_time" TIME NOT NULL,
    "academic_year" TEXT NOT NULL,
    "semester" INTEGER NOT NULL,
    "status" "QuizStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_batches" (
    "quiz_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,

    CONSTRAINT "quiz_batches_pkey" PRIMARY KEY ("quiz_id","batch_id")
);

-- CreateIndex
CREATE INDEX "quizzes_subject_id_idx" ON "quizzes"("subject_id");

-- CreateIndex
CREATE INDEX "quizzes_created_by_faculty_id_idx" ON "quizzes"("created_by_faculty_id");

-- CreateIndex
CREATE INDEX "quizzes_status_idx" ON "quizzes"("status");

-- CreateIndex
CREATE INDEX "quiz_batches_batch_id_idx" ON "quiz_batches"("batch_id");

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_created_by_faculty_id_fkey" FOREIGN KEY ("created_by_faculty_id") REFERENCES "faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_batches" ADD CONSTRAINT "quiz_batches_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_batches" ADD CONSTRAINT "quiz_batches_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
