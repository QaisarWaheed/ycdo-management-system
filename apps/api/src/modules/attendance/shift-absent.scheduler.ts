import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AttendanceLogType,
  AttendanceSource,
  AttendanceStatus,
  EmployeeStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { applyDisciplineRules } from './discipline.helper';
import { is24HourShiftRecord } from './attendance-biometric.util';
import {
  getShiftAttendanceDate,
  minutesSinceShiftStart,
  parseTimeToMinutes,
  toPakistanDateOnly,
  toPakistanMinutesOfDay,
} from './shift-time.util';

const AUTO_UNMARKED_NOTE = 'Auto-marked unmarked at shift start';
const AUTO_ABSENT_24H_NOTE = 'Auto-marked absent for 24-hour shift';

@Injectable()
export class ShiftAbsentScheduler {
  private readonly logger = new Logger(ShiftAbsentScheduler.name);

  constructor(private prisma: PrismaService) {}

  @Cron('*/15 * * * *')
  async markShiftStartAbsent() {
    await this.normalizeLegacyAutoMarkedAbsent();

    const now = new Date();
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
      const is24h = is24HourShiftRecord(shift);

      marked += await this.markAbsentForShift(
        shift.id,
        attendanceDate,
        is24h ? AUTO_ABSENT_24H_NOTE : AUTO_UNMARKED_NOTE,
        is24h ? AttendanceStatus.ABSENT : AttendanceStatus.UNMARKED,
      );
    }

    if (marked > 0) {
      this.logger.log(
        `Auto-marked ${marked} employee(s) at shift start (unmarked/absent)`,
      );
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
        type: AttendanceLogType.REGULAR,
        date: { in: [pkToday, pkYesterday] },
        status: { in: [AttendanceStatus.UNMARKED, AttendanceStatus.ABSENT] },
        checkIn: null,
        source: AttendanceSource.MANUAL,
        OR: [
          { note: AUTO_UNMARKED_NOTE },
          { note: 'Auto-marked absent at shift start' },
        ],
        NOT: { note: AUTO_ABSENT_24H_NOTE },
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

      // 24-hour staff stay ABSENT / never UNINFORMED_ABSENT
      if (is24HourShiftRecord(shift)) {
        continue;
      }

      const expectedDate = getShiftAttendanceDate(now, shift.startTime);

      if (log.date.getTime() !== expectedDate.getTime()) {
        continue;
      }

      const shiftStartMinutes = parseTimeToMinutes(shift.startTime);
      const minutesSince = minutesSinceShiftStart(
        currentMinutes,
        shiftStartMinutes,
      );

      if (minutesSince < 180) continue;

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
      const is24h = is24HourShiftRecord(shift);
      marked += await this.markAbsentForShift(
        shift.id,
        date,
        is24h ? AUTO_ABSENT_24H_NOTE : AUTO_UNMARKED_NOTE,
        is24h ? AttendanceStatus.ABSENT : AttendanceStatus.UNMARKED,
      );
    }

    return { date: dateStr, shiftName: shiftName ?? null, marked };
  }

  private async markAbsentForShift(
    shiftId: string,
    date: Date,
    note: string,
    status: AttendanceStatus,
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
          employeeId_date_type: {
            employeeId: employee.id,
            date,
            type: AttendanceLogType.REGULAR,
          },
        },
      });

      if (!existing) {
        await this.prisma.attendanceLog.create({
          data: {
            employeeId: employee.id,
            branchId: employee.currentBranchId,
            date,
            type: AttendanceLogType.REGULAR,
            status,
            source: AttendanceSource.MANUAL,
            note,
          },
        });
        marked++;
      }
    }

    return marked;
  }

  /**
   * Convert old auto-marked ABSENT rows (no check-in) to UNMARKED —
   * except 24-hour shift absents, which stay ABSENT.
   */
  private async normalizeLegacyAutoMarkedAbsent(): Promise<void> {
    await this.prisma.attendanceLog.updateMany({
      where: {
        status: AttendanceStatus.ABSENT,
        checkIn: null,
        OR: [
          { note: 'Auto-marked absent at shift start' },
          { note: 'Auto-marked absent' },
          { note: AUTO_UNMARKED_NOTE },
        ],
        NOT: { note: AUTO_ABSENT_24H_NOTE },
      },
      data: {
        status: AttendanceStatus.UNMARKED,
        note: AUTO_UNMARKED_NOTE,
      },
    });
  }
}
