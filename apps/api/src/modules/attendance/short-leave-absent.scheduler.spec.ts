jest.mock('./discipline.helper', () => ({
  applyDisciplineRules: jest.fn().mockResolvedValue(undefined),
  reverseAbsenceDeductionForDate: jest.fn(),
  reverseLateDisciplineForDate: jest.fn(),
}));

import {
  AttendanceStatus as A,
  EmployeeStatus,
  LeaveStatus,
  LeaveType,
} from '@prisma/client';
import { ShiftAbsentScheduler } from './shift-absent.scheduler';
import { ProspectiveShortLeaveScheduler } from './prospective-short-leave.scheduler';
import { reconcileShortLeaveAttendance } from './short-leave.util';
import {
  applyDisciplineRules,
  reverseAbsenceDeductionForDate,
} from './discipline.helper';
import { PayrollService } from '../payroll/payroll.service';
import { AUTO_UNMARKED_NOTE } from './attendance-calendar.util';

const day = new Date('2026-08-14T00:00:00Z');

function harness(initial: A | null = A.UNMARKED, approved = true, hours = 8) {
  const employee = {
    id: 'e',
    currentBranchId: 'b',
    status: EmployeeStatus.ACTIVE,
    joiningDate: new Date('2020-01-01'),
    dutyStartTime: '09:00',
    dutyEndTime: hours === 24 ? '09:00' : '17:00',
    dutyTotalHours: hours,
    weeklyOffWeekdays: [],
    shift: null,
  };
  const leave = {
    id: 'l',
    employeeId: 'e',
    leaveType: LeaveType.SHORT_LEAVE,
    status: approved ? LeaveStatus.APPROVED : LeaveStatus.PENDING_APPROVAL,
    startDate: day,
    employee,
  };
  let row: any =
    initial === null
      ? null
      : {
          id: 'a',
          employeeId: 'e',
          date: day,
          type: 'REGULAR',
          status: initial,
          checkIn: null,
          checkOut: null,
          source: 'MANUAL',
          note: AUTO_UNMARKED_NOTE,
          lateMinutes: 0,
          overtimeMinutes: 0,
          dutyStartTimeSnapshot: '09:00',
          dutyEndTimeSnapshot: employee.dutyEndTime,
          employee,
        };
  let beforeWrite: (() => void) | undefined;
  const matches = (w: any): boolean => {
    if (!row) return false;
    if (w.id && row.id !== w.id) return false;
    if (
      w.status &&
      (typeof w.status === 'string'
        ? row.status !== w.status
        : !w.status.in.includes(row.status))
    )
      return false;
    if (w.checkIn === null && row.checkIn !== null) return false;
    if (w.date instanceof Date && +w.date !== +row.date) return false;
    if (w.date?.in && !w.date.in.some((d: Date) => +d === +row.date))
      return false;
    if (w.employee?.leaveRecords?.none && leave.status === LeaveStatus.APPROVED)
      return false;
    return true;
  };
  const db: any = {
    employee: { findMany: jest.fn().mockResolvedValue([employee]) },
    leaveRecord: {
      findMany: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(leave.status === LeaveStatus.APPROVED ? [leave] : []),
        ),
      findFirst: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(leave.status === LeaveStatus.APPROVED ? leave : null),
        ),
    },
    attendanceLog: {
      findUnique: jest.fn(async () => (row ? { ...row } : null)),
      findMany: jest.fn(async ({ where }: any) =>
        matches(where) ? [{ ...row }] : [],
      ),
      create: jest.fn(async ({ data }: any) => {
        if (row) throw new Error('duplicate attendance');
        row = { id: 'a', checkIn: null, checkOut: null, ...data, employee };
        return { ...row };
      }),
      createMany: jest.fn(async ({ data }: any) => {
        beforeWrite?.();
        beforeWrite = undefined;
        if (row) return { count: 0 };
        row = {
          id: 'a',
          checkIn: null,
          checkOut: null,
          lateMinutes: 0,
          overtimeMinutes: 0,
          ...data,
          employee,
        };
        return { count: 1 };
      }),
      upsert: jest.fn(async ({ create, update }: any) => {
        beforeWrite?.();
        beforeWrite = undefined;
        row = row
          ? { ...row, ...update }
          : { id: 'a', checkIn: null, checkOut: null, ...create, employee };
        return { ...row };
      }),
      update: jest.fn(async ({ data }: any) => {
        beforeWrite?.();
        beforeWrite = undefined;
        row = { ...row, ...data };
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        beforeWrite?.();
        beforeWrite = undefined;
        if (!matches(where)) return { count: 0 };
        row = { ...row, ...data };
        return { count: 1 };
      }),
    },
    notification: { create: jest.fn() },
    $transaction: jest.fn(async (fn: any) => fn(db)),
  };
  const payroll = { recomputePendingPayrollForAttendanceDate: jest.fn() };
  return {
    db,
    employee,
    leave,
    payroll,
    get: () => row,
    change: (data: any) => {
      row = { ...row, ...data };
    },
    beforeWrite: (fn: () => void) => {
      beforeWrite = fn;
    },
    absent: new ShiftAbsentScheduler(db, payroll as any),
    short: new ProspectiveShortLeaveScheduler(db, payroll as any),
  };
}

