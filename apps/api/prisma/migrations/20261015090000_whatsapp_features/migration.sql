-- CreateEnum
CREATE TYPE "BranchShift" AS ENUM ('DAY', 'NIGHT');

-- AlterEnum
ALTER TYPE "FineReason" ADD VALUE 'CORRUPTION';

-- AlterTable
ALTER TABLE "AttendanceLog" ADD COLUMN     "payPercent" INTEGER;

-- AlterTable
ALTER TABLE "LeaveRecord" ADD COLUMN     "payPercent" INTEGER;

-- AlterTable
ALTER TABLE "DoctorMonthlyPerformance" ADD COLUMN     "labCollection" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BranchShiftPerformance" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "shift" "BranchShift" NOT NULL,
    "patients" INTEGER NOT NULL DEFAULT 0,
    "labCollection" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "collection" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchShiftPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchProgressReport" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BranchProgressReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchShiftPerformance_year_month_idx" ON "BranchShiftPerformance"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "BranchShiftPerformance_branchId_year_month_shift_key" ON "BranchShiftPerformance"("branchId", "year", "month", "shift");

-- CreateIndex
CREATE UNIQUE INDEX "BranchProgressReport_branchId_year_month_key" ON "BranchProgressReport"("branchId", "year", "month");

-- AddForeignKey
ALTER TABLE "BranchShiftPerformance" ADD CONSTRAINT "BranchShiftPerformance_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchProgressReport" ADD CONSTRAINT "BranchProgressReport_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

