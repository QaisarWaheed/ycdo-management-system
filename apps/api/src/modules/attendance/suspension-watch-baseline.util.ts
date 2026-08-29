import { EmployeeStatus } from '@prisma/client';
import { toPakistanDateOnly } from './attendance-late.util';

/**
 * Set only when a suspension inquiry officially returns the employee to ACTIVE.
 * LATE/UA on this Pakistan calendar date or later count toward the next
 * Near/Due cycle. Earlier days stay on the attendance record unused.
 */
export function suspensionInquiryReinstatementData(now: Date = new Date()) {
  return {
    status: EmployeeStatus.ACTIVE,
    suspensionWatchBaselineOn: toPakistanDateOnly(now),
  };
}

export function countsTowardSuspensionWatch(
  attendanceDate: Date,
  baselineOn: Date | null | undefined,
): boolean {
  if (!baselineOn) return true;
  return attendanceDate.getTime() >= baselineOn.getTime();
}
