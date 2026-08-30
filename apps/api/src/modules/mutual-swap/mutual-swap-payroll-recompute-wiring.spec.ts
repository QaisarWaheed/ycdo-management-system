import { EmployeeStatus } from '@prisma/client';
import { MutualSwapService } from './mutual-swap.service';

jest.mock('../attendance/discipline.helper', () => ({
  reconcileAttendanceFinancialConsequences: jest.fn().mockResolvedValue({}),
}));

/**
 * Wiring-proof tests for the PERMANENT-behavior requirement, reliever/
 * swap flows: createSwap writes SWAP_COVERED for the covered employee
 * (a full-day-credit status, same as PRESENT — see
 * computeHourlyBreakdown), and cancelSwap reverses it back to UNMARKED.
 * Both must fire the centralized hook for the COVERED employee only —
 * the covering employee's writes are overtime-only, never payableMinutes-
 * relevant, so recomputing for them would be wasted work.
 */

const COVERING_ID = 'emp-covering-1';
const COVERED_ID = 'emp-covered-1';

function makeShift(startTime: string, endTime: string) {
  return { startTime, endTime };
}

describe('MutualSwapService — payroll recompute wiring', () => {
  it('createSwap: fires the hook for the COVERED employee only, after the transaction commits', async () => {
    const payrollService = {
      recomputePendingPayrollForAttendanceDate: jest.fn().mockResolvedValue(undefined),
    };

    const coveringEmployee = {
      id: COVERING_ID,
      fullName: 'Covering Employee',
      shiftId: 'shift-1',
      shift: makeShift('09:00', '17:00'),
      currentBranchId: 'branch-1',
      currentDepartmentId: 'dept-1',
      dutyStartTime: '09:00',
      dutyEndTime: '17:00',
      status: EmployeeStatus.ACTIVE,
    };
    const coveredEmployee = {
      id: COVERED_ID,
      fullName: 'Covered Employee',
      shiftId: 'shift-2',
      shift: makeShift('17:00', '01:00'),
      currentBranchId: 'branch-1',
      currentDepartmentId: 'dept-1',
      dutyStartTime: '17:00',
      dutyEndTime: '01:00',
      status: EmployeeStatus.ACTIVE,
    };

    const createdSwap = { id: 'swap-1', date: new Date(Date.UTC(2026, 7, 10)) };

    const tx = {
      mutualSwap: { create: jest.fn().mockResolvedValue(createdSwap) },
      attendanceLog: {
        findFirst: jest.fn().mockResolvedValue(null), // covering has no existing log to bump OT on
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    const prisma = {
      employee: {
        findUnique: jest.fn((args: any) =>
          args.where.id === COVERING_ID ? coveringEmployee : coveredEmployee,
        ),
      },
      mutualSwap: { findFirst: jest.fn().mockResolvedValue(null) }, // no existing swap
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };

    const service = new MutualSwapService(prisma as any, payrollService as any);

    await service.createSwap(
      {
        coveringEmployeeId: COVERING_ID,
        coveredEmployeeId: COVERED_ID,
        date: '2026-08-10',
      } as any,
      'acting-user-1',
    );

    // Covering employee's REGULAR upsert never happened (findFirst
    // returned null), only the OT row + covered REGULAR row upserts.
    expect(tx.attendanceLog.upsert).toHaveBeenCalledTimes(2);
    expect(payrollService.recomputePendingPayrollForAttendanceDate).toHaveBeenCalledTimes(1);
    const [calledEmployeeId] = payrollService.recomputePendingPayrollForAttendanceDate.mock.calls[0];
    expect(calledEmployeeId).toBe(COVERED_ID); // never the covering employee

    const upsertOrder = tx.attendanceLog.upsert.mock.invocationCallOrder[1];
    const hookOrder = payrollService.recomputePendingPayrollForAttendanceDate.mock.invocationCallOrder[0];
    expect(hookOrder).toBeGreaterThan(upsertOrder);
  });

  it('cancelSwap: fires the hook for the COVERED employee only, after the transaction commits', async () => {
    const payrollService = {
      recomputePendingPayrollForAttendanceDate: jest.fn().mockResolvedValue(undefined),
    };

    const swapDate = new Date(Date.UTC(2026, 7, 10));
    const swap = {
      id: 'swap-1',
      status: 'ACTIVE',
      date: swapDate,
      coveringEmployeeId: COVERING_ID,
      coveredEmployeeId: COVERED_ID,
      coveringEmployee: { fullName: 'Covering' },
      coveredEmployee: { fullName: 'Covered' },
    };

    const prisma = {
      mutualSwap: {
        findUnique: jest.fn().mockResolvedValue(swap),
        update: jest.fn().mockResolvedValue({}),
      },
      attendanceLog: {
        deleteMany: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (ops: Promise<any>[]) => Promise.all(ops)),
    };

    const service = new MutualSwapService(prisma as any, payrollService as any);

    await service.cancelSwap('swap-1', 'acting-user-1');

    expect(payrollService.recomputePendingPayrollForAttendanceDate).toHaveBeenCalledTimes(1);
    expect(payrollService.recomputePendingPayrollForAttendanceDate).toHaveBeenCalledWith(
      COVERED_ID,
      swapDate,
    );
  });
});
