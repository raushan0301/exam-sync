-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "disclosed_at" TIMESTAMP(3),
ADD COLUMN     "disclosed_by_admin_id" UUID;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_disclosed_by_admin_id_fkey" FOREIGN KEY ("disclosed_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
