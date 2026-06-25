-- Phase 4: enum extensions, stipend rename, branch change rename, new models

-- EmployeeStatus: add DISMISSED
ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'DISMISSED';

-- LeaveStatus: add reliever workflow statuses
ALTER TYPE "LeaveStatus" ADD VALUE IF NOT EXISTS 'RELIEVER_PENDING';
ALTER TYPE "LeaveStatus" ADD VALUE IF NOT EXISTS 'RELIEVER_CONFIRMED';
ALTER TYPE "LeaveStatus" ADD VALUE IF NOT EXISTS 'RELIEVER_REJECTED';

-- New enums
CREATE TYPE "StipendStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'AUTO_ACCEPTED');
CREATE TYPE "RelieverRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'AUTO_REJECTED', 'HR_ASSIGNED');

-- SalaryRecord → StipendRecord
ALTER TABLE "SalaryRecord" RENAME TO "StipendRecord";
ALTER TABLE "StipendRecord" RENAME COLUMN "basicSalary" TO "basicStipend";

-- PayrollEntry column renames
ALTER TABLE "PayrollEntry" RENAME COLUMN "salaryRecordId" TO "stipendRecordId";
ALTER TABLE "PayrollEntry" RENAME COLUMN "basicSalary" TO "basicStipend";
ALTER TABLE "PayrollEntry" RENAME COLUMN "netSalary" TO "netStipend";

-- Rename unique index on PayrollEntry
ALTER INDEX "PayrollEntry_salaryRecordId_month_year_key"
  RENAME TO "PayrollEntry_stipendRecordId_month_year_key";

-- OutstationRequest → BranchChangeRequest
ALTER TABLE "OutstationRequest" RENAME TO "BranchChangeRequest";

-- RelieverRequest
CREATE TABLE "RelieverRequest" (
    "id" TEXT NOT NULL,
    "leaveRecordId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "relieverId" TEXT NOT NULL,
    "status" "RelieverRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "autoRejectedAt" TIMESTAMP(3),
    "hrAssigned" BOOLEAN NOT NULL DEFAULT false,
    "hrAssignedBy" TEXT,
    "hrAssignedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelieverRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RelieverRequest_leaveRecordId_key" ON "RelieverRequest"("leaveRecordId");

ALTER TABLE "RelieverRequest" ADD CONSTRAINT "RelieverRequest_leaveRecordId_fkey"
  FOREIGN KEY ("leaveRecordId") REFERENCES "LeaveRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RelieverRequest" ADD CONSTRAINT "RelieverRequest_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RelieverRequest" ADD CONSTRAINT "RelieverRequest_relieverId_fkey"
  FOREIGN KEY ("relieverId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- StipendReceipt
CREATE TABLE "StipendReceipt" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payrollEntryId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "StipendStatus" NOT NULL DEFAULT 'PENDING',
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "autoAcceptedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StipendReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StipendReceipt_payrollEntryId_key" ON "StipendReceipt"("payrollEntryId");

ALTER TABLE "StipendReceipt" ADD CONSTRAINT "StipendReceipt_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StipendReceipt" ADD CONSTRAINT "StipendReceipt_payrollEntryId_fkey"
  FOREIGN KEY ("payrollEntryId") REFERENCES "PayrollEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Incentive
CREATE TABLE "Incentive" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incentive_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Incentive" ADD CONSTRAINT "Incentive_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Incentive" ADD CONSTRAINT "Incentive_addedBy_fkey"
  FOREIGN KEY ("addedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
