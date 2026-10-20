-- Payroll phase 2: audit difference deduction, loan kind / purpose,
-- request attachments, Medicine Pending log.
ALTER TYPE "DeductionType" ADD VALUE 'AUDIT_DIFFERENCE';

CREATE TYPE "LoanKind" AS ENUM ('LOAN', 'ADVANCE');
CREATE TYPE "LoanPurpose" AS ENUM ('PERSONAL', 'MEDICAL', 'MARRIAGE', 'EDUCATION');
ALTER TABLE "EmployeeLoan" ADD COLUMN "kind" "LoanKind" NOT NULL DEFAULT 'LOAN';
ALTER TABLE "EmployeeLoan" ADD COLUMN "purpose" "LoanPurpose" NOT NULL DEFAULT 'PERSONAL';

ALTER TABLE "PayChangeRequest" ADD COLUMN "attachmentUrl" TEXT;
ALTER TABLE "PayChangeRequest" ADD COLUMN "attachmentFileName" TEXT;
ALTER TABLE "PayChangeRequest" ADD COLUMN "attachmentMimeType" TEXT;

CREATE TABLE "MedicinePendingEntry" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "tokenNo" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "pendingDate" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MedicinePendingEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MedicinePendingEntry_employeeId_pendingDate_idx" ON "MedicinePendingEntry"("employeeId", "pendingDate");
CREATE INDEX "MedicinePendingEntry_pendingDate_idx" ON "MedicinePendingEntry"("pendingDate");
ALTER TABLE "MedicinePendingEntry" ADD CONSTRAINT "MedicinePendingEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
