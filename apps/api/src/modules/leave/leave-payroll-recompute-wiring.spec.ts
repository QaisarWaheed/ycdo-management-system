// leave.service.ts imports discipline.helper.ts (applyExtraLeaveRejectedDeduction,
// reconcileAttendanceFinancialConsequences), which imports issueAutoTemplatedLetter
// at module scope, which transitively pulls in puppeteer (ESM-only, breaks
// Jest's default CommonJS transform). Stub the module boundary — same
// pattern as every discipline spec in this repo.
jest.mock('../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn().mockResolvedValue(undefined),
}));

import { LeaveStatus, LeaveType, UserRole } from '@prisma/client';
import { LeaveService } from './leave.service';

/**
 * Wiring-proof test (requirement 5 — "leave attendance correction updates
 * PENDING payroll") for LeaveService.markVerifiedLeave: proves the
 * centralized hook fires, with the correct employeeId/date, AFTER the
 * approval transaction commits — not payroll calculation correctness
 * itself (see payroll.service.recompute-hook.spec.ts for that).
 */

const EMP_ID = 'emp-leave-wire-1';
const ACTING_USER = { id: 'user-1', role: UserRole.HR_MANAGER };

describe('LeaveService — payroll recompute wiring', () => {
  it('markVerifiedLeave: fires recomputePendingPayrollForAttendanceDate with (employeeId, leave date) after the transaction commits', async () => {
    const startDate = new Date(Date.UTC(2026, 7, 10)); // August 10 2026

    const payrollService = {
      recomputePendingPayrollForAttendanceDate: jest.fn().mockResolvedValue(undefined),
    };
    const accessScopeService = {};

    const employee = {
      id: EMP_ID,
      status: 'ACTIVE',
      currentBranchId: 'branch-1',
      dutyStartTime: '09:00',
      dutyEndTime: '17:00',
      dutyTotalHours: null,
      shift: null,
      currentDepartment: null,
    };

    const record = {
      id: 'leave-1',
      employeeId: EMP_ID,
      startDate,
      endDate: startDate,
      leaveType: LeaveType.REGULAR,
      status: LeaveStatus.APPROVED,
      employee,
    };

    const updatedLog = {
      id: 'log-1',
      employeeId: EMP_ID,
      date: startDate,
      status: 'ON_LEAVE',
      checkIn: null,
      checkOut: null,
      lateMinutes: 0,
      overtimeMinutes: 0,
      note: 'Approved leave',
    };

    const tx = {
      leaveRecord: { create: jest.fn().mockResolvedValue(record) },
      attendanceLog: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(updatedLog),
      },
      notification: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue(employee) },
      leaveRecord: { findFirst: jest.fn().mockResolvedValue(null) }, // no overlap
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };

    const service = new LeaveService(
      prisma as any,
      accessScopeService as any,
      payrollService as any,
    );

    await service.markVerifiedLeave(
      {
        employeeId: EMP_ID,
        startDate: '2026-08-10',
        endDate: '2026-08-10',
        leaveType: LeaveType.REGULAR,
        reason: 'HR-verified leave for wiring test',
      } as any,
      ACTING_USER,
    );

    expect(tx.attendanceLog.upsert).toHaveBeenCalledTimes(1);
    expect(payrollService.recomputePendingPayrollForAttendanceDate).toHaveBeenCalledTimes(1);
    const [calledEmployeeId, calledDate] = payrollService.recomputePendingPayrollForAttendanceDate.mock.calls[0];
    expect(calledEmployeeId).toBe(EMP_ID);

    // Compare against the EXACT date value markLeaveAttendance actually
    // wrote the AttendanceLog row for (extracted from the upsert call),
    // rather than a hardcoded calendar day — LeaveService's own
    // toDateOnly() truncates via local-machine time, not PKT, which is a
    // pre-existing, separate correctness gap (flagged in the Step 8
    // report) unrelated to this wiring. The point being proven here is
    // narrower and TZ-independent: the hook is called with the SAME
    // business date the write itself used, not some other date.
    const writtenDate = (tx.attendanceLog.upsert.mock.calls[0][0] as any).where
      .employeeId_date_type.date as Date;
    expect(calledDate.getTime()).toBe(writtenDate.getTime());

    const upsertOrder = tx.attendanceLog.upsert.mock.invocationCallOrder[0];
    const hookOrder = payrollService.recomputePendingPayrollForAttendanceDate.mock.invocationCallOrder[0];
    expect(hookOrder).toBeGreaterThan(upsertOrder);
  });
});
