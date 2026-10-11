-- Doctors' monthly performance (patients, surgeries, lab tests, collection) entered by Finance.
-- CreateTable
CREATE TABLE "DoctorMonthlyPerformance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "opdPatients" INTEGER NOT NULL DEFAULT 0,
    "indoorPatients" INTEGER NOT NULL DEFAULT 0,
    "surgeries" INTEGER NOT NULL DEFAULT 0,
    "labTests" INTEGER NOT NULL DEFAULT 0,
    "collection" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorMonthlyPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DoctorMonthlyPerformance_year_month_idx" ON "DoctorMonthlyPerformance"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorMonthlyPerformance_employeeId_year_month_key" ON "DoctorMonthlyPerformance"("employeeId", "year", "month");

-- AddForeignKey
ALTER TABLE "DoctorMonthlyPerformance" ADD CONSTRAINT "DoctorMonthlyPerformance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
