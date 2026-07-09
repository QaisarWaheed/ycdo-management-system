-- CreateEnum
CREATE TYPE "Permission" AS ENUM (
  'ATTENDANCE_MARK',
  'ATTENDANCE_EDIT',
  'LEAVE_APPROVE',
  'LEAVE_APPLY_OTHERS',
  'PAYROLL_MANAGE',
  'EMPLOYEES_CREATE',
  'EMPLOYEES_EDIT',
  'DISCIPLINARY_MANAGE',
  'LETTERS_GENERATE',
  'INCENTIVES_MANAGE',
  'RECRUITMENT_MANAGE',
  'REPORTS_VIEW',
  'BROADCASTS_SEND',
  'ORG_SETUP'
);

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,
    "granted" BOOLEAN NOT NULL,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_userId_permission_key" ON "UserPermission"("userId", "permission");

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
