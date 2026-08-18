import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AttendanceLogType,
  AttendanceStatus,
  LeaveStatus,
  LeaveType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { reconcileShortLeaveAttendance } from './short-leave.util';
import { toPakistanDateOnly } from './shift-time.util';

/**
 * Closes the gap for a genuinely prospective Portal Short Leave: one
 * approved before the actual day's attendance exists, so its 2h/3h
 * duration rule could not be validated at approval time (see
 * short-leave.util.ts's reconcileShortLeaveAttendance doc comment, which
 * also explains why no placeholder AttendanceLog is ever created).
 *
 * Query, exactly:
 *   SELECT * FROM LeaveRecord
 *   WHERE leaveType = 'SHORT_LEAVE' AND status = 'APPROVED'
 *     AND startDate IN (today, yesterday)
 * — bounded to exactly two effective LEAVE dates (LeaveRecord.startDate,
 * the day the leave is FOR — never createdAt/approval time, so a leave
 * approved a week in advance is picked up the moment its startDate falls
 * into this window, regardless of how long ago it was approved). This
 * mirrors shift-missing-checkout.scheduler.ts's proven [today, yesterday]
 * window and the same underlying justification: attendance for "today" is
 * captured today, and "yesterday" stays in scope only because an overnight
 * shift's session, or a brief biometric sync delay, can still be finalized
 * shortly after midnight. Each matched LeaveRecord does exactly one
 * indexed point lookup on AttendanceLog's (employeeId, date, type) unique
 * key — no table scan, no unbounded history. Expected scope: at most a
 * handful of employees request Short Leave on any given day, so this is
 * two cheap indexed queries plus a handful of point lookups per run, not a
 * scan of historical records.
 *
 * Deliberately does NOT touch biometric capture or any check-in/check-out
 * path — those stay completely unmodified. Instead, this periodically
 * re-runs the exact same idempotent reconcileShortLeaveAttendance() used
 * everywhere else, now that real checkIn/checkOut may exist:
 *  - If duration is now valid: converts the row to SHORT_LEAVE (full-day
 *    credit, late-discipline reversal where applicable).
 *  - If duration is now invalid: does nothing. The normal biometric/manual
 *    check-in path (untouched, and never having seen a placeholder to
 *    collide with) has already computed and applied the correct
 *    LATE/HALF_DAY/PRESENT status and its normal discipline — there is
 *    nothing to revert, because nothing was ever incorrectly overridden.
 */
const RECONCILE_STATUSES_TO_SKIP: AttendanceStatus[] = [
  AttendanceStatus.SHORT_LEAVE,
];

@Injectable()
export class ProspectiveShortLeaveScheduler {
  private readonly logger = new Logger(ProspectiveShortLeaveScheduler.name);

  constructor(private prisma: PrismaService) {}

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

      // No real attendance yet — nothing to validate against. Left for a
      // future run; once the leave's startDate falls out of the
      // [today, yesterday] window it is no longer reconsidered (matches
      // shift-missing-checkout.scheduler.ts's same bounded-window tradeoff).
      if (!log?.checkIn) continue;

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

      reconciled++;
    }

    if (reconciled > 0) {
      this.logger.log(
        `Reconciled ${reconciled} prospective Short Leave record(s) against now-available attendance`,
      );
    }
  }
}
