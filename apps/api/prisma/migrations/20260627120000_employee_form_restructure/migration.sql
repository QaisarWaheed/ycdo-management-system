-- Employee: firstName + lastName -> fullName
ALTER TABLE "Employee" ADD COLUMN "fullName" TEXT;
UPDATE "Employee" SET "fullName" = TRIM(CONCAT("firstName", ' ', "lastName"));
ALTER TABLE "Employee" ALTER COLUMN "fullName" SET NOT NULL;
ALTER TABLE "Employee" DROP COLUMN "firstName";
ALTER TABLE "Employee" DROP COLUMN "lastName";

-- Employee: new personal fields
ALTER TABLE "Employee" ADD COLUMN "fatherStatus" TEXT;
ALTER TABLE "Employee" ADD COLUMN "guardianContact" TEXT;
ALTER TABLE "Employee" ADD COLUMN "emergencyRelation" TEXT;
ALTER TABLE "Employee" ADD COLUMN "photoUrl" TEXT;

-- StipendRecord: payroll fields
ALTER TABLE "StipendRecord" ADD COLUMN "allowances" DECIMAL(10,2);
ALTER TABLE "StipendRecord" ADD COLUMN "reward" DECIMAL(10,2);
ALTER TABLE "StipendRecord" ADD COLUMN "incentiveReward" DECIMAL(10,2);
ALTER TABLE "StipendRecord" ADD COLUMN "fuelAllowance" DECIMAL(10,2);
ALTER TABLE "StipendRecord" ADD COLUMN "loanDeduction" DECIMAL(10,2);
ALTER TABLE "StipendRecord" ADD COLUMN "advanceDeduction" DECIMAL(10,2);
ALTER TABLE "StipendRecord" ADD COLUMN "fineDeduction" DECIMAL(10,2);
ALTER TABLE "StipendRecord" ADD COLUMN "healthDeduction" DECIMAL(10,2);
ALTER TABLE "StipendRecord" ADD COLUMN "lumpsumTotal" DECIMAL(10,2);

-- AcademicQualification: status
ALTER TABLE "AcademicQualification" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'COMPLETED';

-- AdvanceLoanRequest
CREATE TABLE "AdvanceLoanRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,
    "repaymentMonths" INTEGER,
    "monthlyDeduction" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvanceLoanRequest_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AdvanceLoanRequest" ADD CONSTRAINT "AdvanceLoanRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
