import {
  AttendanceLogType,
  AttendanceStatus,
  DisciplineCategory,
  EmployeeStatus,
  Prisma,
} from '@prisma/client';
import { pakistanMonthDateRange } from '../attendance/attendance-calendar.util';
import { toPakistanDateOnly } from '../attendance/attendance-late.util';
import { MISSING_CHECKOUT_CYCLE_FROM } from '../attendance/missing-checkout-policy';
import { isExitEmployeeStatus } from '../employees/status-effective.util';

/** Where every calendar day of the month went (counts in days). */
export interface PayslipDayBreakdown {
  totalDays: number;
  beforeJoining: number;
  joinedOn?: string;
  afterExit: number;
  exitOn?: string;
  present: number;
  late: number;
  halfDay: number;
  shortLeave: number;
  swapCovered: number;
  holiday: number;
  paidLeave: number;
  unpaidLeave: number;
  absent: number;
  uninformedAbsent: number;
  /** Past days with no final attendance (missing or UNMARKED). */
  notMarked: number;
  /** Days of a running month not reached yet. */
  upcoming: number;
  /** Days of Basic paid (the figure payroll used). */
  paidDays: number;
}

/** Dates behind each slip line, as "5 Sep". */
export interface PayslipDayDates {
  late: string[];
  earlyCheckout: string[];
  missedCheckout: string[];
  absent: string[];
  uninformedAbsent: string[];
  paidLeave: string[];
  unpaidLeave: string[];
  halfDay: string[];
  notMarked: string[];
  overtime: Array<{ date: string; hours: number }>;
  extraDays: Array<{ date: string; note?: string }>;
}

export interface PayslipDayDetails {
  breakdown: PayslipDayBreakdown;
  dates: PayslipDayDates;
}

export interface SlipDayFacts {
  month: number;
  year: number;
  logs: Array<{
    date: Date;
    status: AttendanceStatus;
    overtimeMinutes: number;
    earlyOutMinutes: number | null;
  }>;
  extraDays: Array<{ date: Date; note: string | null; branch?: string | null }>;
  missedCheckouts: Date[];
}

/** Per-day facts the Attendance Card only keeps as counts. */
export async function loadSlipDayFacts(
  db: Pick<Prisma.TransactionClient, 'attendanceLog' | 'additionalWorkingDay'> &
    Partial<Pick<Prisma.TransactionClient, 'disciplineEvent'>>,
  employeeId: string,
  month: number,
  year: number,
): Promise<SlipDayFacts | null> {
  // Unit-test doubles of Prisma often omit these models; real clients always have them.
  if (!db.attendanceLog?.findMany || !db.additionalWorkingDay?.findMany) return null;
  const { start, end } = pakistanMonthDateRange(year, month);
  const [logs, extraDays, missed] = await Promise.all([
    db.attendanceLog.findMany({
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
        earlyOutMinutes: true,
      },
    }),
    db.additionalWorkingDay.findMany({
      where: { employeeId, date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        note: true,
        relieverSession: { select: { branch: { select: { name: true } } } },
      },
    }),
    // Same incidents the Card counts for the missed-checkout penalty.
    db.disciplineEvent
      ? db.disciplineEvent.findMany({
          where: {
            employeeId,
            category: DisciplineCategory.MISSING_CHECKOUT,
            incidentDate: {
              gte:
                start > MISSING_CHECKOUT_CYCLE_FROM
                  ? start
                  : MISSING_CHECKOUT_CYCLE_FROM,
              lte: end,
            },
          },
          orderBy: { incidentDate: 'asc' },
          select: { incidentDate: true },
        })
      : Promise.resolve([] as Array<{ incidentDate: Date }>),
  ]);
  return {
    month,
    year,
    logs,
    extraDays: extraDays.map((d) => ({
      date: d.date,
      note: d.note,
      branch: d.relieverSession?.branch?.name ?? null,
    })),
    missedCheckouts: missed.map((m) => toPakistanDateOnly(m.incidentDate)),
  };
}

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const key = (d: Date) => d.toISOString().slice(0, 10);
const dayLabel = (d: Date) => `${d.getUTCDate()} ${MONTH_ABBR[d.getUTCMonth()]}`;

/**
 * ["2 Sep","5 Sep"] → "2, 5 Sep"; items with extra text stay whole
 * ("14 Sep (in place of …)"). At most `max` items, then "+N more".
 */
export function formatDayList(dates: string[], max = 10): string {
  if (!dates.length) return '';
  const more = dates.length > max ? ` +${dates.length - max} more` : '';
  const shown = dates.slice(0, max);
  if (shown.some((s) => s.split(' ').length > 2)) return shown.join(', ') + more;
  const month = shown[0].split(' ')[1] ?? '';
  return `${shown.map((s) => s.split(' ')[0]).join(', ')} ${month}${more}`;
}

/**
 * Day-by-day explanation of a month for the slip: where each calendar day
 * went and the dates behind the late / early / missed-checkout / overtime /
 * extra-day lines. Presentation only; pay is never recalculated here.
 */
