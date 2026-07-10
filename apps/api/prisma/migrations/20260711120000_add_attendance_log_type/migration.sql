-- CreateEnum
CREATE TYPE "AttendanceLogType" AS ENUM ('REGULAR', 'OVERTIME');

-- AlterTable
ALTER TABLE "AttendanceLog" ADD COLUMN "type" "AttendanceLogType" NOT NULL DEFAULT 'REGULAR';

-- DropIndex
DROP INDEX "AttendanceLog_employeeId_date_key";

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceLog_employeeId_date_type_key" ON "AttendanceLog"("employeeId", "date", "type");
