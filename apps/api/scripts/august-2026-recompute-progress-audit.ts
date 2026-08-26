/**
 * READ-ONLY progress audit — compares stored PayrollEntry values against
 * what the CURRENT production recompute logic would produce, for every
 * unique employee with an August 2026 PayrollEntry, WITHOUT writing
 * anything.
 *
 * ZERO writes, guaranteed two ways:
 *   1. This script never calls createOrGetEntry / recomputeEmployeeMonth /
 *      recomputeMonthAll / applyOvertime / any other mutating method, and
 *      never issues an HTTP request to the API.
 *   2. The PrismaClient passed into PayrollService is wrapped in a
 *      runtime read-only guard (see makeReadOnlyPrisma below) that throws
 *      before any create/update/upsert/delete/*Many/$transaction/$executeRaw*
 *      call reaches the database, on every model. This is defense in
 *      depth in case any reused private method's call graph ever changes.
 *
 * WHAT IS REUSED VS RE-IMPLEMENTED (per the task's explicit instruction:
 * reuse existing pure helpers where safe, and only build a read-only
 * mirror where reuse is not safe):
 *
 *   REUSED DIRECTLY (unmodified, same class instance, same code path as
 *   production) — verified read-only, each does at most one
 *   `.findMany()`/pure-JS and never writes:
 *     - PayrollService.findOverlappingStipendRecords
 *     - PayrollService.resolveSegmentDateBounds
 *     - PayrollService.dateWithinSegment
 *     - PayrollService.computeMonthlyUnpaidLeaveDates
 *     - PayrollService.computeHourlyBreakdown
 *     - PayrollService.clampPayrollTotals
 *   These are TypeScript-private but not runtime-private — called here via
 *   `(service as any).method(...)` on a real PayrollService instance
 *   wired to the read-only-guarded Prisma client above.
 *
 *   RE-IMPLEMENTED as read-only mirrors, because the real methods mix a
 *   read with a write (upsertAdditionalWorkingDaysAllowanceRow,
 *   upsertUnpaidLeaveDeductionRow, upsertRelieverAllowanceRow all call
 *   .create/.update/.delete) and therefore CANNOT be called safely without
 *   risking a mutation even with the guard removed as an assumption:
 *     - expectedAdditionalWorkingDaysAllowance() mirrors
 *       upsertAdditionalWorkingDaysAllowanceRow's amount calculation
 *       exactly (same query, same formula), stopping short of the write.
 *     - expectedUnpaidLeaveDeduction() mirrors
 *       upsertUnpaidLeaveDeductionRow's amount calculation — this one
 *       reuses the exported pure function unpaidLeaveDeductionAmount
 *       directly, so there is no reimplemented arithmetic at all, only the
 *       read-only "should a row exist" gate.
 *     - expectedRelieverAllowance() mirrors upsertRelieverAllowanceRow's
 *       amount calculation exactly (same query, same
 *       computeRelieverPayableMinutes/resolveAttendanceDutyTimes calls).
 *   Each of these three was checked line-by-line against the current
 *   payroll.service.ts source at write time — see the comment above each
 *   function for the exact source lines it mirrors.
 *
 *   The three "expected row" results above are combined with whatever
 *   OTHER deduction/allowance rows currently exist on the entry (discipline
 *   fines, overtime, manual additions — none of which recompute touches)
 *   into simulated existingDeductions/existingAllowances arrays, then fed
 *   into the REUSED computeHourlyBreakdown + clampPayrollTotals — this
 *   exactly reproduces upsertPayrollEntryForStipendSegment's final
 *   totals-assignment step (payroll.service.ts, the `computeHourlyBreakdown`
 *   call using `refreshed.deductions`/`refreshed.allowances` right before
 *   its closing `payrollEntry.update`), without ever calling `.update`.
 *
 * FROZEN (PROCESSED/PAID) segments are never given an "expected" value at
 * all — production itself never recomputes them (upsertPayrollEntryForStipendSegment
 * returns the untouched entry immediately for those), so computing a
 * hypothetical expected value for a frozen row would be a fabricated
 * number with no counterpart in what the system would ever actually do.
 *
 * Run:
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/august-2026-recompute-progress-audit.ts > august-2026-progress.json
 */

