import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AttendanceLogType,
  AttendanceSource,
  AttendanceStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import { applyDisciplineRules, reverseAbsenceDeductionForDate } from './discipline.helper';
import { is24HourShift, is24HourShiftRecord } from './attendance-biometric.util';
import {
  AUTO_UNMARKED_NOTE,
  isPreJoinAttendanceDate,
  isUninformedUpgradeNote,
} from './attendance-calendar.util';
import { ATTENDANCE_ELIGIBLE_STATUS_WHERE } from './attendance-eligibility.util';
import {
  getShiftAttendanceDate,
  minutesSinceShiftStart,
  parseTimeToMinutes,
  toPakistanDateOnly,
  toPakistanMinutesOfDay,
} from './shift-time.util';

const AUTO_ABSENT_24H_NOTE = 'Auto-marked absent for 24-hour shift';

@Injectable()
export class ShiftAbsentScheduler {
  private readonly logger = new Logger(ShiftAbsentScheduler.name);

  constructor(
    private prisma: PrismaService,
    private payrollService: PayrollService,
  ) {}

  // Every 5 min (not 15) so an UNMARKED placeholder exists close to the
  // actual shift start rather than up to ~15 min after it. The lazy
  // backfill (ensureUnmarkedForActiveShiftsOnDate, attendance.service.ts)
  // already covers the gap instantly whenever someone views attendance;
  // this is only the proactive backstop for when nobody does. The +15
  // marking window below is left wider than the new 5-min cadence on
  // purpose — three consecutive ticks get a chance to catch each shift
  // start instead of exactly one, which is more forgiving of a delayed tick.
  @Cron('*/5 * * * *')
  async markShiftStartAbsent() {
    await this.normalizeLegacyAutoMarkedAbsent();

    const now = new Date();
    const nowMinutes = toPakistanMinutesOfDay(now);

    // Key off each employee's duty clock (with Shift template fallback) so
    // staff with dutyStartTime but no shiftId still get an UNMARKED row
    // when their shift begins (e.g. 02:30 starts).
    const employees = await this.prisma.employee.findMany({
      where: {
        relieverOnly: false,
        ...ATTENDANCE_ELIGIBLE_STATUS_WHERE,
      },
      include: { shift: true },
    });

    let marked = 0;

    for (const employee of employees) {
      const is24h =
        (employee.shift && is24HourShiftRecord(employee.shift)) ||
        is24HourShift(employee);

      if (is24h) {
        const attendanceDate = toPakistanDateOnly(now);
        if (isPreJoinAttendanceDate(attendanceDate, employee.joiningDate)) {
          continue;
        }

        const existing = await this.prisma.attendanceLog.findUnique({
          where: {
            employeeId_date_type: {
              employeeId: employee.id,
              date: attendanceDate,
              type: AttendanceLogType.REGULAR,
            },
          },
        });

        if (!existing) {
          const dutyStart =
            employee.dutyStartTime?.trim() ||
            employee.shift?.startTime?.trim() ||
            null;
          await this.prisma.attendanceLog.create({
            data: {
              employeeId: employee.id,
              branchId: employee.currentBranchId,
              date: attendanceDate,
              type: AttendanceLogType.REGULAR,
              status: AttendanceStatus.UNMARKED,
              source: AttendanceSource.MANUAL,
              note: AUTO_UNMARKED_NOTE,
              dutyStartTimeSnapshot: employee.dutyStartTime ?? dutyStart,
              dutyEndTimeSnapshot:
                employee.dutyEndTime ?? employee.shift?.endTime ?? null,
            },
          });
          marked++;
        }
        continue;
      }

      const dutyStart =
        employee.dutyStartTime?.trim() ||
        employee.shift?.startTime?.trim() ||
        null;
      if (!dutyStart) continue;

      const shiftStartMinutes = parseTimeToMinutes(dutyStart);
      const sinceStart = minutesSinceShiftStart(nowMinutes, shiftStartMinutes);
      // No upper bound: delayed ticks still create UNMARKED so HR can chase
      // and UA upgrade can run after 120 minutes.
      if (sinceStart < 0) {
        continue;
      }

      const attendanceDate = getShiftAttendanceDate(now, dutyStart);
      if (isPreJoinAttendanceDate(attendanceDate, employee.joiningDate)) {
        continue;
      }

      const existing = await this.prisma.attendanceLog.findUnique({
        where: {
          employeeId_date_type: {
            employeeId: employee.id,
            date: attendanceDate,
            type: AttendanceLogType.REGULAR,
          },
        },
      });

      if (!existing) {
        await this.prisma.attendanceLog.create({
          data: {
            employeeId: employee.id,
            branchId: employee.currentBranchId,
            date: attendanceDate,
            type: AttendanceLogType.REGULAR,
            status: AttendanceStatus.UNMARKED,
            source: AttendanceSource.MANUAL,
            note: AUTO_UNMARKED_NOTE,
            dutyStartTimeSnapshot: employee.dutyStartTime ?? dutyStart,
            dutyEndTimeSnapshot:
              employee.dutyEndTime ?? employee.shift?.endTime ?? null,
          },
        });
        marked++;
      }
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
      if (!isUninformedUpgradeNote(log.note)) continue;

      if (isPreJoinAttendanceDate(log.date, log.employee.joiningDate)) {
        continue;
      }

      // Prefer employee duty clock; fall back to linked Shift template.
      // Employees with duty times but no shiftId still need UA upgrade.
      const dutyStart =
        log.dutyStartTimeSnapshot?.trim() ||
        log.employee.dutyStartTime?.trim() ||
        log.employee.shift?.startTime?.trim() ||
        null;
      if (!dutyStart) continue;

      // 24-hour staff stay ABSENT / never UNINFORMED_ABSENT
      if (
        (log.employee.shift && is24HourShiftRecord(log.employee.shift)) ||
        is24HourShift(log.employee)
      ) {
        continue;
      }

      const expectedDate = getShiftAttendanceDate(now, dutyStart);

      if (log.date.getTime() !== expectedDate.getTime()) {
        continue;
      }

      const shiftStartMinutes = parseTimeToMinutes(dutyStart);
      const minutesSince = minutesSinceShiftStart(
        currentMinutes,
        shiftStartMinutes,
      );

      if (minutesSince < 120) continue;

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

      // Fires only after the transaction above has committed. UNMARKED/
      // ABSENT -> UNINFORMED_ABSENT changes this day's policy-credit
      // minutes in computeHourlyBreakdown (same credit-ladder floor as
      // PRESENT/ON_LEAVE/etc — see PayrollService), so a PENDING month's
      // basicStipend can genuinely change here.
      await this.payrollService.recomputePendingPayrollForAttendanceDate(
        log.employee.id,
        log.date,
      );

      upgraded++;
    }

    if (upgraded > 0) {
      this.logger.log(
        `Upgraded ${upgraded} employee(s) to uninformed absent after 2 hours`,
      );
    }

    await this.finalizeYesterday24HourUnmarked(pkYesterday);
  }

