import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttendanceLogType, EmployeeStatus } from '@prisma/client';
import { getDutyWindow, normalizeDutyTimeToHhMm } from '../../common/duty.util';
import { PrismaService } from '../../prisma/prisma.service';
import { is24HourShift } from './attendance-biometric.util';
import {
  parseAttendanceDateTime,
  toPakistanDateOnly,
} from './attendance-late.util';
import { getShiftAttendanceDate } from './shift-time.util';

const OT_CHECKIN_PROMPT_TYPE = 'OVERTIME_CHECKIN_PROMPT';
const OT_CHECKIN_PROMPT_MESSAGE =
  'Your shift has ended. If you are staying for overtime, mark Overtime Check-In from the portal or on the biometric device.';

const AUTO_CHECKOUT_NOTE =
  'Auto checked-out at duty end (no checkout was recorded)';
const AUTO_CHECKOUT_NOTIFICATION_TYPE = 'AUTO_CHECKOUT';
const AUTO_CHECKOUT_MESSAGE =
  'You were automatically checked out because your duty ended without a checkout punch. If you continued working, mark Overtime Check-In from the portal or biometric device.';

/**
 * Shift-end handling: prompts staff about overtime, and auto-checks-out
 * anyone still open past duty end so their attendance closes cleanly and
 * overtime check-in (which requires a closed regular session) stays usable.
 */
@Injectable()
export class ShiftCheckoutScheduler {
  private readonly logger = new Logger(ShiftCheckoutScheduler.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Runs every minute. Notifies staff whose shift ended in the last 2 minutes
   * (PKT), who completed regular attendance (checked out), and have not
   * started overtime.
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

  /**
   * Runs every minute. Auto-checks-out anyone whose duty has ended but who
   * never checked out. checkOut is always stamped at the exact duty end
   * time, not whenever this job happens to run — no overtime is credited.
   */
  @Cron('* * * * *')
  async autoCheckoutAtDutyEnd() {
    const now = new Date();

    const employees = await this.prisma.employee.findMany({
      where: {
        status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.TRAINEE] },
        dutyStartTime: { not: null },
        dutyEndTime: { not: null },
      },
      select: {
        id: true,
        dutyStartTime: true,
        dutyEndTime: true,
        dutyTotalHours: true,
        shift: { select: { name: true, startTime: true, endTime: true } },
      },
    });

    let checkedOut = 0;

    for (const emp of employees) {
      const win = getDutyWindow(emp);
      if (!win || is24HourShift(emp)) continue;

      const attendanceDate = getShiftAttendanceDate(now, emp.dutyStartTime);
      const dutyEnd = this.dutyEndDateTime(
        attendanceDate,
        win.crossesMidnight,
        emp.dutyEndTime,
      );
      if (now.getTime() < dutyEnd.getTime()) continue;

      const open = await this.prisma.attendanceLog.findFirst({
        where: {
          employeeId: emp.id,
          date: attendanceDate,
          type: AttendanceLogType.REGULAR,
          checkIn: { not: null },
          checkOut: null,
        },
      });
      if (!open) continue;

      await this.prisma.$transaction(async (tx) => {
        await tx.attendanceLog.update({
          where: { id: open.id },
          data: {
            checkOut: dutyEnd,
            overtimeMinutes: 0,
            overtimePending: false,
            note: open.note
              ? `${open.note}; ${AUTO_CHECKOUT_NOTE}`
              : AUTO_CHECKOUT_NOTE,
          },
        });

        await tx.notification.create({
          data: {
            employeeId: emp.id,
            type: AUTO_CHECKOUT_NOTIFICATION_TYPE,
            message: AUTO_CHECKOUT_MESSAGE,
          },
        });
      });

      checkedOut++;
    }

    if (checkedOut > 0) {
      this.logger.log(`Auto checked-out ${checkedOut} employee(s) at duty end`);
    }
  }

  /** Resolves an "HH:mm"/"hh:mm AM/PM" duty end time to an actual Date on (or the day after) attendanceDate. */
  private dutyEndDateTime(
    attendanceDate: Date,
    crossesMidnight: boolean,
    dutyEndTime: string,
  ): Date {
    const endDate = new Date(attendanceDate);
    if (crossesMidnight) {
      endDate.setUTCDate(endDate.getUTCDate() + 1);
    }
    const dateStr = endDate.toISOString().slice(0, 10);
    const hhmm = normalizeDutyTimeToHhMm(dutyEndTime);
    return parseAttendanceDateTime(`${dateStr}T${hhmm}:00`);
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
}
