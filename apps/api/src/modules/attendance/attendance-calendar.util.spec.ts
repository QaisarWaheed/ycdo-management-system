import {
  calendarDatesForAttendanceMonth,
  calendarDatesInMonth,
  isPreJoinAttendanceDate,
  isUninformedUpgradeNote,
  MONTH_CALENDAR_UNMARKED_NOTE,
  pakistanMonthDateRange,
  PRE_JOIN_UNMARKED_NOTE,
} from './attendance-calendar.util';

describe('attendance-calendar.util', () => {
  it('returns UTC-midnight first and last days for a 30-day month', () => {
    const { start, end } = pakistanMonthDateRange(2026, 9);
    expect(start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });

  it('lists every calendar day in September 2026', () => {
    const dates = calendarDatesInMonth(2026, 9);
    expect(dates).toHaveLength(30);
    expect(dates[0].toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(dates[13].toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(dates[29].toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });

  it('treats days before joiningDate as pre-join', () => {
    const joining = new Date(Date.UTC(2026, 8, 14));
    expect(
      isPreJoinAttendanceDate(new Date(Date.UTC(2026, 8, 13)), joining),
    ).toBe(true);
    expect(
      isPreJoinAttendanceDate(new Date(Date.UTC(2026, 8, 14)), joining),
    ).toBe(false);
  });

  it('does not upgrade pre-join unmarked notes to uninformed absent', () => {
    expect(isUninformedUpgradeNote(PRE_JOIN_UNMARKED_NOTE)).toBe(false);
    expect(isUninformedUpgradeNote(MONTH_CALENDAR_UNMARKED_NOTE)).toBe(true);
  });

  it('caps the current month at today and omits future months', () => {
    const now = new Date(Date.UTC(2026, 7, 14, 10, 0, 0)); // 15:00 PK on 14 Aug
    const dates = calendarDatesForAttendanceMonth(2026, 8, now);
    expect(dates).toHaveLength(14);
    expect(dates[0].toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(dates[13].toISOString()).toBe('2026-08-14T00:00:00.000Z');
    expect(calendarDatesForAttendanceMonth(2026, 7, now)).toHaveLength(31);
    expect(calendarDatesForAttendanceMonth(2026, 9, now)).toHaveLength(0);
  });
});
