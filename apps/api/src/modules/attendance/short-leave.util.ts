import {
  AttendanceLogType,
  AttendanceSource,
  AttendanceStatus,
  LeaveStatus,
  LeaveType,
  Prisma,
} from '@prisma/client';
import {
  getDutyWindow,
  LATE_GRACE_MINUTES,
  resolveAttendanceDutyTimes,
} from '../../common/duty.util';
import { is24HourShift } from './attendance-biometric.util';
import { reverseLateDisciplineForDate } from './discipline.helper';
import {
  computeShiftEndDateTime,
  computeShiftStartDateTime,
} from './shift-time.util';

/**
 * Fixed monthly entitlements for all normal (non-24-hour) staff — not
 * per-employee configurable, unlike Full Leave's legacy yearly cap
 * (Employee.monthlyAllowedLeaves / MAX_LEAVES_PER_YEAR in leave.service.ts,
 * which this does not replace).
 */
export const MONTHLY_SHORT_LEAVE_LIMIT = 3;
export const MONTHLY_FULL_LEAVE_LIMIT = 2;

/** LeaveRecord states that still consume a monthly quota slot. */
const QUOTA_CONSUMING_LEAVE_STATUSES: LeaveStatus[] = [
  LeaveStatus.PENDING,
  LeaveStatus.BRANCH_APPROVED,
  LeaveStatus.DEPT_APPROVED,
  LeaveStatus.RELIEVER_PENDING,
  LeaveStatus.RELIEVER_CONFIRMED,
  LeaveStatus.HR_PENDING,
  LeaveStatus.PENDING_APPROVAL,
  LeaveStatus.APPROVED,
];

export type ShortLeaveEmployee = {
  dutyStartTime: string | null;
  dutyEndTime: string | null;
  dutyTotalHours?: number | null;
  shift?: { name?: string | null; startTime: string; endTime: string } | null;
};

/** Up to 2 hours Short Leave (8h or less, and 9h duty). */
export const SHORT_LEAVE_ALLOWANCE_2H_MINUTES = 120;
/** Up to 3 hours Short Leave (10h, 11h, and 12h duty). */
export const SHORT_LEAVE_ALLOWANCE_3H_MINUTES = 180;

const DUTY_10H_MINUTES = 10 * 60;
const DUTY_12H_MINUTES = 12 * 60;

export function resolveDutySpanMinutes(
  employee: ShortLeaveEmployee,
): number | null {
  const win = getDutyWindow(employee);
  if (!win || win.is24h) return null;

  const totalMinutes = win.crossesMidnight
    ? 1440 - win.startMin + win.endMin
    : win.endMin - win.startMin;

  return totalMinutes > 0 ? totalMinutes : null;
}

/**
 * Short Leave allowance from configured duty start/end only:
 * - 8-hour or shorter, and 9-hour duty → 120 minutes (2 hours)
 * - 10-hour, 11-hour, and 12-hour duty → 180 minutes (3 hours)
 * Duty longer than 12 hours (non-24h) is not eligible.
 */
export function resolveShortLeaveAllowanceMinutes(
  employee: ShortLeaveEmployee,
): number | null {
  const totalMinutes = resolveDutySpanMinutes(employee);
  if (totalMinutes == null) return null;

  if (totalMinutes < DUTY_10H_MINUTES) {
    return SHORT_LEAVE_ALLOWANCE_2H_MINUTES;
  }
  if (totalMinutes <= DUTY_12H_MINUTES) {
    return SHORT_LEAVE_ALLOWANCE_3H_MINUTES;
  }
  return null;
}

export type ShortLeaveDeviationResult =
  | {
      valid: true;
      side: 'LATE' | 'EARLY' | 'NONE';
      deviationMinutes: number;
      allowanceMinutes: number;
    }
  | { valid: false; reason: string };

/**
 * Single source of truth for "does this attendance row's actual
 * checkIn/checkOut qualify for a Short Leave right now?" — pure, no DB
 * access, so it's identically testable and usable from any caller.
 *
 * Late arrival uses the same 15-minute on-time grace as PRESENT/LATE, so a
 * 10-minute late punch does not count as a "late side". Remaining late
 * minutes plus early-departure minutes may both be present; Short Leave is
 * valid when their total is within the duty-length allowance.
 */
