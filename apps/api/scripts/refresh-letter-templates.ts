/**
 * Force-refresh specific LetterTemplate rows from their current .hbs source
 * files (and, for one row, a stored header field), overwriting whatever
 * content is already in the database.
 *
 * The regular seed (prisma/seeds/letter-templates.seed.ts) intentionally
 * skips rows that already exist, to protect IT-staff edits made through the
 * Letter Templates admin UI. This script is the deliberate override for the
 * one-time cases where source content was rewritten but a database already
 * has rows for those codes from before the rewrite existed:
 *
 *  - Warning/Advice/Explanation/Appreciation/Transfer .hbs bodies were
 *    rewritten to match the official paper letters (Aug 2026).
 *  - The shared letter header/title design (bismillah, office letterhead,
 *    "LETTER OF X" title) moved from a "Notification / Prescribed X" shell
 *    to match the official format. For the 14 built-in Urdu types this is a
 *    pure code change (the header is a Handlebars partial, not stored in
 *    the row) and needs no data fix. EXPLANATION_FINE is the one exception:
 *    it's a custom-type row seeded with an explicit enTitle, which
 *    overrides the code-level fallback, so its enTitle needs a one-time fix
 *    here too.
 *  - EXPLANATION_FINE was promoted from an IT-authored "Custom" template to
 *    a first-class LetterType (selectable from the Generate Letter wizard's
 *    type grid, like every other built-in type). Its row was originally
 *    seeded with isCustom=true/fieldsSchema set, which the regular seed
 *    will never touch on an existing row — flip it here so it no longer
 *    shows up twice (once as a built-in type, once as a "Custom" template)
 *    in the per-employee Generate Letter dialog.
 *
 * Usage (from apps/api):
 *   npx ts-node -r tsconfig-paths/register scripts/refresh-letter-templates.ts
 *   npx ts-node -r tsconfig-paths/register scripts/refresh-letter-templates.ts --apply
 */
import { Prisma, PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

const CODES_TO_REFRESH = [
  'WARNING',
  'ADVICE',
  'EXPLANATION',
  'APPRECIATION',
  'TRANSFER',
  'FINE',
  'SALARY_INCREMENT',
];

const EN_TITLE_FIXES: Record<string, string> = {
  EXPLANATION_FINE: 'LETTER OF EXPLANATION & FINE',
};

const TPL_DIR = path.join(process.cwd(), 'prisma', 'seeds', 'templates', 'letters');

function readTemplate(code: string): string {
  const full = path.join(TPL_DIR, `${code}.hbs`);
  if (!fs.existsSync(full)) {
    throw new Error(`Letter template file missing: ${full}`);
  }
  return fs.readFileSync(full, 'utf8');
}

async function main() {
  console.log(apply ? 'APPLY mode' : 'DRY-RUN (pass --apply to write)');

  for (const code of CODES_TO_REFRESH) {
    const existing = await prisma.letterTemplate.findUnique({ where: { code } });
    const newBodyHtml = readTemplate(code);

    if (!existing) {
      console.log(`SKIP ${code}: no existing row (regular seed will create it)`);
      continue;
    }

    if (existing.bodyHtml === newBodyHtml) {
      console.log(`OK   ${code}: already matches .hbs source`);
      continue;
    }

    console.log(
      `UPDATE ${code}: bodyHtml differs (db=${existing.bodyHtml.length} chars, file=${newBodyHtml.length} chars), version ${existing.version} -> ${existing.version + 1}`,
    );

    if (apply) {
      await prisma.letterTemplate.update({
        where: { code },
        data: { bodyHtml: newBodyHtml, version: existing.version + 1 },
      });
    }
  }

  for (const [code, newEnTitle] of Object.entries(EN_TITLE_FIXES)) {
    const existing = await prisma.letterTemplate.findUnique({ where: { code } });

    if (!existing) {
      console.log(`SKIP ${code}: no existing row`);
      continue;
    }

    if (existing.enTitle === newEnTitle) {
      console.log(`OK   ${code}: enTitle already "${newEnTitle}"`);
      continue;
    }

    console.log(`UPDATE ${code}: enTitle "${existing.enTitle}" -> "${newEnTitle}"`);

    if (apply) {
      await prisma.letterTemplate.update({
        where: { code },
        data: { enTitle: newEnTitle },
      });
    }
  }

  const NOT_CUSTOM_FIXES = ['EXPLANATION_FINE'];

  for (const code of NOT_CUSTOM_FIXES) {
    const existing = await prisma.letterTemplate.findUnique({ where: { code } });

    if (!existing) {
      console.log(`SKIP ${code}: no existing row`);
      continue;
    }

    if (!existing.isCustom) {
      console.log(`OK   ${code}: isCustom already false`);
      continue;
    }

    console.log(`UPDATE ${code}: isCustom true -> false, clearing fieldsSchema`);

    if (apply) {
      await prisma.letterTemplate.update({
        where: { code },
        data: { isCustom: false, fieldsSchema: Prisma.DbNull },
      });
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
