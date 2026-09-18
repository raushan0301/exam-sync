-- CreateEnum
CREATE TYPE "FacultyAssignmentRole" AS ENUM ('PRIMARY_INSTRUCTOR', 'CO_INSTRUCTOR');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ENROLLED', 'DROPPED', 'COMPLETED', 'INACTIVE', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "faculty_subject_batch_assignment" (
    "id" UUID NOT NULL,
    "faculty_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "academic_year" TEXT NOT NULL,
    "semester" INTEGER NOT NULL,
    "role" "FacultyAssignmentRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "faculty_subject_batch_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_subject_enrollment" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "academic_year" TEXT NOT NULL,
    "semester" INTEGER NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ENROLLED',
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dropped_at" TIMESTAMP(3),

    CONSTRAINT "student_subject_enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "faculty_subject_batch_assignment_faculty_id_idx" ON "faculty_subject_batch_assignment"("faculty_id");

-- CreateIndex
CREATE INDEX "faculty_subject_batch_assignment_subject_id_idx" ON "faculty_subject_batch_assignment"("subject_id");

-- CreateIndex
CREATE INDEX "faculty_subject_batch_assignment_batch_id_idx" ON "faculty_subject_batch_assignment"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_subject_batch_assignment_faculty_id_subject_id_batc_key" ON "faculty_subject_batch_assignment"("faculty_id", "subject_id", "batch_id", "academic_year", "semester");

-- CreateIndex
CREATE INDEX "student_subject_enrollment_student_id_idx" ON "student_subject_enrollment"("student_id");

-- CreateIndex
CREATE INDEX "student_subject_enrollment_subject_id_idx" ON "student_subject_enrollment"("subject_id");

-- CreateIndex
CREATE INDEX "student_subject_enrollment_batch_id_idx" ON "student_subject_enrollment"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_subject_enrollment_student_id_subject_id_academic_y_key" ON "student_subject_enrollment"("student_id", "subject_id", "academic_year", "semester");

-- AddForeignKey
ALTER TABLE "faculty_subject_batch_assignment" ADD CONSTRAINT "faculty_subject_batch_assignment_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_subject_batch_assignment" ADD CONSTRAINT "faculty_subject_batch_assignment_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_subject_batch_assignment" ADD CONSTRAINT "faculty_subject_batch_assignment_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_subject_enrollment" ADD CONSTRAINT "student_subject_enrollment_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_subject_enrollment" ADD CONSTRAINT "student_subject_enrollment_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_subject_enrollment" ADD CONSTRAINT "student_subject_enrollment_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
