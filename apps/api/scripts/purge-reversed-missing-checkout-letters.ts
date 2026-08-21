/**
 * Permanently remove reversed missing-checkout letters and re-claim their
 * DisciplineEvent rows so TEMPORARY_AUTO_CHECKOUT=false cannot re-issue
 * letters for those incident dates.
 *
 * Dry-run:
 *   npx ts-node -r tsconfig-paths/register scripts/purge-reversed-missing-checkout-letters.ts
 *
 * Apply:
 *   npx ts-node -r tsconfig-paths/register scripts/purge-reversed-missing-checkout-letters.ts --apply
 */
import {
  DisciplineCategory,
  Prisma,
  PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

type TargetRow = {
  id: string;
  employeeId: string;
  letterType: string;
  letterNo: string | null;
  incidentDate: string | null;
  occurrence: number | null;
};

async function main() {
  const targets = await prisma.$queryRaw<TargetRow[]>`
    SELECT
      id,
      "employeeId",
      "letterType"::text AS "letterType",
      "letterNo",
      variables->>'incidentDate' AS "incidentDate",
      (variables->>'monthlyMissingCheckoutOccurrence')::int AS occurrence
    FROM "Letter"
    WHERE "letterType" IN ('ADVICE', 'WARNING', 'FINE')
      AND (variables->>'monthlyMissingCheckoutOccurrence') IS NOT NULL
      AND COALESCE((variables->>'reversed')::boolean, false) = true
    ORDER BY "generatedAt" DESC
  `;

  console.log(
    APPLY
      ? `APPLY — deleting ${targets.length} reversed missing-checkout letter(s) and ensuring DisciplineEvent claims`
      : `DRY-RUN — ${targets.length} reversed missing-checkout letter(s) would be deleted (pass --apply)`,
  );

  for (const l of targets.slice(0, 12)) {
    console.log(
      `  ${l.letterNo} ${l.letterType} incident=${l.incidentDate} occ=${l.occurrence}`,
    );
  }
  if (targets.length > 12) {
    console.log(`  … +${targets.length - 12} more`);
  }

  if (!APPLY || targets.length === 0) return;

  let deleted = 0;
  let eventsEnsured = 0;
  const ids = targets.map((t) => t.id);

  // Related rows first, then letters in chunks.
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    await prisma.$transaction([
      prisma.letterReply.deleteMany({ where: { letterId: { in: chunk } } }),
      prisma.allegationAcknowledgement.deleteMany({
        where: { letterId: { in: chunk } },
      }),
      prisma.whatsAppLetterSend.deleteMany({
        where: { letterId: { in: chunk } },
      }),
      prisma.letter.deleteMany({ where: { id: { in: chunk } } }),
    ]);
    deleted += chunk.length;
    console.log(`… deleted ${deleted}/${ids.length}`);
  }

  for (const letter of targets) {
    if (
      !letter.incidentDate ||
      !/^\d{4}-\d{2}-\d{2}$/.test(letter.incidentDate)
    ) {
      continue;
    }
    const occurrence = letter.occurrence ?? 1;
    const incidentDate = new Date(`${letter.incidentDate}T00:00:00.000Z`);
    try {
      await prisma.disciplineEvent.create({
        data: {
          employeeId: letter.employeeId,
          category: DisciplineCategory.MISSING_CHECKOUT,
          incidentDate,
          occurrence,
        },
      });
      eventsEnsured++;
    } catch (err) {
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError) ||
        err.code !== 'P2002'
      ) {
        throw err;
      }
    }
  }

  console.log({ deleted, eventsEnsured });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
