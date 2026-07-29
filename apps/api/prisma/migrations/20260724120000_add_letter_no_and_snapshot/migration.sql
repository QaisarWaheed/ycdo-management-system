-- Additive letter snapshot fields + template table + letter number sequence

CREATE TABLE IF NOT EXISTS "LetterTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "requiredVars" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LetterTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LetterTemplate_code_key" ON "LetterTemplate"("code");

ALTER TABLE "Letter" ADD COLUMN IF NOT EXISTS "letterNo" TEXT;
ALTER TABLE "Letter" ADD COLUMN IF NOT EXISTS "variables" JSONB;
ALTER TABLE "Letter" ADD COLUMN IF NOT EXISTS "templateVersion" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "Letter_letterNo_key" ON "Letter"("letterNo");

CREATE SEQUENCE IF NOT EXISTS letter_no_seq START 2456;
