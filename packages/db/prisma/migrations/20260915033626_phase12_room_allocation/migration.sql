-- CreateTable
CREATE TABLE "exam_session_rooms" (
    "id" UUID NOT NULL,
    "exam_session_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "allocated_capacity" INTEGER NOT NULL,
    "session_date" DATE NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_session_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_session_rooms_exam_session_id_idx" ON "exam_session_rooms"("exam_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_session_rooms_room_id_exam_session_id_key" ON "exam_session_rooms"("room_id", "exam_session_id");

-- AddForeignKey
ALTER TABLE "exam_session_rooms" ADD CONSTRAINT "exam_session_rooms_exam_session_id_fkey" FOREIGN KEY ("exam_session_id") REFERENCES "exam_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_rooms" ADD CONSTRAINT "exam_session_rooms_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BR-018: a room cannot be double-booked. Hand-added (Prisma has no
-- declarative EXCLUDE-constraint syntax — same technique already used for
-- Phase 7's CHECK constraint and Phase 8's partial unique index). Requires
-- btree_gist for the equality operator class on a non-range column (room_id)
-- to combine with the range operator class (&&) in one GiST exclusion index.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "exam_session_rooms"
  ADD CONSTRAINT "exam_session_rooms_no_overlap"
  EXCLUDE USING gist (
    "room_id" WITH =,
    tsrange(("session_date" + "start_time"), ("session_date" + "end_time")) WITH &&
  );