import { PrismaClient, PayrollStatus, AttendanceLogType, AttendanceStatus } from '@prisma/client';
import { PayrollService } from '../src/modules/payroll/payroll.service';
import {
  computeHourlyRate,
  computeRelieverPayableMinutes,
  resolveDailyDutyHours,
  roundMoney,
  unpaidLeaveDeductionAmount,
} from '../src/modules/payroll/payroll-hours.util';
import { daysInPayrollMonth } from '../src/common/stipend.util';
import { resolveAttendanceDutyTimes } from '../src/common/duty.util';

const TARGET_MONTH = 8;
const TARGET_YEAR = 2026;
const EPSILON = 0.01; // money-comparison tolerance (rounding noise only)

// ─── Runtime read-only guard ────────────────────────────────────────────

const READ_METHODS = new Set(['findMany', 'findFirst', 'findUnique', 'count', 'groupBy', 'aggregate']);
const BLOCKED_CLIENT_METHODS = new Set(['$transaction', '$executeRaw', '$executeRawUnsafe', '$queryRawUnsafe']);

function makeReadOnlyPrisma(real: PrismaClient): PrismaClient {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && BLOCKED_CLIENT_METHODS.has(prop)) {
        throw new Error(`READ-ONLY GUARD: "${prop}" is blocked on this audit's Prisma client`);
      }
      const value = Reflect.get(target, prop, receiver);
      if (
        typeof prop === 'string' &&
        value !== null &&
        typeof value === 'object' &&
        typeof (value as any).findMany === 'function'
      ) {
        // A model delegate (employee, stipendRecord, payrollEntry, ...) — wrap it too.
        return new Proxy(value, {
          get(mTarget, mProp, mReceiver) {
            if (
              typeof mProp === 'string' &&
              typeof (mTarget as any)[mProp] === 'function' &&
              !READ_METHODS.has(mProp)
            ) {
              throw new Error(`READ-ONLY GUARD: "${String(prop)}.${mProp}" is blocked on this audit's Prisma client`);
            }
            return Reflect.get(mTarget, mProp, mReceiver);
          },
        });
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as PrismaClient;
}

const realPrisma = new PrismaClient();
const prisma = makeReadOnlyPrisma(realPrisma);

// accessScopeService is never invoked by any private method this script
// calls (findOverlappingStipendRecords / computeHourlyBreakdown / etc. do
// not touch it) — a stub that would throw if ever (unexpectedly) called is
// safer than a silent no-op.
const stubAccessScopeService = {
  assertEmployeeAccess: async () => {
    throw new Error('accessScopeService should never be invoked by this read-only audit');
  },
};

const service = new PayrollService(prisma as any, stubAccessScopeService as any) as any;

// ─── Read-only mirrors of the two mutating child-row helpers ───────────

/** Mirrors upsertAdditionalWorkingDaysAllowanceRow's amount calculation
 * exactly (payroll.service.ts ~L890-944), stopping before its write. */
async function expectedAdditionalWorkingDaysAllowance(
  employeeId: string,
  month: number,
  year: number,
  employee: { dutyTotalHours?: number | null; dutyStartTime?: string | null; dutyEndTime?: string | null; shift?: { startTime: string; endTime: string } | null },
  contractualBasic: number,
  segmentStart: Date,
  segmentEndExclusive: Date | null,
): Promise<{ amount: number } | null> {
  const daysInMonth = daysInPayrollMonth(year, month);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
  const dayRows = await prisma.additionalWorkingDay.findMany({
    where: {
      employeeId,
      date: { gte: segmentStart, lte: monthEnd, ...(segmentEndExclusive ? { lt: segmentEndExclusive } : {}) },
    },
    select: { note: true },
  });
  const dayCount = dayRows.length;
  const dailyHours = resolveDailyDutyHours(employee);
  const hourlyRate = computeHourlyRate(contractualBasic, dailyHours, daysInMonth);
  const hours = roundMoney(dayCount * dailyHours);
  const amount = roundMoney(hours * hourlyRate);
  if (dayCount <= 0 || amount <= 0) return null;
  return { amount };
}

