-- Make departments universal (not branch-specific), dedupe by name

ALTER TABLE "Department" ALTER COLUMN "branchId" DROP NOT NULL;

WITH canonical AS (
  SELECT DISTINCT ON (UPPER(TRIM(name))) id
  FROM "Department"
  ORDER BY UPPER(TRIM(name)), "createdAt" ASC
),
dupes AS (
  SELECT d.id AS old_id, c.id AS new_id
  FROM "Department" d
  INNER JOIN canonical c
    ON UPPER(TRIM(d.name)) = (
      SELECT UPPER(TRIM(name)) FROM "Department" WHERE id = c.id
    )
  WHERE d.id <> c.id
)
UPDATE "Employee" e
SET "currentDepartmentId" = d.new_id
FROM dupes d
WHERE e."currentDepartmentId" = d.old_id;

WITH canonical AS (
  SELECT DISTINCT ON (UPPER(TRIM(name))) id
  FROM "Department"
  ORDER BY UPPER(TRIM(name)), "createdAt" ASC
),
dupes AS (
  SELECT d.id AS old_id, c.id AS new_id
  FROM "Department" d
  INNER JOIN canonical c
    ON UPPER(TRIM(d.name)) = (
      SELECT UPPER(TRIM(name)) FROM "Department" WHERE id = c.id
    )
  WHERE d.id <> c.id
)
UPDATE "EmploymentHistory" eh
SET "departmentId" = d.new_id
FROM dupes d
WHERE eh."departmentId" = d.old_id;

DELETE FROM "Department" d
WHERE d.id NOT IN (
  SELECT DISTINCT ON (UPPER(TRIM(name))) id
  FROM "Department"
  ORDER BY UPPER(TRIM(name)), "createdAt" ASC
);

UPDATE "Department" SET "branchId" = NULL;

UPDATE "Department" SET name = UPPER(TRIM(name));

CREATE UNIQUE INDEX IF NOT EXISTS "Department_name_key" ON "Department"("name");
