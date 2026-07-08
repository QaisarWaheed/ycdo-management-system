-- AlterTable
ALTER TABLE "Employee" ALTER COLUMN "currentDepartmentId" DROP NOT NULL;
ALTER TABLE "Employee" ALTER COLUMN "currentDesignation" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Designation" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
