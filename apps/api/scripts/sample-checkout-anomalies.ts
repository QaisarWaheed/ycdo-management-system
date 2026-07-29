/**
 * Sample non-overnight checkOut < checkIn anomalies (read-only).
 * Usage (from apps/api):
 *   DATABASE_URL=... npx ts-node scripts/sample-checkout-anomalies.ts
 */
import { PrismaClient } from '@prisma/client';
import { getDutyWindow } from '../src/common/duty.util';

const prisma = new PrismaClient();
const SAMPLE = 15;

function looksAmPm(value: string | null | undefined): boolean {
  return !!value && /\b(AM|PM)\b/i.test(value);
}

async function main() {
  const ampmStarts = await prisma.$queryRaw<{ dutyStartTime: string }[]>`
    SELECT DISTINCT "dutyStartTime"
    FROM "Employee"
    WHERE "dutyStartTime" IS NOT NULL
      AND ("dutyStartTime" ILIKE '%AM%' OR "dutyStartTime" ILIKE '%PM%')
    LIMIT 20
  `;
  const ampmEnds = await prisma.$queryRaw<{ dutyEndTime: string }[]>`
    SELECT DISTINCT "dutyEndTime"
    FROM "Employee"
    WHERE "dutyEndTime" IS NOT NULL
      AND ("dutyEndTime" ILIKE '%AM%' OR "dutyEndTime" ILIKE '%PM%')
    LIMIT 20
  `;
  console.log('=== AM/PM duty formats in Employee ===');
  console.log('dutyStartTime AM/PM samples:', ampmStarts);
  console.log('dutyEndTime AM/PM samples:', ampmEnds);

  const allFormats = await prisma.$queryRaw<{ v: string }[]>`
    SELECT DISTINCT "dutyStartTime" AS v FROM "Employee" WHERE "dutyStartTime" IS NOT NULL
    UNION
    SELECT DISTINCT "dutyEndTime" AS v FROM "Employee" WHERE "dutyEndTime" IS NOT NULL
    ORDER BY v
    LIMIT 80
  `;
  console.log('=== Distinct duty time strings (sample) ===');
  console.log(allFormats.map((r) => r.v));

  const rows = await prisma.attendanceLog.findMany({
    where: {
      checkIn: { not: null },
      checkOut: { not: null },
      type: 'REGULAR',
    },
    include: {
      employee: {
        select: {
          employeeCode: true,
          fullName: true,
          dutyStartTime: true,
          dutyEndTime: true,
        },
      },
    },
    orderBy: { date: 'asc' },
  });

  type Anomaly = {
    id: string;
    code: string;
    name: string;
    date: string;
    checkIn: string;
    checkOut: string;
    duty: string;
    crossesMidnight: boolean | null;
    source: string;
    note: string | null;
    deltaMin: number;
  };

  const nonOvernight: Anomaly[] = [];
  const overnight: Anomaly[] = [];

  for (const row of rows) {
    if (!row.checkIn || !row.checkOut) continue;
    const delta = Math.round(
      (row.checkOut.getTime() - row.checkIn.getTime()) / 60000,
    );
    if (delta >= 0) continue;

    const win = (() => {
      try {
        return getDutyWindow(row.employee);
      } catch {
        return null;
      }
    })();

    const item: Anomaly = {
      id: row.id,
      code: row.employee.employeeCode,
      name: row.employee.fullName,
      date: row.date.toISOString().slice(0, 10),
      checkIn: row.checkIn.toISOString(),
      checkOut: row.checkOut.toISOString(),
      duty: `${row.employee.dutyStartTime ?? '—'}→${row.employee.dutyEndTime ?? '—'}`,
      crossesMidnight: win?.crossesMidnight ?? null,
      source: row.source,
      note: row.note,
      deltaMin: delta,
    };

    if (win?.crossesMidnight) overnight.push(item);
    else nonOvernight.push(item);
  }

  console.log(`\n=== Totals ===`);
  console.log(`Overnight (cross-midnight duty): ${overnight.length}`);
  console.log(`Non-overnight checkOut < checkIn: ${nonOvernight.length}`);

  if (nonOvernight.length === 0) {
    console.log('No non-overnight anomalies found.');
    return;
  }

  const dates = nonOvernight.map((a) => a.date).sort();
  console.log(`Date range: ${dates[0]} → ${dates[dates.length - 1]}`);

  const byMonth = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byNoteKind = new Map<string, number>();
  for (const a of nonOvernight) {
    const m = a.date.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
    bySource.set(a.source, (bySource.get(a.source) ?? 0) + 1);
    let kind = 'none';
    if (a.note?.includes('Auto-checked out')) kind = 'auto-checkout';
    else if (a.note?.includes('import') || a.note?.includes('CSV')) kind = 'csv-import';
    else if (a.note) kind = 'other-note';
    byNoteKind.set(kind, (byNoteKind.get(kind) ?? 0) + 1);
  }
  console.log('By month:', Object.fromEntries([...byMonth.entries()].sort()));
  console.log('By source:', Object.fromEntries(bySource));
  console.log('By note kind:', Object.fromEntries(byNoteKind));

  // Spread sample across months if possible
  const sample: Anomaly[] = [];
  const months = [...byMonth.keys()].sort();
  let i = 0;
  while (sample.length < SAMPLE && i < nonOvernight.length * 2) {
    const month = months[i % months.length];
    const candidate = nonOvernight.find(
      (a) => a.date.startsWith(month) && !sample.includes(a),
    );
    if (candidate) sample.push(candidate);
    i += 1;
    if (i > 200) break;
  }
  while (sample.length < SAMPLE && sample.length < nonOvernight.length) {
    const next = nonOvernight.find((a) => !sample.includes(a));
    if (!next) break;
    sample.push(next);
  }

  console.log(`\n=== Sample of ${sample.length} non-overnight anomalies ===`);
  for (const a of sample) {
    console.log(
      `${a.code} | ${a.name} | date=${a.date} | delta=${a.deltaMin}m | duty=${a.duty} | crosses=${a.crossesMidnight} | source=${a.source} | note=${a.note ?? '—'}`,
    );
    console.log(`  in=${a.checkIn} out=${a.checkOut}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
