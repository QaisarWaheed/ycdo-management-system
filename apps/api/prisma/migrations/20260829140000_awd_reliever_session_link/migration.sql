-- Link AdditionalWorkingDay rows to RelieverSession for profile visibility (Option A:
-- AWD tab shows reliever duty; payroll still uses RELIEVER allowance for those sessions).

ALTER TABLE "AdditionalWorkingDay" ADD COLUMN "relieverSessionId" TEXT;

CREATE UNIQUE INDEX "AdditionalWorkingDay_relieverSessionId_key"
  ON "AdditionalWorkingDay"("relieverSessionId");

ALTER TABLE "AdditionalWorkingDay"
  ADD CONSTRAINT "AdditionalWorkingDay_relieverSessionId_fkey"
  FOREIGN KEY ("relieverSessionId") REFERENCES "RelieverSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill profile rows for completed reliever sessions (skip dates that already have a manual AWD).
INSERT INTO "AdditionalWorkingDay" (
  "id",
  "employeeId",
  "date",
  "note",
  "addedById",
  "relieverSessionId",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  rs."employeeId",
  rs."date",
  'Reliever duty',
  COALESCE(
    (SELECT u."id" FROM "User" u WHERE u."role" = 'SUPER_ADMIN' ORDER BY u."createdAt" ASC LIMIT 1),
    (SELECT u."id" FROM "User" u ORDER BY u."createdAt" ASC LIMIT 1)
  ),
  rs."id",
  NOW(),
  NOW()
FROM "RelieverSession" rs
WHERE rs."checkOut" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "AdditionalWorkingDay" awd
    WHERE awd."employeeId" = rs."employeeId"
      AND awd."date" = rs."date"
  );
