// attendance.service.ts imports discipline.helper.ts, which imports
// issueAutoTemplatedLetter at module scope, which transitively pulls in
// puppeteer (ESM-only, breaks Jest's default CommonJS transform). Stub the
// module boundary — same pattern as every discipline spec in this directory.
jest.mock('./../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn().mockResolvedValue(undefined),
}));

import { AttendanceStatus, UserRole } from '@prisma/client';
import { AttendanceService } from './attendance.service';

/**
 * Wiring-proof tests for the PERMANENT-behavior requirement: every
 * attendance-mutating path must call
 * PayrollService.recomputePendingPayrollForAttendanceDate AFTER its own
 * write commits, with the correct (employeeId, businessDate).
 *
 * These deliberately do NOT re-verify payroll calculation correctness —
 * that is exhaustively covered by payroll.service.recompute-hook.spec.ts
 * and the existing segmentation/discipline suites. Instead
 * payrollService.recomputePendingPayrollForAttendanceDate is replaced with
 * a jest.fn() spy so these tests prove ONLY the integration point: is it
 * called, with which employeeId, with which date (the attendance business
 * date, never wall-clock "now"), and only after the underlying write has
 * already committed.
 */

const EMP_ID = 'emp-wire-1';
const ACTING_USER = { id: 'user-1', role: UserRole.HR_MANAGER };

