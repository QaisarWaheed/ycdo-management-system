-- CreateTable
CREATE TABLE "UserPassword" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plainText" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPassword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchLocation" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radius" INTEGER NOT NULL DEFAULT 200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BranchLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalAttendance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPassword_userId_key" ON "UserPassword"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchLocation_branchId_key" ON "BranchLocation"("branchId");

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'IT_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DEPARTMENT_HEAD';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PAYROLL_OFFICER';

-- AddForeignKey
ALTER TABLE "UserPassword" ADD CONSTRAINT "UserPassword_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchLocation" ADD CONSTRAINT "BranchLocation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAttendance" ADD CONSTRAINT "PortalAttendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
