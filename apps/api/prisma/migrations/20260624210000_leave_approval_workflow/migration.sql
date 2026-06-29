-- CreateEnum
CREATE TYPE "LeaveApprovalStage" AS ENUM ('BRANCH_MANAGER', 'DEPARTMENT_INCHARGE', 'HR_OPERATIONS');
CREATE TYPE "LeaveApprovalAction" AS ENUM ('APPROVED', 'REJECTED');

-- AlterEnum LeaveType
ALTER TYPE "LeaveType" ADD VALUE 'EMERGENCY';

-- AlterEnum LeaveStatus
ALTER TYPE "LeaveStatus" ADD VALUE 'BRANCH_APPROVED';
ALTER TYPE "LeaveStatus" ADD VALUE 'DEPT_APPROVED';
ALTER TYPE "LeaveStatus" ADD VALUE 'HR_PENDING';
ALTER TYPE "LeaveStatus" ADD VALUE 'CANCELLED';

-- AlterTable LeaveRecord
ALTER TABLE "LeaveRecord" ADD COLUMN "currentStage" "LeaveApprovalStage" DEFAULT 'BRANCH_MANAGER';
ALTER TABLE "LeaveRecord" ADD COLUMN "branchManagerId" TEXT;
ALTER TABLE "LeaveRecord" ADD COLUMN "deptInchargeId" TEXT;

-- CreateTable
CREATE TABLE "LeaveApproval" (
    "id" TEXT NOT NULL,
    "leaveId" TEXT NOT NULL,
    "stage" "LeaveApprovalStage" NOT NULL,
    "action" "LeaveApprovalAction" NOT NULL,
    "actionBy" TEXT NOT NULL,
    "actionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveApproval_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "LeaveApproval" ADD CONSTRAINT "LeaveApproval_leaveId_fkey" FOREIGN KEY ("leaveId") REFERENCES "LeaveRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaveApproval" ADD CONSTRAINT "LeaveApproval_actionBy_fkey" FOREIGN KEY ("actionBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "LeaveApproval_leaveId_idx" ON "LeaveApproval"("leaveId");
