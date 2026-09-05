import { AttendanceStatus } from '@prisma/client';
import {
  summarizeAttendanceLogs,
  toPayrollAttendanceReport,
} from './attendance-summary.util';

describe('summarizeAttendanceLogs', () => {
  it('counts every attendance status separately, including short leave', () => {
    const summary = summarizeAttendanceLogs([
      { status: AttendanceStatus.PRESENT, overtimeMinutes: 0, lateMinutes: 0 },
      { status: AttendanceStatus.PRESENT, overtimeMinutes: 30, lateMinutes: 0 },
      { status: AttendanceStatus.ABSENT, overtimeMinutes: 0, lateMinutes: 0 },
      { status: AttendanceStatus.UNINFORMED_ABSENT, overtimeMinutes: 0, lateMinutes: 0 },
      { status: AttendanceStatus.LATE, overtimeMinutes: 0, lateMinutes: 12 },
      { status: AttendanceStatus.HALF_DAY, overtimeMinutes: 0, lateMinutes: 0 },
      { status: AttendanceStatus.SHORT_LEAVE, overtimeMinutes: 0, lateMinutes: 0 },
      { status: AttendanceStatus.SHORT_LEAVE, overtimeMinutes: 0, lateMinutes: 0 },
      { status: AttendanceStatus.ON_LEAVE, overtimeMinutes: 0, lateMinutes: 0 },
      { status: AttendanceStatus.HOLIDAY, overtimeMinutes: 0, lateMinutes: 0 },
      { status: AttendanceStatus.SWAP_COVERED, overtimeMinutes: 0, lateMinutes: 0 },
      { status: AttendanceStatus.UNMARKED, overtimeMinutes: 0, lateMinutes: 0 },
    ]);

    expect(summary).toEqual({
      totalDays: 12,
      present: 2,
      absent: 1,
      late: 1,
      halfDay: 1,
      shortLeave: 2,
      onLeave: 1,
      uninformedAbsent: 1,
      holiday: 1,
      swapCovered: 1,
      unmarked: 1,
      weeklyOff: 0,
      overtimeMinutes: 30,
      totalLateMinutes: 12,
    });
  });

  it('does not mix short leave into half day or on leave', () => {
    const summary = summarizeAttendanceLogs([
      { status: AttendanceStatus.SHORT_LEAVE, overtimeMinutes: 0, lateMinutes: 0 },
      { status: AttendanceStatus.HALF_DAY, overtimeMinutes: 0, lateMinutes: 0 },
      { status: AttendanceStatus.ON_LEAVE, overtimeMinutes: 0, lateMinutes: 0 },
    ]);

    expect(summary.shortLeave).toBe(1);
    expect(summary.halfDay).toBe(1);
    expect(summary.onLeave).toBe(1);
  });

  it('maps profile summary into finance payroll columns', () => {
    const report = toPayrollAttendanceReport(
      summarizeAttendanceLogs([
        { status: AttendanceStatus.PRESENT, overtimeMinutes: 90, lateMinutes: 0 },
        { status: AttendanceStatus.SWAP_COVERED, overtimeMinutes: 0, lateMinutes: 0 },
        { status: AttendanceStatus.ABSENT, overtimeMinutes: 0, lateMinutes: 0 },
        { status: AttendanceStatus.UNINFORMED_ABSENT, overtimeMinutes: 0, lateMinutes: 0 },
        { status: AttendanceStatus.ON_LEAVE, overtimeMinutes: 0, lateMinutes: 0 },
        { status: AttendanceStatus.LATE, overtimeMinutes: 0, lateMinutes: 15 },
      ]),
      2,
    );
    expect(report).toEqual({
      present: 2,
      absent: 2,
      onLeave: 1,
      late: 1,
      overtimeHours: 1.5,
      extraWorkingDays: 2,
    });
  });

  it('returns zeros for an empty month', () => {
    expect(summarizeAttendanceLogs([])).toEqual({
      totalDays: 0,
      present: 0,
      absent: 0,
      late: 0,
      halfDay: 0,
      shortLeave: 0,
      onLeave: 0,
      uninformedAbsent: 0,
      holiday: 0,
      swapCovered: 0,
      unmarked: 0,
      weeklyOff: 0,
      overtimeMinutes: 0,
      totalLateMinutes: 0,
    });
  });

  it('adds the weekly-off calendar count on top of logged days (no log row exists for weekly-off days)', () => {
    const summary = summarizeAttendanceLogs(
      [
        { status: AttendanceStatus.PRESENT, overtimeMinutes: 0, lateMinutes: 0 },
      ],
      2,
    );
    expect(summary.weeklyOff).toBe(2);
    expect(summary.totalDays).toBe(3);
  });
});
