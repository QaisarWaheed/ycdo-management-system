import { AllowanceProration, Prisma } from '@prisma/client';

/**
 * First payroll month whose package allowances come from EmployeeAllowance
 * rows instead of the four fixed StipendRecord columns. Earlier months keep
 * the old columns, so no month is ever calculated two ways.
 */
export const PACKAGE_ALLOWANCES_FROM = { year: 2026, month: 11 } as const;

export function usesAllowanceTable(year: number, month: number): boolean {
  return (
    year * 12 + month >=
    PACKAGE_ALLOWANCES_FROM.year * 12 + PACKAGE_ALLOWANCES_FROM.month
  );
}

/** First day of the month, UTC (matches the @db.Date month columns). */
export function monthStartUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

export function monthKey(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth() + 1;
}

export function isActiveInMonth(
  row: { startMonth: Date; endMonth: Date | null },
  year: number,
  month: number,
): boolean {
  const key = year * 12 + month;
  return (
    monthKey(row.startMonth) <= key &&
    (row.endMonth == null || monthKey(row.endMonth) >= key)
  );
}

/**
 * Req 4: share of `year`/`month` an allowance or incentive covers, by calendar
 * days. startDay applies only in its first month and endDay only in its last;
 * 1 = whole month (also when no days are set).
 */
export function monthCoverage(
  range: {
    startKey: number;
    startDay?: number | null;
    endKey?: number | null;
    endDay?: number | null;
  },
  year: number,
  month: number,
): number {
  const key = year * 12 + month;
  if (key < range.startKey || (range.endKey != null && key > range.endKey)) return 0;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const first = key === range.startKey && range.startDay ? range.startDay : 1;
  const last =
    key === range.endKey && range.endDay ? Math.min(range.endDay, days) : days;
  return Math.max(0, last - first + 1) / days;
}

/** monthCoverage for an EmployeeAllowance row. */
export function allowanceCoverage(
  row: { startMonth: Date; endMonth: Date | null; startDay?: number | null; endDay?: number | null },
  year: number,
  month: number,
): number {
  return monthCoverage(
    {
      startKey: monthKey(row.startMonth),
      startDay: row.startDay,
      endKey: row.endMonth ? monthKey(row.endMonth) : null,
      endDay: row.endDay,
    },
    year,
    month,
  );
}

export type PackageAllowanceRow = {
  name: string;
  proration: AllowanceProration;
  amount: number;
  sortOrder?: number;
  /** Req 4: share of the month covered (start / end mid-month); default 1. */
  coverage?: number;
};

export type PackageAllowanceLine = { label: string; amount: number };

/**
 * Month amounts for an employee's package allowances.
 * - FULL_MONTH types are prorated together exactly like the old package sum
 *   (`prorate` = the existing employment-days proration), then split per line
 *   with the rounding remainder on the largest line, so the total is identical
 *   to the old formula for the same amounts.
 * - ATTENDANCE types pay amount × paidDays ÷ calendarDays, like Basic.
 */
