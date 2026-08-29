-- CreateEnum
CREATE TYPE "AppointmentLetterLanguage" AS ENUM ('UR', 'EN');

-- CreateTable
CREATE TABLE "AppointmentTemplateMapping" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT,
    "designationId" TEXT,
    "language" "AppointmentLetterLanguage" NOT NULL,
    "templateCode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentTemplateMapping_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AppointmentTemplateMapping_departmentId_designationId_idx"
ON "AppointmentTemplateMapping"("departmentId", "designationId");

CREATE INDEX "AppointmentTemplateMapping_templateCode_idx"
ON "AppointmentTemplateMapping"("templateCode");

ALTER TABLE "AppointmentTemplateMapping"
ADD CONSTRAINT "AppointmentTemplateMapping_departmentId_fkey"
FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppointmentTemplateMapping"
ADD CONSTRAINT "AppointmentTemplateMapping_designationId_fkey"
FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One active exact mapping per department + designation.
CREATE UNIQUE INDEX "AppointmentTemplateMapping_exact_active_key"
ON "AppointmentTemplateMapping" ("departmentId", "designationId")
WHERE "active" = true AND "departmentId" IS NOT NULL AND "designationId" IS NOT NULL;

-- One active department-level fallback per department.
CREATE UNIQUE INDEX "AppointmentTemplateMapping_dept_active_key"
ON "AppointmentTemplateMapping" ("departmentId")
WHERE "active" = true AND "departmentId" IS NOT NULL AND "designationId" IS NULL;

-- One active global fallback.
CREATE UNIQUE INDEX "AppointmentTemplateMapping_global_active_key"
ON "AppointmentTemplateMapping" ((1))
WHERE "active" = true AND "departmentId" IS NULL AND "designationId" IS NULL;

-- One Appointment DRAFT per employee (SENT history unrestricted).
CREATE UNIQUE INDEX "Letter_appointment_draft_employee_key"
ON "Letter" ("employeeId")
WHERE "letterType" = 'APPOINTMENT' AND "status" = 'DRAFT';
