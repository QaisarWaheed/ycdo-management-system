import { AttendanceMonthStatus, PayrollStatus } from '@prisma/client';

jest.mock('../letters/pdf.helper', () => ({ generatePdf: jest.fn() }));

import {
  assertAttendanceOpen,
  attendanceMonthOf,
  isAttendanceLocked,
  isMonthOver,
} from './attendance-month-lock.util';
import { AttendanceLockService } from './attendance-lock.service';
import { PayrollService } from '../payroll/payroll.service';

function db(status: AttendanceMonthStatus | null) {
  return {
    attendanceMonthLock: {
      findUnique: jest.fn().mockResolvedValue(status ? { status } : null),
    },
    employee: { findUnique: jest.fn().mockResolvedValue({ currentBranchId: 'b1' }) },
    branch: { findUnique: jest.fn().mockResolvedValue({ name: 'Head Office' }) },
  };
}

describe('attendance month lock', () => {
  it('uses the Pakistan calendar month', () => {
    // 31 Oct 21:00 UTC is already 1 Nov 02:00 in Pakistan.
    expect(attendanceMonthOf(new Date('2026-10-31T21:00:00Z'))).toEqual({ year: 2026, month: 11 });
    // Date-only values stay on their day.
    expect(attendanceMonthOf(new Date('2026-10-31T00:00:00Z'))).toEqual({ year: 2026, month: 10 });
  });

  it('a month can be verified only after it is over', () => {
    expect(isMonthOver(2026, 10, new Date('2026-10-31T12:00:00Z'))).toBe(false);
    expect(isMonthOver(2026, 10, new Date('2026-10-31T20:00:00Z'))).toBe(true);
    expect(isMonthOver(2026, 9, new Date('2026-10-10T12:00:00Z'))).toBe(true);
  });

  it('blocks manual changes in a verified month with a clear message', async () => {
    await expect(
      assertAttendanceOpen(db(AttendanceMonthStatus.VERIFIED) as never, {
        date: new Date('2026-10-05T00:00:00Z'),
        employeeId: 'e1',
      }),
    ).rejects.toThrow('Head Office (October 2026) is verified and locked');
  });

  it('allows changes once IT unlocked it, or when never verified', async () => {
    await expect(
      assertAttendanceOpen(db(AttendanceMonthStatus.UNLOCKED) as never, {
        date: new Date('2026-10-05T00:00:00Z'),
        branchId: 'b1',
      }),
    ).resolves.toBeUndefined();
    expect(
      await isAttendanceLocked(db(null) as never, 'b1', new Date('2026-10-05T00:00:00Z')),
    ).toBe(false);
  });

  it('refuses to verify a month that is still running', async () => {
    const service = new AttendanceLockService({} as never);
    const now = new Date();
    await expect(
      service.verify(['b1'], now.getFullYear(), now.getMonth() + 1, { id: 'hr' }),
    ).rejects.toThrow('is not over yet');
  });

  it('payroll cannot be finalised for a branch month HR has not verified', async () => {
    const prisma = {
      attendanceMonthLock: { findUnique: jest.fn().mockResolvedValue(null) },
      payrollEntry: { findMany: jest.fn() },
    };
    const service = Object.assign(Object.create(PayrollService.prototype), { prisma });
    await expect(
      service.finalizeBranchMonth(
        { branchId: 'b1', month: 9, year: 2026, status: PayrollStatus.PROCESSED },
        'acc1',
      ),
    ).rejects.toThrow('not verified by HR yet');
    expect(prisma.payrollEntry.findMany).not.toHaveBeenCalled();
  });
});
