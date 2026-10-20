-- Staff loans with Founder approval and monthly payroll installments.
CREATE TYPE "LoanStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "EmployeeLoan" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "monthlyInstallment" DECIMAL(10,2) NOT NULL,
    "startMonth" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "notificationUrl" TEXT,
    "notificationFileName" TEXT,
    "notificationMimeType" TEXT,
    "notificationUploadedAt" TIMESTAMP(3),
    CONSTRAINT "EmployeeLoan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeLoan_employeeId_status_idx" ON "EmployeeLoan"("employeeId", "status");

ALTER TABLE "EmployeeLoan" ADD CONSTRAINT "EmployeeLoan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
