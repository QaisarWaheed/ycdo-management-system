-- Phase 2 Req 4: exact start / end day with calendar-day pro-rata.
ALTER TABLE "EmployeeAllowance" ADD COLUMN "startDay" INTEGER, ADD COLUMN "endDay" INTEGER;
ALTER TABLE "IncentivePlan" ADD COLUMN "startDay" INTEGER, ADD COLUMN "endDay" INTEGER;
