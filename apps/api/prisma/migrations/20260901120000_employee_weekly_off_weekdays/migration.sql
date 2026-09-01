-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "weeklyOffWeekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
