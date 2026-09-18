-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "program_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "roll_number" TEXT NOT NULL,
    "status" "AcademicStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "resource_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "total_rows" INTEGER NOT NULL,
    "success_count" INTEGER NOT NULL,
    "failure_count" INTEGER NOT NULL,
    "results" JSONB NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "students_user_id_key" ON "students"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_roll_number_key" ON "students"("roll_number");

-- CreateIndex
CREATE INDEX "students_program_id_idx" ON "students"("program_id");

-- CreateIndex
CREATE INDEX "students_batch_id_idx" ON "students"("batch_id");

-- CreateIndex
CREATE INDEX "import_jobs_resource_type_created_at_idx" ON "import_jobs"("resource_type", "created_at");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
