import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AttendanceLogType,
  AttendanceSource,
  AttendanceStatus,
  LeaveStatus,
  LeaveType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import { reconcileShortLeaveAttendance } from './short-leave.util';
import { toPakistanDateOnly } from './shift-time.util';

/**
 * Materializes approved Short Leave for today/yesterday without inventing
 * biometric punches. Missing/UNMARKED no-punch rows become SHORT_LEAVE;
 * already-ABSENT/UNINFORMED_ABSENT records are left for separate recovery.
 * Rows with real attendance retain the existing settled-session duration
 * validation through reconcileShortLeaveAttendance.
 * Conditional updates and the attendance unique key make overlapping ticks
 * safe without overwriting biometric evidence or another settled status.
 */
const RECONCILE_STATUSES_TO_SKIP: AttendanceStatus[] = [
  AttendanceStatus.SHORT_LEAVE,
];

@Injectable()
export class ProspectiveShortLeaveScheduler {
  private readonly logger = new Logger(ProspectiveShortLeaveScheduler.name);

  constructor(
    private prisma: PrismaService,
    private payrollService: PayrollService,
  ) {}

  @Cron('*/15 * * * *')
  async reconcilePendingShortLeaves() {
    const now = new Date();
    const pkToday = toPakistanDateOnly(now);
    const pkYesterday = new Date(pkToday);
    pkYesterday.setUTCDate(pkYesterday.getUTCDate() - 1);

    const approvedShortLeaves = await this.prisma.leaveRecord.findMany({
      where: {
        leaveType: LeaveType.SHORT_LEAVE,
        status: LeaveStatus.APPROVED,
        startDate: { in: [pkToday, pkYesterday] },
      },
      select: {
        id: true,
        employeeId: true,
        startDate: true,
        employee: {
          select: {
            currentBranchId: true,
            dutyStartTime: true,
            dutyEndTime: true,
            dutyTotalHours: true,
            shift: { select: { name: true, startTime: true, endTime: true } },
          },
        },
      },
    });

    let reconciled = 0;

    for (const leave of approvedShortLeaves) {
      const log = await this.prisma.attendanceLog.findUnique({
        where: {
          employeeId_date_type: {
            employeeId: leave.employeeId,
            date: leave.startDate,
            type: AttendanceLogType.REGULAR,
          },
        },
        select: { checkIn: true, checkOut: true, status: true },
      });

      // Approval protects a no-punch day. Only materialize a missing row or
      // an UNMARKED placeholder; already-absent rows need separate recovery
      // of their financial/disciplinary consequences, not a silent rewrite.
      if (!log?.checkIn) {
        let changed = 0;
        if (!log) {
          const created = await this.prisma.attendanceLog.createMany({
            data: {
              employeeId: leave.employeeId,
              branchId: leave.employee.currentBranchId,
              date: leave.startDate,
              type: AttendanceLogType.REGULAR,
              status: AttendanceStatus.SHORT_LEAVE,
              source: AttendanceSource.MANUAL,
              dutyStartTimeSnapshot: leave.employee.dutyStartTime,
              dutyEndTimeSnapshot: leave.employee.dutyEndTime,
            },
            skipDuplicates: true,
          });
          changed = created.count;
        } else if (log.status === AttendanceStatus.UNMARKED) {
          const updated = await this.prisma.attendanceLog.updateMany({
            where: {
              employeeId: leave.employeeId,
              date: leave.startDate,
              type: AttendanceLogType.REGULAR,
              status: AttendanceStatus.UNMARKED,
              checkIn: null,
            },
            data: { status: AttendanceStatus.SHORT_LEAVE, lateMinutes: 0 },
          });
          changed = updated.count;
        }
        if (changed > 0) {
          await this.payrollService.recomputePendingPayrollForAttendanceDate(
            leave.employeeId,
            leave.startDate,
          );
          reconciled++;
        }
        continue;
      }

      // Already settled as SHORT_LEAVE (by a previous run) — idempotent skip.
      if (RECONCILE_STATUSES_TO_SKIP.includes(log.status)) continue;

      // Don't evaluate a still-open, same-day session — checkOut (or a
      // fully-passed day, i.e. "yesterday") means the session is settled
      // and won't gain a later early-departure that would turn a
      // currently-valid late-arrival-only read into an invalid split-side
      // one. A fully-passed day with checkOut still null is a legitimate
      // missing-checkout case; evaluateShortLeaveDeviation already treats
      // a null checkOut as "no early-departure side", so only the
      // late-arrival side is considered for it, same as elsewhere.
      const daySettled =
        log.checkOut != null || leave.startDate.getTime() < pkToday.getTime();
      if (!daySettled) continue;

      await this.prisma.$transaction(async (tx) => {
        await reconcileShortLeaveAttendance(
          tx,
          leave.employeeId,
          leave.startDate,
          leave.employee,
        );
      });

      // Fires only after the transaction above has committed. SHORT_LEAVE
      // is a full-day-credit status in computeHourlyBreakdown, same as
      // PRESENT/ON_LEAVE — see PayrollService.
      await this.payrollService.recomputePendingPayrollForAttendanceDate(
        leave.employeeId,
        leave.startDate,
      );

      reconciled++;
    }

    if (reconciled > 0) {
      this.logger.log(
        `Reconciled ${reconciled} prospective Short Leave record(s) against now-available attendance`,
      );
    }
  }
}
