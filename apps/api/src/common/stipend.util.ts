export interface StipendPackageInput {
  basicStipend: number;
  allowances?: number;
  reward?: number;
  progressReward?: number;
  fuelAllowance?: number;
  loanDeduction?: number;
  advanceDeduction?: number;
  fineDeduction?: number;
  healthDeduction?: number;
}

export function calculateLumpsumTotal(values: StipendPackageInput): number {
  return (
    (values.basicStipend || 0) +
    (values.allowances || 0) +
    (values.reward || 0) +
    (values.progressReward || 0) +
    (values.fuelAllowance || 0) -
    (values.loanDeduction || 0) -
    (values.advanceDeduction || 0) -
    (values.fineDeduction || 0) -
    (values.healthDeduction || 0)
  );
}

/**
 * Actual calendar days in a given (1-indexed) month/year — the single
 * source of truth for daily-rate payroll calculations across every module.
 * Never assume 30; February, and 31-day months, must use their real count.
 */
export function daysInPayrollMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * One day's worth of a stipend, using the actual number of calendar days in
 * the month the given business-event date falls in (not the server's
 * current month, not a fixed 30-day assumption). Used wherever a
 * disciplinary or absence deduction is expressed as "N days' pay".
 */
export function dailyStipendRate(basicStipend: number, date: Date): number {
  if (basicStipend <= 0) return 0;
  const days = daysInPayrollMonth(date.getFullYear(), date.getMonth() + 1);
  if (days <= 0) return 0;
  return basicStipend / days;
}

export function stipendRecordToPackage(record: {
  basicStipend: unknown;
  allowances?: unknown;
  reward?: unknown;
  progressReward?: unknown;
  fuelAllowance?: unknown;
  loanDeduction?: unknown;
  advanceDeduction?: unknown;
  fineDeduction?: unknown;
  healthDeduction?: unknown;
  lumpsumTotal?: unknown;
}): StipendPackageInput & { lumpsumTotal: number } {
  const pkg: StipendPackageInput = {
    basicStipend: Number(record.basicStipend) || 0,
    allowances: Number(record.allowances ?? 0),
    reward: Number(record.reward ?? 0),
    progressReward: Number(record.progressReward ?? 0),
    fuelAllowance: Number(record.fuelAllowance ?? 0),
    loanDeduction: Number(record.loanDeduction ?? 0),
    advanceDeduction: Number(record.advanceDeduction ?? 0),
    fineDeduction: Number(record.fineDeduction ?? 0),
    healthDeduction: Number(record.healthDeduction ?? 0),
  };

  return {
    ...pkg,
    lumpsumTotal:
      record.lumpsumTotal != null
        ? Number(record.lumpsumTotal)
        : calculateLumpsumTotal(pkg),
  };
}
