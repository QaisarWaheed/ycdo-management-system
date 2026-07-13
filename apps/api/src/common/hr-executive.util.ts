import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const HR_EXECUTIVE_PERSONAL_FIELDS = [
  'fullName',
  'fatherName',
  'dateOfBirth',
  'phone',
  'email',
  'gender',
  'bloodGroup',
  'caste',
  'domicile',
  'province',
  'city',
  'permanentProvince',
  'permanentCity',
  'district',
  'tehsil',
  'policeStation',
  'currentAddress',
  'permanentAddress',
  'fatherContactNumber',
  'emergencyContactName',
  'emergencyContactNumber',
  'spouseName',
  'spouseContactNumber',
  'maritalStatus',
  'fatherStatus',
  'guardianContact',
  'emergencyRelation',
  'photoUrl',
] as const;

export function assertCanEditPersonalInfo(role: UserRole | string) {
  if (role === UserRole.HR_EXECUTIVE) {
    throw new ForbiddenException(
      'HR executives cannot edit employee personal information',
    );
  }
}

export function stripPersonalEmployeeFields<T extends object>(
  dto: T,
  role: UserRole | string,
): T {
  if (role !== UserRole.HR_EXECUTIVE) {
    return dto;
  }

  const stripped = { ...dto };
  for (const key of HR_EXECUTIVE_PERSONAL_FIELDS) {
    delete stripped[key];
  }
  return stripped;
}
