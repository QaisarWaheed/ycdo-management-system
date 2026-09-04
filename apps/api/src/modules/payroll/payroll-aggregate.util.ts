import { PayrollStatus } from '@prisma/client';
import { roundMoney } from './payroll-hours.util';

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

export function mergePayrollSegments<T extends PayrollSegmentForAggregate>(
  kept: T[],
): T {
  if (kept.length === 0) {
    throw new Error('Cannot merge empty payroll segment list');
  }
  if (kept.length === 1) return kept[0]!;

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
