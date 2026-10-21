-- Team In-charge: IT gives a login department + designation pairs; it rates those employees monthly.
ALTER TYPE "UserRole" ADD VALUE 'TEAM_INCHARGE';

CREATE TABLE "TeamAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeamAssignment_departmentId_designation_key" ON "TeamAssignment"("departmentId", "designation");
CREATE INDEX "TeamAssignment_userId_idx" ON "TeamAssignment"("userId");
ALTER TABLE "TeamAssignment" ADD CONSTRAINT "TeamAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamAssignment" ADD CONSTRAINT "TeamAssignment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TeamProgress" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "remarks" TEXT,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TeamProgress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeamProgress_employeeId_month_year_key" ON "TeamProgress"("employeeId", "month", "year");
ALTER TABLE "TeamProgress" ADD CONSTRAINT "TeamProgress_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
