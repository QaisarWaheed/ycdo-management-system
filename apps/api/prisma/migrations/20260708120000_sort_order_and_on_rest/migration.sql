-- Branch, Department, Designation sort order
ALTER TABLE "Branch" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 999;
ALTER TABLE "Department" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 999;
ALTER TABLE "Designation" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 999;

-- Employee ON_REST status
ALTER TYPE "EmployeeStatus" ADD VALUE 'ON_REST';