/** Mirrors upsertUnpaidLeaveDeductionRow's amount calculation exactly
 * (payroll.service.ts ~L995-1042) — reuses unpaidLeaveDeductionAmount
 * directly, no reimplemented arithmetic. */
function expectedUnpaidLeaveDeduction(
  unpaidLeaveDaysInSegment: number,
  contractualBasic: number,
  daysInMonth: number,
): { amount: number } | null {
  const amount = unpaidLeaveDeductionAmount(unpaidLeaveDaysInSegment, contractualBasic, daysInMonth);
  if (unpaidLeaveDaysInSegment <= 0 || amount <= 0) return null;
  return { amount };
}

/** Mirrors upsertRelieverAllowanceRow's amount calculation exactly
 * (payroll.service.ts ~L1055-1180), stopping before its write. */
async function expectedRelieverAllowance(
  employeeId: string,
  month: number,
  year: number,
  employee: { relieverOnly?: boolean; dutyTotalHours?: number | null; dutyStartTime?: string | null; dutyEndTime?: string | null; shift?: { startTime: string; endTime: string } | null },
  contractualBasic: number,
  segmentStart: Date,
  segmentEndExclusive: Date | null,
): Promise<{ amount: number } | null> {
  const daysInMonth = daysInPayrollMonth(year, month);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

  const sessions = await prisma.relieverSession.findMany({
    where: {
      employeeId,
      date: { gte: segmentStart, lte: monthEnd, ...(segmentEndExclusive ? { lt: segmentEndExclusive } : {}) },
      checkOut: { not: null },
    },
  });

  const ownAttendanceLogs = sessions.length
    ? await prisma.attendanceLog.findMany({
        where: {
          employeeId,
          type: AttendanceLogType.REGULAR,
          date: { in: sessions.map((s) => s.date) },
        },
        select: { date: true, dutyStartTimeSnapshot: true, dutyEndTimeSnapshot: true },
      })
    : [];
  const ownDutyByDate = new Map(ownAttendanceLogs.map((l) => [l.date.toISOString().slice(0, 10), l]));

  const totalPayableMinutes = sessions.reduce((sum, s) => {
    if (!s.checkOut) return sum;
    const ownLogForDate = ownDutyByDate.get(s.date.toISOString().slice(0, 10));
    const dayDuty = resolveAttendanceDutyTimes(ownLogForDate, employee);
    return (
      sum +
      computeRelieverPayableMinutes(
        { relieverOnly: employee.relieverOnly, dutyStartTime: dayDuty.dutyStartTime, dutyEndTime: dayDuty.dutyEndTime },
        { checkIn: s.checkIn, checkOut: s.checkOut!, totalMinutes: s.totalMinutes },
      )
    );
  }, 0);

  const dailyHours = resolveDailyDutyHours(employee);
  const hourlyRate = computeHourlyRate(contractualBasic, dailyHours, daysInMonth);
  const hours = roundMoney(totalPayableMinutes / 60);
  const amount = roundMoney(hours * hourlyRate);
  if (totalPayableMinutes <= 0 || amount <= 0) return null;
  return { amount };
}

// ─── Main audit ──────────────────────────────────────────────────────────

type MoneyTotals = { basicStipend: number; totalAllowances: number; totalDeductions: number; netStipend: number };

