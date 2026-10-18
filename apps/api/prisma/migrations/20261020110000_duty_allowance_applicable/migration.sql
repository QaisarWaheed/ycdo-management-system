-- Phase 2 Req 5: HR marks whether an additional role carries an allowance.
ALTER TABLE "EmployeeAdditionalDuty" ADD COLUMN "allowanceApplicable" BOOLEAN NOT NULL DEFAULT true;
