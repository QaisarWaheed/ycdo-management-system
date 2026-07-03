-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('MARRIED', 'UNMARRIED', 'DIVORCED', 'WIDOW');

-- CreateEnum
CREATE TYPE "FatherStatus" AS ENUM ('ALIVE', 'DECEASED');

-- AlterTable
ALTER TABLE "Employee" ALTER COLUMN "cnic" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "maritalStatus" "MaritalStatus",
ADD COLUMN     "fatherStatus" "FatherStatus",
ADD COLUMN     "guardianContact" TEXT,
ADD COLUMN     "emergencyRelation" TEXT,
ADD COLUMN     "photoUrl" TEXT;