function moneyEqual(a: MoneyTotals, b: MoneyTotals): boolean {
  return (
    Math.abs(a.basicStipend - b.basicStipend) <= EPSILON &&
    Math.abs(a.totalAllowances - b.totalAllowances) <= EPSILON &&
    Math.abs(a.totalDeductions - b.totalDeductions) <= EPSILON &&
    Math.abs(a.netStipend - b.netStipend) <= EPSILON
  );
}

async function main() {
  const discoveryEntries = await prisma.payrollEntry.findMany({
    where: { month: TARGET_MONTH, year: TARGET_YEAR },
    include: { stipendRecord: { select: { employeeId: true } } },
  });
  const employeeIds = [...new Set(discoveryEntries.map((e: any) => e.stipendRecord.employeeId))] as string[];

  let matchedEmployees = 0;
  let staleEmployees = 0;
  let frozenEmployees = 0;
  let errorEmployees = 0;
  let matchedSegments = 0;
  let staleSegments = 0;
  let frozenSegments = 0;

  const staleDetails: Array<{
    employeeId: string;
    employeeCode: string | null;
    employeeName: string | null;
    currentTotals: MoneyTotals;
    expectedTotals: MoneyTotals;
    segments: Array<{ stipendRecordId: string; payrollEntryId: string; outcome: string; current: MoneyTotals; expected: MoneyTotals | null }>;
  }> = [];

  const errorDetails: Array<{ employeeId: string; error: string }> = [];

  for (const employeeId of employeeIds) {
    try {
      const overlappingStipendRecords = await service.findOverlappingStipendRecords(employeeId, TARGET_MONTH, TARGET_YEAR);
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        include: { shift: { select: { startTime: true, endTime: true } } },
      });
      if (!employee) throw new Error(`Employee ${employeeId} not found`);

      const unpaidLeaveDatesForMonth = await service.computeMonthlyUnpaidLeaveDates(
        employeeId,
        TARGET_MONTH,
        TARGET_YEAR,
        (employee as any).monthlyAllowedLeaves,
      );

      let anyPending = false;
      let employeeStale = false;
      const segmentReports: Array<{ stipendRecordId: string; payrollEntryId: string; outcome: string; current: MoneyTotals; expected: MoneyTotals | null }> = [];
      const currentSum: MoneyTotals = { basicStipend: 0, totalAllowances: 0, totalDeductions: 0, netStipend: 0 };
      const expectedSum: MoneyTotals = { basicStipend: 0, totalAllowances: 0, totalDeductions: 0, netStipend: 0 };

      for (const stipendRecord of overlappingStipendRecords) {
        const entry = await prisma.payrollEntry.findUnique({
          where: { stipendRecordId_month_year: { stipendRecordId: stipendRecord.id, month: TARGET_MONTH, year: TARGET_YEAR } },
          include: { deductions: true, allowances: true },
        });
        if (!entry) continue; // no existing entry for this segment — outside audit scope

        const current: MoneyTotals = {
          basicStipend: Number(entry.basicStipend),
          totalAllowances: Number(entry.totalAllowances),
          totalDeductions: Number(entry.totalDeductions),
          netStipend: Number(entry.netStipend),
        };

        if (entry.status === PayrollStatus.PROCESSED || entry.status === PayrollStatus.PAID) {
          frozenSegments++;
          segmentReports.push({ stipendRecordId: stipendRecord.id, payrollEntryId: entry.id, outcome: 'FROZEN', current, expected: null });
          continue;
        }

        anyPending = true;

        const { segmentStart, segmentEndExclusive, monthEnd } = service.resolveSegmentDateBounds(stipendRecord, TARGET_MONTH, TARGET_YEAR);
        const unpaidLeaveDaysInSegment = unpaidLeaveDatesForMonth.filter((d: Date) =>
          service.dateWithinSegment(d, segmentStart, segmentEndExclusive, monthEnd),
        ).length;
        const contractualBasic = Number(stipendRecord.basicStipend);
        const daysInMonth = daysInPayrollMonth(TARGET_YEAR, TARGET_MONTH);

        const [expectedAwd, expectedReliever] = await Promise.all([
          expectedAdditionalWorkingDaysAllowance(employeeId, TARGET_MONTH, TARGET_YEAR, employee as any, contractualBasic, segmentStart, segmentEndExclusive),
          expectedRelieverAllowance(employeeId, TARGET_MONTH, TARGET_YEAR, employee as any, contractualBasic, segmentStart, segmentEndExclusive),
        ]);
        const expectedUnpaidLeave = expectedUnpaidLeaveDeduction(unpaidLeaveDaysInSegment, contractualBasic, daysInMonth);

        const simulatedDeductions = [
          ...entry.deductions.filter((d: any) => d.reason !== 'UNPAID_LEAVE'),
          ...(expectedUnpaidLeave ? [{ amount: expectedUnpaidLeave.amount }] : []),
        ];
        const simulatedAllowances = [
          ...entry.allowances.filter((a: any) => a.type !== 'ADDITIONAL_WORKING_DAYS' && a.type !== 'RELIEVER'),
          ...(expectedAwd ? [{ amount: expectedAwd.amount }] : []),
          ...(expectedReliever ? [{ amount: expectedReliever.amount }] : []),
        ];

        const breakdown = await service.computeHourlyBreakdown(employeeId, TARGET_MONTH, TARGET_YEAR, {
          stipendRecord,
          employee,
          existingDeductions: simulatedDeductions,
          existingAllowances: simulatedAllowances,
        });
        const expected: MoneyTotals = service.clampPayrollTotals(breakdown);

        currentSum.basicStipend += current.basicStipend;
        currentSum.totalAllowances += current.totalAllowances;
        currentSum.totalDeductions += current.totalDeductions;
        currentSum.netStipend += current.netStipend;
        expectedSum.basicStipend += expected.basicStipend;
        expectedSum.totalAllowances += expected.totalAllowances;
        expectedSum.totalDeductions += expected.totalDeductions;
        expectedSum.netStipend += expected.netStipend;

        if (moneyEqual(current, expected)) {
          matchedSegments++;
          segmentReports.push({ stipendRecordId: stipendRecord.id, payrollEntryId: entry.id, outcome: 'MATCHED', current, expected });
        } else {
          staleSegments++;
          employeeStale = true;
          segmentReports.push({ stipendRecordId: stipendRecord.id, payrollEntryId: entry.id, outcome: 'STALE', current, expected });
        }
      }

      if (!anyPending) {
        frozenEmployees++;
      } else if (employeeStale) {
        staleEmployees++;
        staleDetails.push({
          employeeId,
          employeeCode: (employee as any).employeeCode ?? null,
          employeeName: (employee as any).fullName ?? null,
          currentTotals: currentSum,
          expectedTotals: expectedSum,
          segments: segmentReports,
        });
      } else {
        matchedEmployees++;
      }
    } catch (err) {
      errorEmployees++;
      errorDetails.push({ employeeId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const totalUniqueEmployees = employeeIds.length;
  const denominator = matchedEmployees + staleEmployees; // frozen/error excluded from "complete" denominator — neither is "recomputed under this run"
  const percentageComplete = denominator > 0 ? roundMoney((matchedEmployees / denominator) * 100) : null;

  const output = {
    month: TARGET_MONTH,
    year: TARGET_YEAR,
    totalUniqueEmployees,
    matchedEmployees,
    staleEmployees,
    frozenEmployees,
    errorEmployees,
    matchedSegments,
    staleSegments,
    frozenSegments,
    percentageComplete,
    percentageCompleteNote:
      'matchedEmployees / (matchedEmployees + staleEmployees) * 100 — frozen and error employees are excluded from this denominator since they are not candidates for this recompute run.',
    firstTwentyStaleEmployees: staleDetails.slice(0, 20),
    errors: errorDetails,
  };

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await realPrisma.$disconnect();
  });