export function buildPayslipDayDetails(input: {
  facts: SlipDayFacts;
  employee: {
    joiningDate?: Date | null;
    status?: string | null;
    statusEffectiveFrom?: Date | null;
  };
  paidLeaveDateKeys: string[];
  paidDays: number;
  now?: Date;
}): PayslipDayDetails {
  const { facts, employee } = input;
  const { start, end } = pakistanMonthDateRange(facts.year, facts.month);
  const all: Date[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000)
    all.push(new Date(t));
  const joining = employee.joiningDate
    ? toPakistanDateOnly(employee.joiningDate)
    : null;
  const exit =
    employee.status &&
    isExitEmployeeStatus(employee.status as EmployeeStatus) &&
    employee.statusEffectiveFrom
      ? toPakistanDateOnly(employee.statusEffectiveFrom)
      : null;
  const today = key(
    new Date((input.now ?? new Date()).getTime() + 5 * 60 * 60 * 1000),
  );
  const paidLeave = new Set(input.paidLeaveDateKeys);
  const byDate = new Map(facts.logs.map((l) => [key(l.date), l]));

  const dates: PayslipDayDates = {
    late: [],
    earlyCheckout: [],
    missedCheckout: facts.missedCheckouts.map(dayLabel),
    absent: [],
    uninformedAbsent: [],
    paidLeave: [],
    unpaidLeave: [],
    halfDay: [],
    notMarked: [],
    overtime: [],
    extraDays: facts.extraDays.map((d) => {
      const note = d.note?.trim() || (d.branch ? `reliever at ${d.branch}` : '');
      return { date: dayLabel(d.date), ...(note ? { note } : {}) };
    }),
  };
  const b: PayslipDayBreakdown = {
    totalDays: all.length,
    beforeJoining: 0,
    ...(joining && joining > start ? { joinedOn: dayLabel(joining) } : {}),
    afterExit: 0,
    ...(exit && exit <= end ? { exitOn: dayLabel(exit) } : {}),
    present: 0,
    late: 0,
    halfDay: 0,
    shortLeave: 0,
    swapCovered: 0,
    holiday: 0,
    paidLeave: 0,
    unpaidLeave: 0,
    absent: 0,
    uninformedAbsent: 0,
    notMarked: 0,
    upcoming: 0,
    paidDays: input.paidDays,
  };

  for (const d of all) {
    const k = key(d);
    const label = dayLabel(d);
    const log = byDate.get(k);
    if (log && log.overtimeMinutes > 0)
      dates.overtime.push({
        date: label,
        hours: Math.round((log.overtimeMinutes / 60) * 10) / 10,
      });
    if (log && (log.earlyOutMinutes ?? 0) > 0) dates.earlyCheckout.push(label);
    if (!log && joining && d < joining) {
      b.beforeJoining++;
      continue;
    }
    if (!log && exit && d >= exit) {
      b.afterExit++;
      continue;
    }
    switch (log?.status) {
      case AttendanceStatus.PRESENT:
        b.present++;
        break;
      case AttendanceStatus.LATE:
        b.late++;
        dates.late.push(label);
        break;
      case AttendanceStatus.HALF_DAY:
        b.halfDay++;
        dates.halfDay.push(label);
        break;
      case AttendanceStatus.SHORT_LEAVE:
        b.shortLeave++;
        break;
      case AttendanceStatus.SWAP_COVERED:
        b.swapCovered++;
        break;
      case AttendanceStatus.HOLIDAY:
        b.holiday++;
        break;
      case AttendanceStatus.ON_LEAVE:
        if (paidLeave.has(k)) {
          b.paidLeave++;
          dates.paidLeave.push(label);
        } else {
          b.unpaidLeave++;
          dates.unpaidLeave.push(label);
        }
        break;
      case AttendanceStatus.ABSENT:
        b.absent++;
        dates.absent.push(label);
        break;
      case AttendanceStatus.UNINFORMED_ABSENT:
        b.uninformedAbsent++;
        dates.uninformedAbsent.push(label);
        break;
      default:
        // UNMARKED or no final status yet.
        if (k > today) b.upcoming++;
        else {
          b.notMarked++;
          dates.notMarked.push(label);
        }
    }
  }
  return { breakdown: b, dates };
}

/** What the "days not paid" are made of, in days. */
export function unpaidDayParts(
  d: PayslipDayDetails,
): Array<{ label: string; days: number; note?: string }> {
  const b = d.breakdown;
  const list = (dates: string[]) => formatDayList(dates) || undefined;
  return [
    {
      label: 'Before joining',
      days: b.beforeJoining,
      note: b.joinedOn ? `joined ${b.joinedOn}` : undefined,
    },
    {
      label: 'After leaving',
      days: b.afterExit,
      note: b.exitOn ? `left ${b.exitOn}` : undefined,
    },
    { label: 'Unpaid leave', days: b.unpaidLeave, note: list(d.dates.unpaidLeave) },
    { label: 'Absent', days: b.absent, note: list(d.dates.absent) },
    {
      label: 'Uninformed absent',
      days: b.uninformedAbsent,
      note: list(d.dates.uninformedAbsent),
    },
    { label: 'Half days', days: b.halfDay * 0.5, note: list(d.dates.halfDay) },
    {
      label: 'Attendance not marked',
      days: b.notMarked,
      note: list(d.dates.notMarked),
    },
    { label: 'Not paid yet', days: b.upcoming, note: 'month still running' },
  ].filter((p) => p.days > 0);
}
