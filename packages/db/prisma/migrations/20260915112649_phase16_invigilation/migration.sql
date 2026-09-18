-- CreateEnum
CREATE TYPE "InvigilatorRole" AS ENUM ('LEAD_INVIGILATOR', 'ASSISTANT_INVIGILATOR');

-- CreateTable
CREATE TABLE "exam_invigilators" (
    "id" UUID NOT NULL,
    "exam_session_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "faculty_id" UUID NOT NULL,
    "role" "InvigilatorRole" NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_invigilators_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_invigilators_faculty_id_idx" ON "exam_invigilators"("faculty_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_invigilators_exam_session_id_room_id_faculty_id_key" ON "exam_invigilators"("exam_session_id", "room_id", "faculty_id");

-- AddForeignKey
ALTER TABLE "exam_invigilators" ADD CONSTRAINT "exam_invigilators_exam_session_id_fkey" FOREIGN KEY ("exam_session_id") REFERENCES "exam_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_invigilators" ADD CONSTRAINT "exam_invigilators_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_invigilators" ADD CONSTRAINT "exam_invigilators_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
