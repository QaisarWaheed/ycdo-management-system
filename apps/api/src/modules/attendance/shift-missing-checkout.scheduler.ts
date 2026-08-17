import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttendanceLogType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { is24HourShift, isOvernightShift } from './attendance-biometric.util';
import { applyMissingCheckoutDiscipline } from './discipline.helper';
import { computeShiftEndDateTime, toPakistanDateOnly } from './shift-time.util';

/**
 * Grace period after the scheduled shift end before a missing checkout
 * becomes eligible for discipline. Avoids flagging the instant a shift
 * ends (biometric sync delay, brief overtime handoff, etc.) — mirrors the
 * spirit of markUninformedAbsent's grace on the check-in side, kept shorter
 * here since this only drives letters/deductions, never attendance status.
 */
export const MISSING_CHECKOUT_GRACE_MINUTES = 60;

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
):
  | { eligible: true; shiftEnd: Date; minutesPastEnd: number }
  | { eligible: false; reason: string } {
  if (!employee.dutyStartTime || !employee.dutyEndTime) {
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

  const crossesMidnight = isOvernightShift(
    employee.dutyStartTime,
    employee.dutyEndTime,
  );
  const shiftEnd = computeShiftEndDateTime(
    logDate,
    employee.dutyEndTime,
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
 * and the shift has genuinely finished (+ grace) — then applies the
 * missing-checkout disciplinary cycle AND marks the backend session
 * internally closed (Phase 4B: sessionClosedAt), without ever writing a
 * checkOut value. Fully separate from shift-checkout.scheduler.ts (overtime
 * prompts only) and from shift-absent.scheduler.ts (missing check-IN only);
 * deliberately its own file so it can be disabled/reverted independently of
 * either.
 *
 * Detection is derived purely from AttendanceLog state, so it applies
 * identically no matter which of the three live paths (biometric, admin
 * self-mark, HR manual) wrote the check-in.
 */
@Injectable()
export class ShiftMissingCheckoutScheduler {
  private readonly logger = new Logger(ShiftMissingCheckoutScheduler.name);

  constructor(private prisma: PrismaService) {}

  @Cron('*/15 * * * *')
  async flagMissingCheckouts() {
    const now = new Date();
    const pkToday = toPakistanDateOnly(now);
    const pkYesterday = new Date(pkToday);
    pkYesterday.setUTCDate(pkYesterday.getUTCDate() - 1);

    const openLogs = await this.prisma.attendanceLog.findMany({
      where: {
        type: AttendanceLogType.REGULAR,
        date: { in: [pkToday, pkYesterday] },
        checkIn: { not: null },
        checkOut: null,
        sessionClosedAt: null,
      },
      include: {
        employee: {
          select: {
            id: true,
            dutyStartTime: true,
            dutyEndTime: true,
            dutyTotalHours: true,
            shift: { select: { name: true, startTime: true, endTime: true } },
          },
        },
      },
    });

    let evaluated = 0;

    for (const log of openLogs) {
      const employee = log.employee;
      const evaluation = evaluateMissingCheckoutEligibility(
        employee,
        log.date,
        now,
      );
      if (!evaluation.eligible) continue;

      await this.prisma.$transaction(async (tx) => {
        await applyMissingCheckoutDiscipline(tx, employee.id, log.date, {
          checkIn: log.checkIn,
          dutyEndTime: employee.dutyEndTime,
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

      evaluated++;
    }

    if (evaluated > 0) {
      this.logger.log(
        `Missing-checkout discipline evaluated and internally closed ${evaluated} attendance record(s)`,
      );
    }
  }
}
