-- AlterEnum
CREATE TYPE "InquiryOpenApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN "durationDays" INTEGER;
ALTER TABLE "Inquiry" ADD COLUMN "closeRecommendation" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "officiallyOpenedAt" TIMESTAMP(3);
ALTER TABLE "Inquiry" ADD COLUMN "openApprovalStatus" "InquiryOpenApprovalStatus";
ALTER TABLE "Inquiry" ADD COLUMN "selectedOpenApproverUserId" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "openSubmittedById" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "openSubmittedAt" TIMESTAMP(3);
ALTER TABLE "Inquiry" ADD COLUMN "openDecidedById" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "openDecidedAt" TIMESTAMP(3);
ALTER TABLE "Inquiry" ADD COLUMN "openDecisionNote" TEXT;

-- Backfill existing inquiries as already opened (do not change employee status).
UPDATE "Inquiry"
SET
  "officiallyOpenedAt" = COALESCE("officiallyOpenedAt", "startedAt"),
  "openApprovalStatus" = COALESCE("openApprovalStatus", 'APPROVED'::"InquiryOpenApprovalStatus")
WHERE "officiallyOpenedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_selectedOpenApproverUserId_fkey" FOREIGN KEY ("selectedOpenApproverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_openSubmittedById_fkey" FOREIGN KEY ("openSubmittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_openDecidedById_fkey" FOREIGN KEY ("openDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Inquiry_selectedOpenApproverUserId_openApprovalStatus_idx" ON "Inquiry"("selectedOpenApproverUserId", "openApprovalStatus");
