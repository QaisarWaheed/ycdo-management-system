-- Req 20: monthly payroll workflow (salary review corrections, Founder approval, PC proof-reading).
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PROJECT_COORDINATOR';
ALTER TYPE "PayrollStatus" ADD VALUE IF NOT EXISTS 'FOUNDER_APPROVED' BEFORE 'PROCESSED';
ALTER TYPE "PayrollStatus" ADD VALUE IF NOT EXISTS 'PC_VERIFIED' BEFORE 'PROCESSED';
ALTER TYPE "PaySuggestionKind" ADD VALUE IF NOT EXISTS 'DEDUCTION';

CREATE TYPE "SalaryCorrectionStatus" AS ENUM ('SUBMITTED', 'HR_REJECTED', 'FORWARDED', 'CHAIRMAN_REJECTED', 'APPLIED');
CREATE TABLE "SalaryCorrectionRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payrollEntryId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "claimItems" JSONB,
    "status" "SalaryCorrectionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "hrLines" JSONB,
    "hrNote" TEXT,
    "hrById" TEXT,
    "hrAt" TIMESTAMP(3),
    "impactAmount" DECIMAL(10,2),
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "appliedEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalaryCorrectionRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalaryCorrectionRequest_status_idx" ON "SalaryCorrectionRequest"("status");
CREATE INDEX "SalaryCorrectionRequest_employeeId_year_month_idx" ON "SalaryCorrectionRequest"("employeeId", "year", "month");
ALTER TABLE "SalaryCorrectionRequest" ADD CONSTRAINT "SalaryCorrectionRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "PayrollReviewKind" AS ENUM ('FINANCE_CORRECTION', 'PC_PROOF_READING');
CREATE TYPE "PayrollReviewStatus" AS ENUM ('OPEN', 'RESPONDED', 'CLOSED');
CREATE TABLE "PayrollReviewIssue" (
    "id" TEXT NOT NULL,
    "payrollEntryId" TEXT NOT NULL,
    "kind" "PayrollReviewKind" NOT NULL,
    "raisedById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "lineKind" TEXT,
    "lineId" TEXT,
    "note" TEXT NOT NULL,
    "status" "PayrollReviewStatus" NOT NULL DEFAULT 'OPEN',
    "response" TEXT,
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollReviewIssue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PayrollReviewIssue_status_kind_idx" ON "PayrollReviewIssue"("status", "kind");
CREATE INDEX "PayrollReviewIssue_assignedToId_status_idx" ON "PayrollReviewIssue"("assignedToId", "status");
ALTER TABLE "PayrollReviewIssue" ADD CONSTRAINT "PayrollReviewIssue_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "PayrollEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
