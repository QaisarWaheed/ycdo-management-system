-- Phase 3 Req 12: Finance verification lock and Founder-approved amendments.
ALTER TYPE "PayrollStatus" ADD VALUE IF NOT EXISTS 'VERIFIED' BEFORE 'PROCESSED';
ALTER TABLE "PayrollEntry" ADD COLUMN "financeVerifiedAt" TIMESTAMP(3), ADD COLUMN "financeVerifiedById" TEXT;

CREATE TYPE "PayrollAmendmentStatus" AS ENUM ('HR_NOTIFIED', 'SUBMITTED', 'APPROVED', 'REJECTED');
CREATE TABLE "PayrollAmendmentRequest" (
    "id" TEXT NOT NULL,
    "payrollEntryId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "PayrollAmendmentStatus" NOT NULL DEFAULT 'HR_NOTIFIED',
    "notification" TEXT NOT NULL,
    "notifiedById" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "financeNote" TEXT,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    CONSTRAINT "PayrollAmendmentRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PayrollAmendmentRequest_status_idx" ON "PayrollAmendmentRequest"("status");
CREATE INDEX "PayrollAmendmentRequest_employeeId_idx" ON "PayrollAmendmentRequest"("employeeId");
ALTER TABLE "PayrollAmendmentRequest" ADD CONSTRAINT "PayrollAmendmentRequest_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "PayrollEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
