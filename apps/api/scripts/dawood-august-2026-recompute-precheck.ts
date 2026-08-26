/**
 * READ-ONLY — controlled-test precheck for the Steps 1-6 payroll fix
 * (image 168) before any bulk August 2026 recompute.
 *
 * Identifies the employee named "Dawood" and dumps everything needed to
 * decide whether he is a safe single-employee target for a controlled
 * POST /payroll/recompute-month call:
 *   1. employee id / employeeCode / name fields
 *   2. every StipendRecord overlapping August 2026 (half-open
 *      [effectiveFrom, effectiveTo) overlap, same rule the payroll code
 *      itself uses)
 *   3. every August 2026 PayrollEntry across those StipendRecord(s)
 *   4. August AttendanceLog counts grouped by status
 *   5. every August AttendanceLog row's date/status/checkIn/checkOut/
 *      dutyStartTimeSnapshot/dutyEndTimeSnapshot
 *   6. every PayrollDeduction and Allowance row on each August
 *      PayrollEntry
 *   7. single-segment vs multi-segment verdict for August
 *
 * ZERO writes. Only ever calls findMany/findFirst/findUnique. Does not
 * call the API, does not call recompute-month, does not touch any table.
 * If more than one employee matches "Dawood", ALL candidates are printed
 * and none is treated as "the" target — resolve the ambiguity by eye
 * before picking an employeeId for the controlled test.
 *
 * Run (read-only, against the verified production backup / read replica,
 * or production itself if that is genuinely the only option — this
 * script issues no mutations either way):
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/dawood-august-2026-recompute-precheck.ts > dawood-precheck.json
 */

