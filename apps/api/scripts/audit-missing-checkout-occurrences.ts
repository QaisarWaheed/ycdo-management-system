/**
 * Dry-run audit of MISSING_CHECKOUT DisciplineEvent occurrence ranks.
 *
 * Compares each stored occurrence against the chronological expected rank
 * (incidentDate ASC within employee + Pakistan calendar month).
 *
 * Default: dry-run (report only). Pass --apply to rewrite DisciplineEvent
 * occurrence integers only — does NOT delete events, letters, or attendance.
 *
 * Usage (from apps/api):
 *   npx ts-node -r tsconfig-paths/register scripts/audit-missing-checkout-occurrences.ts
 *   npx ts-node -r tsconfig-paths/register scripts/audit-missing-checkout-occurrences.ts --month 2026-08
 *   npx ts-node -r tsconfig-paths/register scripts/audit-missing-checkout-occurrences.ts --month 2026-08 --apply
 *   npx ts-node -r tsconfig-paths/register scripts/audit-missing-checkout-occurrences.ts --employee YCDO-2026-0388
 */
import { DisciplineCategory, PrismaClient } from '@prisma/client';
import { pakistanMonthWindowFromDate } from '../src/modules/attendance/attendance-calendar.util';
import { renumberMissingCheckoutOccurrencesForMonth } from '../src/modules/attendance/discipline.helper';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

const MONTH = argValue('--month'); // YYYY-MM
const EMPLOYEE_CODE = argValue('--employee');

function monthWindow(label: string): { start: Date; end: Date; label: string } {
  if (!/^\d{4}-\d{2}$/.test(label)) {
    throw new Error(`Invalid --month ${label}; expected YYYY-MM`);
  }
  const [y, m] = label.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, 15));
  const { startOfMonth, endOfMonth } = pakistanMonthWindowFromDate(anchor);
  return { start: startOfMonth, end: endOfMonth, label };
}

