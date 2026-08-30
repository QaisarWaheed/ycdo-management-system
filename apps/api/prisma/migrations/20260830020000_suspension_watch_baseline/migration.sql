-- Additive: next Near/Due cycle starts on this Pakistan date after inquiry reinstatement.
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "suspensionWatchBaselineOn" TIMESTAMP(3);
