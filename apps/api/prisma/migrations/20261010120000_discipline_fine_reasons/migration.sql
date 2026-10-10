-- Discipline fine reasons for manual FINE deductions (payslip / report grouping).
DO $$ BEGIN
  CREATE TYPE "FineReason" AS ENUM ('MOBILE_ON_DUTY', 'NO_UNIFORM', 'LEFT_DUTY_POST', 'RULE_VIOLATION', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "PayrollDeduction" ADD COLUMN IF NOT EXISTS "fineReason" "FineReason";
