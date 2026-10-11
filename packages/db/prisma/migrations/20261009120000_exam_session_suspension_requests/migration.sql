-- CreateEnum
CREATE TYPE "SuspensionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEventType" ADD VALUE 'SUSPENSION_REQUESTED';
ALTER TYPE "NotificationEventType" ADD VALUE 'SUSPENSION_APPROVED';
ALTER TYPE "NotificationEventType" ADD VALUE 'SUSPENSION_REJECTED';

-- CreateTable
CREATE TABLE "exam_session_suspension_requests" (
    "id" UUID NOT NULL,
    "exam_session_id" UUID NOT NULL,
    "requested_by_faculty_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "SuspensionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_admin_id" UUID,
    "review_note" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_session_suspension_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_session_suspension_requests_exam_session_id_idx" ON "exam_session_suspension_requests"("exam_session_id");

-- CreateIndex
CREATE INDEX "exam_session_suspension_requests_status_created_at_idx" ON "exam_session_suspension_requests"("status", "created_at");

-- AddForeignKey
ALTER TABLE "exam_session_suspension_requests" ADD CONSTRAINT "exam_session_suspension_requests_exam_session_id_fkey" FOREIGN KEY ("exam_session_id") REFERENCES "exam_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_suspension_requests" ADD CONSTRAINT "exam_session_suspension_requests_requested_by_faculty_id_fkey" FOREIGN KEY ("requested_by_faculty_id") REFERENCES "faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_suspension_requests" ADD CONSTRAINT "exam_session_suspension_requests_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most ONE pending suspension request per exam session (Prisma can't express a partial unique index).
CREATE UNIQUE INDEX "exam_session_suspension_requests_one_pending_per_session"
  ON "exam_session_suspension_requests" ("exam_session_id")
  WHERE "status" = 'PENDING';
