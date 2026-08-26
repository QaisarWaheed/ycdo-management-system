import { AttendanceStatus, EmployeeStatus, Prisma } from '@prisma/client';
import { pakistanMonthDateRange } from './attendance-calendar.util';
import { BRANCH_LABEL_SELECT } from '../../common/branch-select.util';

export type SuspensionWatchReason =
  | 'LATE_NEAR'
  | 'LATE_DUE'
  | 'UA_NEAR'
  | 'UA_DUE';

export type SuspensionWatchlistEntry = {
  employeeId: string;
  fullName: string;
  employeeCode: string | null;
  biometricId: string | null;
  phone: string | null;
  branchId: string | null;
  branchName: string | null;
  lateDays: number;
  uninformedAbsentDays: number;
  reasons: SuspensionWatchReason[];
};

export type SuspensionWatchlistResult = {
  month: string;
  year: number;
  monthNumber: number;
  near: SuspensionWatchlistEntry[];
  due: SuspensionWatchlistEntry[];
  counts: { near: number; due: number };
};

const EXCLUDED_STATUSES: EmployeeStatus[] = [
  EmployeeStatus.TERMINATED,
  EmployeeStatus.RESIGNED,
  EmployeeStatus.DISMISSED,
];

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isLateDrivenHalfDay(row: {
  status: AttendanceStatus;
  note: string | null;
  lateMinutes: number | null;
}): boolean {
  if (row.status !== AttendanceStatus.HALF_DAY) return false;
  if (row.note && /short leave/i.test(row.note)) return false;
  return (row.lateMinutes ?? 0) > 0;
}

/**
 * Monthly late / uninformed-absent counts → Near (6–8 late or UA=2) and
 * Due (≥9 late or UA≥3). Due wins if both apply.
 */
type WatchlistDb = {
  attendanceLog: { findMany: Prisma.TransactionClient['attendanceLog']['findMany'] };
  employee: { findMany: Prisma.TransactionClient['employee']['findMany'] };
};

export async function buildSuspensionWatchlist(
  db: WatchlistDb,
  year: number,
  month: number,
): Promise<SuspensionWatchlistResult> {
  const { start, end } = pakistanMonthDateRange(year, month);
  const monthLabel = `${year}-${String(month).padStart(2, '0')}`;

  const logs = await db.attendanceLog.findMany({
    where: {
      date: { gte: start, lte: end },
      employee: { status: { notIn: EXCLUDED_STATUSES } },
      OR: [
        { status: AttendanceStatus.LATE },
        {
          status: AttendanceStatus.HALF_DAY,
          lateMinutes: { gt: 0 },
        },
        { status: AttendanceStatus.UNINFORMED_ABSENT },
      ],
    },
    select: {
      employeeId: true,
      date: true,
      status: true,
      note: true,
      lateMinutes: true,
    },
  });

  const lateDaysByEmployee = new Map<string, Set<string>>();
  const uaDaysByEmployee = new Map<string, Set<string>>();

  for (const row of logs) {
    const key = dayKey(row.date);
    if (row.status === AttendanceStatus.UNINFORMED_ABSENT) {
      if (!uaDaysByEmployee.has(row.employeeId)) {
        uaDaysByEmployee.set(row.employeeId, new Set());
      }
      uaDaysByEmployee.get(row.employeeId)!.add(key);
      continue;
    }
    if (
      row.status === AttendanceStatus.LATE ||
      isLateDrivenHalfDay(row)
    ) {
      if (!lateDaysByEmployee.has(row.employeeId)) {
        lateDaysByEmployee.set(row.employeeId, new Set());
      }
      lateDaysByEmployee.get(row.employeeId)!.add(key);
    }
  }

  const candidateIds = new Set<string>([
    ...lateDaysByEmployee.keys(),
    ...uaDaysByEmployee.keys(),
  ]);

  const nearIds: string[] = [];
  const dueIds: string[] = [];
  const meta = new Map<
    string,
    {
      lateDays: number;
      uninformedAbsentDays: number;
      reasons: SuspensionWatchReason[];
      bucket: 'near' | 'due';
    }
  >();

  for (const employeeId of candidateIds) {
    const lateDays = lateDaysByEmployee.get(employeeId)?.size ?? 0;
    const uninformedAbsentDays = uaDaysByEmployee.get(employeeId)?.size ?? 0;
    const reasons: SuspensionWatchReason[] = [];

    const lateDue = lateDays >= 9;
    const uaDue = uninformedAbsentDays >= 3;
    const lateNear = lateDays >= 6 && lateDays <= 8;
    const uaNear = uninformedAbsentDays === 2;

    if (lateDue) reasons.push('LATE_DUE');
    if (uaDue) reasons.push('UA_DUE');
    if (!lateDue && lateNear) reasons.push('LATE_NEAR');
    if (!uaDue && uaNear) reasons.push('UA_NEAR');

    if (reasons.length === 0) continue;

    const bucket = lateDue || uaDue ? 'due' : 'near';
    meta.set(employeeId, {
      lateDays,
      uninformedAbsentDays,
      reasons,
      bucket,
    });
    if (bucket === 'due') dueIds.push(employeeId);
    else nearIds.push(employeeId);
  }

  const allIds = [...nearIds, ...dueIds];
  if (allIds.length === 0) {
    return {
      month: monthLabel,
      year,
      monthNumber: month,
      near: [],
      due: [],
      counts: { near: 0, due: 0 },
    };
  }

  const employees = await db.employee.findMany({
    where: { id: { in: allIds } },
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      biometricId: true,
      phone: true,
      currentBranchId: true,
      currentBranch: { select: BRANCH_LABEL_SELECT },
    },
  });
  const byId = new Map(employees.map((e) => [e.id, e]));

  const toEntry = (employeeId: string): SuspensionWatchlistEntry | null => {
    const emp = byId.get(employeeId);
    const m = meta.get(employeeId);
    if (!emp || !m) return null;
    return {
      employeeId: emp.id,
      fullName: emp.fullName,
      employeeCode: emp.employeeCode,
      biometricId: emp.biometricId,
      phone: emp.phone,
      branchId: emp.currentBranchId,
      branchName: emp.currentBranch?.name ?? null,
      lateDays: m.lateDays,
      uninformedAbsentDays: m.uninformedAbsentDays,
      reasons: m.reasons,
    };
  };

  const sortEntries = (a: SuspensionWatchlistEntry, b: SuspensionWatchlistEntry) =>
    a.fullName.localeCompare(b.fullName);

  const near = nearIds
    .map(toEntry)
    .filter((e): e is SuspensionWatchlistEntry => e != null)
    .sort(sortEntries);
  const due = dueIds
    .map(toEntry)
    .filter((e): e is SuspensionWatchlistEntry => e != null)
    .sort(sortEntries);

  return {
    month: monthLabel,
    year,
    monthNumber: month,
    near,
    due,
    counts: { near: near.length, due: due.length },
  };
}
