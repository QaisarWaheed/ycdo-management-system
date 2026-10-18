-- Phase 3 Req 16 / 17: transfer and working-hours change through a letter and approval.
CREATE TYPE "EmployeeChangeKind" AS ENUM ('TRANSFER', 'WORKING_HOURS');
CREATE TYPE "EmployeeChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TABLE "EmployeeChangeRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "EmployeeChangeKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "EmployeeChangeStatus" NOT NULL DEFAULT 'PENDING',
    "letterId" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    CONSTRAINT "EmployeeChangeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeChangeRequest_status_kind_idx" ON "EmployeeChangeRequest"("status", "kind");
CREATE INDEX "EmployeeChangeRequest_employeeId_idx" ON "EmployeeChangeRequest"("employeeId");
ALTER TABLE "EmployeeChangeRequest" ADD CONSTRAINT "EmployeeChangeRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
