jest.mock("../letters/pdf.helper", () => ({}));
jest.mock("../attendance/discipline.helper", () => ({
  reconcileAttendanceFinancialConsequences: jest
    .fn()
    .mockResolvedValue(undefined),
  reverseLateDisciplineForDate: jest.fn(),
}));
import { AttendanceStatus as A, LeaveType } from "@prisma/client";
import { LeaveService } from "./leave.service";
import { AttendanceService } from "../attendance/attendance.service";
import { PayrollService } from "../payroll/payroll.service";

const day = (n: number) => new Date(Date.UTC(2026, 7, n));
function fixture(seed: any[] = []) {
  const rows = new Map<number, any>(seed.map((r) => [+r.date, { ...r }]));
  const employee = {
    monthlyAllowedLeaves: 2,
    weeklyOffWeekdays: [0],
    currentBranchId: "b",
    dutyStartTime: "09:00",
    dutyEndTime: "17:00",
  };
  const matches = (r: any, w: any) =>
    (!w.status ||
      (typeof w.status === "string"
        ? r.status === w.status
        : r.status !== w.status.not)) &&
    (!w.date ||
      ((!w.date.gte || r.date >= w.date.gte) &&
        (!w.date.lte || r.date <= w.date.lte)));
  const prisma: any = {
    attendanceLog: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          rows.get(+where.employeeId_date_type.date) ?? null,
      ),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = +where.employeeId_date_type.date;
        const old = rows.get(key);
        const row = old
          ? { ...old, ...update }
          : {
              id: String(key),
              checkIn: null,
              checkOut: null,
              lateMinutes: 0,
              overtimeMinutes: 0,
              ...create,
            };
        rows.set(key, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const key = +where.employeeId_date_type.date;
        const row = { ...rows.get(key), ...data };
        rows.set(key, row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const [key, row] of rows)
          if (row.id === where.id && matches(row, where)) {
            rows.set(key, { ...row, ...data });
            count++;
          }
        return { count };
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...rows.values()].filter((r) => matches(r, where)),
      ),
    },
    employee: { findUnique: jest.fn(async () => employee) },
    leaveRecord: { findMany: jest.fn(async () => []) },
    additionalWorkingDay: { findMany: jest.fn(async () => []) },
  };
  const leave = new LeaveService(prisma, {} as any, {} as any);
  const approve = (
    start: number,
    end = start,
    leaveType: LeaveType = LeaveType.REGULAR,
  ) =>
    (leave as any).markLeaveAttendance(prisma, {
      employeeId: "e",
      startDate: day(start),
      endDate: day(end),
      leaveType,
      employee,
    });
  const card = Object.create(AttendanceService.prototype);
  card.prisma = prisma;
  card.ensureMonthLogsForEmployee = jest.fn();
  return {
    rows,
    prisma,
    employee,
    approve,
    card,
    payroll: new PayrollService(prisma, {} as any),
  };
}
const holiday = (n: number) => ({
  id: String(+day(n)),
  date: day(n),
  status: A.HOLIDAY,
  lateMinutes: 0,
  overtimeMinutes: 0,
  checkIn: new Date("2026-08-10T04:00:00Z"),
  checkOut: new Date("2026-08-10T12:00:00Z"),
  note: "Public Holiday",
});

