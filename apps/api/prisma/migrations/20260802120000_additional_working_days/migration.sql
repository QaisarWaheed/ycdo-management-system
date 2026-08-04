-- CreateTable
CREATE TABLE "AdditionalWorkingDay" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdditionalWorkingDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdditionalWorkingDay_employeeId_date_idx" ON "AdditionalWorkingDay"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdditionalWorkingDay_employeeId_date_key" ON "AdditionalWorkingDay"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "AdditionalWorkingDay" ADD CONSTRAINT "AdditionalWorkingDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdditionalWorkingDay" ADD CONSTRAINT "AdditionalWorkingDay_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
