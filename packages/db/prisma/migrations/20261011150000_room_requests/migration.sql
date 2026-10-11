-- CreateEnum
CREATE TYPE "RoomRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoomRequestTrigger" AS ENUM ('TOO_MANY_STUDENTS', 'NO_ROOM_FOR_EMPTY_COLUMNS', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEventType" ADD VALUE 'ROOM_REQUEST_SUBMITTED';
ALTER TYPE "NotificationEventType" ADD VALUE 'ROOM_REQUEST_APPROVED';
ALTER TYPE "NotificationEventType" ADD VALUE 'ROOM_REQUEST_REJECTED';

-- AlterTable
ALTER TABLE "room_holds" ADD COLUMN     "request_id" UUID;

-- CreateTable
CREATE TABLE "exam_session_room_requests" (
    "id" UUID NOT NULL,
    "exam_session_id" UUID NOT NULL,
    "requested_by_faculty_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "trigger" "RoomRequestTrigger" NOT NULL,
    "status" "RoomRequestStatus" NOT NULL DEFAULT 'PENDING',
    "previous_status" "ExamSessionStatus" NOT NULL,
    "empty_columns" BOOLEAN,
    "requested_room_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "approved_room_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "reviewed_by_admin_id" UUID,
    "review_note" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_session_room_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_session_room_students" (
    "exam_session_room_id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_session_room_students_pkey" PRIMARY KEY ("exam_session_room_id","quiz_id","student_id")
);

-- CreateIndex
CREATE INDEX "exam_session_room_requests_exam_session_id_status_idx" ON "exam_session_room_requests"("exam_session_id", "status");

-- CreateIndex
CREATE INDEX "exam_session_room_requests_status_created_at_idx" ON "exam_session_room_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "exam_session_room_students_student_id_idx" ON "exam_session_room_students"("student_id");

-- CreateIndex
CREATE INDEX "room_holds_request_id_idx" ON "room_holds"("request_id");

-- AddForeignKey
ALTER TABLE "room_holds" ADD CONSTRAINT "room_holds_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "exam_session_room_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_room_requests" ADD CONSTRAINT "exam_session_room_requests_exam_session_id_fkey" FOREIGN KEY ("exam_session_id") REFERENCES "exam_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_room_requests" ADD CONSTRAINT "exam_session_room_requests_requested_by_faculty_id_fkey" FOREIGN KEY ("requested_by_faculty_id") REFERENCES "faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_room_requests" ADD CONSTRAINT "exam_session_room_requests_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_room_students" ADD CONSTRAINT "exam_session_room_students_exam_session_room_id_fkey" FOREIGN KEY ("exam_session_room_id") REFERENCES "exam_session_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one PENDING room request per exam session.
CREATE UNIQUE INDEX "exam_session_room_requests_one_pending_per_session"
  ON "exam_session_room_requests" ("exam_session_id")
  WHERE "status" = 'PENDING';