export function computePackageAllowanceLines(
  rows: PackageAllowanceRow[],
  opts: {
    prorate: (monthlyAmount: number) => number;
    paidDays: number;
    calendarDays: number;
  },
): { lines: PackageAllowanceLine[]; total: number } {
  const sorted = [...rows].sort(
    (a, b) =>
      (a.sortOrder ?? 100) - (b.sortOrder ?? 100) ||
      a.name.localeCompare(b.name),
  );
  const partial = (r: PackageAllowanceRow) => r.coverage != null && r.coverage < 1;
  const full = sorted.filter(
    (r) => r.proration === AllowanceProration.FULL_MONTH && !partial(r),
  );
  // Req 4: a FULL_MONTH allowance starting / ending mid-month pays its calendar
  // days. ponytail: capped by the employment proration rather than intersecting
  // both ranges exactly; it never overpays, and a same-month join + mid-month
  // allowance start is rare.
  const partialLines = sorted
    .filter((r) => r.proration === AllowanceProration.FULL_MONTH && partial(r))
    .map((r) => ({
      label: r.name,
      amount: Math.min(Math.round(r.amount * r.coverage!), opts.prorate(r.amount)),
    }));
  const byAttendance = sorted.filter(
    (r) => r.proration === AllowanceProration.ATTENDANCE,
  );

  const fullSum = full.reduce((s, r) => s + r.amount, 0);
  const fullTotal = fullSum > 0 ? opts.prorate(fullSum) : 0;
  const fullLines = full.map((r) => ({
    label: r.name,
    amount: fullSum > 0 ? Math.round((r.amount * fullTotal) / fullSum) : 0,
  }));
  const remainder = fullTotal - fullLines.reduce((s, l) => s + l.amount, 0);
  if (remainder !== 0 && fullLines.length > 0) {
    const largest = fullLines.reduce((a, b) => (b.amount > a.amount ? b : a));
    largest.amount += remainder;
  }

  const attendanceLines = byAttendance.map((r) => ({
    label: r.name,
    amount:
      opts.calendarDays > 0
        ? Math.round(
            (r.amount * (r.coverage ?? 1) * opts.paidDays) / opts.calendarDays,
          )
        : 0,
  }));

  const lines = [...fullLines, ...partialLines, ...attendanceLines].filter(
    (l) => l.amount !== 0,
  );
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

/**
 * A new hire's package fields (Allowances, Reward, Reward On Progress, Petrol)
 * also become allowance rows, from the later of their joining month and the
 * cut-over month, so November onward pays them the same.
 */
export async function seedLegacyPackageAllowances(
  tx: Prisma.TransactionClient,
  employeeId: string,
  amounts: Partial<
    Record<
      'allowances' | 'reward' | 'progressReward' | 'fuelAllowance',
      number | null
    >
  >,
  joiningDate: Date,
) {
  const joinKey =
    joiningDate.getUTCFullYear() * 12 + joiningDate.getUTCMonth() + 1;
  const cutKey =
    PACKAGE_ALLOWANCES_FROM.year * 12 + PACKAGE_ALLOWANCES_FROM.month;
  const key = Math.max(joinKey, cutKey);
  const year = Math.floor((key - 1) / 12);
  const startMonth = monthStartUtc(year, key - year * 12);
  const types = await tx.payAllowanceType.findMany({
    where: { legacyField: { not: null } },
  });
  const rows = types
    .map((t) => ({
      t,
      amount: Number(amounts[t.legacyField as keyof typeof amounts] ?? 0),
    }))
    .filter(({ amount }) => amount > 0)
    .map(({ t, amount }) => ({
      employeeId,
      typeId: t.id,
      amount,
      startMonth,
      note: 'From joining package',
    }));
  if (rows.length) await tx.employeeAllowance.createMany({ data: rows });
}

/**
 * Until the cut-over month arrives, the old four package fields are still
 * what HR edits; keep the copied cut-over rows equal to the open package so
 * November starts from the latest amounts. After the cut-over the allowance
 * table is the only source and this does nothing.
 */
export async function syncLegacyAllowanceRows(
  tx: Prisma.TransactionClient,
  employeeId: string,
  now: Date = new Date(),
) {
  if (usesAllowanceTable(now.getUTCFullYear(), now.getUTCMonth() + 1)) return;
  const open = await tx.stipendRecord.findFirst({
    where: { employeeId, effectiveTo: null },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!open) return;
  const startMonth = monthStartUtc(
    PACKAGE_ALLOWANCES_FROM.year,
    PACKAGE_ALLOWANCES_FROM.month,
  );
  const types = await tx.payAllowanceType.findMany({
    where: { legacyField: { not: null } },
  });
  for (const t of types) {
    const amount = Number(
      open[
        t.legacyField as
          | 'allowances'
          | 'reward'
          | 'progressReward'
          | 'fuelAllowance'
      ] ?? 0,
    );
    const row = await tx.employeeAllowance.findFirst({
      where: { employeeId, typeId: t.id, startMonth },
    });
    if (amount > 0 && row) {
      if (Number(row.amount) !== amount) {
        await tx.employeeAllowance.update({
          where: { id: row.id },
          data: { amount },
        });
      }
    } else if (amount > 0) {
      await tx.employeeAllowance.create({
        data: {
          employeeId,
          typeId: t.id,
          amount,
          startMonth,
          note: 'Copied from package on switch-over',
        },
      });
    } else if (row) {
      await tx.employeeAllowance.delete({ where: { id: row.id } });
    }
  }
}
