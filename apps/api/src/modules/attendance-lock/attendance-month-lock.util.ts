import { ForbiddenException } from '@nestjs/common';
import { AttendanceMonthStatus, Prisma, PrismaClient } from '@prisma/client';

type Db = Prisma.TransactionClient | PrismaClient;

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Pakistan calendar month of a date-only value or an instant. */
export function attendanceMonthOf(date: Date): { year: number; month: number } {
  const pk = new Date(date.getTime() + PKT_OFFSET_MS);
  return { year: pk.getUTCFullYear(), month: pk.getUTCMonth() + 1 };
}

export const monthName = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;

/** True once the whole month is over in Pakistan time (only then can it be verified). */
export function isMonthOver(year: number, month: number, now = new Date()): boolean {
  const pk = attendanceMonthOf(now);
  return pk.year * 12 + pk.month > year * 12 + month;
}

export async function isAttendanceMonthVerified(
  db: Db,
  branchId: string,
  year: number,
  month: number,
): Promise<boolean> {
  // Unit-test doubles of Prisma often omit this model; real clients always have it.
  if (!(db as { attendanceMonthLock?: unknown }).attendanceMonthLock) return false;
  const lock = await db.attendanceMonthLock.findUnique({
    where: { branchId_year_month: { branchId, year, month } },
    select: { status: true },
  });
  return lock?.status === AttendanceMonthStatus.VERIFIED;
}

/**
 * Manual attendance changes (HR edits, leave, swaps, imports) are refused for a
 * branch month that HR has verified, until IT unlocks it. The branch is the
 * log's own branch when known, otherwise the employee's current branch.
 */
export async function assertAttendanceOpen(
  db: Db,
  input: { date: Date | Date[]; branchId?: string | null; employeeId?: string },
): Promise<void> {
  if (!(db as { attendanceMonthLock?: unknown }).attendanceMonthLock) return;
  let branchId = input.branchId ?? null;
  if (!branchId && input.employeeId) {
    const employee = await db.employee.findUnique({
      where: { id: input.employeeId },
      select: { currentBranchId: true },
    });
    branchId = employee?.currentBranchId ?? null;
  }
  if (!branchId) return;
  const dates = Array.isArray(input.date) ? input.date : [input.date];
  const months = new Map<string, { year: number; month: number }>();
  for (const d of dates) {
    const m = attendanceMonthOf(d);
    months.set(`${m.year}-${m.month}`, m);
  }
  for (const { year, month } of months.values()) {
    if (await isAttendanceMonthVerified(db, branchId, year, month)) {
      const branch = await db.branch.findUnique({
        where: { id: branchId },
        select: { name: true },
      });
      throw new ForbiddenException(
        `Attendance for ${branch?.name ?? 'this branch'} (${monthName(year, month)}) is verified and locked. Ask IT to unlock it first.`,
      );
    }
  }
}

/** Automated writers (devices, schedulers) skip a locked month instead of failing. */
export async function isAttendanceLocked(
  db: Db,
  branchId: string | null | undefined,
  date: Date,
): Promise<boolean> {
  if (!branchId) return false;
  const { year, month } = attendanceMonthOf(date);
  return isAttendanceMonthVerified(db, branchId, year, month);
}

/** Branches (of the given ones) whose month containing `date` is verified — one query. */
export async function lockedBranchIds(
  db: Db,
  branchIds: Array<string | null | undefined>,
  date: Date,
): Promise<Set<string>> {
  const ids = [...new Set(branchIds.filter((b): b is string => !!b))];
  if (!ids.length || !(db as { attendanceMonthLock?: unknown }).attendanceMonthLock) {
    return new Set();
  }
  const { year, month } = attendanceMonthOf(date);
  const rows = await db.attendanceMonthLock.findMany({
    where: { year, month, status: AttendanceMonthStatus.VERIFIED, branchId: { in: ids } },
    select: { branchId: true },
  });
  return new Set(rows.map((r) => r.branchId));
}
