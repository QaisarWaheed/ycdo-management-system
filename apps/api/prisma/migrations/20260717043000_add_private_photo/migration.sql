-- AlterTable
ALTER TABLE "Employee"
ADD COLUMN "privatePhotoUrl" TEXT,
ADD COLUMN "hideProfilePhoto" BOOLEAN NOT NULL DEFAULT false;
