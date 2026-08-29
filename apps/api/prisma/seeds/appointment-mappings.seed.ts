import { AppointmentLetterLanguage, PrismaClient } from '@prisma/client';
import { APPOINTMENT_MAPPING_SPECS } from '../../src/modules/letters/appointment-catalog';
import {
  UNMAPPED_APPOINTMENT_DESIGNATIONS,
  appointmentTemplateLanguage,
} from '../../src/modules/letters/appointment-families';

async function findDepartment(
  prisma: PrismaClient,
  name: string,
  aliases: string[] = [],
) {
  const names = [name, ...aliases];
  for (const candidate of names) {
    const row = await prisma.department.findFirst({
      where: { name: candidate, isDeleted: false },
      select: { id: true, name: true },
    });
    if (row) return row;
  }
  return null;
}

/**
 * Phase 3B: exact Department + Designation mappings.
 * Idempotent. Skips missing catalog rows. Deactivates fixture/global fallback.
 * Does not rewrite designation titles or create ADMINISTRATION / ADMIN+LAB.
 */
export async function seedAppointmentTemplateMappings(prisma: PrismaClient) {
  await prisma.appointmentTemplateMapping.updateMany({
    where: {
      OR: [
        { departmentId: null, designationId: null },
        { templateCode: { startsWith: 'APPOINTMENT_FIXTURE' } },
      ],
    },
    data: { active: false },
  });

  let created = 0;
  let updated = 0;
  let skippedMissing = 0;

  for (const spec of APPOINTMENT_MAPPING_SPECS) {
    const department = await findDepartment(
      prisma,
      spec.department,
      spec.aliases ?? [],
    );
    if (!department) {
      skippedMissing += spec.titles.length;
      continue;
    }

    const language =
      appointmentTemplateLanguage(spec.templateCode) ??
      AppointmentLetterLanguage.EN;

    for (const title of spec.titles) {
      if (UNMAPPED_APPOINTMENT_DESIGNATIONS.has(title)) {
        skippedMissing += 1;
        continue;
      }
      const designation = await prisma.designation.findFirst({
        where: { title, isDeleted: false },
        select: { id: true },
      });
      if (!designation) {
        skippedMissing += 1;
        continue;
      }

      const existing = await prisma.appointmentTemplateMapping.findFirst({
        where: {
          departmentId: department.id,
          designationId: designation.id,
        },
      });
      if (existing) {
        await prisma.appointmentTemplateMapping.update({
          where: { id: existing.id },
          data: {
            language,
            templateCode: spec.templateCode,
            active: true,
          },
        });
        updated += 1;
      } else {
        await prisma.appointmentTemplateMapping.create({
          data: {
            departmentId: department.id,
            designationId: designation.id,
            language,
            templateCode: spec.templateCode,
            active: true,
          },
        });
        created += 1;
      }
    }
  }

  return { created, updated, skippedMissing };
}

/** Read-only local report. Does not mutate Employee or mapping rows. */
export async function reportAppointmentMappingCoverage(prisma: PrismaClient) {
  const intended: string[] = [];
  const departmentMatched: string[] = [];
  const departmentMissing: string[] = [];
  const designationMatched: string[] = [];
  const designationMissing: string[] = [];
  const invalidSkipped: string[] = [];
  let mappingPresent = 0;
  let mappingMissing = 0;

  for (const spec of APPOINTMENT_MAPPING_SPECS) {
    const department = await findDepartment(
      prisma,
      spec.department,
      spec.aliases ?? [],
    );
    if (!department) {
      departmentMissing.push(spec.department);
      for (const title of spec.titles) {
        intended.push(`${spec.department} / ${title}`);
        designationMissing.push(`${spec.department} / ${title}`);
      }
      continue;
    }
    departmentMatched.push(`${spec.department} -> ${department.name}`);
    for (const title of spec.titles) {
      intended.push(`${spec.department} / ${title}`);
      if (UNMAPPED_APPOINTMENT_DESIGNATIONS.has(title)) {
        invalidSkipped.push(`${spec.department} / ${title}`);
        continue;
      }
      const designation = await prisma.designation.findFirst({
        where: { title, isDeleted: false },
        select: { id: true, title: true },
      });
      if (!designation) {
        designationMissing.push(`${spec.department} / ${title}`);
        continue;
      }
      designationMatched.push(title);
      const mapping = await prisma.appointmentTemplateMapping.findFirst({
        where: {
          departmentId: department.id,
          designationId: designation.id,
          active: true,
        },
      });
      if (mapping) mappingPresent += 1;
      else mappingMissing += 1;
    }
  }

  const uniqueDeptsMatched = [...new Set(departmentMatched)];
  const uniqueDeptsMissing = [...new Set(departmentMissing)];

  const lines = [
    'Appointment mapping coverage (read-only)',
    `Intended pairs: ${intended.length}`,
    `Departments matched: ${uniqueDeptsMatched.length}`,
    `Departments missing: ${uniqueDeptsMissing.length}${
      uniqueDeptsMissing.length ? ` (${uniqueDeptsMissing.join(', ')})` : ''
    }`,
    `Designations matched: ${new Set(designationMatched).size}`,
    `Designations missing: ${designationMissing.length}`,
    `Invalid combinations skipped: ${invalidSkipped.length}`,
    `Active mappings present: ${mappingPresent}`,
    `Intended pairs still unmapped (dept+title exist): ${mappingMissing}`,
  ];
  if (designationMissing.length) {
    lines.push('Missing designations:');
    lines.push(...designationMissing.slice(0, 50).map((row) => `  - ${row}`));
    if (designationMissing.length > 50) {
      lines.push(`  … ${designationMissing.length - 50} more`);
    }
  }
  return {
    text: lines.join('\n'),
    intended: intended.length,
    departmentMatched: uniqueDeptsMatched.length,
    departmentMissing: uniqueDeptsMissing,
    designationMatched: new Set(designationMatched).size,
    designationMissing,
    invalidSkipped,
    mappingPresent,
    mappingMissing,
  };
}
