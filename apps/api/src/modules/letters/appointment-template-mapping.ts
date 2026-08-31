import { AppointmentLetterLanguage, Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import {
  APPOINTMENT_INVALID_ASSIGNMENT_MESSAGE,
  appointmentTemplateLanguage,
  canonicalizeAppointmentTemplateCode,
  isInvalidAppointmentAssignment,
} from './appointment-families';

export const APPOINTMENT_MAPPING_MISSING_MESSAGE =
  'No Appointment Letter template is configured for this Department / Designation.';

export type AppointmentMappingResolved = {
  mappingId: string;
  templateCode: string;
  language: AppointmentLetterLanguage;
  match: 'EXACT' | 'DEPARTMENT' | 'GLOBAL';
  departmentId: string | null;
  designationId: string | null;
};

type MappingDb = {
  designation: {
    findFirst: Prisma.TransactionClient['designation']['findFirst'];
  };
  appointmentTemplateMapping: {
    findFirst: Prisma.TransactionClient['appointmentTemplateMapping']['findFirst'];
  };
};

function failClosed(message = APPOINTMENT_MAPPING_MISSING_MESSAGE): never {
  throw new BadRequestException(message);
}

function resolvedMapping(
  row: {
    id: string;
    templateCode: string;
    language: AppointmentLetterLanguage;
  },
  match: AppointmentMappingResolved['match'],
  departmentId: string | null,
  designationId: string | null,
): AppointmentMappingResolved {
  const templateCode = canonicalizeAppointmentTemplateCode(row.templateCode);
  return {
    mappingId: row.id,
    templateCode,
    language:
      appointmentTemplateLanguage(templateCode) ?? row.language,
    match,
    departmentId,
    designationId,
  };
}

/**
 * Mapping stores Designation.id. Employees still store currentDesignation as
 * the catalog title string. Resolve via exact unique title, never fuzzy match.
 */
export async function resolveAppointmentTemplateMapping(
  db: MappingDb,
  input: {
    departmentId: string | null | undefined;
    designationTitle: string | null | undefined;
  },
): Promise<AppointmentMappingResolved> {
  const departmentId = input.departmentId?.trim() || null;
  const designationTitle = input.designationTitle?.trim() || '';
  if (isInvalidAppointmentAssignment(null, designationTitle)) {
    failClosed(APPOINTMENT_INVALID_ASSIGNMENT_MESSAGE);
  }

  const designation = designationTitle
    ? await db.designation.findFirst({
        where: { title: designationTitle, isDeleted: false },
        select: { id: true },
      })
    : null;

  if (departmentId && designation) {
    const exact = await db.appointmentTemplateMapping.findFirst({
      where: {
        active: true,
        departmentId,
        designationId: designation.id,
      },
    });
    if (exact) {
      return resolvedMapping(exact, 'EXACT', departmentId, designation.id);
    }
  }

  if (departmentId) {
    const dept = await db.appointmentTemplateMapping.findFirst({
      where: {
        active: true,
        departmentId,
        designationId: null,
      },
    });
    if (dept) {
      return resolvedMapping(dept, 'DEPARTMENT', departmentId, null);
    }
  }

  const global = await db.appointmentTemplateMapping.findFirst({
    where: {
      active: true,
      departmentId: null,
      designationId: null,
    },
  });
  if (global) {
    return resolvedMapping(global, 'GLOBAL', null, null);
  }

  failClosed();
}
