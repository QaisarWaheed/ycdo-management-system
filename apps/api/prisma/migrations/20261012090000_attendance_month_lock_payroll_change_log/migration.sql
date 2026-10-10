-- Phase 3: HR verifies & locks attendance per branch-month; Accounts finalise payroll; payroll change log.
-- CreateEnum
CREATE TYPE "AttendanceMonthStatus" AS ENUM ('VERIFIED', 'UNLOCKED');

-- AlterEnum


ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'ATTENDANCE_VERIFY';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'PAYROLL_FINALIZE';

-- CreateTable
CREATE TABLE "AttendanceMonthLock" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "AttendanceMonthStatus" NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "unlockedById" TEXT,
    "unlockedAt" TIMESTAMP(3),
    "unlockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceMonthLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollChangeLog" (
    "id" TEXT NOT NULL,
    "payrollEntryId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "netBefore" DECIMAL(10,2),
    "netAfter" DECIMAL(10,2),
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceMonthLock_branchId_year_month_key" ON "AttendanceMonthLock"("branchId", "year", "month");

-- CreateIndex
CREATE INDEX "PayrollChangeLog_payrollEntryId_createdAt_idx" ON "PayrollChangeLog"("payrollEntryId", "createdAt");

-- AddForeignKey
ALTER TABLE "AttendanceMonthLock" ADD CONSTRAINT "AttendanceMonthLock_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollChangeLog" ADD CONSTRAINT "PayrollChangeLog_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "PayrollEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollChangeLog" ADD CONSTRAINT "PayrollChangeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