export function evaluateShortLeaveDeviation(
  employee: ShortLeaveEmployee,
  logDate: Date,
  checkIn: Date | null,
  checkOut: Date | null,
): ShortLeaveDeviationResult {
  if (is24HourShift(employee)) {
    return {
      valid: false,
      reason: '24-hour staff are not eligible for Short Leave',
    };
  }
  if (!employee.dutyStartTime || !employee.dutyEndTime) {
    return { valid: false, reason: 'no dutyStartTime/dutyEndTime configured' };
  }
  if (!checkIn) {
    return { valid: false, reason: 'attendance has no check-in to evaluate' };
  }

  const allowanceMinutes = resolveShortLeaveAllowanceMinutes(employee);
  if (allowanceMinutes == null) {
    const span = resolveDutySpanMinutes(employee);
    if (span == null) {
      return {
        valid: false,
        reason:
          'Short Leave is not available for 24-hour staff or when duty start/end times are missing or invalid',
      };
    }
    return {
      valid: false,
      reason:
        'Short Leave allowance is 2 hours for duty up to 9 hours and 3 hours for 10–12 hour duty; this employee\'s configured duty is longer than 12 hours — update duty start/end times on the employee profile',
    };
  }

  const win = getDutyWindow(employee);
  const shiftStart = computeShiftStartDateTime(logDate, employee.dutyStartTime);
  const shiftEnd = computeShiftEndDateTime(
    logDate,
    employee.dutyEndTime,
    win.crossesMidnight,
  );

  const rawLateMinutes = Math.max(
    0,
    Math.round((checkIn.getTime() - shiftStart.getTime()) / 60000),
  );
  const lateSideMinutes = Math.max(0, rawLateMinutes - LATE_GRACE_MINUTES);
  const earlySideMinutes = checkOut
    ? Math.max(0, Math.round((shiftEnd.getTime() - checkOut.getTime()) / 60000))
    : 0;

  if (lateSideMinutes === 0 && earlySideMinutes === 0) {
    return { valid: true, side: 'NONE', deviationMinutes: 0, allowanceMinutes };
  }

  const deviationMinutes = lateSideMinutes + earlySideMinutes;
  if (deviationMinutes > allowanceMinutes) {
    return {
      valid: false,
      reason: `Short Leave exceeds the allowed ${allowanceMinutes}-minute limit for this duty length (actual: ${deviationMinutes} minutes)`,
    };
  }

  const side: 'LATE' | 'EARLY' =
    lateSideMinutes >= earlySideMinutes ? 'LATE' : 'EARLY';

  return { valid: true, side, deviationMinutes, allowanceMinutes };
}

/**
 * Unified monthly Short Leave count — the single source of truth shared by
 * BOTH entry flows (Portal LeaveRecord requests and HR-emergency, which now
 * also creates a LeaveRecord under the hood — see attendance.service.ts).
 * Counts distinct LeaveRecord.startDate values this calendar month with
 * leaveType=SHORT_LEAVE in any quota-consuming status (in-flight through the
 * approval chain, PENDING_APPROVAL, or APPROVED). REJECTED/CANCELLED never
 * count, satisfying "do not count rejected/cancelled/reversed records."
 * A LeaveRecord already APPROVED has, by construction, already been
 * reconciled into an AttendanceLog SHORT_LEAVE row — it is not
 * double-counted from AttendanceLog separately.
 */
export async function countShortLeaveOccurrencesThisMonth(
  tx: Prisma.TransactionClient,
  employeeId: string,
  monthDate: Date,
  excludeLeaveRecordId?: string,
): Promise<number> {
  const startOfMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth(),
    1,
  );
  const endOfMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );

  const rows = await tx.leaveRecord.findMany({
    where: {
      employeeId,
      leaveType: LeaveType.SHORT_LEAVE,
      status: { in: QUOTA_CONSUMING_LEAVE_STATUSES },
      startDate: { gte: startOfMonth, lte: endOfMonth },
      ...(excludeLeaveRecordId ? { NOT: { id: excludeLeaveRecordId } } : {}),
    },
    select: { startDate: true },
  });

  return new Set(rows.map((r) => r.startDate.toISOString().slice(0, 10))).size;
}

/**
 * Unified monthly Full Leave count — REGULAR + EMERGENCY together (mirrors
 * the existing yearly-cap convention in leave.service.ts's getApprovedDays,
 * which also treats "not SHORT_LEAVE" as one combined Full Leave bucket).
 * Only APPROVED occurrences consume the monthly entitlement — unlike Short
 * Leave, Full Leave has no second concurrent entry flow racing to reserve a
 * slot before approval, so in-flight chain stages are not counted here.
 */
export async function countApprovedFullLeaveOccurrencesThisMonth(
  tx: Prisma.TransactionClient,
  employeeId: string,
  monthDate: Date,
  excludeLeaveRecordId?: string,
): Promise<number> {
  const startOfMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth(),
    1,
  );
  const endOfMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );

  const rows = await tx.leaveRecord.findMany({
    where: {
      employeeId,
      leaveType: { not: LeaveType.SHORT_LEAVE },
      status: LeaveStatus.APPROVED,
      startDate: { gte: startOfMonth, lte: endOfMonth },
      ...(excludeLeaveRecordId ? { NOT: { id: excludeLeaveRecordId } } : {}),
    },
    select: { startDate: true },
  });

  return new Set(rows.map((r) => r.startDate.toISOString().slice(0, 10))).size;
}

