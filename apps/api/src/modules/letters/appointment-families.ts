import { AppointmentLetterLanguage } from '@prisma/client';

export const APPOINTMENT_TEMPLATE_CODES = [
  'APPT_MEDICAL_CONSULTANT_EN',
  'APPT_MEDICAL_CLINICAL_EN',
  'APPT_CLINICAL_SUPPORT_EN',
  'APPT_PHARMACY_EN',
  'APPT_PHARMACY_SUPPORT_EN',
  'APPT_LAB_EN',
  'APPT_LAB_SUPPORT_EN',
  'APPT_LAB_MANAGEMENT_EN',
  'APPT_MEDICINE_MANAGEMENT_EN',
  'APPT_MEDICINE_SUPPORT_EN',
  'APPT_SURGICAL_EN',
  'APPT_SURGICAL_SUPPORT_EN',
  'APPT_RADIOLOGY_EN',
  'APPT_ADMIN_FINANCE_EN',
  'APPT_IT_SOFTWARE_EN',
  'APPT_MEDIA_EN',
  'APPT_TECHNICAL_EN',
  'APPT_TECHNICAL_SUPPORT_UR',
  'APPT_SUPPORT_UR',
  'APPT_SUPPORT_EN',
  'APPT_VTI_EN',
] as const;

/** Former Urdu support/VTI families kept for already-issued letters. */
export const LEGACY_APPOINTMENT_TEMPLATE_CODES = [
  'APPT_CLINICAL_SUPPORT_UR',
  'APPT_PHARMACY_SUPPORT_UR',
  'APPT_LAB_SUPPORT_UR',
  'APPT_MEDICINE_SUPPORT_UR',
  'APPT_SURGICAL_SUPPORT_UR',
  'APPT_VTI_UR',
] as const;

export type AppointmentTemplateCode =
  (typeof APPOINTMENT_TEMPLATE_CODES)[number];

export type AppointmentSopFamily =
  | 'MEDICAL'
  | 'PHARMACY_MEDICINE'
  | 'LABORATORY'
  | 'SURGICAL_RADIOLOGY'
  | 'ADMIN_HR_ACCOUNTS'
  | 'IT_SOFTWARE_MEDIA'
  | 'SUPPORT_TECHNICAL'
  | 'SUPPORT_GRADE4'
  | 'SUPPORT_OPERATIONS'
  | 'VTI';

export const UNMAPPED_APPOINTMENT_DESIGNATIONS = new Set([
  'ADMINISTRATION / ADMIN+LAB',
  'ADMIN+LAB',
]);

export const APPOINTMENT_INVALID_ASSIGNMENT_MESSAGE =
  'This employee has an invalid Department / Designation assignment and must be corrected before an Appointment Letter can be generated.';

