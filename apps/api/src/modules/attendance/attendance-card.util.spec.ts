import { AttendanceStatus, EmployeeStatus } from '@prisma/client';
import { loadAttendanceCard } from './attendance-card.util';
const row = (day: number, status: AttendanceStatus, extra = {}) => ({
  date: new Date(Date.UTC(2026, 7, day)),
  status,
  overtimeMinutes: 0,
  lateMinutes: 0,
  overtimePending: false,
  overtimeApprovedAt: null,
  ...extra,
});
function fixture(logs = [row(1, AttendanceStatus.PRESENT)], override = {}) {
  return {
    employee: {
      findUnique: jest.fn().mockResolvedValue({
        joiningDate: new Date('2026-08-01'),
        status: EmployeeStatus.ACTIVE,
        statusEffectiveFrom: null,
        monthlyAllowedLeaves: null,
        ...override,
      }),
    },
    attendanceLog: { findMany: jest.fn().mockResolvedValue(logs) },
    additionalWorkingDay: {
      findMany: jest.fn().mockResolvedValue([
        { date: new Date('2026-08-02'), relieverSessionId: null },
        { date: new Date('2026-08-03'), relieverSessionId: 'r' },
      ]),
    },
  };
}
describe('loadAttendanceCard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-07T10:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  it('counts stored statuses and allocates paid leave chronologically', async () => {
    const db = fixture([
      row(8, AttendanceStatus.ON_LEAVE),
      row(2, AttendanceStatus.ON_LEAVE),
      row(6, AttendanceStatus.ON_LEAVE),
      row(3, AttendanceStatus.HOLIDAY),
      row(4, AttendanceStatus.SHORT_LEAVE),
      row(5, AttendanceStatus.HALF_DAY),
    ]);
    const card = await loadAttendanceCard(db as any, 'e', 8, 2026);
    expect(card).toMatchObject({
      calendarDays: 31,
      totalDays: 6,
      onLeave: 3,
      paidLeaveDays: 2,
      unpaidLeaveDays: 1,
      holiday: 1,
      shortLeave: 1,
      halfDay: 1,
      weeklyOff: 0,
      additionalWorkingDays: 2,
      paidLeaveDateKeys: ['2026-08-02', '2026-08-06'],
    });
    expect(card.days[0]).toEqual({
      date: '2026-08-02',
      status: AttendanceStatus.ON_LEAVE,
    });
    expect(card.missingDates).toContain('2026-08-01');
    expect(db.attendanceLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          employeeId: 'e',
          type: 'REGULAR',
          date: { gte: new Date('2026-08-01'), lte: new Date('2026-08-31') },
        },
      }),
    );
  });
  it('respects zero allowance and reports OT provenance without changing totals', async () => {
    const db = fixture(
      [
        row(2, AttendanceStatus.ON_LEAVE),
        row(3, AttendanceStatus.PRESENT, {
          overtimeMinutes: 90,
          overtimePending: true,
        }),
      ],
      { monthlyAllowedLeaves: 0 },
    );
    const card = await loadAttendanceCard(db as any, 'e', 8, 2026);
    expect(card).toMatchObject({
      paidLeaveDays: 0,
      unpaidLeaveDays: 1,
      overtimeMinutes: 90,
      overtimeHours: 1.5,
    });
    expect(card.risks.join(' ')).toMatch(/pending/i);
    expect(card.risks.join(' ')).toMatch(/approval/i);
  });
  it('limits gaps by joining, exit and today without guessing weekly offs', async () => {
    const db = fixture([], {
      joiningDate: new Date('2026-08-29'),
      status: EmployeeStatus.RESIGNED,
      statusEffectiveFrom: new Date('2026-08-31'),
    });
    expect(
      (await loadAttendanceCard(db as any, 'e', 8, 2026)).missingDates,
    ).toEqual(['2026-08-29', '2026-08-30']);
    expect(
      (await loadAttendanceCard(fixture([]) as any, 'e', 10, 2026))
        .missingDates,
    ).toEqual([]);
  });
  it('rejects duplicate dates and invalid statuses', async () => {
    await expect(
      loadAttendanceCard(
        fixture([
          row(1, AttendanceStatus.PRESENT),
          row(1, AttendanceStatus.ABSENT),
        ]) as any,
        'e',
        8,
        2026,
      ),
    ).rejects.toThrow(/duplicate/i);
    await expect(
      loadAttendanceCard(
        fixture([row(1, 'INVALID' as AttendanceStatus)]) as any,
        'e',
        8,
        2026,
      ),
    ).rejects.toThrow(/status/i);
  });
  it('rejects invalid months before querying', async () => {
    const db = fixture();
    await expect(loadAttendanceCard(db as any, 'e', 13, 2026)).rejects.toThrow(
      /month/i,
    );
    expect(db.employee.findUnique).not.toHaveBeenCalled();
  });
});
