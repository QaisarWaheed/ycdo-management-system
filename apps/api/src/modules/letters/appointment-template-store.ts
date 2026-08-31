import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  APPOINTMENT_TEMPLATE_CODES,
  appointmentFamilyMeta,
  appointmentTemplateFile,
  isAppointmentTemplateCode,
  isLegacyAppointmentTemplateCode,
} from './appointment-families';

export type AppointmentLetterTemplateRow = {
  code: string;
  bodyHtml: string;
  bodyHtmlEn: string | null;
  requiredVars: string[];
  version: number;
};

type LetterTemplateDb = {
  letterTemplate: {
    findFirst: (args: unknown) => Promise<any>;
    create: (args: unknown) => Promise<AppointmentLetterTemplateRow>;
  };
};

function templateFilePath(relativeFile: string): string | null {
  const candidates = [
    join(process.cwd(), 'prisma', 'seeds', 'templates', relativeFile),
    join(
      __dirname,
      '..',
      '..',
      '..',
      'prisma',
      'seeds',
      'templates',
      relativeFile,
    ),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

function readAppointmentBody(code: string): string {
  const relative = appointmentTemplateFile(code);
  const full = templateFilePath(relative);
  if (!full) {
    throw new Error(
      `Appointment template file missing for ${code} (${relative})`,
    );
  }
  return readFileSync(full, 'utf8');
}

export async function loadOrCreateAppointmentLetterTemplate(
  db: LetterTemplateDb,
  code: string,
): Promise<AppointmentLetterTemplateRow> {
  const existing = await db.letterTemplate.findFirst({
    where: { code, active: true },
    select: {
      code: true,
      bodyHtml: true,
      bodyHtmlEn: true,
      requiredVars: true,
      version: true,
    },
  });
  if (existing) return existing;

  const meta = appointmentFamilyMeta(code);
  if (
    !meta ||
    (!isAppointmentTemplateCode(code) && !isLegacyAppointmentTemplateCode(code))
  ) {
    throw new Error(`Unknown Appointment template ${code}`);
  }

  const bodyHtml = readAppointmentBody(code);
  try {
    return await db.letterTemplate.create({
      data: {
        code,
        name: meta.name,
        bodyHtml,
        requiredVars: ['stipendAmount'],
        version: 1,
        active: true,
      },
      select: {
        code: true,
        bodyHtml: true,
        bodyHtmlEn: true,
        requiredVars: true,
        version: true,
      },
    });
  } catch (err) {
    const prismaCode =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code)
        : '';
    if (prismaCode === 'P2002') {
      const raced = await db.letterTemplate.findFirst({
        where: { code, active: true },
        select: {
          code: true,
          bodyHtml: true,
          bodyHtmlEn: true,
          requiredVars: true,
          version: true,
        },
      });
      if (raced) return raced;
    }
    throw err;
  }
}

export async function ensureAppointmentFamilyTemplates(
  db: LetterTemplateDb,
): Promise<{ created: string[] }> {
  const created: string[] = [];
  for (const code of APPOINTMENT_TEMPLATE_CODES) {
    const existing = await db.letterTemplate.findFirst({
      where: { code, active: true },
      select: { id: true },
    });
    if (existing) continue;
    await loadOrCreateAppointmentLetterTemplate(db, code);
    created.push(code);
  }
  return { created };
}
