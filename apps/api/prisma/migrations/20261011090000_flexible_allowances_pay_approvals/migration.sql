-- Phase 2: flexible allowances, incentive types, executive approval for pay increases.
-- Old StipendRecord columns stay untouched (months before Nov 2026 keep using them).

-- CreateEnum
CREATE TYPE "AllowanceProration" AS ENUM ('FULL_MONTH', 'ATTENDANCE');

-- CreateEnum
CREATE TYPE "PayChangeKind" AS ENUM ('SALARY_INCREMENT', 'PACKAGE_EDIT', 'ALLOWANCE', 'INCENTIVE', 'PAYROLL_ADDITION');

-- CreateEnum
CREATE TYPE "PayChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Incentive" ADD COLUMN     "typeId" TEXT;

-- CreateTable
CREATE TABLE "IncentiveType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncentiveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayAllowanceType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "proration" "AllowanceProration" NOT NULL DEFAULT 'FULL_MONTH',
    "legacyField" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayAllowanceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAllowance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "startMonth" DATE NOT NULL,
    "endMonth" DATE,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAllowance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayChangeRequest" (
    "id" TEXT NOT NULL,
    "kind" "PayChangeKind" NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "reason" TEXT,
    "approverTarget" "EmployeeApproverTarget" NOT NULL,
    "status" "PayChangeStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncentiveType_name_key" ON "IncentiveType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PayAllowanceType_name_key" ON "PayAllowanceType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PayAllowanceType_legacyField_key" ON "PayAllowanceType"("legacyField");

-- CreateIndex
CREATE INDEX "EmployeeAllowance_employeeId_startMonth_idx" ON "EmployeeAllowance"("employeeId", "startMonth");

-- CreateIndex
CREATE INDEX "PayChangeRequest_status_approverTarget_idx" ON "PayChangeRequest"("status", "approverTarget");

-- CreateIndex
CREATE INDEX "PayChangeRequest_employeeId_status_idx" ON "PayChangeRequest"("employeeId", "status");

-- AddForeignKey
ALTER TABLE "Incentive" ADD CONSTRAINT "Incentive_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "IncentiveType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAllowance" ADD CONSTRAINT "EmployeeAllowance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAllowance" ADD CONSTRAINT "EmployeeAllowance_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "PayAllowanceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayChangeRequest" ADD CONSTRAINT "PayChangeRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayChangeRequest" ADD CONSTRAINT "PayChangeRequest_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayChangeRequest" ADD CONSTRAINT "PayChangeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Seed: the four old package fields become allowance types (same labels as the payslip).
INSERT INTO "PayAllowanceType" ("id", "name", "proration", "legacyField", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid()::text, 'Travelling Exp',     'FULL_MONTH', 'allowances',     10, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Reward',             'FULL_MONTH', 'reward',         20, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Reward On Progress', 'FULL_MONTH', 'progressReward', 30, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Petrol',             'FULL_MONTH', 'fuelAllowance',  40, CURRENT_TIMESTAMP);

-- Seed: types named in the 10 Oct 2026 meeting.
INSERT INTO "PayAllowanceType" ("id", "name", "proration", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid()::text, 'Pharmacy',          'FULL_MONTH', 50, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Audit',             'FULL_MONTH', 60, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Admin',             'FULL_MONTH', 70, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Incharge',          'FULL_MONTH', 80, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Night Monitoring',  'ATTENDANCE', 90, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Salary Difference', 'FULL_MONTH', 95, CURRENT_TIMESTAMP);

INSERT INTO "IncentiveType" ("id", "name") VALUES
  (gen_random_uuid()::text, 'On Progress'),
  (gen_random_uuid()::text, 'Private Room');

-- Copy each employee's current package amounts into the new table, from the
-- cut-over month (PACKAGE_ALLOWANCES_FROM = 2026-11). Same amounts, so no
-- salary changes on the switch-over.
WITH open_pkg AS (
  SELECT DISTINCT ON ("employeeId") "employeeId", "allowances", "reward", "progressReward", "fuelAllowance"
  FROM "StipendRecord"
  WHERE "effectiveTo" IS NULL
  ORDER BY "employeeId", "effectiveFrom" DESC
),
amounts AS (
  SELECT "employeeId", 'allowances' AS field, "allowances" AS amount FROM open_pkg
  UNION ALL SELECT "employeeId", 'reward', "reward" FROM open_pkg
  UNION ALL SELECT "employeeId", 'progressReward', "progressReward" FROM open_pkg
  UNION ALL SELECT "employeeId", 'fuelAllowance', "fuelAllowance" FROM open_pkg
)
INSERT INTO "EmployeeAllowance" ("id", "employeeId", "typeId", "amount", "startMonth", "note", "updatedAt")
SELECT gen_random_uuid()::text, a."employeeId", t."id", a.amount, DATE '2026-11-01',
       'Copied from package on switch-over', CURRENT_TIMESTAMP
FROM amounts a
JOIN "PayAllowanceType" t ON t."legacyField" = a.field
WHERE a.amount IS NOT NULL AND a.amount > 0;