async function main() {
  const month = MONTH
    ? monthWindow(MONTH)
    : (() => {
        const now = new Date();
        const y = Number(
          now.toLocaleString('en-US', {
            timeZone: 'Asia/Karachi',
            year: 'numeric',
          }),
        );
        const m = Number(
          now.toLocaleString('en-US', {
            timeZone: 'Asia/Karachi',
            month: '2-digit',
          }),
        );
        return monthWindow(`${y}-${String(m).padStart(2, '0')}`);
      })();

  let employeeFilter: { id?: string; employeeCode?: string } | undefined;
  if (EMPLOYEE_CODE) {
    const emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeCode: EMPLOYEE_CODE },
          { id: EMPLOYEE_CODE },
        ],
      },
      select: { id: true, employeeCode: true, fullName: true },
    });
    if (!emp) {
      throw new Error(`Employee not found: ${EMPLOYEE_CODE}`);
    }
    employeeFilter = { id: emp.id };
    console.log(`Scoped to ${emp.fullName} (${emp.employeeCode})`);
  }

  const events = await prisma.disciplineEvent.findMany({
    where: {
      category: DisciplineCategory.MISSING_CHECKOUT,
      incidentDate: { gte: month.start, lte: month.end },
      ...(employeeFilter?.id ? { employeeId: employeeFilter.id } : {}),
    },
    include: {
      employee: { select: { employeeCode: true, fullName: true } },
    },
    orderBy: [{ employeeId: 'asc' }, { incidentDate: 'asc' }],
  });

  type Row = {
    employeeId: string;
    code: string;
    name: string;
    incidentDate: string;
    current: number;
    expected: number;
    ok: boolean;
  };

  const byEmployee = new Map<string, typeof events>();
  for (const e of events) {
    const list = byEmployee.get(e.employeeId) ?? [];
    list.push(e);
    byEmployee.set(e.employeeId, list);
  }

  const rows: Row[] = [];
  let needsRepair = 0;

  for (const [employeeId, list] of byEmployee) {
    const sorted = [...list].sort(
      (a, b) => a.incidentDate.getTime() - b.incidentDate.getTime(),
    );
    sorted.forEach((e, idx) => {
      const expected = idx + 1;
      const ok = e.occurrence === expected;
      if (!ok) needsRepair++;
      rows.push({
        employeeId,
        code: e.employee.employeeCode,
        name: e.employee.fullName,
        incidentDate: e.incidentDate.toISOString().slice(0, 10),
        current: e.occurrence,
        expected,
        ok,
      });
    });
  }

  console.log(
    `\nMISSING_CHECKOUT occurrence audit — month ${month.label} (${APPLY ? 'APPLY' : 'DRY-RUN'})`,
  );
  console.log(`Events: ${events.length} | Mismatches: ${needsRepair}\n`);

  let lastEmp = '';
  for (const row of rows) {
    if (row.employeeId !== lastEmp) {
      lastEmp = row.employeeId;
      console.log(`\nEmployee: ${row.name} (${row.code})`);
      console.log('Category: MISSING_CHECKOUT');
    }
    console.log(
      [
        row.incidentDate,
        `Current occurrence: ${row.current}`,
        `Expected occurrence: ${row.expected}`,
        row.ok ? 'OK' : 'NEEDS REPAIR',
      ].join('\n'),
    );
    console.log('');
  }

  // Related letters whose stored occurrence may disagree with expected rank.
  const letterMismatches: Array<{
    code: string;
    letterType: string;
    incidentDate: string;
    letterOcc: number;
    expected: number;
    reversed: boolean;
  }> = [];

  for (const row of rows) {
    const letters = await prisma.letter.findMany({
      where: {
        employeeId: row.employeeId,
        letterType: { in: ['ADVICE', 'WARNING', 'FINE'] },
        generatedAt: { gte: month.start },
      },
      select: { letterType: true, variables: true },
    });
    for (const letter of letters) {
      const vars = letter.variables as {
        monthlyMissingCheckoutOccurrence?: number;
        incidentDate?: string;
        reversed?: boolean;
        reversedDueToShortLeave?: boolean;
      } | null;
      if (vars?.monthlyMissingCheckoutOccurrence == null) continue;
      if (vars.incidentDate !== row.incidentDate) continue;
      if (vars.monthlyMissingCheckoutOccurrence !== row.expected) {
        letterMismatches.push({
          code: row.code,
          letterType: letter.letterType,
          incidentDate: row.incidentDate,
          letterOcc: vars.monthlyMissingCheckoutOccurrence,
          expected: row.expected,
          reversed: !!(vars.reversed || vars.reversedDueToShortLeave),
        });
      }
    }
  }

  if (letterMismatches.length > 0) {
    console.log(
      `\nLetters whose monthlyMissingCheckoutOccurrence ≠ expected chronological rank: ${letterMismatches.length}`,
    );
    console.log(
      '(Reported only — script does not rewrite Letter.variables)\n',
    );
    for (const m of letterMismatches.slice(0, 50)) {
      console.log(
        `${m.code} ${m.incidentDate} ${m.letterType} letterOcc=${m.letterOcc} expected=${m.expected}${m.reversed ? ' [REVERSED]' : ''}`,
      );
    }
    if (letterMismatches.length > 50) {
      console.log(`... and ${letterMismatches.length - 50} more`);
    }
  }

  if (APPLY && needsRepair > 0) {
    console.log(
      `\nAPPLY: renumbering DisciplineEvent.occurrence for ${byEmployee.size} employee(s)...`,
    );
    for (const employeeId of byEmployee.keys()) {
      await prisma.$transaction(async (tx) => {
        await renumberMissingCheckoutOccurrencesForMonth(
          tx,
          employeeId,
          month.start,
        );
      });
    }
    console.log('APPLY complete. Re-run without --apply to verify.');
  } else if (!APPLY && needsRepair > 0) {
    console.log(
      '\nNo DB changes. Re-run with --apply to rewrite DisciplineEvent.occurrence only.',
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
