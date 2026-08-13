/**
 * Force-refresh specific LetterTemplate rows from their current .hbs source
 * files, overwriting whatever content is already in the database.
 *
 * The regular seed (prisma/seeds/letter-templates.seed.ts) intentionally
 * skips rows that already exist, to protect IT-staff edits made through the
 * Letter Templates admin UI. This script is the deliberate override for the
 * one-time case where the .hbs files were rewritten (Warning/Advice/
 * Explanation/Appreciation/Transfer, Aug 2026 official-format rebuild) and
 * that rewrite needs to reach a database that already has rows for those
 * codes from before the rewrite existed.
 *
 * Usage (from apps/api):
 *   npx ts-node -r tsconfig-paths/register scripts/refresh-letter-templates.ts
 *   npx ts-node -r tsconfig-paths/register scripts/refresh-letter-templates.ts --apply
 */
import { PrismaClient } from '@prisma/client';
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
];

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
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