describe('approved Short Leave versus absent schedulers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-08-14T12:00:00+05:00'));
  });
  afterEach(() => jest.useRealTimers());

  it.each([null, A.UNMARKED])(
    'materializes approved no-punch leave from %s and survives absent scheduling',
    async (initial) => {
      const h = harness(initial);
      await h.short.reconcilePendingShortLeaves();
      await h.absent.markUninformedAbsent();
      expect(h.get()).toMatchObject({
        status: A.SHORT_LEAVE,
        checkIn: null,
        checkOut: null,
      });
      expect(applyDisciplineRules).not.toHaveBeenCalled();
      expect(h.db.notification.create).not.toHaveBeenCalled();
      await h.short.reconcilePendingShortLeaves();
      expect(
        h.payroll.recomputePendingPayrollForAttendanceDate,
      ).toHaveBeenCalledTimes(1);
    },
  );

  it('protects approval even when the absent scheduler runs first', async () => {
    const h = harness();
    await h.absent.markUninformedAbsent();
    expect(h.get().status).toBe(A.UNMARKED);
    expect(applyDisciplineRules).not.toHaveBeenCalled();
    await h.short.reconcilePendingShortLeaves();
    expect(h.get().status).toBe(A.SHORT_LEAVE);
  });

  it('protects approved leave from the prior-day 24-hour ABSENT finalizer', async () => {
    const h = harness(A.UNMARKED, true, 24);
    jest.setSystemTime(new Date('2026-08-15T00:30:00+05:00'));
    await h.absent.markUninformedAbsent();
    expect(h.get().status).toBe(A.UNMARKED);
    expect(applyDisciplineRules).not.toHaveBeenCalled();
    await h.short.reconcilePendingShortLeaves();
    expect(h.get().status).toBe(A.SHORT_LEAVE);
  });

  it('does not overwrite Short Leave committed after absent candidate discovery', async () => {
    const h = harness(A.UNMARKED, false);
    h.beforeWrite(() => {
      h.leave.status = LeaveStatus.APPROVED;
      h.change({ status: A.SHORT_LEAVE });
    });
    await h.absent.markUninformedAbsent();
    expect(h.get().status).toBe(A.SHORT_LEAVE);
    expect(applyDisciplineRules).not.toHaveBeenCalled();
    expect(h.db.notification.create).not.toHaveBeenCalled();
  });

  it('does not overwrite a concurrent biometric punch when applying no-punch leave', async () => {
    const h = harness();
    h.beforeWrite(() =>
      h.change({
        status: A.PRESENT,
        checkIn: new Date('2026-08-14T09:00:00+05:00'),
      }),
    );
    await h.short.reconcilePendingShortLeaves();
    expect(h.get().status).toBe(A.PRESENT);
  });

  it('rechecks approval at the absent write even before SHORT_LEAVE has been materialized', async () => {
    const h = harness(A.UNMARKED, false);
    h.beforeWrite(() => {
      h.leave.status = LeaveStatus.APPROVED;
    });
    await h.absent.markUninformedAbsent();
    expect(h.get().status).toBe(A.UNMARKED);
    expect(applyDisciplineRules).not.toHaveBeenCalled();
  });

  it('overlapping Short Leave ticks create one attendance row and recompute once', async () => {
    const h = harness(null);
    await Promise.all([
      h.short.reconcilePendingShortLeaves(),
      h.short.reconcilePendingShortLeaves(),
    ]);
    expect(h.get().status).toBe(A.SHORT_LEAVE);
    expect(
      h.payroll.recomputePendingPayrollForAttendanceDate,
    ).toHaveBeenCalledTimes(1);
  });

  it('shift-start creation and prospective creation converge without unique-key errors', async () => {
    const h = harness(null);
    await Promise.all([
      h.absent.markShiftStartAbsent(),
      h.short.reconcilePendingShortLeaves(),
    ]);
    await h.absent.markUninformedAbsent();
    await h.short.reconcilePendingShortLeaves();
    expect(h.get().status).toBe(A.SHORT_LEAVE);
    expect(applyDisciplineRules).not.toHaveBeenCalled();
  });

  it('two absent ticks do not double-apply consequences for an unapproved day', async () => {
    const h = harness(A.UNMARKED, false);
    await Promise.all([
      h.absent.markUninformedAbsent(),
      h.absent.markUninformedAbsent(),
    ]);
    expect(applyDisciplineRules).toHaveBeenCalledTimes(1);
    expect(h.db.notification.create).toHaveBeenCalledTimes(1);
  });

  it('retains ordinary uninformed-absence behavior for unapproved leave', async () => {
    const h = harness(A.UNMARKED, false);
    await h.absent.markUninformedAbsent();
    expect(h.get().status).toBe(A.UNINFORMED_ABSENT);
    expect(applyDisciplineRules).toHaveBeenCalledTimes(1);
  });

  it('leaves an existing HOLIDAY unchanged', async () => {
    const h = harness(A.HOLIDAY);
    await h.short.reconcilePendingShortLeaves();
    await h.absent.markUninformedAbsent();
    expect(h.get().status).toBe(A.HOLIDAY);
    expect(applyDisciplineRules).not.toHaveBeenCalled();
  });

  it.each([A.ABSENT, A.UNINFORMED_ABSENT])(
    'documents unrepaired no-check-in recovery from %s',
    async (status) => {
      const h = harness(status);
      expect(
        await reconcileShortLeaveAttendance(h.db, 'e', day, h.employee),
      ).toEqual({
        applied: false,
        reason: 'no real attendance yet for this date',
      });
      await h.short.reconcilePendingShortLeaves();
      expect(h.get().status).toBe(status);
      expect(reverseAbsenceDeductionForDate).not.toHaveBeenCalled();
    },
  );

  it.each([A.ABSENT, A.UNINFORMED_ABSENT])(
    'documents status-only recovery from %s with valid real punches',
    async (status) => {
      const h = harness(status);
      h.change({
        checkIn: new Date('2026-08-14T09:00:00+05:00'),
        checkOut: new Date('2026-08-14T17:00:00+05:00'),
      });
      expect(
        await reconcileShortLeaveAttendance(h.db, 'e', day, h.employee),
      ).toMatchObject({ applied: true });
      expect(h.get().status).toBe(A.SHORT_LEAVE);
      // Existing reconciler reverses lateness only, not absence deductions/events.
      expect(reverseAbsenceDeductionForDate).not.toHaveBeenCalled();
    },
  );

  it('keeps no-punch SHORT_LEAVE eligible for a full scheduled day in existing payroll calculations', async () => {
    const h = harness();
    await h.short.reconcilePendingShortLeaves();
    const service = new PayrollService(
      {
        attendanceLog: { findMany: jest.fn().mockResolvedValue([h.get()]) },
      } as any,
      {} as any,
    );
    const result = await (service as any).computeHourlyBreakdown('e', 8, 2026, {
      stipendRecord: {
        basicStipend: 24800,
        effectiveFrom: day,
        effectiveTo: new Date('2026-08-15T00:00:00Z'),
      },
      employee: h.employee,
      existingDeductions: [],
      existingAllowances: [],
      asOf: new Date('2026-09-01T00:00:00Z'),
    });
    expect(h.get().status).toBe(A.SHORT_LEAVE);
    expect(result.policyCreditMinutes).toBe(480);
    expect(result.creditedAttendanceDays).toBe(1);
    expect(result.payrollBasicStipend).toBe(800);
    expect(result.disciplineDeductions).toBe(0);
  });
});
