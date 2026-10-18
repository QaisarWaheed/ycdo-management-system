-- Phase 2 Req 2: special leaves (HR Operations → Chairman), pay % per type.
ALTER TYPE "LeaveType" ADD VALUE IF NOT EXISTS 'SPECIAL';
ALTER TYPE "LeaveStatus" ADD VALUE IF NOT EXISTS 'CHAIRMAN_PENDING';
ALTER TYPE "LeaveApprovalStage" ADD VALUE IF NOT EXISTS 'CHAIRMAN';

CREATE TABLE "SpecialLeaveType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payPercent" INTEGER NOT NULL DEFAULT 50,
    "maxDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpecialLeaveType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SpecialLeaveType_name_key" ON "SpecialLeaveType"("name");

ALTER TABLE "LeaveRecord" ADD COLUMN "specialLeaveTypeId" TEXT,
ADD COLUMN "requestedById" TEXT;
ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_specialLeaveTypeId_fkey" FOREIGN KEY ("specialLeaveTypeId") REFERENCES "SpecialLeaveType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
