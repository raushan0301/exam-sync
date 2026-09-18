-- CreateEnum
CREATE TYPE "NotificationRecipientType" AS ENUM ('STUDENT', 'FACULTY', 'ADMIN');

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('QUIZ_APPROVED', 'QUIZ_REJECTED', 'SEAT_ASSIGNED', 'EXAM_SESSION_RESCHEDULED', 'EXAM_SESSION_CANCELLED', 'INCIDENT_STATUS_UPDATED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'RETRYING', 'SENT', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_type" "NotificationRecipientType" NOT NULL,
    "recipient_id" UUID NOT NULL,
    "event_type" "NotificationEventType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_idempotency_key_key" ON "notifications"("idempotency_key");

-- CreateIndex
CREATE INDEX "notifications_recipient_type_recipient_id_created_at_idx" ON "notifications"("recipient_type", "recipient_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_status_next_attempt_at_idx" ON "notifications"("status", "next_attempt_at");
