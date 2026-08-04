import { LetterType } from '@prisma/client';
import { URDU_LETTER_STYLES } from './urdu-letter-styles';
import { renderHandlebarsTemplate } from './selection-letter.helper';

export interface LetterRenderVariables {
  letterNo: string;
  issueDate: string;
  letterStyles: string;
  senderTitle: string;
  subject: string;
  employeeName: string;
  employeeCode?: string;
  designation?: string;
  department?: string;
  branch?: string;
  cnic?: string;
  joiningDate?: string;
  [key: string]: unknown;
}

export const DEFAULT_SENDER_TITLE = 'کوآرڈینیٹر پروجیکٹس';

export const LETTER_TYPE_SUBJECT: Record<LetterType, string> = {
  APPOINTMENT: 'Appointment / Selection Letter',
  WARNING: 'لیٹر آف وارننگ',
  ADVICE: 'ایڈوائس / Letter of Advice',
  DISCIPLINARY: 'Letter of Displeasure',
  EXPLANATION: 'تحریری وضاحت طلب',
  SHOW_CAUSE: 'شو کاز نوٹس / قانونی نوٹس',
  FINE: 'فائن / جرمانہ',
  INQUIRY: 'انکوائری نوٹس',
  APPRECIATION: 'Letter of Appreciation',
  TRANSFER: 'NOTIFICATION — Transfer / Posting',
  SUSPENSION: 'معطلی نوٹس / Suspension',
  TERMINATION: 'ختمِ ملازمت / Termination',
  REINSTATEMENT: 'بحالیِ ملازمت / Reinstatement',
  REJOINING: 'واپسیِ ملازمت / Rejoining',
  SALARY_INCREMENT: 'NOTIFICATION — Stipend Enhancement',
  EXPERIENCE: 'تجربہ سرٹیفکیٹ / Experience Certificate',
};

export const LETTER_TEMPLATE_META: Record<
  Exclude<LetterType, 'APPOINTMENT'>,
  { name: string; requiredVars: string[] }
> = {
  WARNING: {
    name: 'Warning Letter (Urdu)',
    requiredVars: ['violations'],
  },
  ADVICE: {
    name: 'Advice Letter (Urdu)',
    requiredVars: ['adviceReason'],
  },
  DISCIPLINARY: {
    name: 'Disciplinary / Displeasure Letter (Urdu)',
    requiredVars: ['disciplinaryReason'],
  },
  EXPLANATION: {
    name: 'Explanation Request (Urdu)',
    requiredVars: ['issueDescription'],
  },
  SHOW_CAUSE: {
    name: 'Show Cause Notice (Urdu)',
    requiredVars: ['allegation'],
  },
  FINE: {
    name: 'Fine / Penalty Letter (Urdu)',
    requiredVars: ['fineReason', 'fineAmount', 'deductionMonth'],
  },
  INQUIRY: {
    name: 'Inquiry Notice (Urdu)',
    requiredVars: ['inquiryReason'],
  },
  APPRECIATION: {
    name: 'Appreciation Letter (Urdu)',
    requiredVars: ['appreciationReason'],
  },
  TRANSFER: {
    name: 'Transfer / Posting Notification (English)',
    requiredVars: ['fromBranch', 'toBranch', 'effectiveDate'],
  },
  SUSPENSION: {
    name: 'Suspension Notice (Urdu)',
    requiredVars: ['suspensionReason'],
  },
  TERMINATION: {
    name: 'Termination Letter (Urdu)',
    requiredVars: ['terminationReason'],
  },
  REINSTATEMENT: {
    name: 'Reinstatement Letter (Urdu)',
    requiredVars: ['reinstatementDate'],
  },
  REJOINING: {
    name: 'Rejoining Letter (Urdu)',
    requiredVars: ['rejoiningDate'],
  },
  SALARY_INCREMENT: {
    name: 'Salary Increment Notification (English)',
    requiredVars: ['previousSalary', 'newSalary', 'effectiveDate'],
  },
  EXPERIENCE: {
    name: 'Experience Certificate (Urdu)',
    requiredVars: ['lastWorkingDate'],
  },
};

const LETTER_TYPE_SHORT: Record<LetterType, string> = {
  APPOINTMENT: 'APT',
  WARNING: 'WRN',
  ADVICE: 'ADV',
  DISCIPLINARY: 'DSC',
  EXPLANATION: 'EXP',
  SHOW_CAUSE: 'SCN',
  FINE: 'FNE',
  INQUIRY: 'INQ',
  APPRECIATION: 'APR',
  TRANSFER: 'TRF',
  SUSPENSION: 'SUS',
  TERMINATION: 'TRM',
  REINSTATEMENT: 'RST',
  REJOINING: 'RJN',
  SALARY_INCREMENT: 'INC',
  EXPERIENCE: 'EXL',
};

export function getLetterTypeShort(letterType: LetterType): string {
  return LETTER_TYPE_SHORT[letterType];
}

export function sanitizeRefForFilename(refNumber: string): string {
  return refNumber.replace(/\//g, '-');
}

export function templateCodeForLetterType(letterType: LetterType): string {
  return letterType === 'APPOINTMENT' ? 'SELECTION_LETTER' : letterType;
}

export function defaultSubjectFor(letterType: LetterType): string {
  return LETTER_TYPE_SUBJECT[letterType];
}

/** Split newline / bullet text into violation lines for WARNING templates. */
export function parseViolationLines(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return raw
    .split(/\r?\n|;|•/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean);
}

export interface AttendanceRow {
  date: string;
  inTime: string;
  outTime: string;
}

/** Parse attendance evidence rows for FINE late variant. */
export function parseAttendanceRows(raw: unknown): AttendanceRow[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const r = row as Record<string, unknown>;
        const date = String(r.date ?? '').trim();
        if (!date) return null;
        return {
          date,
          inTime: String(r.inTime ?? r.checkIn ?? '').trim() || '—',
          outTime: String(r.outTime ?? r.checkOut ?? '').trim() || '—',
        };
      })
      .filter((r): r is AttendanceRow => r != null);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parseAttendanceRows(parsed);
    } catch {
      // One row per line: date | in | out
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [date, inTime, outTime] = line.split(/[|,]/).map((s) => s.trim());
          if (!date) return null;
          return {
            date,
            inTime: inTime || '—',
            outTime: outTime || '—',
          };
        })
        .filter((r): r is AttendanceRow => r != null);
    }
  }
  return [];
}

export function renderLetterHtml(
  bodyHtml: string,
  variables: Record<string, unknown>,
): string {
  return renderHandlebarsTemplate(bodyHtml, {
    letterStyles: URDU_LETTER_STYLES,
    senderTitle: DEFAULT_SENDER_TITLE,
    ...variables,
  });
}

/** @deprecated Kept for type imports; prefer LetterRenderVariables. */
export type LetterData = LetterRenderVariables;
