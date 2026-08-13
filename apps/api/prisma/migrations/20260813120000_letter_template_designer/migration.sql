-- AlterEnum
ALTER TYPE "LetterType" ADD VALUE 'CUSTOM';

-- AlterTable
ALTER TABLE "LetterTemplate" ADD COLUMN "bodyHtmlEn" TEXT;
ALTER TABLE "LetterTemplate" ADD COLUMN "subjectUr" TEXT;
ALTER TABLE "LetterTemplate" ADD COLUMN "subjectEn" TEXT;
ALTER TABLE "LetterTemplate" ADD COLUMN "enTitle" TEXT;
ALTER TABLE "LetterTemplate" ADD COLUMN "enPrescribed" TEXT;
ALTER TABLE "LetterTemplate" ADD COLUMN "enSubtitle" TEXT;
ALTER TABLE "LetterTemplate" ADD COLUMN "letterCode" TEXT;
ALTER TABLE "LetterTemplate" ADD COLUMN "fieldsSchema" JSONB;
ALTER TABLE "LetterTemplate" ADD COLUMN "primaryLanguage" TEXT NOT NULL DEFAULT 'ur';
ALTER TABLE "LetterTemplate" ADD COLUMN "isCustom" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Letter" ADD COLUMN "templateCode" TEXT;

-- DataMigration: existing English-language letter types keep rendering as English
UPDATE "LetterTemplate" SET "primaryLanguage" = 'en' WHERE "code" IN ('TRANSFER', 'SALARY_INCREMENT');

