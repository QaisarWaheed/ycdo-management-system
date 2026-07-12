-- Force all department and designation names to ALL CAPS.
-- Dedupe case-variant rows before uppercasing to avoid unique constraint violations.

-- 1. Uppercase free-text designation fields (no unique constraint on these)
UPDATE "Employee"
SET "currentDesignation" = UPPER(TRIM("currentDesignation"))
WHERE "currentDesignation" IS NOT NULL;

UPDATE "EmploymentHistory"
SET designation = UPPER(TRIM(designation))
WHERE designation IS NOT NULL;

UPDATE "JobApplication"
SET "selectedDesignation" = UPPER(TRIM("selectedDesignation"))
WHERE "selectedDesignation" IS NOT NULL;

-- 2. Dedupe departments by normalized name, then uppercase
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
  SELECT id
  FROM (
    SELECT DISTINCT ON (UPPER(TRIM(name))) id
    FROM "Department"
    ORDER BY UPPER(TRIM(name)), "createdAt" ASC
  ) AS canonical
);

UPDATE "Department" SET name = UPPER(TRIM(name));

-- 3. Dedupe designations by normalized title (prefer active, non-deleted), then uppercase
DELETE FROM "Designation" d
WHERE d.id NOT IN (
  SELECT id
  FROM (
    SELECT DISTINCT ON (UPPER(TRIM(title))) id
    FROM "Designation"
    ORDER BY
      UPPER(TRIM(title)),
      CASE WHEN "isActive" = true AND "isDeleted" = false THEN 0 ELSE 1 END,
      "createdAt" ASC
  ) AS canonical
);

UPDATE "Designation"
SET title = UPPER(TRIM(title)),
    category = UPPER(TRIM(category));
