import { AppointmentLetterLanguage } from '@prisma/client';

function normalizeKey(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Biomedical Engineer is the only Repair & Development designation that
 * receives an English appointment letter.
 */
export function isBiomedicalEngineerDesignation(
  designationTitle: string | null | undefined,
): boolean {
  const title = normalizeKey(designationTitle);
  return (
    title === 'BIO MEDICAL ENGINEERS' ||
    title === 'BIO MEDICAL ENGINEER' ||
    title === 'BIOMEDICAL ENGINEER' ||
    title === 'BIOMEDICAL ENGINEERS'
  );
}

/**
 * Appointment letter language:
 * - Repair and Development: Urdu, except Biomedical Engineer (English)
 * - Grade 4: Urdu
 * - All other staff: English
 */
export function appointmentLanguageForStaff(
  departmentName: string | null | undefined,
  designationTitle: string | null | undefined,
): AppointmentLetterLanguage {
  const dept = normalizeKey(departmentName);
  if (dept === 'GRADE 4') return AppointmentLetterLanguage.UR;
  if (dept === 'REPAIR AND DEVELOPMENT') {
    return isBiomedicalEngineerDesignation(designationTitle)
      ? AppointmentLetterLanguage.EN
      : AppointmentLetterLanguage.UR;
  }
  return AppointmentLetterLanguage.EN;
}

export function isUrduAppointmentStaff(
  departmentName: string | null | undefined,
  designationTitle: string | null | undefined,
): boolean {
  return (
    appointmentLanguageForStaff(departmentName, designationTitle) ===
    AppointmentLetterLanguage.UR
  );
}
