-- Ensure Appointment letters resolve for OPD and Surgical Department roles in
-- deployed databases where seeds are not run during startup.

INSERT INTO "Designation" (id, title, category, "isActive", "isDeleted", "sortOrder", "createdAt")
VALUES
  (gen_random_uuid(), 'SURGICAL INCHARGE', 'SURGICAL DEPARTMENT', true, false, 80, NOW()),
  (gen_random_uuid(), 'SURGICAL MANAGER', 'SURGICAL DEPARTMENT', true, false, 81, NOW())
ON CONFLICT (title) DO UPDATE
SET
  category = EXCLUDED.category,
  "isActive" = true,
  "isDeleted" = false;

WITH desired(department_name, designation_title, template_code) AS (
  VALUES
    ('OPD', 'DOCTOR', 'APPT_MEDICAL_CLINICAL_EN'),
    ('OPD', 'MEDICAL OFFICER', 'APPT_MEDICAL_CLINICAL_EN'),
    ('OPD', 'SONOLOGIST', 'APPT_MEDICAL_CLINICAL_EN'),
    ('OPD', 'WOMAN MEDICAL OFFICER', 'APPT_MEDICAL_CLINICAL_EN'),
    ('OPD', 'LHV', 'APPT_CLINICAL_SUPPORT_EN'),
    ('OPD', 'OPD STAFF', 'APPT_CLINICAL_SUPPORT_EN'),
    ('SURGICAL DEPARTMENT', 'ANESTHETIC', 'APPT_SURGICAL_EN'),
    ('SURGICAL DEPARTMENT', 'SURGEON', 'APPT_SURGICAL_EN'),
    ('SURGICAL DEPARTMENT', 'SURGICAL INCHARGE', 'APPT_SURGICAL_EN'),
    ('SURGICAL DEPARTMENT', 'SURGICAL MANAGER', 'APPT_SURGICAL_EN'),
    ('SURGICAL DEPARTMENT', 'OPERATION THEATER ASSISTANT', 'APPT_SURGICAL_SUPPORT_EN'),
    ('SURGICAL DEPARTMENT', 'OPERATION THEATER TECHNICIAN', 'APPT_SURGICAL_SUPPORT_EN')
),
resolved AS (
  SELECT
    dept.id AS department_id,
    des.id AS designation_id,
    desired.template_code
  FROM desired
  JOIN "Department" dept
    ON UPPER(dept.name) = desired.department_name
    AND dept."isDeleted" = false
  JOIN "Designation" des
    ON UPPER(des.title) = desired.designation_title
    AND des."isDeleted" = false
)
UPDATE "AppointmentTemplateMapping" mapping
SET
  language = 'EN'::"AppointmentLetterLanguage",
  "templateCode" = resolved.template_code,
  active = true,
  "updatedAt" = NOW()
FROM resolved
WHERE mapping."departmentId" = resolved.department_id
  AND mapping."designationId" = resolved.designation_id;

WITH desired(department_name, designation_title, template_code) AS (
  VALUES
    ('OPD', 'DOCTOR', 'APPT_MEDICAL_CLINICAL_EN'),
    ('OPD', 'MEDICAL OFFICER', 'APPT_MEDICAL_CLINICAL_EN'),
    ('OPD', 'SONOLOGIST', 'APPT_MEDICAL_CLINICAL_EN'),
    ('OPD', 'WOMAN MEDICAL OFFICER', 'APPT_MEDICAL_CLINICAL_EN'),
    ('OPD', 'LHV', 'APPT_CLINICAL_SUPPORT_EN'),
    ('OPD', 'OPD STAFF', 'APPT_CLINICAL_SUPPORT_EN'),
    ('SURGICAL DEPARTMENT', 'ANESTHETIC', 'APPT_SURGICAL_EN'),
    ('SURGICAL DEPARTMENT', 'SURGEON', 'APPT_SURGICAL_EN'),
    ('SURGICAL DEPARTMENT', 'SURGICAL INCHARGE', 'APPT_SURGICAL_EN'),
    ('SURGICAL DEPARTMENT', 'SURGICAL MANAGER', 'APPT_SURGICAL_EN'),
    ('SURGICAL DEPARTMENT', 'OPERATION THEATER ASSISTANT', 'APPT_SURGICAL_SUPPORT_EN'),
    ('SURGICAL DEPARTMENT', 'OPERATION THEATER TECHNICIAN', 'APPT_SURGICAL_SUPPORT_EN')
),
resolved AS (
  SELECT
    dept.id AS department_id,
    des.id AS designation_id,
    desired.template_code
  FROM desired
  JOIN "Department" dept
    ON UPPER(dept.name) = desired.department_name
    AND dept."isDeleted" = false
  JOIN "Designation" des
    ON UPPER(des.title) = desired.designation_title
    AND des."isDeleted" = false
)
INSERT INTO "AppointmentTemplateMapping" (
  id,
  "departmentId",
  "designationId",
  language,
  "templateCode",
  active,
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  resolved.department_id,
  resolved.designation_id,
  'EN'::"AppointmentLetterLanguage",
  resolved.template_code,
  true,
  NOW(),
  NOW()
FROM resolved
WHERE NOT EXISTS (
  SELECT 1
  FROM "AppointmentTemplateMapping" mapping
  WHERE mapping."departmentId" = resolved.department_id
    AND mapping."designationId" = resolved.designation_id
);
