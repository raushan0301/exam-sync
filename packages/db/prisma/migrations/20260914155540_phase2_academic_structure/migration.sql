-- CreateEnum
CREATE TYPE "AcademicStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "AcademicStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "AcademicStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "status" "AcademicStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "program_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "programs_code_key" ON "programs"("code");

-- CreateIndex
CREATE INDEX "programs_department_id_idx" ON "programs"("department_id");

-- CreateIndex
CREATE INDEX "batches_program_id_idx" ON "batches"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "batches_program_id_year_section_key" ON "batches"("program_id", "year", "section");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_code_key" ON "subjects"("code");

-- CreateIndex
CREATE INDEX "subjects_department_id_idx" ON "subjects"("department_id");

-- CreateIndex
CREATE INDEX "subjects_program_id_idx" ON "subjects"("program_id");

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
