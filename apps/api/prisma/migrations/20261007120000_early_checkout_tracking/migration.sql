-- Early check-out is tracked separately from lateness.
ALTER TABLE "AttendanceLog" ADD COLUMN IF NOT EXISTS "earlyOutMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterEnum
ALTER TYPE "DisciplineCategory" ADD VALUE IF NOT EXISTS 'EARLY_CHECKOUT';
