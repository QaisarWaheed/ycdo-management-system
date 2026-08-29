-- Link AdditionalWorkingDay rows to RelieverSession for profile visibility (Option A:
-- AWD tab shows reliever duty; payroll still uses RELIEVER allowance for those sessions).

ALTER TABLE "AdditionalWorkingDay" ADD COLUMN IF NOT EXISTS "relieverSessionId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "AdditionalWorkingDay_relieverSessionId_key"
  ON "AdditionalWorkingDay"("relieverSessionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AdditionalWorkingDay_relieverSessionId_fkey'
  ) THEN
    ALTER TABLE "AdditionalWorkingDay"
      ADD CONSTRAINT "AdditionalWorkingDay_relieverSessionId_fkey"
      FOREIGN KEY ("relieverSessionId") REFERENCES "RelieverSession"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: at most one AWD row per employee+date (pick earliest completed session that day).
-- Skipped when no User exists (addedById is NOT NULL).
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
  picked."employeeId",
  picked."date",
  'Reliever duty',
  picked."addedById",
  picked."sessionId",
  NOW(),
  NOW()
FROM (
  SELECT DISTINCT ON (rs."employeeId", rs."date")
    rs."id" AS "sessionId",
    rs."employeeId",
    rs."date",
    COALESCE(
      (SELECT u."id" FROM "User" u WHERE u."role" = 'SUPER_ADMIN' ORDER BY u."createdAt" ASC LIMIT 1),
      (SELECT u."id" FROM "User" u ORDER BY u."createdAt" ASC LIMIT 1)
    ) AS "addedById"
  FROM "RelieverSession" rs
  WHERE rs."checkOut" IS NOT NULL
  ORDER BY rs."employeeId", rs."date", rs."checkIn" ASC
) AS picked
WHERE picked."addedById" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "AdditionalWorkingDay" awd
    WHERE awd."employeeId" = picked."employeeId"
      AND awd."date" = picked."date"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "AdditionalWorkingDay" awd
    WHERE awd."relieverSessionId" = picked."sessionId"
  );
