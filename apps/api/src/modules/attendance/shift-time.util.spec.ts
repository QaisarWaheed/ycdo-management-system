import {
  getShiftAttendanceDate,
  hasDutyStartedForAttendanceDate,
  statusFromLateMinutes,
  HALF_DAY_LATE_THRESHOLD_MINUTES,
} from './shift-time.util';

describe('statusFromLateMinutes (final payroll policy)', () => {
  it('uses >120 minutes as HALF_DAY threshold', () => {
    expect(HALF_DAY_LATE_THRESHOLD_MINUTES).toBe(120);
    expect(statusFromLateMinutes(0)).toBe('PRESENT');
    expect(statusFromLateMinutes(1)).toBe('LATE');
    expect(statusFromLateMinutes(60)).toBe('LATE');
    expect(statusFromLateMinutes(120)).toBe('LATE');
    expect(statusFromLateMinutes(121)).toBe('HALF_DAY');
  });
});

describe('hasDutyStartedForAttendanceDate', () => {
  const aug19 = new Date(Date.UTC(2026, 7, 19));
  const aug20 = new Date(Date.UTC(2026, 7, 20));
  const aug21 = new Date(Date.UTC(2026, 7, 21));

  it('overnight 21:00: does not materialize "today" at mid-morning', () => {
    // 20 Aug 10:00 PKT = 05:00 UTC
    const now = new Date(Date.UTC(2026, 7, 20, 5, 0, 0));
    expect(hasDutyStartedForAttendanceDate(aug20, '21:00', now)).toBe(false);
    expect(hasDutyStartedForAttendanceDate(aug19, '21:00', now)).toBe(true);
  });

  it('overnight 21:00: materializes today only after duty start', () => {
    // 20 Aug 21:05 PKT = 16:05 UTC
    const now = new Date(Date.UTC(2026, 7, 20, 16, 5, 0));
    expect(hasDutyStartedForAttendanceDate(aug20, '21:00', now)).toBe(true);
  });

  it('overnight 22:00: does not materialize next calendar day at 01:37', () => {
    // 21 Aug 01:37 PKT = 20 Aug 20:37 UTC
    const now = new Date(Date.UTC(2026, 7, 20, 20, 37, 0));
    expect(hasDutyStartedForAttendanceDate(aug21, '22:00', now)).toBe(false);
    expect(hasDutyStartedForAttendanceDate(aug20, '22:00', now)).toBe(true);
  });

  it('day shift 08:00: skips today before duty start', () => {
    // 20 Aug 06:00 PKT = 01:00 UTC
    const now = new Date(Date.UTC(2026, 7, 20, 1, 0, 0));
    expect(hasDutyStartedForAttendanceDate(aug20, '08:00', now)).toBe(false);
  });

  it('day shift 08:00: allows today after duty start', () => {
    // 20 Aug 08:10 PKT = 03:10 UTC
    const now = new Date(Date.UTC(2026, 7, 20, 3, 10, 0));
    expect(hasDutyStartedForAttendanceDate(aug20, '08:00', now)).toBe(true);
  });

  it('02:30 start: hidden before start, shown after', () => {
    // 21 Aug 02:00 PKT = 20 Aug 21:00 UTC
    const before = new Date(Date.UTC(2026, 7, 20, 21, 0, 0));
    expect(hasDutyStartedForAttendanceDate(aug21, '02:30', before)).toBe(false);
    // 21 Aug 02:35 PKT = 20 Aug 21:35 UTC
    const after = new Date(Date.UTC(2026, 7, 20, 21, 35, 0));
    expect(hasDutyStartedForAttendanceDate(aug21, '02:30', after)).toBe(true);
  });

  it('00:00 start: materializes after midnight', () => {
    // 21 Aug 01:37 PKT
    const now = new Date(Date.UTC(2026, 7, 20, 20, 37, 0));
    expect(hasDutyStartedForAttendanceDate(aug21, '00:00', now)).toBe(true);
  });

  it('never materializes future calendar days', () => {
    const now = new Date(Date.UTC(2026, 7, 20, 16, 0, 0));
    expect(hasDutyStartedForAttendanceDate(aug21, '21:00', now)).toBe(false);
  });
});

describe('getShiftAttendanceDate for overnight', () => {
  it('maps morning hours before 21:00 start back to yesterday', () => {
    // 20 Aug 10:00 PKT
    const now = new Date(Date.UTC(2026, 7, 20, 5, 0, 0));
    const date = getShiftAttendanceDate(now, '21:00');
    expect(date.toISOString().slice(0, 10)).toBe('2026-08-19');
  });

  it('maps evening after 21:00 start to today', () => {
    // 20 Aug 21:30 PKT
    const now = new Date(Date.UTC(2026, 7, 20, 16, 30, 0));
    const date = getShiftAttendanceDate(now, '21:00');
    expect(date.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('maps 01:37 before 22:00 start back to yesterday', () => {
    const now = new Date(Date.UTC(2026, 7, 20, 20, 37, 0));
    const date = getShiftAttendanceDate(now, '22:00');
    expect(date.toISOString().slice(0, 10)).toBe('2026-08-20');
  });
});