import { AttendanceLogType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TARGET_MONTH = 8;
const TARGET_YEAR = 2026;
const MONTH_START = new Date(Date.UTC(TARGET_YEAR, TARGET_MONTH - 1, 1, 0, 0, 0, 0));
const MONTH_END = new Date(Date.UTC(TARGET_YEAR, TARGET_MONTH - 1, 31, 23, 59, 59, 999));

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function main() {
  // 1. Find every employee whose name contains "Dawood" — do not assume a
  // single match or a specific employeeCode.
  const candidates = await prisma.employee.findMany({
    where: { fullName: { contains: 'Dawood', mode: 'insensitive' } },
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      fatherName: true,
      cnic: true,
      status: true,
      currentDesignation: true,
      currentBranchId: true,
      dutyTotalHours: true,
      dutyStartTime: true,
      dutyEndTime: true,
      monthlyAllowedLeaves: true,
    },
  });

  if (candidates.length === 0) {
    console.log(JSON.stringify({ error: 'No employee matching "Dawood" found' }, null, 2));
    return;
  }

  if (candidates.length > 1) {
    console.log(
      JSON.stringify(
        {
          warning: 'MULTIPLE employees match "Dawood" — resolve ambiguity before selecting a controlled-test employeeId',
          candidates,
        },
        null,
        2,
      ),
    );
    return;
  }

  const employee = candidates[0];

  // 4. StipendRecord rows overlapping August 2026 — same half-open overlap
  // rule findOverlappingStipendRecords uses in payroll.service.ts:
  //   effectiveFrom <= monthEnd AND (effectiveTo IS NULL OR effectiveTo > monthStart)
  const stipendRecords = await prisma.stipendRecord.findMany({
    where: {
      employeeId: employee.id,
      effectiveFrom: { lte: MONTH_END },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: MONTH_START } }],
    },
    orderBy: { effectiveFrom: 'asc' },
    select: { id: true, basicStipend: true, effectiveFrom: true, effectiveTo: true },
  });

  // 5. PayrollEntry rows for August 2026 across every overlapping segment.
  const payrollEntries = await prisma.payrollEntry.findMany({
    where: {
      month: TARGET_MONTH,
      year: TARGET_YEAR,
      stipendRecordId: { in: stipendRecords.map((s) => s.id) },
    },
    select: {
      id: true,
      stipendRecordId: true,
      status: true,
      basicStipend: true,
      totalAllowances: true,
      totalDeductions: true,
      netStipend: true,
    },
    orderBy: { id: 'asc' },
  });

  // 6. August attendance counts grouped by status (REGULAR type — the
  // basis payroll.service.ts's computeHourlyBreakdown itself reads).
  const attendanceGrouped = await prisma.attendanceLog.groupBy({
    by: ['status'],
    where: {
      employeeId: employee.id,
      type: AttendanceLogType.REGULAR,
      date: { gte: MONTH_START, lte: MONTH_END },
    },
    _count: { _all: true },
  });

  // 7. Every August attendance date's detail.
  const attendanceLogs = await prisma.attendanceLog.findMany({
    where: {
      employeeId: employee.id,
      type: AttendanceLogType.REGULAR,
      date: { gte: MONTH_START, lte: MONTH_END },
    },
    select: {
      date: true,
      status: true,
      checkIn: true,
      checkOut: true,
      dutyStartTimeSnapshot: true,
      dutyEndTimeSnapshot: true,
    },
    orderBy: { date: 'asc' },
  });

  // 8. Deductions/allowances on each August PayrollEntry.
  const payrollEntryIds = payrollEntries.map((e) => e.id);
  const deductions = await prisma.payrollDeduction.findMany({
    where: { payrollEntryId: { in: payrollEntryIds } },
    select: { id: true, payrollEntryId: true, reason: true, amount: true, description: true },
    orderBy: { id: 'asc' },
  });
  const allowances = await prisma.allowance.findMany({
    where: { payrollEntryId: { in: payrollEntryIds } },
    select: { id: true, payrollEntryId: true, type: true, amount: true, hours: true, description: true },
    orderBy: { id: 'asc' },
  });

  const isMultiSegment = stipendRecords.length > 1;

  const output = {
    employee: {
      id: employee.id,
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      fatherName: employee.fatherName,
      cnic: employee.cnic,
      status: employee.status,
      currentDesignation: employee.currentDesignation,
      currentBranchId: employee.currentBranchId,
      dutyTotalHours: employee.dutyTotalHours,
      dutyStartTime: employee.dutyStartTime,
      dutyEndTime: employee.dutyEndTime,
      monthlyAllowedLeaves: employee.monthlyAllowedLeaves,
    },
    stipendRecordsOverlappingAugust2026: stipendRecords.map((s) => ({
      id: s.id,
      basicStipend: Number(s.basicStipend),
      effectiveFrom: iso(s.effectiveFrom),
      effectiveTo: iso(s.effectiveTo),
    })),
    payrollEntriesAugust2026: payrollEntries.map((e) => ({
      id: e.id,
      stipendRecordId: e.stipendRecordId,
      status: e.status,
      basicStipend: Number(e.basicStipend),
      totalAllowances: Number(e.totalAllowances),
      totalDeductions: Number(e.totalDeductions),
      netStipend: Number(e.netStipend),
    })),
    attendanceCountsByStatus: attendanceGrouped.map((g) => ({
      status: g.status,
      count: g._count._all,
    })),
    attendanceDatesAugust2026: attendanceLogs.map((l) => ({
      date: iso(l.date),
      status: l.status,
      checkIn: iso(l.checkIn),
      checkOut: iso(l.checkOut),
      dutyStartTimeSnapshot: l.dutyStartTimeSnapshot,
      dutyEndTimeSnapshot: l.dutyEndTimeSnapshot,
    })),
    payrollDeductions: deductions.map((d) => ({
      id: d.id,
      payrollEntryId: d.payrollEntryId,
      reason: d.reason,
      amount: Number(d.amount),
      description: d.description,
    })),
    payrollAllowances: allowances.map((a) => ({
      id: a.id,
      payrollEntryId: a.payrollEntryId,
      type: a.type,
      amount: Number(a.amount),
      hours: a.hours,
      description: a.description,
    })),
    segmentation: {
      overlappingStipendRecordCount: stipendRecords.length,
      isMultiSegment,
      verdict: isMultiSegment
        ? 'MULTI-SEGMENT for August 2026 — recompute-month will touch multiple PayrollEntry rows for this employee'
        : 'SINGLE-SEGMENT for August 2026 — recompute-month will touch exactly one PayrollEntry row for this employee',
    },
    recommendedControlledTestEmployeeId: employee.id,
  };

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
