import { LetterType } from '@prisma/client';
import { LETTER_TYPE_EN_HEADER } from '../letters/letter-templates.helper';

export function ordinal(n: number): string {
  const value = Math.max(1, Math.floor(n));
  const v = value % 100;
  if (v >= 11 && v <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

export function whatsappLetterTypeLabel(letterType: LetterType): string {
  if (letterType === LetterType.APPOINTMENT) {
    return 'Appointment letter';
  }
  if (letterType === LetterType.SUSPENSION_ELIGIBILITY) {
    return 'Eligibility for Suspension notice (not a suspension)';
  }
  if (letterType === LetterType.NEAR_SUSPENSION_WARNING) {
    return 'Warning of approaching suspension (not a suspension)';
  }
  const header =
    LETTER_TYPE_EN_HEADER[letterType as Exclude<LetterType, 'APPOINTMENT'>];
  if (header?.title) {
    return header.title
      .toLowerCase()
      .replace(/\b([a-z])/g, (c) => c.toUpperCase());
  }
  return letterType.replace(/_/g, ' ');
}

/** e.g. "2nd Letter Of Warning", "1st Absence Notice" */
export function sequencedLetterLabel(
  letterType: LetterType,
  sequence: number,
): string {
  return `${ordinal(sequence)} ${whatsappLetterTypeLabel(letterType)}`;
}
