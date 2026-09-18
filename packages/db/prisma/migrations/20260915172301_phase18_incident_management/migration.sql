-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('CHEATING_SUSPICION', 'UNAUTHORIZED_MATERIAL', 'MISCONDUCT', 'MISSING', 'LATE', 'MEDICAL', 'SEATING', 'TECHNICAL', 'ROOM', 'IDENTITY', 'PAPER', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "IncidentAction" AS ENUM ('CREATE', 'INVESTIGATE', 'ESCALATE', 'RESOLVE', 'DISMISS');

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "exam_session_id" UUID NOT NULL,
    "quiz_id" UUID,
    "student_id" UUID,
    "room_id" UUID,
    "seat_id" UUID,
    "reported_by_faculty_id" UUID NOT NULL,
    "incident_type" "IncidentType" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "evidence_metadata" JSONB,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolved_by_admin_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id"),
    -- BR-039/API_CONTRACT.md: "resolution required for RESOLVE/DISMISS" —
    -- same technique as quiz_approval_history's CHECK (Phase 7,
    -- migration 20260914175710) for BR-012's reason-required-on-reject;
    -- single-row, no cross-table read needed (unlike attendance's
    -- locked-reason case), so a plain CHECK is the real backstop here,
    -- not just an app-level convention.
    CONSTRAINT "incidents_resolution_required_check" CHECK (status NOT IN ('RESOLVED', 'DISMISSED') OR resolution IS NOT NULL)
);

-- CreateTable
CREATE TABLE "incident_history" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" "IncidentAction" NOT NULL,
    "old_status" "IncidentStatus",
    "new_status" "IncidentStatus" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incidents_exam_session_id_idx" ON "incidents"("exam_session_id");

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- CreateIndex
CREATE INDEX "incidents_reported_by_faculty_id_idx" ON "incidents"("reported_by_faculty_id");

-- CreateIndex
CREATE INDEX "incident_history_incident_id_idx" ON "incident_history"("incident_id");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_exam_session_id_fkey" FOREIGN KEY ("exam_session_id") REFERENCES "exam_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "room_seats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_faculty_id_fkey" FOREIGN KEY ("reported_by_faculty_id") REFERENCES "faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_admin_id_fkey" FOREIGN KEY ("resolved_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_history" ADD CONSTRAINT "incident_history_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_history" ADD CONSTRAINT "incident_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
