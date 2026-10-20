/** Loan eligibility: at least this many months of service on the application date. */
export const LOAN_MIN_SERVICE_MONTHS = 6;

/** Payroll deduction rows for an installment: `Loan installment [<id>]` / `Advance installment [<id>]`. */
export const INSTALLMENT_PREFIXES = ['Loan installment [', 'Advance installment ['];

export function loanInstallmentDescription(loanId: string, kind: 'LOAN' | 'ADVANCE' = 'LOAN') {
  return `${kind === 'ADVANCE' ? 'Advance' : 'Loan'} installment [${loanId}]`;
}

/** The loan id an installment row belongs to, or null for any other row. */
export function installmentLoanId(description?: string | null): string | null {
  return /^(?:Loan|Advance) installment \[([^\]]+)\]$/.exec(description ?? '')?.[1] ?? null;
}

/** Whole months of service from the joining date to `on` (calendar based). */
export function serviceMonths(joiningDate: Date, on: Date): number {
  let months =
    (on.getUTCFullYear() - joiningDate.getUTCFullYear()) * 12 +
    (on.getUTCMonth() - joiningDate.getUTCMonth());
  if (on.getUTCDate() < joiningDate.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

export function loanEligibility(joiningDate: Date | null, on: Date) {
  const months = joiningDate ? serviceMonths(joiningDate, on) : 0;
  return {
    eligible: months >= LOAN_MIN_SERVICE_MONTHS,
    serviceMonths: months,
    minMonths: LOAN_MIN_SERVICE_MONTHS,
  };
}

/**
 * Installment to take in payroll month (year, month): nothing before the
 * start month, the monthly amount after it, and only what is left at the end.
 */
export function installmentForMonth(
  loan: { amount: number; monthlyInstallment: number; startMonth: Date },
  year: number,
  month: number,
  alreadyPaid: number,
): number {
  const start =
    loan.startMonth.getUTCFullYear() * 12 + loan.startMonth.getUTCMonth() + 1;
  if (year * 12 + month < start) return 0;
  const left = Math.round((loan.amount - alreadyPaid) * 100) / 100;
  if (left <= 0) return 0;
  return Math.min(loan.monthlyInstallment, left);
}
