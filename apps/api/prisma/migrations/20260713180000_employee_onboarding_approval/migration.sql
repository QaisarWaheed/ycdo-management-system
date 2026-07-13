-- Add PRESIDENT role and employee onboarding approval workflow

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PRESIDENT';
ALTER TYPE "BroadcastTarget" ADD VALUE IF NOT EXISTS 'PRESIDENT';
ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';

CREATE TYPE "EmployeeApproverTarget" AS ENUM ('PRESIDENT', 'FOUNDER', 'CHAIRMAN_ADMIN');
CREATE TYPE "EmployeeOnboardingStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "EmployeeOnboardingApproval" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "approverTarget" "EmployeeApproverTarget" NOT NULL,
    "status" "EmployeeOnboardingStatus" NOT NULL DEFAULT 'PENDING',
    "formSnapshot" JSONB NOT NULL,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeOnboardingApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeOnboardingApproval_employeeId_key" ON "EmployeeOnboardingApproval"("employeeId");

ALTER TABLE "EmployeeOnboardingApproval" ADD CONSTRAINT "EmployeeOnboardingApproval_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeOnboardingApproval" ADD CONSTRAINT "EmployeeOnboardingApproval_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeOnboardingApproval" ADD CONSTRAINT "EmployeeOnboardingApproval_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
