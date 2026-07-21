import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AttendanceLogType,
  AttendanceStatus,
  EmployeeStatus,
} from '@prisma/client';
import { getDutyWindow } from '../../common/duty.util';
import { PrismaService } from '../../prisma/prisma.service';
import { is24HourShift } from './attendance-biometric.util';
import {
  parseAttendanceDateTime,
  toPakistanDateOnly,
} from './attendance-late.util';

const AUTO_CHECKOUT_NOTE = 'Auto-checked out at shift end';
const OT_CHECKIN_PROMPT_TYPE = 'OVERTIME_CHECKIN_PROMPT';
const OT_CHECKIN_PROMPT_MESSAGE =
  'Your shift has ended. If you are staying for overtime, mark Overtime Check-In from the portal or on the biometric device.';

/** How far back to look for open check-ins (covers overnight + missed cron ticks). */
const LOOKBACK_DAYS = 2;

@Injectable()
export class ShiftCheckoutScheduler {
  private readonly logger = new Logger(ShiftCheckoutScheduler.name);

  constructor(private prisma: PrismaService) {}

  /** Auto-checkout open regular sessions once shift end has passed. */
  @Cron('* * * * *')
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
      if (is24HourShift(log.employee)) continue;

      const win = getDutyWindow(log.employee);
      if (!win || win.is24h) continue;

      const expectedCheckOut = this.buildExpectedCheckOutFromDuty(
        log.date,
        log.checkIn,
        win.endMin,
        win.crossesMidnight,
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

      await this.sendOvertimePromptIfNeeded(log.employeeId, pkToday);
      checkedOut++;
    }

    if (checkedOut > 0) {
      this.logger.log(
        `Auto-checked out ${checkedOut} employee(s) at shift end`,
      );
    }
  }

  /**
   * Runs every minute. Notifies staff whose shift ended in the last 2 minutes
   * (PKT), who completed regular attendance, and have not started overtime.
   */
  @Cron('* * * * *')
  async notifyShiftEndForOvertime() {
    const now = new Date();
    const pkParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);

    const get = (type: string) =>
      pkParts.find((p) => p.type === type)?.value ?? '';
    const hh = Number(get('hour'));
    const mm = Number(get('minute'));
    const windowEndMin = hh * 60 + mm;
    const windowStartMin = windowEndMin - 2;
    const pkToday = toPakistanDateOnly(now);

    const employees = await this.prisma.employee.findMany({
      where: {
        status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.TRAINEE] },
        relieverOnly: false,
        dutyStartTime: { not: null },
        dutyEndTime: { not: null },
      },
      select: {
        id: true,
        dutyStartTime: true,
        dutyEndTime: true,
      },
    });

    let notified = 0;

    for (const emp of employees) {
      const win = getDutyWindow(emp);
      if (!win || win.is24h) continue;

      const endMin = win.endMin;
      const inWindow =
        windowStartMin >= 0
          ? endMin > windowStartMin && endMin <= windowEndMin
          : endMin >= windowStartMin + 24 * 60 || endMin <= windowEndMin;

      if (!inWindow) continue;

      const regular = await this.prisma.attendanceLog.findFirst({
        where: {
          employeeId: emp.id,
          date: pkToday,
          type: AttendanceLogType.REGULAR,
          checkIn: { not: null },
          checkOut: { not: null },
        },
      });
      if (!regular) continue;

      const overtime = await this.prisma.attendanceLog.findFirst({
        where: {
          employeeId: emp.id,
          date: pkToday,
          type: AttendanceLogType.OVERTIME,
          checkIn: { not: null },
        },
      });
      if (overtime) continue;

      const sent = await this.sendOvertimePromptIfNeeded(emp.id, pkToday);
      if (sent) notified++;
    }

    if (notified > 0) {
      this.logger.log(
        `Shift-end overtime prompt sent to ${notified} employee(s)`,
      );
    }
  }

  private async sendOvertimePromptIfNeeded(
    employeeId: string,
    pkToday: Date,
  ): Promise<boolean> {
    const existingPrompt = await this.prisma.notification.findFirst({
      where: {
        employeeId,
        type: OT_CHECKIN_PROMPT_TYPE,
        isRead: false,
        createdAt: { gte: pkToday },
      },
    });

    if (existingPrompt) return false;

    await this.prisma.notification.create({
      data: {
        employeeId,
        type: OT_CHECKIN_PROMPT_TYPE,
        message: OT_CHECKIN_PROMPT_MESSAGE,
      },
    });
    return true;
  }

  /**
   * Stamp checkOut from employee duty end on the attendance date (PKT),
   * rolling to the next day when the window crosses midnight.
   */
  private buildExpectedCheckOutFromDuty(
    logDate: Date,
    checkIn: Date,
    endMin: number,
    crossesMidnight: boolean,
  ): Date {
    const y = logDate.getUTCFullYear();
    const m = String(logDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(logDate.getUTCDate()).padStart(2, '0');
    const hh = String(Math.floor(endMin / 60)).padStart(2, '0');
    const mm = String(endMin % 60).padStart(2, '0');

    let checkOut = parseAttendanceDateTime(`${y}-${m}-${d}T${hh}:${mm}:00`);

    if (crossesMidnight || checkOut.getTime() <= checkIn.getTime()) {
      checkOut = new Date(checkOut.getTime() + 24 * 60 * 60 * 1000);
    }

    return checkOut;
  }
}
