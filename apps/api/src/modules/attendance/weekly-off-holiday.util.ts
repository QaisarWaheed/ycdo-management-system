import { AttendanceLogType, AttendanceSource, AttendanceStatus, Employee, Prisma } from '@prisma/client';
import { isSchedulerAttendanceEligible } from '../employees/status-effective.util';
import { toPakistanDateOnly } from './shift-time.util';
import { isWeeklyOffDate } from './weekly-off.util';

type WeeklyOffEmployee = Pick<Employee, 'id' | 'currentBranchId' | 'status'> &
  Partial<Pick<Employee, 'joiningDate' | 'statusEffectiveFrom' | 'relieverOnly' | 'weeklyOffWeekdays' | 'dutyStartTime' | 'dutyEndTime'>>;

/** Missing rows only; never rewrite final attendance, punches, or older months. */
export async function ensureWeeklyOffHolidays(
  prisma: Pick<Prisma.TransactionClient, 'attendanceLog'>,
  employee: WeeklyOffEmployee,
  date?: Date,
  now = new Date(),
): Promise<number> {
  if (!employee.weeklyOffWeekdays?.length) return 0;
  const today = toPakistanDateOnly(now);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const dates = date ? [date] : Array.from({ length: today.getUTCDate() }, (_, i) =>
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), i + 1)));
  const eligible = dates.filter(day => day >= monthStart && day <= today &&
    isWeeklyOffDate(employee.weeklyOffWeekdays, day) && isSchedulerAttendanceEligible(employee, day));
  if (!eligible.length) return 0;
  const inserted = await prisma.attendanceLog.createMany({
    skipDuplicates: true,
    data: eligible.map(day => ({
      employeeId: employee.id, branchId: employee.currentBranchId, date: day,
      type: AttendanceLogType.REGULAR, status: AttendanceStatus.HOLIDAY,
      source: AttendanceSource.MANUAL, note: 'Assigned Weekly Off',
      dutyStartTimeSnapshot: employee.dutyStartTime ?? null,
      dutyEndTimeSnapshot: employee.dutyEndTime ?? null,
    })),
  });
  return inserted.count;
}
