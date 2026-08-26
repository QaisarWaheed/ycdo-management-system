-- AlterEnum
ALTER TYPE "InquiryOutcome" ADD VALUE 'REST';

-- CreateEnum
CREATE TYPE "InquiryFinalDecisionStatus" AS ENUM ('PENDING_APPROVAL', 'REJECTED', 'APPLIED');

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN "findingRecordedById" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "findingRecordedAt" TIMESTAMP(3);
ALTER TABLE "Inquiry" ADD COLUMN "finalDecisionStatus" "InquiryFinalDecisionStatus";
ALTER TABLE "Inquiry" ADD COLUMN "selectedFinalApproverUserId" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "finalDecisionSubmittedById" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "finalDecisionSubmittedAt" TIMESTAMP(3);
ALTER TABLE "Inquiry" ADD COLUMN "finalDecidedById" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "finalDecidedAt" TIMESTAMP(3);
ALTER TABLE "Inquiry" ADD COLUMN "finalDecisionNote" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "destinationBranchId" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "fineAmount" DECIMAL(10,2);
ALTER TABLE "Inquiry" ADD COLUMN "appliedFineDeductionId" TEXT;

-- CreateIndex
CREATE INDEX "Inquiry_selectedFinalApproverUserId_finalDecisionStatus_idx" ON "Inquiry"("selectedFinalApproverUserId", "finalDecisionStatus");

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_findingRecordedById_fkey" FOREIGN KEY ("findingRecordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_selectedFinalApproverUserId_fkey" FOREIGN KEY ("selectedFinalApproverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_finalDecisionSubmittedById_fkey" FOREIGN KEY ("finalDecisionSubmittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_finalDecidedById_fkey" FOREIGN KEY ("finalDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_destinationBranchId_fkey" FOREIGN KEY ("destinationBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
