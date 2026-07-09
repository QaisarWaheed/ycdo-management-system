-- Make shifts universal (not branch-specific)

ALTER TABLE "Shift" ALTER COLUMN "branchId" DROP NOT NULL;

ALTER TABLE "Shift" DROP CONSTRAINT IF EXISTS "Shift_branchId_name_key";

WITH canonical AS (
  SELECT DISTINCT ON (name, "startTime", "endTime") id
  FROM "Shift"
  ORDER BY name, "startTime", "endTime", "createdAt" ASC
),
dupes AS (
  SELECT s.id AS old_id, c.id AS new_id
  FROM "Shift" s
  INNER JOIN canonical c
    ON s.name = (
      SELECT name FROM "Shift" WHERE id = c.id
    )
    AND s."startTime" = (
      SELECT "startTime" FROM "Shift" WHERE id = c.id
    )
    AND s."endTime" = (
      SELECT "endTime" FROM "Shift" WHERE id = c.id
    )
  WHERE s.id <> c.id
)
UPDATE "Employee" e
SET "shiftId" = d.new_id
FROM dupes d
WHERE e."shiftId" = d.old_id;

DELETE FROM "Shift" s
WHERE s.id NOT IN (
  SELECT DISTINCT ON (name, "startTime", "endTime") id
  FROM "Shift"
  ORDER BY name, "startTime", "endTime", "createdAt" ASC
);

UPDATE "Shift" SET "branchId" = NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Shift_name_startTime_endTime_key"
  ON "Shift"("name", "startTime", "endTime");
