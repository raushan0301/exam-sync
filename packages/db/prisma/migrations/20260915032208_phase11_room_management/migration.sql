-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'INACTIVE');

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "building" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "room_number" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "rows" INTEGER NOT NULL,
    "columns" INTEGER NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'ACTIVE',
    "accessibility_info" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_seats" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "seat_label" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "col_index" INTEGER NOT NULL,
    "is_accessible" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_availability" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rooms_status_idx" ON "rooms"("status");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_building_room_number_key" ON "rooms"("building", "room_number");

-- CreateIndex
CREATE INDEX "room_seats_room_id_idx" ON "room_seats"("room_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_seats_room_id_seat_label_key" ON "room_seats"("room_id", "seat_label");

-- CreateIndex
CREATE INDEX "room_availability_room_id_date_idx" ON "room_availability"("room_id", "date");

-- AddForeignKey
ALTER TABLE "room_seats" ADD CONSTRAINT "room_seats_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_availability" ADD CONSTRAINT "room_availability_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