export type ShortLeaveReconcileEmployee = ShortLeaveEmployee & {
  currentBranchId: string;
};

export type ShortLeaveReconcileResult =
  | { applied: true; side: 'LATE' | 'EARLY' | 'NONE' }
  | { applied: false; reason: string };

/**
 * Canonical "apply the Short Leave outcome to this date's attendance" step —
 * the single reconciliation path shared by the Portal flow (leave.service.ts
 * markLeaveAttendance), the HR-emergency flow (attendance.service.ts), and
 * ProspectiveShortLeaveScheduler, so all three converge on identical
 * treatment (status, payroll credit, discipline reversal) once a Short
 * Leave is approved for a given date.
 *
 * Deliberately never creates an AttendanceLog row and never writes anything
 * when no real checkIn exists yet for this date — a genuinely prospective
 * Portal request (approved before the day happens) is left alone; the
 * LeaveRecord stays APPROVED with no fabricated attendance, and
 * ProspectiveShortLeaveScheduler re-invokes this same function once real
 * attendance exists. An earlier design synthesized a SHORT_LEAVE placeholder
 * (null checkIn/checkOut) immediately at approval time — removed after an
 * audit found it corrupts applyLateDiscipline's occurrence count: several
 * write paths preserve an existing row's `note` field unless explicitly
 * overridden (biometricRegularCheckIn's `note: ... : anyExisting.note`,
 * updateAttendance's equivalent), so the placeholder's `'Approved short
 * leave'` note would survive a later REAL check-in that turns out genuinely
 * late, and applyLateDiscipline explicitly excludes any HALF_DAY row whose
 * note contains "short leave" from its monthly late count — silently
 * hiding a real late day from the 3rd/6th-occurrence Fine cycle. A second,
 * independent problem: shift-absent.scheduler.ts only marks ABSENT
 * `if (!existing)`, so the placeholder would mask a genuine full no-show
 * (not what Short Leave covers) as a fully-paid, undisciplined day forever.
 * Never creating the placeholder avoids both: real check-in/check-out paths
 * are completely untouched and always run their own normal create-path
 * logic, and a genuine no-show still gets marked ABSENT normally.
 */
export async function reconcileShortLeaveAttendance(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
  employee: ShortLeaveReconcileEmployee,
): Promise<ShortLeaveReconcileResult> {
  const existing = await tx.attendanceLog.findUnique({
    where: {
      employeeId_date_type: {
        employeeId,
        date,
        type: AttendanceLogType.REGULAR,
      },
    },
  });

  if (!existing?.checkIn) {
    return {
      applied: false,
      reason: 'no real attendance yet for this date',
    };
  }

  // The duty that applied on THIS date — the row's own snapshot when
  // present, current employee duty only as a last resort. dutyTotalHours
  // and shift have no historical snapshot equivalent, so they are kept
  // from the current employee record regardless (matching the same
  // documented limitation as payroll's per-day resolution).
  const dayDuty = resolveAttendanceDutyTimes(existing, employee);
  const evaluation = evaluateShortLeaveDeviation(
    {
      ...employee,
      dutyStartTime: dayDuty.dutyStartTime,
      dutyEndTime: dayDuty.dutyEndTime,
    },
    date,
    existing.checkIn,
    existing.checkOut,
  );
  if (evaluation.valid === false) {
    return { applied: false, reason: evaluation.reason };
  }
  const side = evaluation.side;

  // Reconcile only when the day being converted was actually a
  // lateness-driven HALF_DAY/LATE — never touches an already-short-leave
  // row (idempotent on reruns) or an unrelated status.
  const wasLatenessDriven =
    existing.status === AttendanceStatus.LATE ||
    (existing.status === AttendanceStatus.HALF_DAY &&
      existing.lateMinutes > 0 &&
      !(existing.note ?? '').toLowerCase().includes('short leave'));

  if (wasLatenessDriven && side !== 'EARLY') {
    await reverseLateDisciplineForDate(tx, employeeId, date);
  }

  // update(), never upsert() — existing is guaranteed present above, so
  // this can never fabricate a row.
  await tx.attendanceLog.update({
    where: {
      employeeId_date_type: {
        employeeId,
        date,
        type: AttendanceLogType.REGULAR,
      },
    },
    data: {
      status: AttendanceStatus.SHORT_LEAVE,
      source: AttendanceSource.MANUAL,
      note: 'Approved short leave',
    },
  });

  return { applied: true, side };
}
