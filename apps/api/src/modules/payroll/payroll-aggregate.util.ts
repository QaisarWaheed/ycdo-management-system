import { AllowanceType, PayrollStatus } from '@prisma/client';
import { roundMoney } from './payroll-hours.util';
import { isManualDeduction } from './manual-deduction.util';

/** Snap any calendar date to the 1st of that UTC month (stipend date-only convention). */
export function toUtcMonthStart(date: Date): Date {
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date');
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export type PayrollSegmentForAggregate = {
  id: string;
  month: number;
  year: number;
  basicStipend: unknown;
  totalAllowances: unknown;
  totalDeductions: unknown;
  netStipend: unknown;
  status: PayrollStatus;
  stipendRecord?: {
    employeeId?: string;
    employee?: { id?: string } | null;
    effectiveFrom?: Date;
    effectiveTo?: Date | null;
  } | null;
  deductions?: unknown[];
  allowances?: unknown[];
  forcedNonActive?: boolean;
  attendance?: unknown;
};

function employeeKey(entry: PayrollSegmentForAggregate): string {
  return (
    entry.stipendRecord?.employee?.id ??
    entry.stipendRecord?.employeeId ??
    entry.id
  );
}

function statusRank(s: PayrollStatus): number {
  return s === PayrollStatus.PAID ? 3 : s === PayrollStatus.PROCESSED ? 2 : 1;
}

/**
 * Keep real mid-month increment segments; drop leftover closed packages that
 * started on/after the newest open package. Same rules as profile history.
 */
export function keepPayrollSegmentsForMonth<T extends PayrollSegmentForAggregate>(
  group: T[],
): T[] {
  const active = group
    .filter((e) => e.stipendRecord?.effectiveTo == null)
    .sort(
      (a, b) =>
        (a.stipendRecord?.effectiveFrom?.getTime() ?? 0) -
        (b.stipendRecord?.effectiveFrom?.getTime() ?? 0),
    );
  const newestActive = active[active.length - 1];
  const newestActiveFrom = newestActive?.stipendRecord?.effectiveFrom;

  return group.filter((e) => {
    const sr = e.stipendRecord;
    if (!sr) return true;
    if (sr.effectiveTo == null) {
      return !newestActive || e.id === newestActive.id;
    }
    if (
      newestActiveFrom &&
      sr.effectiveFrom &&
      sr.effectiveFrom.getTime() >= newestActiveFrom.getTime()
    ) {
      return false;
    }
    return true;
  });
}

/** Does this entry's stipend package overlap the entry's own calendar month? */
export function packageCoversEntryMonth(entry: PayrollSegmentForAggregate): boolean {
  const sr = entry.stipendRecord;
  if (!sr) return true;
  const monthStart = Date.UTC(entry.year, entry.month - 1, 1);
  const nextMonthStart = Date.UTC(entry.year, entry.month, 1);
  if (sr.effectiveTo && sr.effectiveTo.getTime() <= monthStart) return false;
  if (sr.effectiveFrom && sr.effectiveFrom.getTime() >= nextMonthStart) return false;
  return true;
}

type MoneyRow = { amount?: unknown; type?: string; reason?: string; description?: string | null };

/**
 * A leftover entry on a package that no longer covers the month (e.g. the old
 * package after a day-1 increment) keeps only what HR/Finance entered by hand:
 * manual deductions and incentive (CUSTOM) allowances. Its basic, package
 * components and attendance-generated items are already on the current entry.
 * Nothing is deleted — this only affects how the month is added up.
 */
function manualOnly<T extends PayrollSegmentForAggregate>(entry: T): T {
  const allowances = ((entry.allowances ?? []) as MoneyRow[]).filter(
    (a) => a.type === AllowanceType.CUSTOM,
  );
  const deductions = ((entry.deductions ?? []) as MoneyRow[]).filter((d) =>
    isManualDeduction({ reason: d.reason, description: d.description }),
  );
  const totalAllowances = roundMoney(
    allowances.reduce((sum, a) => sum + Number(a.amount ?? 0), 0),
  );
  const totalDeductions = roundMoney(
    deductions.reduce((sum, d) => sum + Number(d.amount ?? 0), 0),
  );
  return {
    ...entry,
    basicStipend: 0,
    allowances,
    deductions,
    totalAllowances,
    totalDeductions,
    netStipend: roundMoney(totalAllowances - totalDeductions),
  };
}

export function mergePayrollSegments<T extends PayrollSegmentForAggregate>(
  segments: T[],
): T {
  if (segments.length === 0) {
    throw new Error('Cannot merge empty payroll segment list');
  }
  if (segments.length === 1) return segments[0]!;

  const anyCovering = segments.some(packageCoversEntryMonth);
  const kept = anyCovering
    ? segments.map((e) => (packageCoversEntryMonth(e) ? e : manualOnly(e)))
    : segments;

  const primary =
    kept.find((e) => e.stipendRecord?.effectiveTo == null) ?? kept[0]!;

  return {
    ...primary,
    basicStipend: roundMoney(
      kept.reduce((sum, e) => sum + Number(e.basicStipend), 0),
    ),
    totalAllowances: roundMoney(
      kept.reduce((sum, e) => sum + Number(e.totalAllowances), 0),
    ),
    totalDeductions: roundMoney(
      kept.reduce((sum, e) => sum + Number(e.totalDeductions), 0),
    ),
    netStipend: roundMoney(
      kept.reduce((sum, e) => sum + Number(e.netStipend), 0),
    ),
    status: kept.reduce<T>(
      (best, e) => (statusRank(e.status) > statusRank(best.status) ? e : best),
      kept[0]!,
    ).status,
    deductions: kept.flatMap((e) => e.deductions ?? []),
    allowances: kept.flatMap((e) => e.allowances ?? []),
    forcedNonActive: kept.some((e) => e.forcedNonActive === true),
  };
}

/** One history row per calendar month (single employee). */
export function aggregatePayrollHistoryByMonth<
  T extends PayrollSegmentForAggregate,
>(entries: T[]): T[] {
  const byMonth = new Map<string, T[]>();
  for (const entry of entries) {
    const key = `${entry.year}-${entry.month}`;
    const bucket = byMonth.get(key) ?? [];
    bucket.push(entry);
    byMonth.set(key, bucket);
  }

  const merged: T[] = [];
  for (const group of byMonth.values()) {
    const kept = keepPayrollSegmentsForMonth(group);
    if (kept.length === 0) continue;
    merged.push(mergePayrollSegments(kept));
  }

  return merged.sort((a, b) =>
    a.year !== b.year ? b.year - a.year : b.month - a.month,
  );
}

/**
 * Monthly Payroll list: one row per employee for a filtered month
 * (same money as profile Payroll History for that month).
 */
export function aggregateMonthlyPayrollByEmployee<
  T extends PayrollSegmentForAggregate,
>(entries: T[]): T[] {
  const byEmployee = new Map<string, T[]>();
  for (const entry of entries) {
    const key = employeeKey(entry);
    const bucket = byEmployee.get(key) ?? [];
    bucket.push(entry);
    byEmployee.set(key, bucket);
  }

  const merged: T[] = [];
  for (const group of byEmployee.values()) {
    const kept = keepPayrollSegmentsForMonth(group);
    if (kept.length === 0) continue;
    merged.push(mergePayrollSegments(kept));
  }

  return merged.sort((a, b) => {
    const nameA =
      (a.stipendRecord as { employee?: { fullName?: string } } | undefined)
        ?.employee?.fullName ?? '';
    const nameB =
      (b.stipendRecord as { employee?: { fullName?: string } } | undefined)
        ?.employee?.fullName ?? '';
    const byName = nameA.localeCompare(nameB);
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });
}
