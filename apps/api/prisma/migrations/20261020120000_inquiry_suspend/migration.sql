-- Phase 2 Req 9: explicit suspension inside an inquiry (executive approval).
CREATE TYPE "InquirySuspendStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');
ALTER TABLE "Inquiry"
  ADD COLUMN "suspendStatus" "InquirySuspendStatus",
  ADD COLUMN "suspendFrom" DATE,
  ADD COLUMN "suspendReason" TEXT,
  ADD COLUMN "suspendRequestedById" TEXT,
  ADD COLUMN "suspendRequestedAt" TIMESTAMP(3),
  ADD COLUMN "suspendApproverUserId" TEXT,
  ADD COLUMN "suspendDecidedById" TEXT,
  ADD COLUMN "suspendDecidedAt" TIMESTAMP(3),
  ADD COLUMN "suspendDecisionNote" TEXT,
  ADD COLUMN "suspendLetterId" TEXT;
