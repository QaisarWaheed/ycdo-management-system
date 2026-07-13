import { Prisma, UserRole } from '@prisma/client';
import { DEPARTMENT_DESIGNATIONS } from './org-structure';

/** Exact department / designation category for medicine staff. */
export const MEDICINE_DEPARTMENT_NAME = 'MEDICINE MANAGEMENT SYSTEM';

export const MEDICINE_DESIGNATIONS: string[] = [
  ...(DEPARTMENT_DESIGNATIONS[MEDICINE_DEPARTMENT_NAME] ?? []),
];

export function isMedicineManagerRole(role?: UserRole | string | null) {
  return role === UserRole.MEDICINE_MANAGER || role === 'MEDICINE_MANAGER';
}

/** Prisma employee filter: department name OR designation title under medicine. */
export function medicineEmployeeWhere(): Prisma.EmployeeWhereInput {
  const designationFilters: Prisma.EmployeeWhereInput[] =
    MEDICINE_DESIGNATIONS.map((title) => ({
      currentDesignation: { equals: title, mode: 'insensitive' },
    }));

  return {
    OR: [
      {
        currentDepartment: {
          name: { equals: MEDICINE_DEPARTMENT_NAME, mode: 'insensitive' },
        },
      },
      ...designationFilters,
    ],
  };
}

export function assertEmployeeInMedicineScope(employee: {
  currentDesignation?: string | null;
  currentDepartment?: { name?: string | null } | null;
}): boolean {
  const dept = employee.currentDepartment?.name?.trim().toUpperCase();
  if (dept === MEDICINE_DEPARTMENT_NAME) return true;

  const title = employee.currentDesignation?.trim().toUpperCase();
  if (!title) return false;
  return MEDICINE_DESIGNATIONS.some((d) => d.toUpperCase() === title);
}
