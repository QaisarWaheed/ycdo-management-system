-- Force all department and designation names to ALL CAPS

UPDATE "Department" SET name = UPPER(TRIM(name));

UPDATE "Designation" SET title = UPPER(TRIM(title)), category = UPPER(TRIM(category));

UPDATE "Employee"
SET "currentDesignation" = UPPER(TRIM("currentDesignation"))
WHERE "currentDesignation" IS NOT NULL;

UPDATE "EmploymentHistory"
SET designation = UPPER(TRIM(designation))
WHERE designation IS NOT NULL;
