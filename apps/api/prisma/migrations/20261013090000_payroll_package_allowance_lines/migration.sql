-- Phase 4: per-type package allowance amounts on each payroll entry (itemised reports).
ALTER TABLE "PayrollEntry" ADD COLUMN IF NOT EXISTS "packageAllowanceLines" JSONB;
