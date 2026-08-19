import { toPakistanDateOnly } from './attendance-late.util';

export const AUTO_UNMARKED_NOTE = 'Auto-marked unmarked at shift start';
export const PRE_JOIN_UNMARKED_NOTE = 'Unmarked — employee had not joined';
export const MONTH_CALENDAR_UNMARKED_NOTE =
  'Auto-marked unmarked for month calendar';

const UNINFORMED_UPGRADE_NOTES = new Set([
  AUTO_UNMARKED_NOTE,
  'Auto-marked absent at shift start',
  MONTH_CALENDAR_UNMARKED_NOTE,
]);

/** Pakistan calendar first/last day of a 1-indexed month, stored as UTC midnight. */
export function pakistanMonthDateRange(
  year: number,
  month: number,
): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0)),
  };
}

export function calendarDatesInMonth(year: number, month: number): Date[] {
  const { start, end } = pakistanMonthDateRange(year, month);
  const dates: Date[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
    dates.push(new Date(t));
  }
  return dates;
}

export function isPreJoinAttendanceDate(
  date: Date,
  joiningDate: Date | null | undefined,
): boolean {
  if (!joiningDate) return false;
  return date.getTime() < toPakistanDateOnly(joiningDate).getTime();
}

export function isUninformedUpgradeNote(note: string | null | undefined): boolean {
  return !!note && UNINFORMED_UPGRADE_NOTES.has(note);
}

/** Pakistan calendar year/month (1-indexed) for a stored attendance/leave Date. */
export function pakistanYearMonthFromDate(date: Date): {
  year: number;
  month: number;
} {
  const pk = toPakistanDateOnly(date);
  return { year: pk.getUTCFullYear(), month: pk.getUTCMonth() + 1 };
}

/** Inclusive calendar-day count between two UTC-midnight (or date-only) instants. */
export function inclusiveUtcDayCount(start: Date, endInclusive: Date): number {
  const a = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
  );
  const b = Date.UTC(
    endInclusive.getUTCFullYear(),
    endInclusive.getUTCMonth(),
    endInclusive.getUTCDate(),
  );
  if (b < a) return 0;
  return Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

/** Pakistan calendar month window for a stored date (UTC midnight bounds). */
export function pakistanMonthWindowFromDate(date: Date): {
  year: number;
  month: number;
  startOfMonth: Date;
  endOfMonth: Date;
} {
  const { year, month } = pakistanYearMonthFromDate(date);
  return {
    year,
    month,
    startOfMonth: new Date(Date.UTC(year, month - 1, 1)),
    endOfMonth: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
  };
}
