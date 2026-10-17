import { AttendanceStatus, EmployeeStatus } from '@prisma/client';
import { loadAttendanceCard } from '../attendance/attendance-card.util';
import { calculateCardSalary } from './attendance-card-salary.util';

/** Point 25: force-generated pay for a suspended employee stops at the suspension start. */
function prisma(status: EmployeeStatus, statusEffectiveFrom: Date | null) {
  const present = (d: number) => ({
    date: new Date(Date.UTC(2026, 9, d)),
    status: AttendanceStatus.PRESENT,
    overtimeMinutes: 0,
    lateMinutes: 0,
    earlyOutMinutes: 0,
    overtimePending: false,
    overtimeApprovedAt: null,
    overtimeStatus: null,
    payPercent: null,
  });
  return {
    employee: {
      findUnique: jest.fn().mockResolvedValue({
        joiningDate: new Date('2025-01-01'),
        status,
        statusEffectiveFrom,
        monthlyAllowedLeaves: 0,
      }),
    },
    // Worked 1–10 Oct; a stray PRESENT on 20 Oct (inside the suspension).
    attendanceLog: {
      findMany: jest.fn().mockResolvedValue([
        ...Array.from({ length: 10 }, (_, i) => present(i + 1)),
        present(20),
      ]),
    },
    additionalWorkingDay: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ date: new Date(Date.UTC(2026, 9, 25)), relieverSessionId: null }]),
    },
  } as never;
}

describe('suspension pay cut-off (Point 25)', () => {
  it('pays the days before the suspension start only', async () => {
    const card = await loadAttendanceCard(
      prisma(EmployeeStatus.SUSPENDED, new Date('2026-10-15T00:00:00Z')),
      'e1',
      10,
      2026,
    );
    expect(card.present).toBe(10);
    expect(card.additionalWorkingDays).toBe(0);
    // Suspension days are neither paid nor reported as missing attendance.
    expect(card.missingDates.some((d) => d >= '2026-10-15')).toBe(false);
    expect(card.missingDates).toContain('2026-10-11');
    const salary = calculateCardSalary(card, 31000, 8);
    expect(salary.paidDays).toBe(10);
    expect(salary.earnedBasic).toBe(10000);
  });

  it('a whole month after the suspension start pays nothing', async () => {
    const card = await loadAttendanceCard(
      prisma(EmployeeStatus.SUSPENDED, new Date('2026-09-20T00:00:00Z')),
      'e1',
      10,
      2026,
    );
    expect(calculateCardSalary(card, 31000, 8).paidDays).toBe(0);
  });

  it('after reinstatement nothing is paid back automatically (no logs = unpaid)', async () => {
    const card = await loadAttendanceCard(prisma(EmployeeStatus.ACTIVE, null), 'e1', 10, 2026);
    // Only the stored days count; the empty suspension days stay unpaid.
    expect(calculateCardSalary(card, 31000, 8).paidDays).toBe(11);
  });
});
