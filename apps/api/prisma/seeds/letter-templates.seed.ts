import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

type TemplateSeed = {
  code: string;
  name: string;
  file: string;
  requiredVars: string[];
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
    requiredVars: ['adviceReason'],
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
    requiredVars: ['appreciationReason'],
  },
  {
    code: 'TRANSFER',
    name: 'Transfer / Posting Notification (Urdu)',
    file: 'letters/TRANSFER.hbs',
    requiredVars: ['fromBranch', 'toBranch', 'effectiveDate'],
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
    name: 'Salary Increment Notification (Urdu)',
    file: 'letters/SALARY_INCREMENT.hbs',
    requiredVars: ['previousSalary', 'newSalary', 'effectiveDate'],
  },
  {
    code: 'EXPERIENCE',
    name: 'Experience Certificate (Urdu)',
    file: 'letters/EXPERIENCE.hbs',
    requiredVars: ['lastWorkingDate'],
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
    const bodyHtml = readTemplate(tpl.file);
    const existing = await prisma.letterTemplate.findUnique({
      where: { code: tpl.code },
    });

    if (existing) {
      await prisma.letterTemplate.update({
        where: { code: tpl.code },
        data: {
          name: tpl.name,
          bodyHtml,
          requiredVars: tpl.requiredVars,
          active: true,
          version: existing.version + 1,
        },
      });
    } else {
      await prisma.letterTemplate.create({
        data: {
          code: tpl.code,
          name: tpl.name,
          bodyHtml,
          requiredVars: tpl.requiredVars,
          version: 1,
          active: true,
        },
      });
    }
  }
}
