-- AlterEnum
ALTER TYPE "EmployeeStatus" ADD VALUE 'APPOINTED' AFTER 'ACTIVE';

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('REGULAR', 'SHORT_LEAVE');

-- CreateEnum
CREATE TYPE "QualType" AS ENUM ('ACADEMIC', 'JOB_RELEVANT');

-- CreateEnum
CREATE TYPE "OutstationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "UserRole_new" AS ENUM ('SUPER_ADMIN', 'FOUNDER', 'CHAIRMAN', 'HR_OPERATIONS_MANAGER', 'HR_ADMIN_MANAGER', 'ADMIN_OFFICER', 'HR_MANAGER', 'BRANCH_MANAGER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "BroadcastTarget_new" AS ENUM ('ALL', 'SUPER_ADMIN', 'FOUNDER', 'CHAIRMAN', 'HR_OPERATIONS_MANAGER', 'HR_ADMIN_MANAGER', 'ADMIN_OFFICER', 'HR_MANAGER', 'BRANCH_MANAGER', 'EMPLOYEE');

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new" USING (
  CASE "role"::text
    WHEN 'BRANCH_HR' THEN 'BRANCH_MANAGER'
    WHEN 'DEPARTMENT_HEAD' THEN 'ADMIN_OFFICER'
    WHEN 'PAYROLL_OFFICER' THEN 'HR_OPERATIONS_MANAGER'
    ELSE "role"::text
  END::"UserRole_new"
);
DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";

-- AlterTable
ALTER TABLE "NotificationBroadcast" ALTER COLUMN "targetRole" TYPE "BroadcastTarget_new" USING (
  CASE "targetRole"::text
    WHEN 'BRANCH_HR' THEN 'BRANCH_MANAGER'
    WHEN 'DEPARTMENT_HEAD' THEN 'ADMIN_OFFICER'
    WHEN 'PAYROLL_OFFICER' THEN 'HR_OPERATIONS_MANAGER'
    ELSE "targetRole"::text
  END::"BroadcastTarget_new"
);
DROP TYPE "BroadcastTarget";
ALTER TYPE "BroadcastTarget_new" RENAME TO "BroadcastTarget";

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "fatherContactNumber" TEXT,
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactNumber" TEXT,
ADD COLUMN     "spouseName" TEXT,
ADD COLUMN     "spouseContactNumber" TEXT,
ADD COLUMN     "caste" TEXT,
ADD COLUMN     "domicile" TEXT,
ADD COLUMN     "currentAddress" TEXT,
ADD COLUMN     "permanentAddress" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "tehsil" TEXT,
ADD COLUMN     "policeStation" TEXT,
ADD COLUMN     "bloodGroup" TEXT;

-- AlterTable
ALTER TABLE "Letter" ADD COLUMN     "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LeaveRecord" ADD COLUMN     "leaveType" "LeaveType" NOT NULL DEFAULT 'REGULAR';

-- CreateTable
CREATE TABLE "AcademicQualification" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "qualType" "QualType" NOT NULL DEFAULT 'ACADEMIC',
    "degree" TEXT NOT NULL,
    "boardUniversity" TEXT NOT NULL,
    "obtainedMarks" TEXT,
    "divisionGrade" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreviousEmployment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "ownerAdminName" TEXT,
    "contactNumber" TEXT,
    "postalAddress" TEXT,
    "totalExperience" TEXT,
    "relevantExperience" TEXT,
    "jobResponsibilities" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreviousEmployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutstationRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL,
    "status" "OutstationStatus" NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutstationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllegationAcknowledgement" (
    "id" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllegationAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AllegationAcknowledgement_letterId_key" ON "AllegationAcknowledgement"("letterId");

-- AddForeignKey
ALTER TABLE "AcademicQualification" ADD CONSTRAINT "AcademicQualification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreviousEmployment" ADD CONSTRAINT "PreviousEmployment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutstationRequest" ADD CONSTRAINT "OutstationRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllegationAcknowledgement" ADD CONSTRAINT "AllegationAcknowledgement_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "Letter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllegationAcknowledgement" ADD CONSTRAINT "AllegationAcknowledgement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
