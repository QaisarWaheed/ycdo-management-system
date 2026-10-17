-- CreateEnum
CREATE TYPE "ExtraTimeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "IncentiveDuration" AS ENUM ('ONE_TIME', 'MONTHS', 'PERMANENT');

-- AlterTable
ALTER TABLE "AttendanceLog" ADD COLUMN     "overtimeEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "overtimeRequestedById" TEXT,
ADD COLUMN     "overtimeReviewNote" TEXT,
ADD COLUMN     "overtimeStatus" "ExtraTimeStatus";

-- AlterTable
ALTER TABLE "SuspensionRequest" ADD COLUMN     "periodEndAlertedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Incentive" ADD COLUMN     "planId" TEXT;

-- AlterTable
ALTER TABLE "AdditionalWorkingDay" ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" "ExtraTimeStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "IncentivePlan" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "typeId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "duration" "IncentiveDuration" NOT NULL,
    "startMonth" INTEGER NOT NULL,
    "startYear" INTEGER NOT NULL,
    "endMonth" INTEGER,
    "endYear" INTEGER,
    "stoppedAt" TIMESTAMP(3),
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncentivePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAdditionalDuty" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "allowanceId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAdditionalDuty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncentivePlan_employeeId_idx" ON "IncentivePlan"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeAdditionalDuty_employeeId_idx" ON "EmployeeAdditionalDuty"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Incentive_planId_month_year_key" ON "Incentive"("planId", "month", "year");

-- AddForeignKey
ALTER TABLE "Incentive" ADD CONSTRAINT "Incentive_planId_fkey" FOREIGN KEY ("planId") REFERENCES "IncentivePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncentivePlan" ADD CONSTRAINT "IncentivePlan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncentivePlan" ADD CONSTRAINT "IncentivePlan_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "IncentiveType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAdditionalDuty" ADD CONSTRAINT "EmployeeAdditionalDuty_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing extra working days were already paid: keep them approved.
UPDATE "AdditionalWorkingDay" SET "status" = 'APPROVED', "reviewedAt" = "createdAt";
