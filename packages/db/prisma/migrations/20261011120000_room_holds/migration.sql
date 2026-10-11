-- CreateEnum
CREATE TYPE "RoomHoldKind" AS ENUM ('MAIN', 'BACKUP');

-- CreateEnum
CREATE TYPE "RoomHoldStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEventType" ADD VALUE 'ROOM_HOLD_RELEASED';
ALTER TYPE "NotificationEventType" ADD VALUE 'BACKUP_ROOM_USED';

-- AlterTable
ALTER TABLE "exam_sessions" ADD COLUMN     "empty_columns_planned" BOOLEAN;

-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN     "backup_room_locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "empty_columns_planned" BOOLEAN;

-- CreateTable
CREATE TABLE "room_holds" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "kind" "RoomHoldKind" NOT NULL,
    "seats_held" INTEGER NOT NULL,
    "hold_date" DATE NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "status" "RoomHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "release_reason" TEXT,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_holds_room_id_hold_date_status_idx" ON "room_holds"("room_id", "hold_date", "status");

-- CreateIndex
CREATE INDEX "room_holds_quiz_id_status_idx" ON "room_holds"("quiz_id", "status");

-- AddForeignKey
ALTER TABLE "room_holds" ADD CONSTRAINT "room_holds_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_holds" ADD CONSTRAINT "room_holds_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A hold must cover at least one seat and a real time window.
ALTER TABLE "room_holds" ADD CONSTRAINT "room_holds_seats_positive" CHECK ("seats_held" > 0);
ALTER TABLE "room_holds" ADD CONSTRAINT "room_holds_window_valid" CHECK ("end_time" > "start_time");
