ALTER TABLE "quizzes" ADD COLUMN "requested_room_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
ALTER TABLE "quizzes" ADD COLUMN "backup_room_id" UUID;
ALTER TABLE "quizzes" ADD COLUMN "room_allocation_strategy" TEXT;

ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_backup_room_id_fkey"
  FOREIGN KEY ("backup_room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
