import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AttendanceLogType,
  AttendanceStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  is24HourShift,
  isOvernightShift,
  resolveShiftEndTime,
  resolveShiftStartTime,
} from './attendance-biometric.util';
import {
  parseAttendanceDateTime,
  toPakistanDateOnly,
} from './attendance-late.util';

const AUTO_CHECKOUT_NOTE = 'Auto-checked out at shift end';
const OT_CHECKIN_PROMPT_TYPE = 'OVERTIME_CHECKIN_PROMPT';
const OT_CHECKIN_PROMPT_MESSAGE =
  'Your shift has ended and you were auto-checked out. If you are continuing work, please Overtime Check-In on the biometric device.';

/** How far back to look for open check-ins (covers overnight + missed cron ticks). */
const LOOKBACK_DAYS = 2;

@Injectable()
export class ShiftCheckoutScheduler {
  private readonly logger = new Logger(ShiftCheckoutScheduler.name);

  constructor(private prisma: PrismaService) {}

  @Cron('*/15 * * * *')
  async autoCheckoutAtShiftEnd() {
    const now = new Date();
    const pkToday = toPakistanDateOnly(now);
    const lookback = new Date(pkToday);
    lookback.setUTCDate(lookback.getUTCDate() - LOOKBACK_DAYS);

    const openLogs = await this.prisma.attendanceLog.findMany({
      where: {
        type: AttendanceLogType.REGULAR,
        checkIn: { not: null },
        checkOut: null,
        date: { gte: lookback, lte: pkToday },
        status: {
          in: [
            AttendanceStatus.PRESENT,
            AttendanceStatus.LATE,
            AttendanceStatus.HALF_DAY,
          ],
        },
      },
      include: {
        employee: {
          include: { shift: true },
        },
      },
    });

    let checkedOut = 0;

    for (const log of openLogs) {
      if (!log.checkIn) continue;

      if (is24HourShift(log.employee)) {
        continue;
      }

      const endTime = resolveShiftEndTime(log.employee);
      if (!endTime) continue;

      const startTime = resolveShiftStartTime(log.employee);
      const expectedCheckOut = this.buildExpectedCheckOut(
        log.date,
        log.checkIn,
        startTime,
        endTime,
      );

      if (now.getTime() < expectedCheckOut.getTime()) {
        continue;
      }

      const checkOut =
        expectedCheckOut.getTime() > log.checkIn.getTime()
          ? expectedCheckOut
          : new Date(log.checkIn.getTime() + 60_000);

      const note = log.note
        ? log.note.includes(AUTO_CHECKOUT_NOTE)
          ? log.note
          : `${log.note}; ${AUTO_CHECKOUT_NOTE}`
        : AUTO_CHECKOUT_NOTE;

      await this.prisma.attendanceLog.update({
        where: { id: log.id },
        data: {
          checkOut,
          overtimeMinutes: 0,
          note,
        },
      });

      const existingPrompt = await this.prisma.notification.findFirst({
        where: {
          employeeId: log.employeeId,
          type: OT_CHECKIN_PROMPT_TYPE,
          isRead: false,
          createdAt: { gte: pkToday },
        },
      });

      if (!existingPrompt) {
        await this.prisma.notification.create({
          data: {
            employeeId: log.employeeId,
            type: OT_CHECKIN_PROMPT_TYPE,
            message: OT_CHECKIN_PROMPT_MESSAGE,
          },
        });
      }

      checkedOut++;
    }

    if (checkedOut > 0) {
      this.logger.log(
        `Auto-checked out ${checkedOut} employee(s) at shift end`,
      );
    }
  }

  /**
   * Duty-date + end time in Pakistan local. For overnight shifts (or when
   * same-day end would be at/before check-in), checkout moves to the next day.
   */
  private buildExpectedCheckOut(
    logDate: Date,
    checkIn: Date,
    startTime: string | null,
    endTime: string,
  ): Date {
    const y = logDate.getUTCFullYear();
    const m = String(logDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(logDate.getUTCDate()).padStart(2, '0');
    const time = endTime.length === 5 ? `${endTime}:00` : endTime;

    let checkOut = parseAttendanceDateTime(`${y}-${m}-${d}T${time}`);

    const overnight = isOvernightShift(startTime, endTime);
    if (overnight || checkOut.getTime() <= checkIn.getTime()) {
      checkOut = new Date(checkOut.getTime() + 24 * 60 * 60 * 1000);
    }

    return checkOut;
  }
}
