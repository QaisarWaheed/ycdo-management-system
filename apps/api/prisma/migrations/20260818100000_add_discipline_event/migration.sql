-- CreateEnum
CREATE TYPE "DisciplineCategory" AS ENUM ('LATE', 'UNINFORMED_ABSENT', 'MISSING_CHECKOUT');

-- CreateTable
CREATE TABLE "DisciplineEvent" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "category" "DisciplineCategory" NOT NULL,
    "incidentDate" DATE NOT NULL,
    "occurrence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisciplineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DisciplineEvent_employeeId_category_incidentDate_key" ON "DisciplineEvent"("employeeId", "category", "incidentDate");

-- AddForeignKey
ALTER TABLE "DisciplineEvent" ADD CONSTRAINT "DisciplineEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
