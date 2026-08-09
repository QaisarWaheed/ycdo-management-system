import Handlebars from 'handlebars';
import { LetterType } from '@prisma/client';
import { URDU_LETTER_STYLES } from './urdu-letter-styles';
import { renderHandlebarsTemplate } from './selection-letter.helper';
import { YCDO_LOGO_DATA_URI } from './ycdo-logo-base64';

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

/** Matches official warning PDF signatory. */
export const DEFAULT_SENDER_TITLE = 'چیئرمین ایڈمن ڈیپارٹمنٹ';

export const DEFAULT_ORG_LINE = 'YCDO ملتان، پاکستان';

/** Urdu subjects shown on the letter (centered / عنوان). */
export const LETTER_TYPE_SUBJECT: Record<LetterType, string> = {
  APPOINTMENT: 'Appointment / Selection Letter',
  WARNING: 'لیٹر آف وارننگ',
  ADVICE: 'ایڈوائس لیٹر',
  DISCIPLINARY: 'لیٹر آف ڈسپلیژر',
  EXPLANATION: 'تحریری وضاحت طلب',
  SHOW_CAUSE: 'شو کاز نوٹس',
  FINE: 'فائن / جرمانہ نوٹس',
  INQUIRY: 'انکوائری نوٹس',
  APPRECIATION: 'تعریفی خط',
  TRANSFER: 'ٹرانسفر / پوسٹنگ نوٹیفکیشن',
  SUSPENSION: 'معطلی نوٹس',
  TERMINATION: 'ختمِ ملازمت',
  REINSTATEMENT: 'بحالیِ ملازمت',
  REJOINING: 'واپسیِ ملازمت',
  SALARY_INCREMENT: 'تنخواہ / الاؤنس اضافہ',
  EXPERIENCE: 'تجربہ سرٹیفکیٹ',
};

/** English top heading + subheading only (per official PDF shell). */
export const LETTER_TYPE_EN_HEADER: Record<
  Exclude<LetterType, 'APPOINTMENT'>,
  { title: string; prescribed: string; subtitle: string }