  /**
   * 24-hour staff stay UNMARKED all Pakistan calendar day (no UA, no late).
   * After midnight, leftover UNMARKED with no punch becomes ABSENT + absent SOP.
   */
  private async finalizeYesterday24HourUnmarked(pkYesterday: Date) {
    const leftover = await this.prisma.attendanceLog.findMany({
      where: {
        type: AttendanceLogType.REGULAR,
        date: pkYesterday,
        status: AttendanceStatus.UNMARKED,
        checkIn: null,
      },
      include: {
        employee: { include: { shift: true } },
      },
    });

    let closed = 0;
    for (const log of leftover) {
      if (
        !(
          (log.employee.shift && is24HourShiftRecord(log.employee.shift)) ||
          is24HourShift(log.employee)
        )
      ) {
        continue;
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.attendanceLog.update({
          where: { id: log.id },
          data: {
            status: AttendanceStatus.ABSENT,
            note: AUTO_ABSENT_24H_NOTE,
          },
        });

        await applyDisciplineRules(
          tx,
          log.employee.id,
          AttendanceStatus.ABSENT,
          log.date,
        );
      });

      await this.payrollService.recomputePendingPayrollForAttendanceDate(
        log.employee.id,
        log.date,
      );
      closed++;
    }

    if (closed > 0) {
      this.logger.log(
        `Closed ${closed} 24-hour unmarked row(s) as absent for prior calendar day`,
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
        relieverOnly: false,
        ...ATTENDANCE_ELIGIBLE_STATUS_WHERE,
      },
    });

    let marked = 0;

    for (const employee of employees) {
      if (isPreJoinAttendanceDate(date, employee.joiningDate)) {
        continue;
      }

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
            dutyStartTimeSnapshot: employee.dutyStartTime ?? null,
            dutyEndTimeSnapshot: employee.dutyEndTime ?? null,
          },
        });
        marked++;

        // Only the 24h-shift ABSENT branch is payroll-relevant here — a
        // bare UNMARKED create (normal shifts) contributes zero credit
        // either way, so recomputing for it would be pure wasted work.
        // Covers both callers (markShiftStartAbsent cron and
        // backfillAbsentForDate) since they both funnel through here.
        if (status === AttendanceStatus.ABSENT) {
          await this.payrollService.recomputePendingPayrollForAttendanceDate(
            employee.id,
            date,
          );
        }
      }
    }

    return marked;
  }

  /**
   * Convert old auto-marked ABSENT rows (no check-in) to UNMARKED —
   * except 24-hour shift absents, which stay ABSENT.
   */
  private async normalizeLegacyAutoMarkedAbsent(): Promise<void> {
    const rows = await this.prisma.attendanceLog.findMany({
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
      select: { id: true, employeeId: true, date: true },
    });

    for (const row of rows) {
      await this.prisma.$transaction(async (tx) => {
        await tx.attendanceLog.update({
          where: { id: row.id },
          data: {
            status: AttendanceStatus.UNMARKED,
            note: AUTO_UNMARKED_NOTE,
          },
        });
        await reverseAbsenceDeductionForDate(tx, row.employeeId, row.date);
      });
      await this.payrollService.recomputePendingPayrollForAttendanceDate(
        row.employeeId,
        row.date,
      );
    }
  }
}
