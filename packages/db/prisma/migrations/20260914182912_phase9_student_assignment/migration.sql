-- CreateEnum
CREATE TYPE "QuizStudentAssignmentStatus" AS ENUM ('ASSIGNED', 'WAITLISTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "quiz_student_assignments" (
    "id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "exam_session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "QuizStudentAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_student_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quiz_student_assignments_student_id_idx" ON "quiz_student_assignments"("student_id");

-- CreateIndex
CREATE INDEX "quiz_student_assignments_exam_session_id_idx" ON "quiz_student_assignments"("exam_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_student_assignments_quiz_id_student_id_key" ON "quiz_student_assignments"("quiz_id", "student_id");

-- AddForeignKey
ALTER TABLE "quiz_student_assignments" ADD CONSTRAINT "quiz_student_assignments_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_student_assignments" ADD CONSTRAINT "quiz_student_assignments_exam_session_id_fkey" FOREIGN KEY ("exam_session_id") REFERENCES "exam_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_student_assignments" ADD CONSTRAINT "quiz_student_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
