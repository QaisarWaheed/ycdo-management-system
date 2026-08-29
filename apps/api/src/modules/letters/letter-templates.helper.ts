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

export const DEFAULT_ORG_LINE = 'YCDO ملتان پاکستان';

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
  EXPLANATION_FINE: 'تحریری وضاحت طلب و جرمانہ نوٹس',
  SUSPENSION_ELIGIBILITY: 'اہلیت برائے معطلی بابت مسلسل خلاف ورزیاں',
  NEAR_SUSPENSION_WARNING: 'مسلسل خلاف ورزیوں بابت تنبیہی نوٹس',
  CUSTOM: '',
};

/** English top heading + subheading only (per official PDF shell). */
export const LETTER_TYPE_EN_HEADER: Record<
  Exclude<LetterType, 'APPOINTMENT'>,
  { title: string; prescribed: string; subtitle: string }
> = {
  WARNING: { title: 'LETTER OF WARNING', prescribed: '', subtitle: '' },
  ADVICE: { title: 'LETTER OF ADVICE', prescribed: '', subtitle: '' },
  DISCIPLINARY: { title: 'LETTER OF DISPLEASURE', prescribed: '', subtitle: '' },
  EXPLANATION: { title: 'LETTER OF EXPLANATION', prescribed: '', subtitle: '' },
  SHOW_CAUSE: { title: 'SHOW CAUSE NOTICE', prescribed: '', subtitle: '' },
  FINE: { title: 'LETTER OF FINE / PENALTY', prescribed: '', subtitle: '' },
  INQUIRY: { title: 'INQUIRY NOTICE', prescribed: '', subtitle: '' },
  APPRECIATION: { title: 'LETTER OF APPRECIATION', prescribed: '', subtitle: '' },
  TRANSFER: { title: 'NOTIFICATION OF TRANSFER', prescribed: '', subtitle: '' },
  SUSPENSION: { title: 'SUSPENSION NOTICE', prescribed: '', subtitle: '' },
  TERMINATION: { title: 'TERMINATION LETTER', prescribed: '', subtitle: '' },
  REINSTATEMENT: { title: 'REINSTATEMENT LETTER', prescribed: '', subtitle: '' },
  REJOINING: { title: 'REJOINING LETTER', prescribed: '', subtitle: '' },
  SALARY_INCREMENT: {
    title: 'SALARY INCREMENT NOTIFICATION',
    prescribed: '',
    subtitle: '',
  },
  EXPERIENCE: { title: 'EXPERIENCE CERTIFICATE', prescribed: '', subtitle: '' },
  EXPLANATION_FINE: {
    title: 'LETTER OF EXPLANATION & FINE',
    prescribed: '',
    subtitle: '',
  },
  SUSPENSION_ELIGIBILITY: {
    title: 'اہلیت برائے معطلی',
    prescribed: '',
    subtitle: '',
  },
  NEAR_SUSPENSION_WARNING: {
    title: 'تنبیہی نوٹس برائے ممکنہ معطلی',
    prescribed: '',
    subtitle: '',
  },
  // Custom (IT-authored) templates always carry their own enTitle on the
  // LetterTemplate row; this entry is just a safe fallback.
  CUSTOM: { title: 'NOTIFICATION', prescribed: '', subtitle: '' },
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
    requiredVars: ['violations'],
  },
  DISCIPLINARY: {
    name: 'Disciplinary / Displeasure Letter (Urdu)',
    requiredVars: ['disciplinaryReason'],
  },
  EXPLANATION: {
    name: 'Explanation Request (Urdu)',
    requiredVars: ['violations'],
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
    name: 'Letter of Appreciation',
    requiredVars: ['bonusAmount'],
  },
  TRANSFER: {
    name: 'Transfer / Posting Notification',
    requiredVars: ['toPosting', 'targetDesignation', 'effectiveDate'],
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
  EXPLANATION_FINE: {
    name: 'Explanation & Fine Letter (Urdu)',
    requiredVars: ['violations', 'fineAmount', 'deductionMonth'],
  },
  SUSPENSION_ELIGIBILITY: {
    name: 'Eligibility for Suspension Notice (Urdu)',
    requiredVars: [],
  },
  NEAR_SUSPENSION_WARNING: {
    name: 'Near Suspension Warning Notice (Urdu)',
    requiredVars: [],
  },
  // Custom templates carry their own name/requiredVars on the LetterTemplate
  // row; this entry is just a safe fallback and is not otherwise read.
  CUSTOM: {
    name: 'Custom Letter',
    requiredVars: [],
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
  EXPLANATION_FINE: 'EXF',
  SUSPENSION_ELIGIBILITY: 'SEL',
  NEAR_SUSPENSION_WARNING: 'NSW',
  CUSTOM: 'GEN',
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

export function buildLetterRef(
  letterType: LetterType,
  letterNo: string,
  shortOverride?: string | null,
): string {
  const short = shortOverride || getLetterTypeShort(letterType);
  const sequence = letterNo.split('/')[0]?.replace(/\D/g, '') || '';
  if (!sequence || letterNo.startsWith('PREVIEW')) {
    return letterNo;
  }
  return `HRMS/${short}/${sequence}`;
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
  <div class="bismillah">بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيْمِ</div>
  <div class="letterhead-row">
    <div>
      {{#if letterheadLogoUrl}}
        <img class="letterhead-logo" src="{{letterheadLogoUrl}}" alt="YCDO" />
      {{else}}
        <div class="letterhead-logo-fallback">YCDO<br/>SERVE HUMANITY</div>
      {{/if}}
    </div>
    <div class="letterhead-right">
      <div class="letterhead-org">
        <div class="office">OFFICE OF THE</div>
        <div class="org-name">YOUTH COMMUNITY<br/>DEVELOPMENT ORGANIZATION</div>
        <div class="loc">MULTAN, PAKISTAN</div>
      </div>
      <div class="letter-nos">
        <div class="letter-no-line">Letter no: {{letterNo}}</div>
        <div class="letter-no-line">Dated: {{issueDate}}</div>
      </div>
    </div>
  </div>
  <div class="notification-block">
    <p class="en-title">{{enTitle}}</p>
  </div>
</div>

<div class="meta-block">
  <div class="row"><span class="label">منجانب:</span> {{senderTitle}}</div>
  <div class="row">{{orgLine}}</div>
  <div class="row"><span class="label">بجانب:</span> {{employeeName}}{{#if designation}} ({{designation}}){{/if}}</div>
  {{#if branch}}<div class="row">{{branch}}</div>{{/if}}
  <div class="row subject-row"><span class="label">عنوان:</span> {{subject}}</div>
</div>
`;

const YCDO_LETTER_FOOTER = `
<div class="closing">
  <p>والسلام</p>
</div>
<div class="signature">
  <div>{{senderTitle}}</div>
  <div>{{orgLine}}</div>
</div>
`;

/** Shown at the bottom of every issued letter (PDF + HTML preview). */
export const COMPUTER_GENERATED_NOTICE =
  'This is a computer generated letter and it does not require any signatures';

export const COMPUTER_GENERATED_NOTICE_HTML = `
<div class="computer-generated-notice">${COMPUTER_GENERATED_NOTICE}</div>`;

/**
 * Appends the disclaimer once, inside the first `.page` block (before its
 * closing tag) when present. PDF generation hides this in-body copy and
 * renders the same text via Puppeteer's footer instead.
 */
export function appendComputerGeneratedNotice(htmlContent: string): string {
  if (htmlContent.includes('computer-generated-notice')) {
    return htmlContent;
  }
  const trimmed = htmlContent.trimEnd();
  if (/<div class="page">/i.test(trimmed) && /<\/div>\s*<\/body>/i.test(trimmed)) {
    return trimmed.replace(
      /<\/div>\s*<\/body>/i,
      `${COMPUTER_GENERATED_NOTICE_HTML}</div></body>`,
    );
  }
  if (/<\/body>/i.test(trimmed)) {
    return trimmed.replace(
      /<\/body>/i,
      `${COMPUTER_GENERATED_NOTICE_HTML}</body>`,
    );
  }
  if (/<\/html>/i.test(trimmed)) {
    return trimmed.replace(
      /<\/html>/i,
      `${COMPUTER_GENERATED_NOTICE_HTML}</html>`,
    );
  }
  return `${trimmed}${COMPUTER_GENERATED_NOTICE_HTML}`;
}

let partialsRegistered = false;

function ensurePartials() {
  if (partialsRegistered) return;
  Handlebars.registerPartial('ycdoLetterHeader', YCDO_LETTER_HEADER);
  Handlebars.registerPartial('ycdoLetterFooter', YCDO_LETTER_FOOTER);
  partialsRegistered = true;
}

export function applyFineUniformWording(html: string): string {
  const from = 'آئندہ آپ کی ڈیوٹی کے دوران';
  const to = 'آئندہ آپ ڈیوٹی کے دوران';
  if (!html.includes(from)) return html;
  return html.split(from).join(to);
}

export function renderLetterHtml(
  bodyHtml: string,
  variables: Record<string, unknown>,
): string {
  ensurePartials();
  return appendComputerGeneratedNotice(
    renderHandlebarsTemplate(applyFineUniformWording(bodyHtml), {
      letterStyles: URDU_LETTER_STYLES,
      senderTitle: DEFAULT_SENDER_TITLE,
      orgLine: DEFAULT_ORG_LINE,
      letterheadLogoUrl: process.env.LETTERHEAD_LOGO_URL || YCDO_LOGO_DATA_URI,
      ...variables,
    }),
  );
}

/** @deprecated Kept for type imports; prefer LetterRenderVariables. */
export type LetterData = LetterRenderVariables;
