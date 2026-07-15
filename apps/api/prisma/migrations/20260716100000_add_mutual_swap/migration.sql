-- AlterEnum
ALTER TYPE "AttendanceStatus" ADD VALUE 'SWAP_COVERED';

-- CreateTable
CREATE TABLE "MutualSwap" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "coveringEmployeeId" TEXT NOT NULL,
    "coveredEmployeeId" TEXT NOT NULL,
    "coveredShiftId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MutualSwap_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MutualSwap" ADD CONSTRAINT "MutualSwap_coveringEmployeeId_fkey" FOREIGN KEY ("coveringEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MutualSwap" ADD CONSTRAINT "MutualSwap_coveredEmployeeId_fkey" FOREIGN KEY ("coveredEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MutualSwap" ADD CONSTRAINT "MutualSwap_coveredShiftId_fkey" FOREIGN KEY ("coveredShiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MutualSwap" ADD CONSTRAINT "MutualSwap_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MutualSwap" ADD CONSTRAINT "MutualSwap_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
