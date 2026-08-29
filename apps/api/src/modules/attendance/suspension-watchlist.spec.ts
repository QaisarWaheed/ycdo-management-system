import { AttendanceStatus } from '@prisma/client';
import { buildSuspensionWatchlist } from './suspension-watchlist';

describe('buildSuspensionWatchlist', () => {
  it('puts late 6–8 in near, ≥9 in due, and due wins over near', async () => {
    const logs = [
      // emp-near: 6 late days
      ...Array.from({ length: 6 }, (_, i) => ({
        employeeId: 'emp-near',
        date: new Date(Date.UTC(2026, 7, i + 1)),
        status: AttendanceStatus.LATE,
        note: null,
        lateMinutes: 10,
      })),
      // emp-due: 9 late days
      ...Array.from({ length: 9 }, (_, i) => ({
        employeeId: 'emp-due',
        date: new Date(Date.UTC(2026, 7, i + 1)),
        status: AttendanceStatus.LATE,
        note: null,
        lateMinutes: 10,
      })),
      // emp-ua-near: 2 UA
      {
        employeeId: 'emp-ua-near',
        date: new Date(Date.UTC(2026, 7, 2)),
        status: AttendanceStatus.UNINFORMED_ABSENT,
        note: null,
        lateMinutes: null,
      },
      {
        employeeId: 'emp-ua-near',
        date: new Date(Date.UTC(2026, 7, 3)),
        status: AttendanceStatus.UNINFORMED_ABSENT,
        note: null,
        lateMinutes: null,
      },
      // emp-both: late 7 + UA 3 → due only
      ...Array.from({ length: 7 }, (_, i) => ({
        employeeId: 'emp-both',
        date: new Date(Date.UTC(2026, 7, i + 1)),
        status: AttendanceStatus.LATE,
        note: null,
        lateMinutes: 5,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        employeeId: 'emp-both',
        date: new Date(Date.UTC(2026, 7, 10 + i)),
        status: AttendanceStatus.UNINFORMED_ABSENT,
        note: null,
        lateMinutes: null,
      })),
    ];

    const employees = [
      {
        id: 'emp-near',
        fullName: 'Near Late',
        employeeCode: 'N1',
        biometricId: null,
        phone: '03001234567',
        currentBranchId: null,
        currentBranch: null,
      },
      {
        id: 'emp-due',
        fullName: 'Due Late',
        employeeCode: 'D1',
        biometricId: null,
        phone: null,
        currentBranchId: null,
        currentBranch: null,
      },
      {
        id: 'emp-ua-near',
        fullName: 'Near UA',
        employeeCode: 'U1',
        biometricId: null,
        phone: '03007654321',
        currentBranchId: null,
        currentBranch: null,
      },
      {
        id: 'emp-both',
        fullName: 'Both Due',
        employeeCode: 'B1',
        biometricId: null,
        phone: null,
        currentBranchId: null,
        currentBranch: null,
      },
    ];

    const db = {
      attendanceLog: {
        findMany: jest.fn().mockResolvedValue(logs),
      },
      employee: {
        findMany: jest.fn().mockResolvedValue(employees),
      },
    };

    const result = await buildSuspensionWatchlist(db, 2026, 8);

    expect(result.counts).toEqual({ near: 2, due: 2 });
    expect(result.near.map((e) => e.employeeId).sort()).toEqual([
      'emp-near',
      'emp-ua-near',
    ]);
    expect(result.due.map((e) => e.employeeId).sort()).toEqual([
      'emp-both',
      'emp-due',
    ]);
    expect(result.due.find((e) => e.employeeId === 'emp-both')?.reasons).toEqual(
      expect.arrayContaining(['UA_DUE', 'LATE_NEAR']),
    );
    expect(result.due.find((e) => e.employeeId === 'emp-due')?.lateDates).toHaveLength(
      9,
    );
    expect(
      result.due.find((e) => e.employeeId === 'emp-both')?.uninformedAbsentDates,
    ).toHaveLength(3);
  });

  it('omits employees below near/due thresholds from both lists', async () => {
    const logs = [
      ...Array.from({ length: 5 }, (_, i) => ({
        employeeId: 'emp-five-late',
        date: new Date(Date.UTC(2026, 7, i + 1)),
        status: AttendanceStatus.LATE,
        note: null,
        lateMinutes: 10,
      })),
      {
        employeeId: 'emp-one-ua',
        date: new Date(Date.UTC(2026, 7, 2)),
        status: AttendanceStatus.UNINFORMED_ABSENT,
        note: null,
        lateMinutes: null,
      },
    ];
    const db = {
      attendanceLog: { findMany: jest.fn().mockResolvedValue(logs) },
      employee: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const result = await buildSuspensionWatchlist(db, 2026, 8);

    expect(result.counts).toEqual({ near: 0, due: 0 });
    expect(result.near).toEqual([]);
    expect(result.due).toEqual([]);
    expect(db.employee.findMany).not.toHaveBeenCalled();
  });
});
