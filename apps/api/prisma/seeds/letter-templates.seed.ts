import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function seedLetterTemplates(prisma: PrismaClient) {
  const bodyHtml = readFileSync(
    join(__dirname, 'templates', 'selection-letter.hbs'),
    'utf8',
  );

  await prisma.letterTemplate.upsert({
    where: { code: 'SELECTION_LETTER' },
    update: {},
    create: {
      code: 'SELECTION_LETTER',
      name: 'Appointment / Selection Letter',
      bodyHtml,
      requiredVars: ['stipendAmount', 'hoursPerDay', 'shiftName', 'capacity'],
      version: 1,
    },
  });
}
