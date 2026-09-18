-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'MEDICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('MANUAL', 'SEAT_BASED', 'QR', 'BIOMETRIC');

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL,
    "quiz_student_assignment_id" UUID NOT NULL,
    "seat_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "method" "AttendanceMethod" NOT NULL,
    "marked_by_faculty_id" UUID NOT NULL,
    "marked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_history" (
    "id" UUID NOT NULL,
    "attendance_id" UUID NOT NULL,
    "changed_by_faculty_id" UUID NOT NULL,
    "old_status" "AttendanceStatus" NOT NULL,
    "new_status" "AttendanceStatus" NOT NULL,
    "reason" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_quiz_student_assignment_id_key" ON "attendance"("quiz_student_assignment_id");

-- CreateIndex
CREATE INDEX "attendance_history_attendance_id_idx" ON "attendance_history"("attendance_id");

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_quiz_student_assignment_id_fkey" FOREIGN KEY ("quiz_student_assignment_id") REFERENCES "quiz_student_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "room_seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_marked_by_faculty_id_fkey" FOREIGN KEY ("marked_by_faculty_id") REFERENCES "faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_history" ADD CONSTRAINT "attendance_history_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_history" ADD CONSTRAINT "attendance_history_changed_by_faculty_id_fkey" FOREIGN KEY ("changed_by_faculty_id") REFERENCES "faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
