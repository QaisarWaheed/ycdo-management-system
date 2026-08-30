import { Prisma, PrismaClient } from '@prisma/client';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  APPOINTMENT_TEMPLATE_CODES,
  LEGACY_APPOINTMENT_TEMPLATE_CODES,
  appointmentFamilyMeta,
  appointmentTemplateFile,
} from '../../src/modules/letters/appointment-families';
import { seedAppointmentTemplateMappings } from './appointment-mappings.seed';

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
    code: 'APPOINTMENT_FIXTURE_EN',
    name: 'Appointment Letter fixture (English)',
    file: 'letters/APPOINTMENT_FIXTURE_EN.hbs',
    requiredVars: [],
  },
  {
    code: 'APPOINTMENT_FIXTURE_UR',
    name: 'Appointment Letter fixture (Urdu)',
    file: 'letters/APPOINTMENT_FIXTURE_UR.hbs',
    requiredVars: [],
  },
  ...APPOINTMENT_TEMPLATE_CODES.map((code) => ({
    code,
    name: appointmentFamilyMeta(code)!.name,
    file: appointmentTemplateFile(code),
    requiredVars: ['stipendAmount'],
  })),
  ...LEGACY_APPOINTMENT_TEMPLATE_CODES.map((code) => ({
    code,
    name: appointmentFamilyMeta(code)!.name,
    file: appointmentTemplateFile(code),
    requiredVars: ['stipendAmount'],
  })),
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
    code: 'SUSPENSION_ELIGIBILITY',
    name: 'Eligibility for Suspension Notice (Urdu)',
    file: 'letters/SUSPENSION_ELIGIBILITY.hbs',
    requiredVars: [],
    subjectUr: 'اہلیت برائے معطلی بابت مسلسل خلاف ورزیاں',
    enTitle: 'اہلیت برائے معطلی',
    letterCode: 'SEL',
  },
  {
    code: 'NEAR_SUSPENSION_WARNING',
    name: 'Near Suspension Warning Notice (Urdu)',
    file: 'letters/NEAR_SUSPENSION_WARNING.hbs',
    requiredVars: [],
    subjectUr: 'مسلسل خلاف ورزیوں بابت تنبیہی نوٹس',
    enTitle: 'تنبیہی نوٹس برائے ممکنہ معطلی',
    letterCode: 'NSW',
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
    // First-class letter type (LetterType.EXPLANATION_FINE) selectable from
    // the Generate Letter wizard's type grid — not an IT-authored "Custom"
    // template, so isCustom/fieldsSchema are intentionally omitted; its field
    // list lives in apps/hrms/src/lib/letterFieldConfig.ts like every other
    // built-in Urdu type.
    code: 'EXPLANATION_FINE',
    name: 'Explanation & Fine Letter (Urdu)',
    file: 'letters/EXPLANATION_FINE.hbs',
    requiredVars: ['violations', 'fineAmount', 'deductionMonth'],
    subjectUr: 'تحریری وضاحت طلب و جرمانہ نوٹس',
    enTitle: 'LETTER OF EXPLANATION & FINE',
    letterCode: 'EXF',
  },
  {
    code: 'WARNING_FINE',
    name: 'Warning & Fine Letter (Urdu)',
    file: 'letters/WARNING_FINE.hbs',
    requiredVars: ['violations', 'fineAmount', 'deductionMonth'],
    isCustom: true,
    subjectUr: 'وارننگ و جرمانہ نوٹس',
    enTitle: 'LETTER OF WARNING & FINE',
    letterCode: 'WNF',
    fieldsSchema: [
      { key: 'employeeName', label: 'نام (بجانب)', required: true },
      { key: 'designation', label: 'عہدہ' },
      { key: 'branch', label: 'برانچ / مقام' },
      { key: 'senderTitle', label: 'منجانب' },
      {
        key: 'violations',
        label: 'خلاف ورزیاں (ہر سطر ایک نکتہ)',
        type: 'textarea',
        required: true,
        hint: 'اردو میں لکھیں — ہر لائن الگ نکتہ بنے گا',
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

    const isAppointmentFamily = tpl.code.startsWith('APPT_');
    const bodyHtml = readTemplate(tpl.file);

    if (existing && !isAppointmentFamily) {
      // Once a non-appointment template row exists, the database is the live
      // source of truth — IT staff can edit wording via Letter Templates.
      continue;
    }

    if (existing && isAppointmentFamily) {
      await prisma.letterTemplate.update({
        where: { code: tpl.code },
        data: {
          name: tpl.name,
          bodyHtml,
          requiredVars: tpl.requiredVars,
          active: true,
        },
      });
      continue;
    }

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

  await prisma.letterTemplate.updateMany({
    where: {
      code: { in: ['APPOINTMENT_FIXTURE_EN', 'APPOINTMENT_FIXTURE_UR'] },
    },
    data: { active: false },
  });

  await seedAppointmentTemplateMappings(prisma);
}