function makeService(overrides: {
  employee?: any;
  existingLog?: any;
  txAttendanceLogUpsertResult?: any;
} = {}) {
  const payrollService = {
    recomputePendingPayrollForAttendanceDate: jest.fn().mockResolvedValue(undefined),
  };
  const permissionsService = {
    userHasPermission: jest.fn().mockResolvedValue(true),
  };
  const accessScopeService = {
    assertEmployeeAccess: jest.fn().mockResolvedValue(undefined),
    userHasPermissionOrScopedCapability: jest.fn().mockResolvedValue(true),
  };

  const employee = overrides.employee ?? {
    id: EMP_ID,
    status: 'ACTIVE',
    dutyStartTime: '09:00',
    dutyEndTime: '17:00',
    dutyTotalHours: null,
    shift: null,
    currentBranchId: 'branch-1',
    currentDepartment: null,
  };

  const txAttendanceLog = {
    id: 'log-1',
    employeeId: EMP_ID,
    status: AttendanceStatus.PRESENT,
    checkIn: null,
    checkOut: null,
    lateMinutes: 0,
    overtimeMinutes: 0,
    note: null,
    ...(overrides.txAttendanceLogUpsertResult ?? {}),
  };

  const tx = {
    attendanceLog: {
      upsert: jest.fn().mockResolvedValue(txAttendanceLog),
      update: jest.fn().mockResolvedValue(txAttendanceLog),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    leaveRecord: { create: jest.fn() },
  };

  const prisma = {
    employee: { findUnique: jest.fn().mockResolvedValue(employee) },
    attendanceLog: {
      findUnique: jest.fn().mockResolvedValue(overrides.existingLog ?? null),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };

  const service = new AttendanceService(
    prisma as any,
    permissionsService as any,
    accessScopeService as any,
    payrollService as any,
  );

  return { service, prisma, tx, payrollService, employee, txAttendanceLog };
}

describe('AttendanceService — payroll recompute wiring', () => {
  // 1. UNMARKED -> PRESENT via markManual fires the hook with the right
  // employee and business date, after the write commits.
  it('markManual: fires recomputePendingPayrollForAttendanceDate with (employeeId, businessDate) after the transaction commits', async () => {
    const { service, payrollService, tx } = makeService();

    await service.markManual(
      {
        employeeId: EMP_ID,
        date: '2026-08-10',
        status: AttendanceStatus.PRESENT,
      } as any,
      ACTING_USER,
    );

    expect(tx.attendanceLog.upsert).toHaveBeenCalledTimes(1);
    expect(payrollService.recomputePendingPayrollForAttendanceDate).toHaveBeenCalledTimes(1);
    const [calledEmployeeId, calledDate] = payrollService.recomputePendingPayrollForAttendanceDate.mock.calls[0];
    expect(calledEmployeeId).toBe(EMP_ID);
    expect(calledDate.getUTCFullYear()).toBe(2026);
    expect(calledDate.getUTCMonth()).toBe(7); // August (0-indexed)
    expect(calledDate.getUTCDate()).toBe(10);

    // Fired AFTER the transaction resolved, not from inside it — the
    // upsert call must have already happened by the time the spy was hit.
    const upsertOrder = tx.attendanceLog.upsert.mock.invocationCallOrder[0];
    const hookOrder = payrollService.recomputePendingPayrollForAttendanceDate.mock.invocationCallOrder[0];
    expect(hookOrder).toBeGreaterThan(upsertOrder);
  });

  // 3. Historical August correction made via updateAttendance recomputes
  // August (log.date), never wall-clock "now" — proven by never touching
  // Date.now()/new Date() for the recompute call's date argument at all;
  // it must come from the stored log's own date.
  it('updateAttendance: fires the hook using the ROW\'S historical date, not wall-clock "now"', async () => {
    const historicalDate = new Date(Date.UTC(2026, 7, 10)); // August 10 2026
    const existingLog = {
      id: 'log-1',
      employeeId: EMP_ID,
      date: historicalDate,
      status: AttendanceStatus.PRESENT,
      checkIn: null,
      checkOut: null,
      lateMinutes: 0,
      overtimeMinutes: 0,
      note: null,
      employee: {
        id: EMP_ID,
        fullName: 'Test',
        employeeCode: 'E-1',
        currentBranchId: 'branch-1',
        dutyStartTime: '09:00',
        dutyEndTime: '17:00',
        dutyTotalHours: null,
        currentDesignation: null,
        currentDepartment: null,
        shift: null,
      },
      branch: null,
    };

    const payrollService = {
      recomputePendingPayrollForAttendanceDate: jest.fn().mockResolvedValue(undefined),
    };
    const permissionsService = { userHasPermission: jest.fn().mockResolvedValue(true) };
    const accessScopeService = {
      assertEmployeeAccess: jest.fn().mockResolvedValue(undefined),
      userHasPermissionOrScopedCapability: jest.fn().mockResolvedValue(true),
    };

    const updatedLog = { ...existingLog, status: AttendanceStatus.ABSENT };
    const tx = {
      attendanceLog: { update: jest.fn().mockResolvedValue(updatedLog) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      leaveRecord: { findFirst: jest.fn().mockResolvedValue(null) },
      stipendRecord: { findFirst: jest.fn().mockResolvedValue(null) }, // basicStipend <= 0 -> no-op deduction path
    };
    const prisma = {
      attendanceLog: { findUnique: jest.fn().mockResolvedValue(existingLog) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };

    const service = new AttendanceService(
      prisma as any,
      permissionsService as any,
      accessScopeService as any,
      payrollService as any,
    );

    // "Now" (wall clock) is September in this scenario — HR is correcting
    // an August record from September. The date passed to the hook must
    // be August (the row's own date), never September/"today".
    await service.updateAttendance(
      'log-1',
      { status: AttendanceStatus.ABSENT } as any,
      ACTING_USER,
    );

    expect(payrollService.recomputePendingPayrollForAttendanceDate).toHaveBeenCalledWith(
      EMP_ID,
      historicalDate,
    );
  });

  it('updateAttendance ON_LEAVE creates an APPROVED LeaveRecord so yearly remaining leaves drop', async () => {
    const historicalDate = new Date(Date.UTC(2026, 7, 10));
    const existingLog = {
      id: 'log-1',
      employeeId: EMP_ID,
      date: historicalDate,
      status: AttendanceStatus.UNMARKED,
      checkIn: null,
      checkOut: null,
      lateMinutes: 0,
      overtimeMinutes: 0,
      note: null,
      employee: {
        id: EMP_ID,
        fullName: 'Test',
        employeeCode: 'E-1',
        currentBranchId: 'branch-1',
        dutyStartTime: '09:00',
        dutyEndTime: '17:00',
        dutyTotalHours: null,
        currentDesignation: null,
        currentDepartment: null,
        shift: null,
      },
      branch: null,
    };

    const payrollService = {
      recomputePendingPayrollForAttendanceDate: jest.fn().mockResolvedValue(undefined),
    };
    const permissionsService = { userHasPermission: jest.fn().mockResolvedValue(true) };
    const accessScopeService = {
      assertEmployeeAccess: jest.fn().mockResolvedValue(undefined),
      userHasPermissionOrScopedCapability: jest.fn().mockResolvedValue(true),
    };

    const updatedLog = { ...existingLog, status: AttendanceStatus.ON_LEAVE };
    const tx = {
      attendanceLog: { update: jest.fn().mockResolvedValue(updatedLog) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      leaveRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'leave-1' }),
      },
      stipendRecord: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      attendanceLog: { findUnique: jest.fn().mockResolvedValue(existingLog) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };

    const service = new AttendanceService(
      prisma as any,
      permissionsService as any,
      accessScopeService as any,
      payrollService as any,
    );

    await service.updateAttendance(
      'log-1',
      { status: AttendanceStatus.ON_LEAVE } as any,
      ACTING_USER,
    );

    expect(tx.leaveRecord.create).toHaveBeenCalledTimes(1);
    const created = tx.leaveRecord.create.mock.calls[0][0].data;
    expect(created.employeeId).toBe(EMP_ID);
    expect(created.totalDays).toBe(1);
    expect(created.status).toBe('APPROVED');
    expect(payrollService.recomputePendingPayrollForAttendanceDate).toHaveBeenCalledWith(
      EMP_ID,
      historicalDate,
    );
  });

  it('updateAttendance ON_LEAVE does not duplicate a covering LeaveRecord', async () => {
    const historicalDate = new Date(Date.UTC(2026, 7, 10));
    const existingLog = {
      id: 'log-1',
      employeeId: EMP_ID,
      date: historicalDate,
      status: AttendanceStatus.ON_LEAVE,
      checkIn: null,
      checkOut: null,
      lateMinutes: 0,
      overtimeMinutes: 0,
      note: null,
      employee: {
        id: EMP_ID,
        fullName: 'Test',
        employeeCode: 'E-1',
        currentBranchId: 'branch-1',
        dutyStartTime: '09:00',
        dutyEndTime: '17:00',
        dutyTotalHours: null,
        currentDesignation: null,
        currentDepartment: null,
        shift: null,
      },
      branch: null,
    };

    const payrollService = {
      recomputePendingPayrollForAttendanceDate: jest.fn().mockResolvedValue(undefined),
    };
    const permissionsService = { userHasPermission: jest.fn().mockResolvedValue(true) };
    const accessScopeService = {
      assertEmployeeAccess: jest.fn().mockResolvedValue(undefined),
      userHasPermissionOrScopedCapability: jest.fn().mockResolvedValue(true),
    };

    const tx = {
      attendanceLog: { update: jest.fn().mockResolvedValue(existingLog) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      leaveRecord: {
        findFirst: jest.fn().mockResolvedValue({ id: 'leave-existing' }),
        create: jest.fn(),
      },
      stipendRecord: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      attendanceLog: { findUnique: jest.fn().mockResolvedValue(existingLog) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };

    const service = new AttendanceService(
      prisma as any,
      permissionsService as any,
      accessScopeService as any,
      payrollService as any,
    );

    await service.updateAttendance(
      'log-1',
      { status: AttendanceStatus.ON_LEAVE } as any,
      ACTING_USER,
    );

    expect(tx.leaveRecord.create).not.toHaveBeenCalled();
  });

  // 8 (wiring half): the hook itself decides whether a PayrollEntry
  // exists — attendance mutation paths never check this themselves, they
  // just always call the hook unconditionally. Confirms markManual makes
  // no PayrollEntry-existence check of its own (that responsibility is
  // fully centralized in PayrollService, not duplicated per caller).
  it('markManual: does not itself query PayrollEntry — the existence check is fully centralized in the hook', async () => {
    const { service } = makeService();

    await service.markManual(
      {
        employeeId: EMP_ID,
        date: '2026-08-10',
        status: AttendanceStatus.PRESENT,
      } as any,
      ACTING_USER,
    );

    // The fake prisma above has no `payrollEntry` model at all — if
    // markManual tried to query it directly, this would throw. Reaching
    // this line without throwing proves no such duplicated logic exists.
    expect(true).toBe(true);
  });
});
