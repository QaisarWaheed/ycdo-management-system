-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('MARRIED', 'UNMARRIED', 'DIVORCED', 'WIDOW');

-- AlterTable
ALTER TABLE "Employee" ALTER COLUMN "cnic" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "maritalStatus" "MaritalStatus";
