import { AppointmentLetterLanguage, Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import {
  APPOINTMENT_INVALID_ASSIGNMENT_MESSAGE,
  appointmentTemplateLanguage,
  canonicalizeAppointmentTemplateCode,
  isInvalidAppointmentAssignment,
} from './appointment-families';
import { lookupAppointmentCatalog } from './appointment-catalog';

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
 * the catalog title string. Resolve via the unique title (case/space-insensitive),
 * never fuzzy match.
 */
export async function resolveAppointmentTemplateMapping(
  db: MappingDb,
  input: {
    departmentId: string | null | undefined;
    designationTitle: string | null | undefined;
    /** Department name used as catalog fallback when no DB mapping exists. */
    departmentName?: string | null | undefined;
  },
): Promise<AppointmentMappingResolved> {
  const departmentId = input.departmentId?.trim() || null;
  // Employee.currentDesignation is free text: collapse spaces and ignore case so
  // "Lab  staff" still resolves to the unique LAB STAFF designation.
  const designationTitle =
    input.designationTitle?.trim().replace(/\s+/g, ' ') || '';
  if (isInvalidAppointmentAssignment(null, designationTitle)) {
    failClosed(APPOINTMENT_INVALID_ASSIGNMENT_MESSAGE);
  }

  const designation = designationTitle
    ? await db.designation.findFirst({
        where: {
          title: { equals: designationTitle, mode: 'insensitive' },
          isDeleted: false,
        },
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

  // Catalog fallback: use the in-memory APPOINTMENT_MAPPING_SPECS so the
  // letter can be generated even when the DB mapping rows are absent
  // (e.g. migration not yet applied on a freshly deployed instance).
  if (input.departmentName && designationTitle) {
    const catalog = lookupAppointmentCatalog(input.departmentName, designationTitle);
    if (catalog) {
      const templateCode = canonicalizeAppointmentTemplateCode(catalog.templateCode);
      return {
        mappingId: 'CATALOG_FALLBACK',
        templateCode,
        language: catalog.language,
        match: 'EXACT',
        departmentId,
        designationId: designation?.id ?? null,
      };
    }
  }

  failClosed();
}
