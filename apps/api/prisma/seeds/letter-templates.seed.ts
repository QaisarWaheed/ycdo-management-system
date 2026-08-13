import { Prisma, PrismaClient } from '@prisma/client';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

type TemplateFieldSeed = {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'date' | 'select';
  hint?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
};

type TemplateSeed = {
  code: string;
  name: string;
  file: string;
  requiredVars: string[];
  isCustom?: boolean;
  subjectUr?: string;
  enTitle?: string;
  enPrescribed?: string;
  enSubtitle?: string;
  letterCode?: string;
  fieldsSchema?: TemplateFieldSeed[];
};

const TEMPLATES: TemplateSeed[] = [
  {
    code: 'SELECTION_LETTER',
    name: 'Appointment / Selection Letter',
    file: 'selection-letter.hbs',
    requiredVars: ['stipendAmount', 'hoursPerDay', 'shiftName', 'capacity'],
  },
  {
    code: 'WARNING',
    name: 'Warning Letter (Urdu)',
    file: 'letters/WARNING.hbs',
    requiredVars: ['violations'],
  },
  {
    code: 'ADVICE',
    name: 'Advice Letter (Urdu)',
    file: 'letters/ADVICE.hbs',
    requiredVars: ['lateTime'],
  },
  {
    code: 'DISCIPLINARY',
    name: 'Disciplinary / Displeasure Letter (Urdu)',
    file: 'letters/DISCIPLINARY.hbs',
    requiredVars: ['disciplinaryReason'],
  },
  {
    code: 'EXPLANATION',
    name: 'Explanation Request (Urdu)',
    file: 'letters/EXPLANATION.hbs',
    requiredVars: ['issueDescription'],
  },
  {
    code: 'SHOW_CAUSE',
    name: 'Show Cause Notice (Urdu)',
    file: 'letters/SHOW_CAUSE.hbs',
    requiredVars: ['allegation'],
  },
  {
    code: 'FINE',
    name: 'Fine / Penalty Letter (Urdu)',
    file: 'letters/FINE.hbs',
    requiredVars: ['fineReason', 'fineAmount', 'deductionMonth'],
  },
  {
    code: 'INQUIRY',
    name: 'Inquiry Notice (Urdu)',
    file: 'letters/INQUIRY.hbs',
    requiredVars: ['inquiryReason'],
  },
  {
    code: 'APPRECIATION',
    name: 'Appreciation Letter (Urdu)',
    file: 'letters/APPRECIATION.hbs',
    requiredVars: ['reviewMonth', 'rewardAmount'],
  },
  {
    code: 'TRANSFER',
    name: 'Transfer / Posting Notification',
    file: 'letters/TRANSFER.hbs',
    requiredVars: ['toPosting', 'timing', 'targetDesignation', 'effectiveDate'],
  },
  {
    code: 'SUSPENSION',
    name: 'Suspension Notice (Urdu)',
    file: 'letters/SUSPENSION.hbs',
    requiredVars: ['suspensionReason'],
  },
  {
    code: 'TERMINATION',
    name: 'Termination Letter (Urdu)',
    file: 'letters/TERMINATION.hbs',
    requiredVars: ['terminationReason'],
  },
  {
    code: 'REINSTATEMENT',
    name: 'Reinstatement Letter (Urdu)',
    file: 'letters/REINSTATEMENT.hbs',
    requiredVars: ['reinstatementDate'],
  },
  {
    code: 'REJOINING',
    name: 'Rejoining Letter (Urdu)',
    file: 'letters/REJOINING.hbs',
    requiredVars: ['rejoiningDate'],
  },
  {
    code: 'SALARY_INCREMENT',
    name: 'Salary Increment Notification',
    file: 'letters/SALARY_INCREMENT.hbs',
    requiredVars: ['previousSalary', 'newSalary', 'effectiveDate'],
  },
  {
    code: 'EXPERIENCE',
    name: 'Experience Certificate (Urdu)',
    file: 'letters/EXPERIENCE.hbs',
    requiredVars: ['lastWorkingDate'],
  },
  {
    code: 'EXPLANATION_FINE',
    name: 'Explanation & Fine Letter (Urdu)',
    file: 'letters/EXPLANATION_FINE.hbs',
    requiredVars: ['violations', 'fineAmount', 'deductionMonth'],
    isCustom: true,
    subjectUr: 'تحریری وضاحت طلب و جرمانہ نوٹس',
    enTitle: 'LETTER OF EXPLANATION & FINE',
    letterCode: 'EXF',
    fieldsSchema: [
      { key: 'employeeName', label: 'نام (بجانب)', required: true },
      { key: 'designation', label: 'عہدہ' },
      { key: 'branch', label: 'برانچ / مقام' },
      { key: 'senderTitle', label: 'منجانب' },
      { key: 'adviceLetterNo', label: 'سابقہ Letter of Advice نمبر (اختیاری)' },
      {
        key: 'adviceLetterDate',
        label: 'Letter of Advice تاریخ (اختیاری)',
        type: 'date',
      },
      { key: 'warningLetterNo', label: 'سابقہ Letter of Warning نمبر (اختیاری)' },
      {
        key: 'warningLetterDate',
        label: 'Letter of Warning تاریخ (اختیاری)',
        type: 'date',
      },
      {
        key: 'violations',
        label: 'امور جن پر وضاحت درکار ہے (ہر سطر ایک نکتہ)',
        type: 'textarea',
        required: true,
        hint: 'اردو میں لکھیں — ہر لائن الگ نکتہ بنے گا',
      },
      {
        key: 'responseDeadline',
        label: 'آخری تاریخِ جواب',
        type: 'date',
      },
      {
        key: 'fineAmount',
        label: 'رقم / کٹوتی (مثلاً 500/- یا دو یوم تنخواہ)',
        required: true,
      },
      {
        key: 'deductionMonth',
        label: 'ماہِ کٹوتی',
        required: true,
        hint: 'مثلاً: اگست 2026',
      },
    ],
  },
];

function readTemplate(relativePath: string): string {
  const full = join(__dirname, 'templates', relativePath);
  if (!existsSync(full)) {
    throw new Error(`Letter template file missing: ${full}`);
  }
  return readFileSync(full, 'utf8');
}

export async function seedLetterTemplates(prisma: PrismaClient) {
  for (const tpl of TEMPLATES) {
    const existing = await prisma.letterTemplate.findUnique({
      where: { code: tpl.code },
    });

    // Once a template row exists, the database is the live source of truth —
    // IT staff can edit its wording via the Letter Templates admin UI, and
    // re-running the seed must never clobber those edits with the original
    // .hbs file content.
    if (existing) continue;

    const bodyHtml = readTemplate(tpl.file);
    await prisma.letterTemplate.create({
      data: {
        code: tpl.code,
        name: tpl.name,
        bodyHtml,
        requiredVars: tpl.requiredVars,
        isCustom: tpl.isCustom ?? false,
        subjectUr: tpl.subjectUr,
        enTitle: tpl.enTitle,
        enPrescribed: tpl.enPrescribed,
        enSubtitle: tpl.enSubtitle,
        letterCode: tpl.letterCode,
        fieldsSchema: tpl.fieldsSchema
          ? (tpl.fieldsSchema as unknown as Prisma.InputJsonValue)
          : undefined,
        version: 1,
        active: true,
      },
    });
  }
}
