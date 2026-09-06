import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceLogType, AttendanceStatus, Prisma } from '@prisma/client';
import { isExitEmployeeStatus } from '../employees/status-effective.util';
import { splitPaidUnpaidLeaveDays } from '../payroll/payroll-hours.util';
import {
  calendarDatesForAttendanceMonth,
  pakistanMonthDateRange,
} from './attendance-calendar.util';
import { toPakistanDateOnly } from './attendance-late.util';
import { summarizeAttendanceLogs } from './attendance-summary.util';

/** Read-only monthly card. Stored final statuses are never reconstructed from punches or today's roster. */
export async function loadAttendanceCard(
  prisma: Pick<
    Prisma.TransactionClient,
    'employee' | 'attendanceLog' | 'additionalWorkingDay'
  >,
  employeeId: string,
  month: number,
  year: number,
) {
  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 9999
  ) {
    throw new BadRequestException('A valid month and year are required');
  }
  const { start, end } = pakistanMonthDateRange(year, month);
  const [employee, storedLogs, extraDays] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        joiningDate: true,
        status: true,
        statusEffectiveFrom: true,
        monthlyAllowedLeaves: true,
      },
    }),
    prisma.attendanceLog.findMany({
      where: {
        employeeId,
        type: AttendanceLogType.REGULAR,
        date: { gte: start, lte: end },
      },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        status: true,
        overtimeMinutes: true,
        lateMinutes: true,
        overtimePending: true,
        overtimeApprovedAt: true,
      },
    }),
    prisma.additionalWorkingDay.findMany({
      where: { employeeId, date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
      select: { date: true, relieverSessionId: true },
    }),
  ]);
  if (!employee)
    throw new NotFoundException(`Employee with id ${employeeId} not found`);
  const logs = [...storedLogs].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  const loggedDates = new Set<string>();
  const days = logs.map((log) => {
    if (
      !(log.date instanceof Date) ||
      !Number.isFinite(log.date.getTime()) ||
      log.date < start ||
      log.date > end
    ) {
      throw new ConflictException('Attendance Card contains an invalid date');
    }
    const date = log.date.toISOString().slice(0, 10);
    if (loggedDates.has(date))
      throw new ConflictException(`Duplicate final attendance date: ${date}`);
    if (!Object.values(AttendanceStatus).includes(log.status)) {
      throw new ConflictException(`Invalid final attendance status on ${date}`);
    }
    loggedDates.add(date);
    return { date, status: log.status };
  });
  const leave = splitPaidUnpaidLeaveDays({
    onLeaveDates: logs
      .filter((log) => log.status === AttendanceStatus.ON_LEAVE)
      .map((log) => log.date),
    monthlyAllowedLeaves: employee.monthlyAllowedLeaves,
  });
  const joiningDate = employee.joiningDate
    ? toPakistanDateOnly(employee.joiningDate)
    : null;
  const exitDate =
    isExitEmployeeStatus(employee.status) && employee.statusEffectiveFrom
      ? toPakistanDateOnly(employee.statusEffectiveFrom)
      : null;
  const missingDates = calendarDatesForAttendanceMonth(year, month)
    .filter(
      (date) =>
        (!joiningDate || date >= joiningDate) && (!exitDate || date < exitDate),
    )
    .map((date) => date.toISOString().slice(0, 10))
    .filter((date) => !loggedDates.has(date));
  const summary = summarizeAttendanceLogs(logs, 0);
  const risks = [
    'Overtime provenance: Card OT is the stored REGULAR overtimeMinutes total; separate OVERTIME rows are excluded and approval is not inferred or changed.',
  ];
  if (logs.some((log) => log.overtimePending)) {
    risks.push(
      'Pending overtime exists in the Card source; stored overtime totals retain it.',
    );
  }
  if (logs.some((log) => log.overtimeMinutes > 0 && !log.overtimeApprovedAt)) {
    risks.push(
      'Some stored overtime has no explicit approval timestamp; its approval origin requires review.',
    );
  }
  if (missingDates.length) {
    risks.push(
      'Missing dates have no stored final REGULAR status; these may include weekly offs. No status was inferred from the current roster.',
    );
  }
  if (logs.some(log => (joiningDate && log.date < joiningDate) || (exitDate && log.date >= exitDate))) {
    risks.push('Stored attendance exists outside recorded joining/exit dates. Card preserves those explicit classifications; HR must verify the employment dates and attendance evidence.');
  }
  if (isExitEmployeeStatus(employee.status) && !employee.statusEffectiveFrom) {
    risks.push(
      'Exit eligibility is uncertain because the employee has no status effective date.',
    );
  }
  return {
    ...summary,
    employeeId,
    month,
    year,
    calendarDays: end.getUTCDate(),
    days,
    paidLeaveDays: leave.paidLeaveDays,
    unpaidLeaveDays: leave.unpaidLeaveDays,
    paidLeaveDateKeys: [...leave.paidLeaveDateKeys],
    additionalWorkingDays: extraDays.length,
    overtimeHours: Math.round((summary.overtimeMinutes / 60) * 100) / 100,
    pendingOvertimeMinutes: logs.reduce((sum, log) => sum + (log.overtimePending ? log.overtimeMinutes : 0), 0),
    missingDates,
    risks,
  };
}

export type AttendanceCard = Awaited<ReturnType<typeof loadAttendanceCard>>;
