-- AlterTable
ALTER TABLE "Letter" ADD COLUMN "createdById" TEXT;

-- CreateIndex
CREATE INDEX "Letter_createdById_idx" ON "Letter"("createdById");

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: the login that generated each letter is recorded in the audit log.
UPDATE "Letter" l
SET "createdById" = a."userId"
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "userId"
  FROM "AuditLog"
  WHERE "entity" = 'Letter' AND "action" = 'LETTER_GENERATED'
  ORDER BY "entityId", "createdAt" ASC
) a
WHERE l."id" = a."entityId";
