-- CreateEnum
CREATE TYPE "LetterStatus" AS ENUM ('DRAFT', 'SENT', 'REVERSED');

-- AlterTable
ALTER TABLE "Letter" ADD COLUMN "status" "LetterStatus" NOT NULL DEFAULT 'SENT';
ALTER TABLE "Letter" ADD COLUMN "reversedAt" TIMESTAMP(3);
ALTER TABLE "Letter" ADD COLUMN "reversedById" TEXT;
ALTER TABLE "Letter" ADD COLUMN "reversalReason" TEXT;

-- Backfill soft-reversed letters from variables JSON
UPDATE "Letter"
SET "status" = 'REVERSED',
    "reversedAt" = COALESCE("reversedAt", NOW()),
    "reversalReason" = COALESCE(
      "reversalReason",
      'Backfilled from soft-reverse variables'
    )
WHERE "status" = 'SENT'
  AND (
    ("variables"::jsonb ? 'reversed' AND ("variables"::jsonb->>'reversed') IN ('true', 'True', '1'))
    OR ("variables"::jsonb ? 'reversedDueToShortLeave')
    OR ("variables"::jsonb ? 'reversalTrigger')
  );

-- ForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "Letter_status_idx" ON "Letter"("status");
CREATE INDEX "Letter_employeeId_status_idx" ON "Letter"("employeeId", "status");
