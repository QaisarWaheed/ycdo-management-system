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

function utcDateOnly(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function roundStipendMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calendar days a payroll stipend segment is payable in a month.
 * Attendance logs are never an input — Basic / fixed-package proration
 * uses only contractual bounds:
 *   start = later of segmentStart and employmentStart (joiningDate)
 *   end exclusive = earlier of segmentEndExclusive and employmentEndExclusive
 *     (statusEffectiveFrom: last working day is the day before)
 */
export function payrollSegmentPayableDays(input: {
  year: number;
  month: number;
  segmentStart: Date;
  segmentEndExclusive: Date | null;
  monthEnd: Date;
  employmentStart?: Date | null;
  /** Exclusive end (e.g. statusEffectiveFrom). Last payable day is the day before. */
  employmentEndExclusive?: Date | null;
}): number {
  const daysInMonth = daysInPayrollMonth(input.year, input.month);
  if (daysInMonth <= 0) return 0;

  let start = utcDateOnly(input.segmentStart);
  if (input.employmentStart) {
    const join = utcDateOnly(input.employmentStart);
    if (join.getTime() > start.getTime()) {
      start = join;
    }
  }

  const monthEnd = utcDateOnly(input.monthEnd);
  let endExclusive: Date | null = null;
  if (input.segmentEndExclusive) {
    endExclusive = utcDateOnly(input.segmentEndExclusive);
  }
  if (input.employmentEndExclusive) {
    const empEnd = utcDateOnly(input.employmentEndExclusive);
    if (!endExclusive || empEnd.getTime() < endExclusive.getTime()) {
      endExclusive = empEnd;
    }
  }

  let endInclusive = monthEnd;
  if (endExclusive) {
    endInclusive = new Date(endExclusive.getTime() - 24 * 60 * 60 * 1000);
    if (endInclusive.getTime() > monthEnd.getTime()) {
      endInclusive = monthEnd;
    }
  }
  if (endInclusive.getTime() < start.getTime()) {
    return 0;
  }

  return (
    Math.round(
      (endInclusive.getTime() - start.getTime()) / (24 * 60 * 60 * 1000),
    ) + 1
  );
}

/**
 * Contractual Basic Stipend for a payroll stipend segment: payable calendar
 * days ÷ calendar days in the month. Attendance logs are not an input —
 * missing future/unmarked days do not shrink this figure. A segment covering
 * the whole month returns the full assigned monthly stipend.
 */
export function prorateContractualBasicForPayrollSegment(input: {
  contractualBasic: number;
  year: number;
  month: number;
  segmentStart: Date;
  segmentEndExclusive: Date | null;
  monthEnd: Date;
  /** Employee.joiningDate — Basic starts on the later of this and segmentStart. */
  employmentStart?: Date | null;
  /** statusEffectiveFrom — Basic ends the day before (last working day). */
  employmentEndExclusive?: Date | null;
}): number {
  const daysInMonth = daysInPayrollMonth(input.year, input.month);
  const contractual = Number(input.contractualBasic);
  if (daysInMonth <= 0 || !Number.isFinite(contractual) || contractual <= 0) {
    return 0;
  }

  const segmentDays = payrollSegmentPayableDays(input);
  if (segmentDays <= 0) return 0;
  if (segmentDays >= daysInMonth) {
    return roundStipendMoney(contractual);
  }
  return roundStipendMoney((contractual * segmentDays) / daysInMonth);
}

/** Prorate a monthly package amount (allowance/reward/fuel) over payable segment days. */
export function prorateMonthlyPackageAmount(input: {
  monthlyAmount: number;
  year: number;
  month: number;
  segmentStart: Date;
  segmentEndExclusive: Date | null;
  monthEnd: Date;
  employmentStart?: Date | null;
  employmentEndExclusive?: Date | null;
}): number {
  const amount = Number(input.monthlyAmount);
  if (!Number.isFinite(amount) || amount === 0) return 0;
  return prorateContractualBasicForPayrollSegment({
    ...input,
    contractualBasic: amount,
  });
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

/** Basic Stipend from full credited attendance days (not clocked hours). */
export function basicStipendFromCreditedDays(
  contractualBasic: number,
  creditedDays: number,
  year: number,
  month: number,
): number {
  const daysInMonth = daysInPayrollMonth(year, month);
  const contractual = Number(contractualBasic);
  const days = Number(creditedDays);
  if (
    daysInMonth <= 0 ||
    !Number.isFinite(contractual) ||
    contractual <= 0 ||
    !Number.isFinite(days) ||
    days <= 0
  ) {
    return 0;
  }
  if (days >= daysInMonth) {
    return roundStipendMoney(contractual);
  }
  return roundStipendMoney((contractual * days) / daysInMonth);
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
