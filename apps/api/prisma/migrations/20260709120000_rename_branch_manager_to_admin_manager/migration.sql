-- Rename UserRole enum value
ALTER TYPE "UserRole" RENAME VALUE 'BRANCH_MANAGER' TO 'ADMIN_MANAGER';

-- Rename BroadcastTarget enum value
ALTER TYPE "BroadcastTarget" RENAME VALUE 'BRANCH_MANAGER' TO 'ADMIN_MANAGER';

-- Add branchId to User for branch-scoped admin managers
ALTER TABLE "User" ADD COLUMN "branchId" TEXT;

ALTER TABLE "User"
  ADD CONSTRAINT "User_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill branchId for admin managers linked to employees
UPDATE "User" u
SET "branchId" = e."currentBranchId"
FROM "Employee" e
WHERE u."employeeId" = e.id
  AND u.role = 'ADMIN_MANAGER'
  AND u."branchId" IS NULL;
