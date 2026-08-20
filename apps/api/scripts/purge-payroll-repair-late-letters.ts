/**
 * Remove late-discipline letters that were mass-created by payroll generate
 * repair (historical incident days all stamped with today's issue date).
 *
 * Keeps:
 *   - Payroll LATE_ARRIVAL fine deductions
 *   - DisciplineEvent rows
 *   - Late letters whose incidentDate is the SAME calendar day they were
 *     generated (real-time lateness that day)
 *
 * Deletes:
 *   - ADVICE / WARNING / FINE / SUSPENSION letters with monthlyLateOccurrence
 *     that were generated on the given Pakistan day, whose incidentDate is
 *     strictly earlier than that day
 *   - Related letter replies, acknowledgements, WhatsApp send rows
 *
 * Usage (dry-run first — prints counts only):
 *   npx ts-node -r tsconfig-paths/register scripts/purge-payroll-repair-late-letters.ts [YYYY-MM-DD]
 *
 * Apply deletes:
 *   npx ts-node -r tsconfig-paths/register scripts/purge-payroll-repair-late-letters.ts [YYYY-MM-DD] --apply
 *
 * Default generation day: 2026-08-20 (the payroll mass-letter day).
 */
import {
  LetterType,
  PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();

const LATE_LETTER_TYPES: LetterType[] = [
  LetterType.ADVICE,
  LetterType.WARNING,
  LetterType.FINE,
  LetterType.SUSPENSION,
];

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  return {
    apply,
    generationDay: dateArg ?? '2026-08-20',
  };
}

/** Pakistan calendar day [start, end) as UTC instants for generatedAt filter. */
function pakistanDayWindow(dayLabel: string): { start: Date; end: Date } {
  const start = new Date(`${dayLabel}T00:00:00+05:00`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function incidentDateOf(variables: unknown): string | null {
  if (!variables || typeof variables !== 'object') return null;
  const incident = (variables as { incidentDate?: unknown }).incidentDate;
  if (typeof incident !== 'string') return null;
  const trimmed = incident.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function hasMonthlyLateOccurrence(variables: unknown): boolean {
  if (!variables || typeof variables !== 'object') return false;
  return (
    typeof (variables as { monthlyLateOccurrence?: unknown })
      .monthlyLateOccurrence === 'number'
  );
}

async function main() {
  const { apply, generationDay } = parseArgs();
  const { start, end } = pakistanDayWindow(generationDay);

  console.log(
    apply
      ? `APPLY mode — deleting payroll-repair late letters generated on ${generationDay} PKT`
      : `DRY-RUN — listing payroll-repair late letters generated on ${generationDay} PKT (pass --apply to delete)`,
  );
  console.log(`generatedAt window: ${start.toISOString()} .. ${end.toISOString()}\n`);

  const candidates = await prisma.letter.findMany({
    where: {
      letterType: { in: LATE_LETTER_TYPES },
      generatedAt: { gte: start, lt: end },
    },
    select: {
      id: true,
      letterNo: true,
      letterType: true,
      generatedAt: true,
      employeeId: true,
      variables: true,
      employee: { select: { employeeCode: true, fullName: true } },
    },
    orderBy: { generatedAt: 'asc' },
  });

  const toDelete = candidates.filter((letter) => {
    if (!hasMonthlyLateOccurrence(letter.variables)) return false;
    const incident = incidentDateOf(letter.variables);
    // No structured incident date → unsafe to auto-delete.
    if (!incident) return false;
    // Same-day real-time letter — keep.
    if (incident >= generationDay) return false;
    return true;
  });

  const keptSameDay = candidates.length - toDelete.length;

  console.log(`Candidates generated that day (late letter types): ${candidates.length}`);
  console.log(`Kept (same-day / not repair pattern): ${keptSameDay}`);
  console.log(`To delete (historical incidentDate): ${toDelete.length}`);

  const byType = toDelete.reduce(
    (acc, row) => {
      acc[row.letterType] = (acc[row.letterType] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  console.log('By type:', byType);

  if (toDelete.length === 0) {
    console.log('\nNothing to delete.');
    return;
  }

  console.log('\nSample (up to 15):');
  for (const row of toDelete.slice(0, 15)) {
    const incident = incidentDateOf(row.variables);
    console.log(
      `  ${row.letterNo ?? row.id} | ${row.letterType} | incident=${incident} | ${row.employee.employeeCode} ${row.employee.fullName}`,
    );
  }
  if (toDelete.length > 15) {
    console.log(`  … +${toDelete.length - 15} more`);
  }

  if (!apply) {
    console.log('\nDry-run only. Re-run with --apply to delete.');
    return;
  }

  const ids = toDelete.map((row) => row.id);

  const deleted = await prisma.$transaction(async (tx) => {
    await tx.letterReply.deleteMany({ where: { letterId: { in: ids } } });
    await tx.allegationAcknowledgement.deleteMany({
      where: { letterId: { in: ids } },
    });
    // WhatsAppLetterSend cascades on letter delete.
    const result = await tx.letter.deleteMany({ where: { id: { in: ids } } });
    return result.count;
  });

  console.log(`\nDeleted ${deleted} letter(s). Payroll fine deductions were not touched.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
