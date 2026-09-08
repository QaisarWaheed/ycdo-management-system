import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttendanceLogType } from '@prisma/client';
import { resolveAttendanceDutyTimes } from '../../common/duty.util';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import { isEmployeeEligibleForAttendance } from './attendance-eligibility.util';
import { is24HourShift, isOvernightShift } from './attendance-biometric.util';
import { applyMissingCheckoutDiscipline } from './discipline.helper';
import { computeShiftEndDateTime, toPakistanDateOnly } from './shift-time.util';

/**
 * Grace period after the scheduled shift end before a missing checkout
 * becomes eligible for discipline. Avoids flagging the instant a shift
 * ends (biometric sync delay, brief overtime handoff, etc.) — mirrors the
 * spirit of markUninformedAbsent's grace on the check-in side, kept shorter
 * here since this drives a warning draft, never attendance status.
 *
 * Closure stores scheduled duty end and preserves attendance status and saved OT.
 */
export const MISSING_CHECKOUT_GRACE_MINUTES = 30;

export type MissingCheckoutEmployee = {
  dutyStartTime: string | null;
  dutyEndTime: string | null;
  dutyTotalHours?: number | null;
  shift?: { name?: string | null; startTime: string; endTime: string } | null;
};

/**
 * Single source of truth for "has this open (checkIn set, checkOut null,
 * not yet internally closed) row genuinely earned missing-checkout
 * eligibility right now?" — shared by the live scheduler and the one-time
 * backfill/reconciliation script (Phase 4B) so the two can never drift
 * apart on what counts as category C ("eligible historical missing
 * checkout") vs A/D ("still inside shift/grace").
 *
 * Returns null when eligible (with the computed shiftEnd, for logging/
 * reporting), or a short reason string when not eligible / not evaluable.
 */
export function evaluateMissingCheckoutEligibility(
  employee: MissingCheckoutEmployee,
  logDate: Date,
  now: Date,
  dutyOverride?: { dutyStartTime: string | null; dutyEndTime: string | null },
):
  | { eligible: true; shiftEnd: Date; minutesPastEnd: number }
  | { eligible: false; reason: string } {
  const dutyStart =
    dutyOverride?.dutyStartTime?.trim() || employee.dutyStartTime;
  const dutyEnd = dutyOverride?.dutyEndTime?.trim() || employee.dutyEndTime;

  if (!dutyStart || !dutyEnd) {
    return {
      eligible: false,
      reason: 'no dutyStartTime/dutyEndTime configured',
    };
  }
  if (is24HourShift(employee)) {
    return {
      eligible: false,
      reason: '24-hour staff — checkout never required',
    };
  }

  const crossesMidnight = isOvernightShift(dutyStart, dutyEnd);
  const shiftEnd = computeShiftEndDateTime(
    logDate,
    dutyEnd,
    crossesMidnight,
  );
  const minutesPastEnd = (now.getTime() - shiftEnd.getTime()) / 60000;

  if (minutesPastEnd < MISSING_CHECKOUT_GRACE_MINUTES) {
    return { eligible: false, reason: 'still inside shift/checkout grace' };
  }

  return { eligible: true, shiftEnd, minutesPastEnd };
}

/** At duty end + 30 minutes, close at scheduled end and create a discipline-only warning draft. */
@Injectable()
export class ShiftMissingCheckoutScheduler {
  private readonly logger = new Logger(ShiftMissingCheckoutScheduler.name);

  constructor(
    private prisma: PrismaService,
    private payrollService: PayrollService,
  ) {}

  @Cron('* * * * *')
  async flagMissingCheckouts() {
    const now = new Date();
    const today = toPakistanDateOnly(now);
    const yesterday = new Date(today); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const openLogs = await this.prisma.attendanceLog.findMany({
      where: { type: AttendanceLogType.REGULAR, date: { in: [today, yesterday] },
        checkIn: { not: null }, checkOut: null, sessionClosedAt: null },
      include: { employee: { select: { id: true, status: true, dutyStartTime: true, dutyEndTime: true,
        dutyTotalHours: true, shift: { select: { name: true, startTime: true, endTime: true } } } } },
    });
    for (const log of openLogs) {
      if (!isEmployeeEligibleForAttendance(log.employee.status)) continue;
      const duty = resolveAttendanceDutyTimes(log, log.employee);
      const evaluation = evaluateMissingCheckoutEligibility(log.employee, log.date, now, duty);
      if (!evaluation.eligible || evaluation.shiftEnd <= log.checkIn!) continue;
      await this.prisma.$transaction(async tx => {
        const changed = await tx.attendanceLog.updateMany({
          where: { id: log.id, checkOut: null, sessionClosedAt: null, checkIn: log.checkIn },
          data: { checkOut: evaluation.shiftEnd, sessionClosedAt: now,
            note: [log.note?.trim(), 'Auto checkout at scheduled duty end: missing checkout'].filter(Boolean).join(' | ') },
        });
        if (!changed.count) return;
        await applyMissingCheckoutDiscipline(tx, log.employeeId, log.date, {
          checkIn: log.checkIn!, dutyEndTime: duty.dutyEndTime, warningOnly: true,
        });
      });
    }
  }
}