describe("approved leave Holiday / Weekly Off precedence", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-01T12:00:00Z"));
  });
  afterEach(() => jest.useRealTimers());

  it("keeps normal working-day leave ON_LEAVE", async () => {
    const f = fixture();
    await f.approve(8);
    expect(f.rows.get(+day(8)).status).toBe(A.ON_LEAVE);
  });
  it("creates HOLIDAY for the Weekly Off inside a multi-day leave range", async () => {
    const f = fixture();
    await f.approve(8, 10);
    expect([8, 9, 10].map((n) => f.rows.get(+day(n)).status)).toEqual([
      A.ON_LEAVE,
      A.HOLIDAY,
      A.ON_LEAVE,
    ]);
  });
  it("preserves an existing Public Holiday and its punches exactly", async () => {
    const before = holiday(10);
    const f = fixture([before]);
    await f.approve(8, 10);
    expect(f.rows.get(+day(10))).toEqual(before);
  });
  it("does not overwrite Public Holiday when approving Short Leave either", async () => {
    const before = holiday(10);
    const f = fixture([before]);
    await f.approve(10, 10, LeaveType.SHORT_LEAVE);
    expect(f.rows.get(+day(10))).toEqual(before);
  });
  it("counts both holidays in Holiday, only working-day leave in On Leave, without counting Weekly Off twice", async () => {
    const f = fixture([holiday(10)]);
    await f.approve(8, 11);
    const summary = await f.card.getEmployeeSummary("e", 8, 2026);
    expect(summary.holiday).toBe(2);
    expect(summary.onLeave).toBe(2);
    expect(summary.weeklyOff).toBe(0); // current roster does not invent historical Card statuses
    expect(summary.totalDays).toBe(4); // only the four stored final rows
  });
  it("excludes both holidays from the actual payroll paid-leave allocation", async () => {
    const f = fixture([holiday(10)]);
    await f.approve(8, 11);
    expect(
      await (f.payroll as any).computeMonthlyUnpaidLeaveDates("e", 8, 2026, 2),
    ).toEqual([]);
    await f.approve(12);
    expect(
      await (f.payroll as any).computeMonthlyUnpaidLeaveDates("e", 8, 2026, 2),
    ).toEqual([day(12)]);
  });
  it("is idempotent when the range is approved again", async () => {
    const f = fixture([holiday(10)]);
    await f.approve(8, 11);
    const before = [...f.rows.values()];
    await f.approve(8, 11);
    expect([...f.rows.values()]).toEqual(before);
  });
  it("preserves punches when a rostered Weekly Off already has regular attendance", async () => {
    const before = { ...holiday(9), status: A.PRESENT };
    const f = fixture([before]);
    await f.approve(9);
    expect(f.rows.get(+day(9))).toMatchObject({
      status: A.HOLIDAY,
      checkIn: before.checkIn,
      checkOut: before.checkOut,
    });
  });
  it("keeps both holidays fully paid even with zero allowed paid leave days", async () => {
    const f = fixture([holiday(10)]);
    await f.approve(8, 11);
    f.employee.monthlyAllowedLeaves = 0;
    const unpaid = await (f.payroll as any).computeMonthlyUnpaidLeaveDates(
      "e",
      8,
      2026,
      0,
    );
    const result = await (f.payroll as any).computeHourlyBreakdown(
      "e",
      8,
      2026,
      {
        stipendRecord: {
          basicStipend: 24800,
          effectiveFrom: day(8),
          effectiveTo: day(12),
        },
        employee: f.employee,
        applyContractualPackage: true,
        existingDeductions: [],
        existingAllowances: [],
        unpaidLeaveDateKeys: new Set(
          unpaid.map((d: Date) => d.toISOString().slice(0, 10)),
        ),
        asOf: new Date("2026-09-01T12:00:00Z"),
      },
    );
    expect(result.creditedAttendanceDays).toBe(2);
    expect(result.payrollBasicStipend).toBe(1600);
  });
  it("still corrects a working-day row created concurrently after the initial read", async () => {
    const f = fixture();
    f.prisma.attendanceLog.findUnique.mockImplementationOnce(async () => {
      f.rows.set(+day(10), { ...holiday(10), status: A.UNMARKED });
      return null;
    });
    await f.approve(10);
    expect(f.rows.get(+day(10))).toMatchObject({
      status: A.ON_LEAVE,
      checkIn: null,
      checkOut: null,
    });
  });
  it("does not overwrite a HOLIDAY that appears after the initial read", async () => {
    const f = fixture();
    f.prisma.attendanceLog.findUnique.mockImplementationOnce(async () => {
      f.rows.set(+day(10), holiday(10));
      return null;
    });
    await f.approve(10);
    expect(f.rows.get(+day(10))).toEqual(holiday(10));
  });
  it("guards the update itself against concurrent HOLIDAY promotion", async () => {
    const f = fixture([{ ...holiday(10), status: A.UNMARKED }]);
    const update = f.prisma.attendanceLog.updateMany.getMockImplementation();
    f.prisma.attendanceLog.updateMany.mockImplementationOnce(
      async (args: any) => {
        f.rows.set(+day(10), holiday(10));
        return update(args);
      },
    );
    await f.approve(10);
    expect(f.rows.get(+day(10))).toEqual(holiday(10));
  });
});
