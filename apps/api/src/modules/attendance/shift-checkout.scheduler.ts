import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttendanceLogType, EmployeeStatus } from '@prisma/client';
import { getDutyWindow } from '../../common/duty.util';
import { PrismaService } from '../../prisma/prisma.service';
import { toPakistanDateOnly } from './attendance-late.util';

const OT_CHECKIN_PROMPT_TYPE = 'OVERTIME_CHECKIN_PROMPT';
const OT_CHECKIN_PROMPT_MESSAGE =
  'Your shift has ended. If you are staying for overtime, mark Overtime Check-In from the portal or on the biometric device.';

/**
 * Shift-end handling: prompts staff about overtime. Checkout is always
 * manual — Admin/HR (or the employee) must record it explicitly; nothing
 * here auto-closes an open attendance session.
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
