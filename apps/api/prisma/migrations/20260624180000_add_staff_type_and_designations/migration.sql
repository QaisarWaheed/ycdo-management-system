-- CreateEnum
CREATE TYPE "StaffType" AS ENUM ('NEW', 'EXISTING', 'INTERNEE');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "staffType" "StaffType" NOT NULL DEFAULT 'NEW';

-- CreateTable
CREATE TABLE "Designation" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Designation_title_key" ON "Designation"("title");
