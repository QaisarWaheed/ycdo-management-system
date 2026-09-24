import { DeductionType } from '@prisma/client';
import { isLegacyAttendanceDeduction } from './attendance-card-salary.util';

/**
 * Causes HR enters by hand from the payroll modal. Only these can be added,
 * edited or removed there; attendance and disciplinary deductions stay owned
 * by the modules that create them.
 */
export const MANUAL_DEDUCTION_REASONS: DeductionType[] = [
  DeductionType.MEDICINE_PENDING,
  DeductionType.KITCHEN_PENDING,
  DeductionType.LOAN,
  DeductionType.ADVANCE,
  DeductionType.ELECTRICITY_BILL,
  DeductionType.MOBILE_BILL,
  DeductionType.OTHER,
  DeductionType.FINE,
];

export function isManualDeduction(row: {
  reason?: string;
  description?: string | null;
}): boolean {
  return (
    MANUAL_DEDUCTION_REASONS.includes(row.reason as DeductionType) &&
    !isLegacyAttendanceDeduction(row)
  );
}
