import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AttendanceSource,
  AttendanceStatus,
  EmployeeStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { applyDisciplineRules } from './discipline.helper';
import {
  getShiftAttendanceDate,
  minutesSinceShiftStart,
  parseTimeToMinutes,
  toPakistanDateOnly,
  toPakistanMinutesOfDay,
} from './shift-time.util';

const AUTO_UNMARKED_NOTE = 'Auto-marked unmarked at shift start';

@Injectable()
export class ShiftAbsentScheduler {
  private readonly logger = new Logger(ShiftAbsentScheduler.name);

  constructor(private prisma: PrismaService) {}

  @Cron('*/15 * * * *')
  async markShiftStartAbsent() {
    const now = new Date();
    const today = toPakistanDateOnly(now);
    const nowMinutes = toPakistanMinutesOfDay(now);

    const recentlyStartedShifts = await this.prisma.shift.findMany({
      where: { isActive: true },
    });

    let marked = 0;

    for (const shift of recentlyStartedShifts) {
      const shiftStartMinutes = parseTimeToMinutes(shift.startTime);

      if (
        nowMinutes < shiftStartMinutes ||
        nowMinutes > shiftStartMinutes + 15
      ) {
        continue;
      }

      const attendanceDate = getShiftAttendanceDate(now, shift.startTime);

      marked += await this.markAbsentForShift(
        shift.id,
        attendanceDate,
        AUTO_UNMARKED_NOTE,
      );
    }

    if (marked > 0) {
      this.logger.log(`Auto-marked ${marked} employee(s) unmarked at shift start`);
    }
  }

  @Cron('*/15 * * * *')
  async markUninformedAbsent() {
    const now = new Date();
    const currentMinutes = toPakistanMinutesOfDay(now);
    const pkToday = toPakistanDateOnly(now);
    const pkYesterday = new Date(pkToday);
    pkYesterday.setUTCDate(pkYesterday.getUTCDate() - 1);

    const unmarkedLogs = await this.prisma.attendanceLog.findMany({
      where: {
        date: { in: [pkToday, pkYesterday] },
        status: { in: [AttendanceStatus.UNMARKED, AttendanceStatus.ABSENT] },
        checkIn: null,
        source: AttendanceSource.MANUAL,
        OR: [
          { note: AUTO_UNMARKED_NOTE },
          { note: 'Auto-marked absent at shift start' },
        ],
      },
      include: {
        employee: {
          include: {
            shift: true,
          },
        },
      },
    });

    let upgraded = 0;

    for (const log of unmarkedLogs) {
      if (!log.employee.shift) continue;

      const shift = log.employee.shift;
      const expectedDate = getShiftAttendanceDate(now, shift.startTime);

      if (log.date.getTime() !== expectedDate.getTime()) {
        continue;
      }

      if (shift.name === '24 Hours') {
        const currentHour = Math.floor(currentMinutes / 60);
        const currentMin = currentMinutes % 60;
        if (currentHour < 23 || (currentHour === 23 && currentMin < 45)) {
          continue;
        }
      } else {
        const shiftStartMinutes = parseTimeToMinutes(shift.startTime);
        const minutesSince = minutesSinceShiftStart(
          currentMinutes,
          shiftStartMinutes,
        );

        if (minutesSince < 180) continue;
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.attendanceLog.update({
          where: { id: log.id },
          data: { status: AttendanceStatus.UNINFORMED_ABSENT },
        });

        await applyDisciplineRules(
          tx,
          log.employee.id,
          AttendanceStatus.UNINFORMED_ABSENT,
          log.date,
        );

        await tx.notification.create({
          data: {
            employeeId: log.employee.id,
            message:
              'You have been marked as Uninformed Absent. 2 days stipend deduction applied.',
            type: 'UNINFORMED_ABSENT',
          },
        });
      });

      upgraded++;
    }

    if (upgraded > 0) {
      this.logger.log(
        `Upgraded ${upgraded} employee(s) to uninformed absent after 3 hours`,
      );
    }
  }

  async backfillAbsentForDate(dateStr: string, shiftName?: string) {
    const date = toPakistanDateOnly(new Date(dateStr));
    const shiftWhere: Prisma.ShiftWhereInput = { isActive: true };
    if (shiftName) {
      shiftWhere.name = shiftName;
    }

    const shifts = await this.prisma.shift.findMany({ where: shiftWhere });
    let marked = 0;

    for (const shift of shifts) {
      marked += await this.markAbsentForShift(
        shift.id,
        date,
        AUTO_UNMARKED_NOTE,
      );
    }

    return { date: dateStr, shiftName: shiftName ?? null, marked };
  }

  private async markAbsentForShift(
    shiftId: string,
    date: Date,
    note: string,
  ): Promise<number> {
    const employees = await this.prisma.employee.findMany({
      where: {
        shiftId,
        status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED] },
      },
    });

    let marked = 0;

    for (const employee of employees) {
      const existing = await this.prisma.attendanceLog.findUnique({
        where: {
          employeeId_date: {
            employeeId: employee.id,
            date,
          },
        },
      });

      if (!existing) {
        await this.prisma.attendanceLog.create({
          data: {
            employeeId: employee.id,
            branchId: employee.currentBranchId,
            date,
            status: AttendanceStatus.UNMARKED,
            source: AttendanceSource.MANUAL,
            note,
          },
        });
        marked++;
      }
    }

    return marked;
  }
}
