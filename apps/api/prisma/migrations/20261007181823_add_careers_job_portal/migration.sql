-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CareerApplicationStatus" AS ENUM ('PENDING', 'REVIEWING', 'SHORTLISTED', 'REJECTED', 'HIRED');

-- DropForeignKey
ALTER TABLE "Department" DROP CONSTRAINT "Department_branchId_fkey";

-- DropForeignKey
ALTER TABLE "Employee" DROP CONSTRAINT "Employee_currentDepartmentId_fkey";

-- DropForeignKey
ALTER TABLE "Shift" DROP CONSTRAINT "Shift_branchId_fkey";

-- DropIndex
DROP INDEX "LeaveApproval_leaveId_idx";

-- DropIndex
DROP INDEX "Shift_branchId_name_key";

-- AlterTable
ALTER TABLE "BranchChangeRequest" RENAME CONSTRAINT "OutstationRequest_pkey" TO "BranchChangeRequest_pkey";

-- AlterTable
ALTER TABLE "LetterTemplate" ALTER COLUMN "requiredVars" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StipendRecord" RENAME CONSTRAINT "SalaryRecord_pkey" TO "StipendRecord_pkey";

-- CreateTable
CREATE TABLE "JobPosting" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT,
    "location" TEXT,
    "description" TEXT,
    "requirements" TEXT,
    "deadline" TIMESTAMP(3),
    "status" "JobStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Applicant" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Applicant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerApplication" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "status" "CareerApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "fatherName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "cnic" TEXT,
    "address" TEXT,
    "city" TEXT,
    "academicRecords" JSONB,
    "experiences" JSONB,
    "coverLetter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Applicant_email_key" ON "Applicant"("email");

-- CreateIndex
CREATE INDEX "CareerApplication_jobId_idx" ON "CareerApplication"("jobId");

-- CreateIndex
CREATE INDEX "CareerApplication_applicantId_idx" ON "CareerApplication"("applicantId");

-- CreateIndex
CREATE INDEX "CareerApplication_status_idx" ON "CareerApplication"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CareerApplication_jobId_applicantId_key" ON "CareerApplication"("jobId", "applicantId");

-- RenameForeignKey
ALTER TABLE "BranchChangeRequest" RENAME CONSTRAINT "OutstationRequest_employeeId_fkey" TO "BranchChangeRequest_employeeId_fkey";

-- RenameForeignKey
ALTER TABLE "PayrollEntry" RENAME CONSTRAINT "PayrollEntry_salaryRecordId_fkey" TO "PayrollEntry_stipendRecordId_fkey";

-- RenameForeignKey
ALTER TABLE "StipendRecord" RENAME CONSTRAINT "SalaryRecord_employeeId_fkey" TO "StipendRecord_employeeId_fkey";

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_currentDepartmentId_fkey" FOREIGN KEY ("currentDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerApplication" ADD CONSTRAINT "CareerApplication_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerApplication" ADD CONSTRAINT "CareerApplication_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "UserManagerScope_userId_projectId_departmentId_designationId_id" RENAME TO "UserManagerScope_userId_projectId_departmentId_designationI_idx";