export function isInvalidAppointmentAssignment(
  departmentName?: string | null,
  designationTitle?: string | null,
): boolean {
  const dept = (departmentName ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  const title = (designationTitle ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (!title && dept !== 'ADMINISTRATION') return false;
  if (UNMAPPED_APPOINTMENT_DESIGNATIONS.has(title)) return true;
  if (title.includes('ADMIN+LAB')) return true;
  if (dept === 'ADMINISTRATION' && (title === 'ADMIN+LAB' || title.includes('ADMIN+LAB'))) {
    return true;
  }
  return false;
}

const FAMILY_BY_CODE: Record<
  AppointmentTemplateCode,
  {
    language: AppointmentLetterLanguage;
    sopFamily: AppointmentSopFamily;
    serviceArea: string;
    name: string;
  }
> = {
  APPT_MEDICAL_CONSULTANT_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'MEDICAL',
    serviceArea: 'Medical Services',
    name: 'Appointment — Medical Consultant (English)',
  },
  APPT_MEDICAL_CLINICAL_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'MEDICAL',
    serviceArea: 'Medical Services',
    name: 'Appointment — Medical Clinical (English)',
  },
  APPT_CLINICAL_SUPPORT_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'MEDICAL',
    serviceArea: 'Medical Services',
    name: 'Appointment — Clinical Support (English)',
  },
  APPT_PHARMACY_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'PHARMACY_MEDICINE',
    serviceArea: 'Pharmacy Services',
    name: 'Appointment — Pharmacy (English)',
  },
  APPT_PHARMACY_SUPPORT_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'PHARMACY_MEDICINE',
    serviceArea: 'Pharmacy Services',
    name: 'Appointment — Pharmacy Support (English)',
  },
  APPT_LAB_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'LABORATORY',
    serviceArea: 'Laboratory Services',
    name: 'Appointment — Laboratory (English)',
  },
  APPT_LAB_SUPPORT_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'LABORATORY',
    serviceArea: 'Laboratory Services',
    name: 'Appointment — Laboratory Support (English)',
  },
  APPT_LAB_MANAGEMENT_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'LABORATORY',
    serviceArea: 'Laboratory Services',
    name: 'Appointment — Laboratory Management (English)',
  },
  APPT_MEDICINE_MANAGEMENT_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'PHARMACY_MEDICINE',
    serviceArea: 'Medicine Management Services',
    name: 'Appointment — Medicine Management (English)',
  },
  APPT_MEDICINE_SUPPORT_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'PHARMACY_MEDICINE',
    serviceArea: 'Medicine Management Services',
    name: 'Appointment — Medicine Support (English)',
  },
  APPT_SURGICAL_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'SURGICAL_RADIOLOGY',
    serviceArea: 'Surgical Services',
    name: 'Appointment — Surgical (English)',
  },
  APPT_SURGICAL_SUPPORT_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'SURGICAL_RADIOLOGY',
    serviceArea: 'Surgical Services',
    name: 'Appointment — Surgical Support (English)',
  },
  APPT_RADIOLOGY_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'SURGICAL_RADIOLOGY',
    serviceArea: 'Radiology Services',
    name: 'Appointment — Radiology (English)',
  },
  APPT_ADMIN_FINANCE_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'ADMIN_HR_ACCOUNTS',
    serviceArea: 'Administrative Services',
    name: 'Appointment — Admin / Finance / HR (English)',
  },
  APPT_IT_SOFTWARE_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'IT_SOFTWARE_MEDIA',
    serviceArea: 'IT & Software Services',
    name: 'Appointment — IT / Software (English)',
  },
  APPT_MEDIA_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'IT_SOFTWARE_MEDIA',
    serviceArea: 'Media & Communication Services',
    name: 'Appointment — Media (English)',
  },
  APPT_TECHNICAL_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'SUPPORT_TECHNICAL',
    serviceArea: 'Repair & Development Services',
    name: 'Appointment — Technical (English)',
  },
  APPT_TECHNICAL_SUPPORT_UR: {
    language: AppointmentLetterLanguage.UR,
    sopFamily: 'SUPPORT_TECHNICAL',
    serviceArea: 'Repair & Development Services',
    name: 'Appointment — Repair & Development (Urdu)',
  },
  APPT_SUPPORT_UR: {
    language: AppointmentLetterLanguage.UR,
    sopFamily: 'SUPPORT_GRADE4',
    serviceArea: 'Support Services',
    name: 'Appointment — Grade 4 (Urdu)',
  },
  APPT_SUPPORT_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'SUPPORT_OPERATIONS',
    serviceArea: 'Support Services',
    name: 'Appointment — Support Services (English)',
  },
  APPT_VTI_EN: {
    language: AppointmentLetterLanguage.EN,
    sopFamily: 'VTI',
    serviceArea: 'Vocational Training Services',
    name: 'Appointment — VTI (English)',
  },
};

const LEGACY_FAMILY_BY_CODE: Record<
  (typeof LEGACY_APPOINTMENT_TEMPLATE_CODES)[number],
  {
    language: AppointmentLetterLanguage;
    sopFamily: AppointmentSopFamily;
    serviceArea: string;
    name: string;
  }
