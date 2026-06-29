-- AlterTable
ALTER TABLE "AttendanceLog" ADD COLUMN "overtimePending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AttendanceLog" ADD COLUMN "overtimeApprovedBy" TEXT;
ALTER TABLE "AttendanceLog" ADD COLUMN "overtimeApprovedAt" TIMESTAMP(3);
