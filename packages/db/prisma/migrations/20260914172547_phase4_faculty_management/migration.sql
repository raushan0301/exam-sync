-- CreateTable
CREATE TABLE "faculty" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "department_id" UUID NOT NULL,
    "employee_code" TEXT NOT NULL,
    "status" "AcademicStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "faculty_user_id_key" ON "faculty"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_employee_code_key" ON "faculty"("employee_code");

-- CreateIndex
CREATE INDEX "faculty_department_id_idx" ON "faculty"("department_id");

-- AddForeignKey
ALTER TABLE "faculty" ADD CONSTRAINT "faculty_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty" ADD CONSTRAINT "faculty_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