> = {
  APPT_CLINICAL_SUPPORT_UR: {
    language: AppointmentLetterLanguage.UR,
    sopFamily: 'MEDICAL',
    serviceArea: 'Medical Services',
    name: 'Appointment — Clinical Support (Urdu, legacy)',
  },
  APPT_PHARMACY_SUPPORT_UR: {
    language: AppointmentLetterLanguage.UR,
    sopFamily: 'PHARMACY_MEDICINE',
    serviceArea: 'Pharmacy Services',
    name: 'Appointment — Pharmacy Support (Urdu, legacy)',
  },
  APPT_LAB_SUPPORT_UR: {
    language: AppointmentLetterLanguage.UR,
    sopFamily: 'LABORATORY',
    serviceArea: 'Laboratory Services',
    name: 'Appointment — Laboratory Support (Urdu, legacy)',
  },
  APPT_MEDICINE_SUPPORT_UR: {
    language: AppointmentLetterLanguage.UR,
    sopFamily: 'PHARMACY_MEDICINE',
    serviceArea: 'Medicine Management Services',
    name: 'Appointment — Medicine Support (Urdu, legacy)',
  },
  APPT_SURGICAL_SUPPORT_UR: {
    language: AppointmentLetterLanguage.UR,
    sopFamily: 'SURGICAL_RADIOLOGY',
    serviceArea: 'Surgical Services',
    name: 'Appointment — Surgical Support (Urdu, legacy)',
  },
  APPT_VTI_UR: {
    language: AppointmentLetterLanguage.UR,
    sopFamily: 'VTI',
    serviceArea: 'Vocational Training Services',
    name: 'Appointment — VTI (Urdu, legacy)',
  },
};

export function isAppointmentTemplateCode(
  code: string,
): code is AppointmentTemplateCode {
  return (APPOINTMENT_TEMPLATE_CODES as readonly string[]).includes(code);
}

export function isLegacyAppointmentTemplateCode(
  code: string,
): code is (typeof LEGACY_APPOINTMENT_TEMPLATE_CODES)[number] {
  return (LEGACY_APPOINTMENT_TEMPLATE_CODES as readonly string[]).includes(code);
}

export function appointmentFamilyMeta(code: string) {
  if (isAppointmentTemplateCode(code)) return FAMILY_BY_CODE[code];
  if (isLegacyAppointmentTemplateCode(code)) return LEGACY_FAMILY_BY_CODE[code];
  return null;
}

export function resolveAppointmentServiceArea(
  templateCode: string,
  departmentName?: string | null,
): string {
  const meta = appointmentFamilyMeta(templateCode);
  if (!meta) {
    throw new Error(
      `No service area is configured for Appointment template ${templateCode}.`,
    );
  }
  const dept = (departmentName ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (templateCode === 'APPT_ADMIN_FINANCE_EN') {
    if (dept === 'HUMAN RESOURCES') return 'Human Resource Services';
    if (dept === 'ACCOUNTS') return 'Finance & Accounts Services';
    return 'Administrative Services';
  }
  if (templateCode === 'APPT_SUPPORT_UR') {
    if (dept === 'GRADE 4') return 'Support Services';
  }
  if (templateCode === 'APPT_SUPPORT_EN') {
    if (dept === 'KITCHEN') return 'Kitchen Services';
    if (dept === 'SANITARY') return 'Sanitary Services';
    if (dept === 'LABORATORY MANAGEMENT SYSTEM') return 'Support Services';
  }
  return meta.serviceArea;
}

export function appointmentTemplateLanguage(
  templateCode: string,
): AppointmentLetterLanguage | null {
  return appointmentFamilyMeta(templateCode)?.language ?? null;
}

export function appointmentTemplateFile(templateCode: string): string {
  const language = appointmentTemplateLanguage(templateCode);
  return language === AppointmentLetterLanguage.UR
    ? 'letters/APPT_BASE_UR.hbs'
    : 'letters/APPT_BASE_EN.hbs';
}