> = {
  WARNING: {
    title: 'Notification',
    prescribed: 'Prescribed "Letter of Warning"',
    subtitle:
      'It is notified that the following notified format is approved for Letter of Warning.',
  },
  ADVICE: {
    title: 'Notification',
    prescribed: 'Prescribed "Letter of Advice"',
    subtitle:
      'It is notified that the following notified format is approved for Letter of Advice.',
  },
  DISCIPLINARY: {
    title: 'Notification',
    prescribed: 'Prescribed "Letter of Displeasure"',
    subtitle:
      'It is notified that the following notified format is approved for Letter of Displeasure.',
  },
  EXPLANATION: {
    title: 'Notification',
    prescribed: 'Prescribed "Explanation Request"',
    subtitle:
      'It is notified that the following notified format is approved for Explanation Request.',
  },
  SHOW_CAUSE: {
    title: 'Notification',
    prescribed: 'Prescribed "Show Cause Notice"',
    subtitle:
      'It is notified that the following notified format is approved for Show Cause Notice.',
  },
  FINE: {
    title: 'Notification',
    prescribed: 'Prescribed "Fine / Penalty Letter"',
    subtitle:
      'It is notified that the following notified format is approved for Fine / Penalty Letter.',
  },
  INQUIRY: {
    title: 'Notification',
    prescribed: 'Prescribed "Inquiry Notice"',
    subtitle:
      'It is notified that the following notified format is approved for Inquiry Notice.',
  },
  APPRECIATION: {
    title: 'Notification',
    prescribed: 'Prescribed "Letter of Appreciation"',
    subtitle:
      'It is notified that the following notified format is approved for Letter of Appreciation.',
  },
  TRANSFER: {
    title: 'Notification',
    prescribed: 'Prescribed "Transfer / Posting"',
    subtitle:
      'It is notified that the following notified format is approved for Transfer / Posting.',
  },
  SUSPENSION: {
    title: 'Notification',
    prescribed: 'Prescribed "Suspension Notice"',
    subtitle:
      'It is notified that the following notified format is approved for Suspension Notice.',
  },
  TERMINATION: {
    title: 'Notification',
    prescribed: 'Prescribed "Termination Letter"',
    subtitle:
      'It is notified that the following notified format is approved for Termination Letter.',
  },
  REINSTATEMENT: {
    title: 'Notification',
    prescribed: 'Prescribed "Reinstatement Letter"',
    subtitle:
      'It is notified that the following notified format is approved for Reinstatement Letter.',
  },
  REJOINING: {
    title: 'Notification',
    prescribed: 'Prescribed "Rejoining Letter"',
    subtitle:
      'It is notified that the following notified format is approved for Rejoining Letter.',
  },
  SALARY_INCREMENT: {
    title: 'Notification',
    prescribed: 'Prescribed "Salary Increment"',
    subtitle:
      'It is notified that the following notified format is approved for Salary Increment.',
  },
  EXPERIENCE: {
    title: 'Notification',
    prescribed: 'Prescribed "Experience Certificate"',
    subtitle:
      'It is notified that the following notified format is approved for Experience Certificate.',
  },
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
    requiredVars: ['lateTime'],
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
    requiredVars: ['reviewMonth', 'rewardAmount'],
  },
  TRANSFER: {
    name: 'Transfer / Posting Notification',
    requiredVars: ['toPosting', 'timing', 'targetDesignation', 'effectiveDate'],
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
    name: 'Salary Increment Notification',
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

export function buildLetterRef(letterType: LetterType, letterNo: string): string {
  const short = getLetterTypeShort(letterType);
  const first = letterNo.split('/')[0]?.replace(/\D/g, '') || '0';
  const padded = first.slice(-3).padStart(3, '0');
  return `HRMS/${short}/${padded}`;
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

const YCDO_LETTER_HEADER = `
<div class="letter-shell-top">
  <div class="letterhead-row">
    <div>
      {{#if letterheadLogoUrl}}
        <img class="letterhead-logo" src="{{letterheadLogoUrl}}" alt="YCDO" />
      {{else}}
        <div class="letterhead-logo-fallback">YCDO<br/>SERVE HUMANITY</div>
      {{/if}}
    </div>
    <div class="letter-nos">
      <div class="letter-no-line">Letter No. {{letterNo}}</div>
      <div class="ref-line"><span class="ltr">{{letterRef}}</span> :بحوالہ</div>
    </div>
  </div>
  <div class="notification-block">
    <p class="en-title">{{enTitle}}</p>
    <p class="en-prescribed">{{enPrescribed}}</p>
  </div>
  <hr class="hr-line" />
</div>

<div class="meta-block">
  <div class="row"><span class="label">تاریخ:</span> {{issueDate}}</div>
  <div class="row"><span class="label">منجانب:</span> {{senderTitle}}</div>
  <div class="row">{{orgLine}}</div>
  <div class="row"><span class="label">بجانب:</span> {{employeeName}}{{#if designation}} ({{designation}}){{/if}}</div>
  {{#if branch}}<div class="row">{{branch}}</div>{{/if}}
  <div class="row"><span class="label">عنوان:</span> {{subject}}</div>
</div>
`;

const YCDO_LETTER_FOOTER = `
<div class="closing">
  <p>والسلام</p>
</div>
<div class="signature">
  <div class="sig-line"></div>
  <div>{{senderTitle}}</div>
  <div>{{orgLine}}</div>
</div>
`;

let partialsRegistered = false;

function ensurePartials() {
  if (partialsRegistered) return;
  Handlebars.registerPartial('ycdoLetterHeader', YCDO_LETTER_HEADER);
  Handlebars.registerPartial('ycdoLetterFooter', YCDO_LETTER_FOOTER);
  partialsRegistered = true;
}

export function renderLetterHtml(
  bodyHtml: string,
  variables: Record<string, unknown>,
): string {
  ensurePartials();
  return renderHandlebarsTemplate(bodyHtml, {
    letterStyles: URDU_LETTER_STYLES,
    senderTitle: DEFAULT_SENDER_TITLE,
    orgLine: DEFAULT_ORG_LINE,
    letterheadLogoUrl: process.env.LETTERHEAD_LOGO_URL || YCDO_LOGO_DATA_URI,
    ...variables,
  });
}

/** @deprecated Kept for type imports; prefer LetterRenderVariables. */
export type LetterData = LetterRenderVariables;
