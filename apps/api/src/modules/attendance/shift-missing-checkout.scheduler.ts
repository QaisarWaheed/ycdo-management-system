import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttendanceLogType } from '@prisma/client';
import { resolveAttendanceDutyTimes } from '../../common/duty.util';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import { isEmployeeEligibleForAttendance } from './attendance-eligibility.util';
import { is24HourShift, isOvernightShift } from './attendance-biometric.util';
import {
  applyMissingCheckoutDiscipline,
  reconcileAttendanceFinancialConsequences,
} from './discipline.helper';
import { computeShiftEndDateTime, toPakistanDateOnly } from './shift-time.util';
import {
  isTemporaryAutoCheckoutEnabled,
  TEMPORARY_AUTO_CHECKOUT_NOTE,
} from './temporary-auto-checkout';

/**
 * Grace period after the scheduled shift end before a missing checkout
 * becomes eligible for discipline. Avoids flagging the instant a shift
 * ends (biometric sync delay, brief overtime handoff, etc.) — mirrors the
 * spirit of markUninformedAbsent's grace on the check-in side, kept shorter
 * here since this only drives letters/deductions, never attendance status.
 *
 * During TEMPORARY_AUTO_CHECKOUT=true the same grace gates auto-punching
 * checkOut at duty end (no discipline).
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

/**
 * Detects AttendanceLog rows where checkIn is set, checkOut is still null,
 * and the shift has genuinely finished (+ grace).
 *
 * Normal mode: applies the missing-checkout disciplinary cycle AND marks
 * the backend session internally closed (sessionClosedAt), without writing
 * checkOut.
 *
 * Temporary mode (TEMPORARY_AUTO_CHECKOUT=true): writes checkOut = duty end
 * after the same grace, skips all checkout discipline, and reverses any
 * prior missing-checkout consequences for that day. Flip the env flag off
 * and redeploy to restore normal mode — discipline code paths stay intact.
 *
 * Fully separate from shift-checkout.scheduler.ts (overtime prompts only)
 * and from shift-absent.scheduler.ts (missing check-IN only).
 */
@Injectable()
export class ShiftMissingCheckoutScheduler {
  private readonly logger = new Logger(ShiftMissingCheckoutScheduler.name);

  constructor(
    private prisma: PrismaService,
    private payrollService: PayrollService,
  ) {}

  @Cron('*/5 * * * *')
  async flagMissingCheckouts() {
    const now = new Date();
    const temporaryAutoCheckout = isTemporaryAutoCheckoutEnabled();
    const pkToday = toPakistanDateOnly(now);
    const pkYesterday = new Date(pkToday);
    pkYesterday.setUTCDate(pkYesterday.getUTCDate() - 1);

    // Temporary mode also picks up rows already session-closed without a
    // real checkOut (disciplined before the flag was turned on) so they
    // get an auto punch + discipline reversal.
    const openLogs = await this.prisma.attendanceLog.findMany({
      where: {
        type: AttendanceLogType.REGULAR,
        date: { in: [pkToday, pkYesterday] },
        checkIn: { not: null },
        checkOut: null,
        ...(temporaryAutoCheckout ? {} : { sessionClosedAt: null }),
      },
      include: {
        employee: {
          select: {
            id: true,
            dutyStartTime: true,
            dutyEndTime: true,
            dutyTotalHours: true,
            status: true,
            shift: { select: { name: true, startTime: true, endTime: true } },
          },
        },
      },
    });

    let evaluated = 0;

    for (const log of openLogs) {
      const employee = log.employee;
      if (!isEmployeeEligibleForAttendance(employee.status)) continue;
      const duty = resolveAttendanceDutyTimes(log, employee);
      const evaluation = evaluateMissingCheckoutEligibility(
        employee,
        log.date,
        now,
        duty,
      );
      if (!evaluation.eligible) continue;

      if (temporaryAutoCheckout) {
        if (evaluation.shiftEnd.getTime() <= (log.checkIn?.getTime() ?? 0)) {
          continue;
        }

        await this.prisma.$transaction(async (tx) => {
          const before = await tx.attendanceLog.findUnique({
            where: { id: log.id },
          });
          if (!before || before.checkOut != null || !before.checkIn) {
            return;
          }

          const noteParts = [
            before.note?.trim(),
            TEMPORARY_AUTO_CHECKOUT_NOTE,
          ].filter(Boolean);

          const after = await tx.attendanceLog.update({
            where: { id: log.id },
            data: {
              checkOut: evaluation.shiftEnd,
              sessionClosedAt: before.sessionClosedAt ?? now,
              note: noteParts.join(' | '),
            },
          });

          // Reverses any prior missing-checkout Advice/Warning/Fine for this
          // day. applyMissingCheckoutDiscipline is also no-op while the flag
          // is on, so no new discipline can be issued on this path.
          await reconcileAttendanceFinancialConsequences(tx, {
            employeeId: before.employeeId,
            date: before.date,
            before: {
              status: before.status,
              lateMinutes: before.lateMinutes,
              checkIn: before.checkIn,
              checkOut: before.checkOut,
              note: before.note,
            },
            after: {
              status: after.status,
              lateMinutes: after.lateMinutes,
              checkIn: after.checkIn,
              checkOut: after.checkOut,
              note: after.note,
            },
            dutyStartTimeSnapshot: before.dutyStartTimeSnapshot,
          });
        });
      } else {
        await this.prisma.$transaction(async (tx) => {
          await applyMissingCheckoutDiscipline(tx, employee.id, log.date, {
            checkIn: log.checkIn!,
            dutyEndTime: duty.dutyEndTime,
          });

          // checkOut stays NULL — the employee never actually checked out.
          // sessionClosedAt is the separate, internal "stop treating this as
          // an open session" marker consumed by findOpenRegularLog /
          // findOpenRegularLogForAuto.
          await tx.attendanceLog.update({
            where: { id: log.id },
            data: { sessionClosedAt: now },
          });
        });
      }

      await this.payrollService.recomputePendingPayrollForAttendanceDate(
        employee.id,
        log.date,
      );

      evaluated++;
    }

    if (evaluated > 0) {
      this.logger.log(
        temporaryAutoCheckout
          ? `Temporary auto-checkout punched ${evaluated} attendance record(s) at duty end (discipline skipped)`
          : `Missing-checkout discipline evaluated and internally closed ${evaluated} attendance record(s)`,
      );
    }
  }
}
