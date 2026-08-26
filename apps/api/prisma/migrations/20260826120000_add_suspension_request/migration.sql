-- CreateEnum
CREATE TYPE "InquiryFinding" AS ENUM ('GUILTY', 'NOT_GUILTY');

-- CreateEnum
CREATE TYPE "InquiryFinalAction" AS ENUM ('DISMISS', 'TERMINATE', 'REST', 'FINE_AND_REINSTATE');

-- CreateEnum
CREATE TYPE "SuspensionRequestStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ISSUED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN "inquiryOfficerUserId" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "finding" "InquiryFinding";
ALTER TABLE "Inquiry" ADD COLUMN "finalAction" "InquiryFinalAction";

-- CreateTable
CREATE TABLE "SuspensionRequest" (
    "id" TEXT NOT NULL,
    "disciplinaryActionId" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "SuspensionRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "inquiryOfficerUserId" TEXT NOT NULL,
    "inquiryDeadlineAt" TIMESTAMP(3) NOT NULL,
    "selectedApproverUserId" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "issuedAt" TIMESTAMP(3),
    "suspendedFromBranchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuspensionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuspensionRequest_disciplinaryActionId_key" ON "SuspensionRequest"("disciplinaryActionId");

-- CreateIndex
CREATE UNIQUE INDEX "SuspensionRequest_letterId_key" ON "SuspensionRequest"("letterId");

-- CreateIndex
CREATE INDEX "Inquiry_inquiryOfficerUserId_idx" ON "Inquiry"("inquiryOfficerUserId");

-- CreateIndex
CREATE INDEX "SuspensionRequest_status_idx" ON "SuspensionRequest"("status");

-- CreateIndex
CREATE INDEX "SuspensionRequest_employeeId_idx" ON "SuspensionRequest"("employeeId");

-- CreateIndex
CREATE INDEX "SuspensionRequest_selectedApproverUserId_status_idx" ON "SuspensionRequest"("selectedApproverUserId", "status");

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_inquiryOfficerUserId_fkey" FOREIGN KEY ("inquiryOfficerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspensionRequest" ADD CONSTRAINT "SuspensionRequest_disciplinaryActionId_fkey" FOREIGN KEY ("disciplinaryActionId") REFERENCES "DisciplinaryAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspensionRequest" ADD CONSTRAINT "SuspensionRequest_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "Letter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspensionRequest" ADD CONSTRAINT "SuspensionRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspensionRequest" ADD CONSTRAINT "SuspensionRequest_inquiryOfficerUserId_fkey" FOREIGN KEY ("inquiryOfficerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspensionRequest" ADD CONSTRAINT "SuspensionRequest_selectedApproverUserId_fkey" FOREIGN KEY ("selectedApproverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspensionRequest" ADD CONSTRAINT "SuspensionRequest_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspensionRequest" ADD CONSTRAINT "SuspensionRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspensionRequest" ADD CONSTRAINT "SuspensionRequest_suspendedFromBranchId_fkey" FOREIGN KEY ("suspendedFromBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
