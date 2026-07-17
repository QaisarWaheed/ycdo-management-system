-- ProjectDepartment: hospital project ↔ department mappings
CREATE TABLE "ProjectDepartment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDepartment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectDepartment_projectId_departmentId_key"
  ON "ProjectDepartment"("projectId", "departmentId");
CREATE INDEX "ProjectDepartment_projectId_idx" ON "ProjectDepartment"("projectId");
CREATE INDEX "ProjectDepartment_departmentId_idx" ON "ProjectDepartment"("departmentId");

ALTER TABLE "ProjectDepartment"
  ADD CONSTRAINT "ProjectDepartment_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectDepartment"
  ADD CONSTRAINT "ProjectDepartment_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- UserManagerScope: scoped Admin Officer–equivalent access
CREATE TABLE "UserManagerScope" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "designationId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserManagerScope_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserManagerScope_userId_idx" ON "UserManagerScope"("userId");
CREATE INDEX "UserManagerScope_projectId_idx" ON "UserManagerScope"("projectId");
CREATE INDEX "UserManagerScope_departmentId_idx" ON "UserManagerScope"("departmentId");
CREATE INDEX "UserManagerScope_userId_projectId_departmentId_designationId_idx"
  ON "UserManagerScope"("userId", "projectId", "departmentId", "designationId");

-- Partial uniques so NULL designationId (all designations) is unique per user/project/dept
CREATE UNIQUE INDEX "UserManagerScope_user_project_dept_all_designations_key"
  ON "UserManagerScope"("userId", "projectId", "departmentId")
  WHERE "designationId" IS NULL;

CREATE UNIQUE INDEX "UserManagerScope_user_project_dept_designation_key"
  ON "UserManagerScope"("userId", "projectId", "departmentId", "designationId")
  WHERE "designationId" IS NOT NULL;

ALTER TABLE "UserManagerScope"
  ADD CONSTRAINT "UserManagerScope_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserManagerScope"
  ADD CONSTRAINT "UserManagerScope_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserManagerScope"
  ADD CONSTRAINT "UserManagerScope_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserManagerScope"
  ADD CONSTRAINT "UserManagerScope_designationId_fkey"
  FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Remove executive roles from additional roles (keep as primary if assigned)
DELETE FROM "UserAdditionalRole"
WHERE "role" IN ('PRESIDENT', 'FOUNDER', 'CHAIRMAN');

-- Backfill ProjectDepartment for HOSPITAL projects, excluding org-level departments
INSERT INTO "ProjectDepartment" ("id", "projectId", "departmentId", "createdAt")
SELECT
  gen_random_uuid()::text,
  p."id",
  d."id",
  CURRENT_TIMESTAMP
FROM "Project" p
CROSS JOIN "Department" d
WHERE p."type" = 'HOSPITAL'
  AND p."isActive" = true
  AND d."isActive" = true
  AND d."isDeleted" = false
  AND UPPER(TRIM(d."name")) NOT IN (
    'HUMAN RESOURCES',
    'ACCOUNTS',
    'SOFTWARE DEPARTMENT',
    'MEDIA & NEWS',
    'IT',
    'TEACHER',
    'PRINCIPAL',
    'VTI',
    'KITCHEN'
  )
ON CONFLICT ("projectId", "departmentId") DO NOTHING;

-- Also include departments currently used by hospital employees (still excluding org-level)
INSERT INTO "ProjectDepartment" ("id", "projectId", "departmentId", "createdAt")
SELECT DISTINCT
  gen_random_uuid()::text,
  b."projectId",
  e."currentDepartmentId",
  CURRENT_TIMESTAMP
FROM "Employee" e
JOIN "Branch" b ON b."id" = e."currentBranchId"
JOIN "Project" p ON p."id" = b."projectId"
JOIN "Department" d ON d."id" = e."currentDepartmentId"
WHERE p."type" = 'HOSPITAL'
  AND e."currentDepartmentId" IS NOT NULL
  AND b."projectId" IS NOT NULL
  AND UPPER(TRIM(d."name")) NOT IN (
    'HUMAN RESOURCES',
    'ACCOUNTS',
    'SOFTWARE DEPARTMENT',
    'MEDIA & NEWS',
    'IT',
    'TEACHER',
    'PRINCIPAL',
    'VTI',
    'KITCHEN'
  )
ON CONFLICT ("projectId", "departmentId") DO NOTHING;
