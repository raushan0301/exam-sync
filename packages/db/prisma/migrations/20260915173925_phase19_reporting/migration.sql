-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('ATTENDANCE', 'SEATING_PLAN', 'INCIDENT_REPORT', 'ROOM_UTILIZATION');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('CSV', 'EXCEL');

-- CreateEnum
CREATE TYPE "ReportJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'REPORT_READY';

-- CreateTable
CREATE TABLE "report_jobs" (
    "id" UUID NOT NULL,
    "report_type" "ReportType" NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "exam_session_id" UUID NOT NULL,
    "status" "ReportJobStatus" NOT NULL DEFAULT 'PENDING',
    "result_url" TEXT,
    "result_data" BYTEA,
    "result_content_type" TEXT,
    "result_filename" TEXT,
    "error_message" TEXT,
    "requested_by_admin_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_jobs_status_idx" ON "report_jobs"("status");

-- CreateIndex
CREATE INDEX "report_jobs_exam_session_id_idx" ON "report_jobs"("exam_session_id");

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_exam_session_id_fkey" FOREIGN KEY ("exam_session_id") REFERENCES "exam_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_requested_by_admin_id_fkey" FOREIGN KEY ("requested_by_admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
