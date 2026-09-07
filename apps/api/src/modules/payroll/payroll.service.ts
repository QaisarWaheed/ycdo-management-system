import { resolvePackageComponents, validatePackageTimeline } from './stipend-package-integrity.util';
import { loadAttendanceCard, type AttendanceCard } from '../attendance/attendance-card.util';
import { calculateCardSalary, isLegacyAttendanceDeduction, CARD_ABSENCE_DESCRIPTION, CARD_LATE_DESCRIPTION } from './attendance-card-salary.util';
import { payrollTransactionClient, withPayrollEmployeeTransaction } from './payroll-write-lock.util';
import {
  calculateLumpsumTotal,
  dailyStipendRate,
  daysInPayrollMonth,
  stipendRecordToPackage,
  prorateMonthlyPackageAmount,
} from '../../common/stipend.util';
import {
  getDutyWindow,
  resolveAttendanceDutyTimes,
} from '../../common/duty.util';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AllowanceType,
  AttendanceLogType,
  AttendanceStatus,
  DeductionType,
  EmployeeStatus,
  LeaveApprovalAction,
  LeaveApprovalStage,
  LeaveStatus,
  LeaveType,
  LetterType,
  Permission,
  PayrollStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScopeService } from '../permissions/access-scope.service';
import {
  isPreJoinAttendanceDate,
  pakistanMonthDateRange,
  pakistanYearMonthFromDate,
  PRE_JOIN_UNMARKED_NOTE,
} from '../attendance/attendance-calendar.util';
import {
  EMPTY_PAYROLL_ATTENDANCE_REPORT,
  summarizeAttendanceLogs,
  toPayrollAttendanceReport,
} from '../attendance/attendance-summary.util';
import {
  aggregateMonthlyPayrollByEmployee,
  aggregatePayrollHistoryByMonth as aggregatePayrollHistoryByMonthUtil,
  keepPayrollSegmentsForMonth,
  mergePayrollSegments,
  toUtcMonthStart,
} from './payroll-aggregate.util';
import {
  isExitEmployeeStatus,
  isPostExitAttendanceDate,
  isPreActiveAttendanceDate,
} from '../employees/status-effective.util';
import {
  parseAttendanceDateTime,
  toPakistanDateOnly,
} from '../attendance/attendance-late.util';
import { repairLateDisciplineForPayrollMonth } from '../attendance/discipline.helper';
import {
  AddDeductionDto,
  AddAllowanceDto,
  ApplyOvertimeDto,
  CreatePayrollEntryDto,
  PayrollQueryDto,
  RebuildPayrollDto,
  ResetUnpaidPayrollDto,
  SalaryIncrementDto,
  UpdateActiveStipendDto,
  UpdatePayrollStatusDto,
} from './payroll.dto';
import {
  isPayrollDefaultStatus,
  PAYROLL_DEFAULT_EMPLOYEE_STATUSES,
} from './payroll-eligibility.util';
import {
  buildHourlyPayrollBreakdown,
  computeHourlyRate,
  computeRelieverPayableMinutes,
  dateKey,
  hoursFromDutyWindow,
  leaveCreditMinutes,
  payableMinutesWithinDutyWindow,
  resolveDailyDutyHours,
  resolveManualAllowancePay,
  roundMoney,
  splitPaidUnpaidLeaveDays,
  type HourlyPayrollBreakdown,
} from './payroll-hours.util';
import {
  PAYSLIP_ORG_NAME,
  formatSlipDutyTime,
  formatSlipMonthTitle,
  formatSlipPeriod,
  sanitizeSheetName,
  computeDeductionsTotal,
  computeEarningsTotal,
  type PayslipSlipData,
} from './payslip-slip.util';
import ExcelJS from 'exceljs';

const PK_OFFSET_MS = 5 * 60 * 60 * 1000;
/** Pakistan calendar date (midnight UTC of the PK day) for a given instant
 * — used to decide whether a segment date has actually elapsed yet, so an
 * in-progress month's gap-day crediting never reaches into the future. */
function pakistanDateOnly(d: Date): Date {
  const pk = new Date(d.getTime() + PK_OFFSET_MS);
  return new Date(Date.UTC(pk.getUTCFullYear(), pk.getUTCMonth(), pk.getUTCDate()));
}

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);
  private transactionBound = false;
  private inTransaction(tx: Prisma.TransactionClient): PayrollService {
    const service = new PayrollService(payrollTransactionClient(tx), this.accessScopeService);
    service.transactionBound = true;
    return service;
  }
  private async entryEmployeeId(entryId: string): Promise<string> {
    const entry = await this.prisma.payrollEntry.findUnique({ where: { id: entryId }, include: { stipendRecord: true } });
    if (!entry) throw new NotFoundException('Payroll entry not found');
    return entry.stipendRecord.employeeId;
  }

  constructor(
    private prisma: PrismaService,
    private accessScopeService: AccessScopeService,
  ) {}

  async createOrGetEntry(
    dto: CreatePayrollEntryDto,
    actingUser?: { id: string; role: UserRole },
  ) {
    if (!this.transactionBound) return withPayrollEmployeeTransaction(this.prisma, dto.employeeId, tx => this.inTransaction(tx).createOrGetEntry(dto, actingUser));

    if (actingUser?.id) {
      await this.accessScopeService.assertEmployeeAccess(
        actingUser.id,
        actingUser.role,
        Permission.PAYROLL_MANAGE,
        dto.employeeId,
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: {
        shift: { select: { startTime: true, endTime: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    const defaultEligible = isPayrollDefaultStatus(employee.status);
    const forceNonActive = dto.allowNonActive === true;

    if (!defaultEligible && !forceNonActive) {
      throw new BadRequestException(
        `Payroll entries are only generated for ACTIVE or ON_REST employees (current status: ${employee.status}). Use approved force-generate for exceptions.`,
      );
    }

    if (forceNonActive && !defaultEligible) {
      if (!dto.approvalReason?.trim()) {
        throw new BadRequestException(
          'approvalReason is required when generating payroll for a non-active employee',
        );
      }
      if (!actingUser?.id) {
        throw new ForbiddenException(
          'Authenticated user required to force-generate payroll',
        );
      }
    }

    // Discover EVERY StipendRecord overlapping this month. Create/refresh
    // each overlapping PENDING segment so mid-month stipend changes keep
    // separate contractual periods (calendar-prorated Basic + allowances).
    // Fixed monthly package deductions apply once on the package-bearing
    // segment only (active open record, else newest closed). Return the
    // package-bearing entry to preserve this method's single-entry contract.
    const { records: overlappingStipendRecords, backfillFromAttendance } =
      await this.resolveStipendRecordsForPayrollMonth(
        dto.employeeId,
        dto.month,
        dto.year,
      );
    if (overlappingStipendRecords.length === 0) {
      throw new NotFoundException(
        `No stipend record found covering ${dto.month}/${dto.year} for ${employee.fullName} (${employee.employeeCode}). Add a stipend package with an effective date on or before this month, then generate again.`,
      );
    }
    const activeStipendRecord =
      overlappingStipendRecords.find((r) => r.effectiveTo === null) ??
      overlappingStipendRecords[overlappingStipendRecords.length - 1];
    const packageBearingId = activeStipendRecord.id;

    const existingActiveEntry = await this.prisma.payrollEntry.findUnique({
      where: {
        stipendRecordId_month_year: {
          stipendRecordId: activeStipendRecord.id,
          month: dto.month,
          year: dto.year,
        },
      },
    });

    if (
      existingActiveEntry &&
      (existingActiveEntry.status === PayrollStatus.PROCESSED ||
        existingActiveEntry.status === PayrollStatus.PAID)
    ) {
      await this.pruneDuplicateOpenActivePayrollEntries(
        dto.employeeId,
        dto.month,
        dto.year,
        overlappingStipendRecords,
      );
      return existingActiveEntry;
    }

    if (forceNonActive && !defaultEligible && actingUser?.id) {
      await this.prisma.auditLog.create({
        data: {
          userId: actingUser.id,
          action: 'PAYROLL_ENTRY_FORCED',
          entity: 'PayrollEntry',
          entityId: existingActiveEntry?.id ?? dto.employeeId,
          changes: {
            employeeId: dto.employeeId,
            employeeStatus: employee.status,
            month: dto.month,
            year: dto.year,
            approvalReason: dto.approvalReason?.trim(),
          },
        },
      });
    }

    const unpaidLeaveDatesForMonth = await this.computeMonthlyUnpaidLeaveDates(
      dto.employeeId,
      dto.month,
      dto.year,
      employee.monthlyAllowedLeaves,
    );

    let primaryResult: Awaited<
      ReturnType<PayrollService['upsertPayrollEntryForStipendSegment']>
    > | null = null;

    for (const stipendRecord of overlappingStipendRecords) {
      const refreshed = await this.upsertPayrollEntryForStipendSegment(
        stipendRecord,
        dto,
        employee,
        forceNonActive && !defaultEligible && stipendRecord.id === packageBearingId
          ? true
          : undefined,
        unpaidLeaveDatesForMonth,
        stipendRecord.id === packageBearingId,
        {
          backfillFromJoining:
            !backfillFromAttendance && stipendRecord.effectiveTo == null,
          backfillFromAttendance,
          backfillContractualFromEmployment:
            !backfillFromAttendance &&
            stipendRecord.effectiveTo == null &&
            overlappingStipendRecords[0]?.id === stipendRecord.id,
        },
      );
      if (stipendRecord.id === packageBearingId) {
        primaryResult = refreshed;
      }
    }

    await this.pruneDuplicateOpenActivePayrollEntries(
      dto.employeeId,
      dto.month,
      dto.year,
      overlappingStipendRecords,
    );

    if (!primaryResult) {
      throw new NotFoundException(
        `Failed to create payroll entry for ${employee.fullName} (${employee.employeeCode})`,
      );
    }
    return primaryResult;
  }

  /**
   * Explicit, "return everything" multi-segment recompute for one
   * employee/month. Unlike createOrGetEntry, this NEVER creates a new
   * PayrollEntry — it only refreshes PENDING segments that already have one.
   * PROCESSED and PAID stay financially frozen. Segments with no entry yet
   * still need an explicit createOrGetEntry call (which also carries the
   * non-active-employee eligibility checks this method deliberately does
   * not duplicate). Shares upsertPayrollEntryForStipendSegment with
   * createOrGetEntry, so the two can never compute a segment differently.
   */
  async recomputeEmployeeMonth(
    dto: { employeeId: string; month: number; year: number },
    actingUser?: { id: string; role: UserRole },
  ): Promise<
    Array<{
      stipendRecordId: string;
      status: 'RECOMPUTED' | 'FROZEN' | 'NO_EXISTING_ENTRY';
      entry: Prisma.PayrollEntryGetPayload<{
        include: { deductions: true; allowances: true };
      }> | null;
    }>
  > {
    if (!this.transactionBound) return withPayrollEmployeeTransaction(this.prisma, dto.employeeId, tx => this.inTransaction(tx).recomputeEmployeeMonth(dto, actingUser));

    if (actingUser?.id) {
      await this.accessScopeService.assertEmployeeAccess(
        actingUser.id,
        actingUser.role,
        Permission.PAYROLL_MANAGE,
        dto.employeeId,
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: { shift: { select: { startTime: true, endTime: true } } },
    });
    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    const { records: overlappingStipendRecords, backfillFromAttendance } =
      await this.resolveStipendRecordsForPayrollMonth(
        dto.employeeId,
        dto.month,
        dto.year,
      );
    if (overlappingStipendRecords.length === 0) {
      return [];
    }
    const packageBearingId =
      overlappingStipendRecords.find((r) => r.effectiveTo === null)?.id ??
      overlappingStipendRecords[overlappingStipendRecords.length - 1]?.id;

    const unpaidLeaveDatesForMonth = await this.computeMonthlyUnpaidLeaveDates(
      dto.employeeId,
      dto.month,
      dto.year,
      employee.monthlyAllowedLeaves,
    );

    const results: Array<{
      stipendRecordId: string;
      status: 'RECOMPUTED' | 'FROZEN' | 'NO_EXISTING_ENTRY';
      entry: Prisma.PayrollEntryGetPayload<{
        include: { deductions: true; allowances: true };
      }> | null;
    }> = [];

    for (const stipendRecord of overlappingStipendRecords) {
      const existing = await this.prisma.payrollEntry.findUnique({
        where: {
          stipendRecordId_month_year: {
            stipendRecordId: stipendRecord.id,
            month: dto.month,
            year: dto.year,
          },
        },
        include: { deductions: true, allowances: true },
      });

      if (!existing) {
        results.push({
          stipendRecordId: stipendRecord.id,
          status: 'NO_EXISTING_ENTRY',
          entry: null,
        });
        continue;
      }

      if (
        existing.status === PayrollStatus.PAID ||
        existing.status === PayrollStatus.PROCESSED
      ) {
        results.push({
          stipendRecordId: stipendRecord.id,
          status: 'FROZEN',
          entry: existing,
        });
        continue;
      }

      const refreshedEntry = await this.upsertPayrollEntryForStipendSegment(
        stipendRecord,
        dto,
        employee,
        undefined,
        unpaidLeaveDatesForMonth,
        stipendRecord.id === packageBearingId,
        {
          backfillFromJoining:
            !backfillFromAttendance && stipendRecord.effectiveTo == null,
          backfillFromAttendance,
          backfillContractualFromEmployment:
            !backfillFromAttendance &&
            stipendRecord.effectiveTo == null &&
            overlappingStipendRecords[0]?.id === stipendRecord.id,
        },
      );
      results.push({
        stipendRecordId: stipendRecord.id,
        status: 'RECOMPUTED',
        entry: refreshedEntry,
      });
    }

    await this.pruneDuplicateOpenActivePayrollEntries(
      dto.employeeId,
      dto.month,
      dto.year,
      overlappingStipendRecords,
    );

    return results;
  }

  /**
   * PERMANENT-behavior centralized hook: the single entry point every
   * attendance-mutating path in the system (biometric, manual, portal,
   * import, leave approval/reconciliation, mutual swap, short-leave and
   * absence schedulers) calls after its own write has already committed,
   * so a PENDING PayrollEntry never goes stale again the way the August
   * 2026 data did before Steps 1-6's one-time cleanup.
   *
   * Derives month/year from `attendanceDate` (the attendance BUSINESS
   * date — AttendanceLog.date / a LeaveRecord's own startDate/endDate /
   * a MutualSwap's own date — never wall-clock "now", so correcting a
   * historical August record in September still recomputes AUGUST, never
   * the current month). Reuses recomputeEmployeeMonth (and transitively
   * findOverlappingStipendRecords / upsertPayrollEntryForStipendSegment)
   * verbatim — no calculation logic is duplicated here.
   *
   * Two safety properties, both load-bearing:
   *   1. Never auto-creates payroll: if no PayrollEntry exists yet for
   *      this employee/month (across ANY stipend segment), this is a
   *      no-op — an attendance change is never itself sufficient reason
   *      to bring a new payroll record into existence; that remains an
   *      explicit createOrGetEntry/salary-cycle decision.
   *   2. Never throws: the attendance/leave/swap mutation that triggered
   *      this has already succeeded and committed by the time this runs
   *      (every caller awaits this AFTER its own transaction resolves,
   *      never inside it) — a recompute failure must never surface as
   *      though the attendance write itself failed. Logged, not thrown.
   *
   * No recursion risk: recomputeEmployeeMonth's entire call graph
   * (computeHourlyBreakdown, computeMonthlyUnpaidLeaveDates,
   * upsertAdditionalWorkingDaysAllowanceRow, upsertUnpaidLeaveDeductionRow,
   * upsertRelieverAllowanceRow, upsertOvertimeAllowanceRow) only ever READS AttendanceLog — none of
   * it writes to AttendanceLog or calls back into any attendance/leave/
   * swap service — so this can never trigger another attendance mutation
   * or another recompute cycle.
   *
   * PROCESSED and PAID segments stay financially frozen. Only PENDING
   * entries are refreshed so in-progress months keep matching attendance.
   */
  async recomputePendingPayrollForAttendanceDate(
    employeeId: string,
    attendanceDate: Date,
  ): Promise<void> {
    const { month, year } = pakistanYearMonthFromDate(attendanceDate);

    try {
      const existingEntry = await this.prisma.payrollEntry.findFirst({
        where: { month, year, stipendRecord: { employeeId } },
        select: { id: true },
      });
      if (!existingEntry) return; // never auto-create payroll from an attendance side effect

      await this.recomputeEmployeeMonth({ employeeId, month, year });
    } catch (err) {
      this.logger.error(
        `recomputePendingPayrollForAttendanceDate failed for employee ${employeeId}, ${year}-${month}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Safe, generic system-wide recompute for one calendar month's EXISTING
   * payroll data — built for the August 2026 stale-payroll cleanup after
   * Steps 1-6, but not August-specific (month/year are inputs). Discovers
   * every unique EMPLOYEE (never PayrollEntry row — an employee can have
   * multiple rows across stipend segments, and must only ever be entered
   * into recomputeEmployeeMonth once, see step 7 of the spec this
   * implements) who already has at least one PayrollEntry for the target
   * month/year, then delegates every actual recompute to the existing,
   * already-tested recomputeEmployeeMonth — this method adds ZERO new
   * calculation logic, only discovery/orchestration/reporting on top of
   * it. recomputeEmployeeMonth already never creates a new PayrollEntry
   * and already skips PROCESSED/PAID segments untouched, so both of those
   * guarantees are inherited for free rather than re-implemented here.
   *
   * BATCHING: offset/limit apply at the UNIQUE-EMPLOYEE level (never a
   * PayrollEntry row count — a multi-segment employee must never be split
   * across two batches or entered twice), against a deterministic
   * (sorted-by-employeeId) ordering of the full month's employee scope, so
   * that repeated calls with offset 0, limit, 2×limit, ... walk every
   * employee exactly once regardless of how many calls it takes — this is
   * what lets a large month be recomputed in several short HTTP requests
   * instead of one that risks a 504. `limit` defaults to 25 and is capped
   * at 50 by the DTO's own validation; this method re-clamps defensively
   * for any caller that builds the dto object directly.
   *
   * dryRun: true performs the exact same discovery/classification pass
   * with ZERO calls to recomputeEmployeeMonth (zero mutations) — it
   * reports what WOULD happen, never a fabricated projected after-value.
   * Non-dry-run requests are rejected unless `confirm` exactly equals
   * 'RECOMPUTE_PENDING_PAYROLL' (checked by the DTO's own validator,
   * defense-in-depth double-checked here too since this method can in
   * principle be called directly).
   *
   * Processing is strictly sequential (one employee at a time, no
   * Promise.all fan-out) and each employee's status is re-read fresh
   * immediately before it is processed — never from the initial discovery
   * snapshot — so a payroll that transitions to PROCESSED/PAID mid-run
   * (or between a dry-run and the follow-up apply call) is still
   * correctly frozen. One employee throwing is caught and recorded in
   * `failures`; it never aborts the remaining employees in this batch.
   */
  async recomputeMonthAll(
    dto: {
      month: number;
      year: number;
      dryRun?: boolean;
      confirm?: string;
      limit?: number;
      offset?: number;
    },
    actingUser: { id: string; role: UserRole },
  ) {
    const isDryRun = dto.dryRun === true;
    if (!isDryRun && dto.confirm !== 'RECOMPUTE_PENDING_PAYROLL') {
      throw new BadRequestException(
        'Bulk recompute requires confirm: "RECOMPUTE_PENDING_PAYROLL" unless dryRun is true',
      );
    }

    const DEFAULT_LIMIT = 25;
    const MAX_LIMIT = 50;
    const limit = Math.min(Math.max(1, dto.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const offset = Math.max(0, dto.offset ?? 0);

    // Discovery snapshot for the WHOLE month/year — used only to derive
    // the deterministic employee ordering and totalEmployeesInScope, never
    // to pick which entries get processed (currentEntries, re-read fresh
    // per employee below, is the source of truth for that).
    const discoveryEntries = await this.prisma.payrollEntry.findMany({
      where: { month: dto.month, year: dto.year },
      include: { stipendRecord: { select: { employeeId: true } } },
    });

    type MoneyTotals = {
      basicStipend: number;
      totalAllowances: number;
      totalDeductions: number;
      netStipend: number;
    };
    const sumTotals = (
      rows: Array<{
        basicStipend: unknown;
        totalAllowances: unknown;
        totalDeductions: unknown;
        netStipend: unknown;
      }>,
    ): MoneyTotals =>
      rows.reduce<MoneyTotals>(
        (acc, r) => ({
          basicStipend: acc.basicStipend + Number(r.basicStipend),
          totalAllowances: acc.totalAllowances + Number(r.totalAllowances),
          totalDeductions: acc.totalDeductions + Number(r.totalDeductions),
          netStipend: acc.netStipend + Number(r.netStipend),
        }),
        { basicStipend: 0, totalAllowances: 0, totalDeductions: 0, netStipend: 0 },
      );

    // Deterministic ordering — sorted by employeeId so consecutive calls
    // (offset 0, limit; offset limit, limit; ...) can never skip or
    // duplicate an employee, and a repeated call with the same
    // offset/limit always returns the exact same slice.
    const allEmployeeIds = [
      ...new Set(discoveryEntries.map((e) => e.stipendRecord.employeeId)),
    ].sort();
    const totalEmployeesInScope = allEmployeeIds.length;
    const batchEmployeeIds = allEmployeeIds.slice(offset, offset + limit);
    const batchEmployeesFound = batchEmployeeIds.length;
    const batchEmployeeIdSet = new Set(batchEmployeeIds);

    // beforeTotals/afterTotals are scoped to THIS batch's employees only —
    // the closed universe of PayrollEntry ids this call can ever touch
    // (recompute never creates a new entry, so no id outside this set can
    // appear later, and no id belonging to an employee outside this batch
    // is ever touched by this call).
    const batchEntryIdUniverse = discoveryEntries
      .filter((e) => batchEmployeeIdSet.has(e.stipendRecord.employeeId))
      .map((e) => e.id);
    const beforeTotals = sumTotals(
      discoveryEntries.filter((e) =>
        batchEmployeeIdSet.has(e.stipendRecord.employeeId),
      ),
    );

    let employeesProcessed = 0;
    let employeesSkipped = 0;
    let employeesFailed = 0;
    let segmentsRecomputed = 0;
    let segmentsFrozen = 0;

    type SegmentResult = {
      stipendRecordId: string;
      payrollEntryId: string | null;
      statusBefore: PayrollStatus;
      outcome: 'RECOMPUTED' | 'FROZEN' | 'WOULD_RECOMPUTE';
    };
    const results: Array<{
      employeeId: string;
      employeeCode: string | null;
      employeeName: string | null;
      status:
        | 'RECOMPUTED'
        | 'PARTIAL_RECOMPUTE'
        | 'WOULD_RECOMPUTE'
        | 'SKIPPED_ALL_FROZEN';
      segments: SegmentResult[];
    }> = [];
    const failures: Array<{ employeeId: string; error: string }> = [];

    // Strictly sequential — no Promise.all fan-out across employees.
    for (const employeeId of batchEmployeeIds) {
      try {
        // Re-read fresh, immediately before acting on this employee — never
        // trust the initial discovery snapshot for the mutate/skip decision.
        const currentEntries = await this.prisma.payrollEntry.findMany({
          where: {
            month: dto.month,
            year: dto.year,
            stipendRecord: { employeeId },
          },
        });
        if (currentEntries.length === 0) continue; // entry set is closed; defensive only

        const unpaidCount = currentEntries.filter(
          (e) => e.status === PayrollStatus.PENDING,
        ).length;

        const employee = await this.prisma.employee.findUnique({
          where: { id: employeeId },
          select: { employeeCode: true, fullName: true },
        });

        if (unpaidCount === 0) {
          // Only PROCESSED/PAID -> skip employee entirely, never mutated.
          employeesSkipped++;
          segmentsFrozen += currentEntries.length;
          results.push({
            employeeId,
            employeeCode: employee?.employeeCode ?? null,
            employeeName: employee?.fullName ?? null,
            status: 'SKIPPED_ALL_FROZEN',
            segments: currentEntries.map((e) => ({
              stipendRecordId: e.stipendRecordId,
              payrollEntryId: e.id,
              statusBefore: e.status,
              outcome: 'FROZEN',
            })),
          });
          continue;
        }

        if (isDryRun) {
          // Scope/precondition reporting only — no mutating helper is ever
          // called in this branch, so there is nothing to fabricate.
          employeesProcessed++;
          const frozenHere = currentEntries.length - unpaidCount;
          segmentsRecomputed += unpaidCount;
          segmentsFrozen += frozenHere;
          results.push({
            employeeId,
            employeeCode: employee?.employeeCode ?? null,
            employeeName: employee?.fullName ?? null,
            status: 'WOULD_RECOMPUTE',
            segments: currentEntries.map((e) => ({
              stipendRecordId: e.stipendRecordId,
              payrollEntryId: e.id,
              statusBefore: e.status,
              outcome:
                e.status === PayrollStatus.PENDING
                  ? 'WOULD_RECOMPUTE'
                  : 'FROZEN',
            })),
          });
          continue;
        }

        // APPLY — delegate to the existing, already-tested
        // recomputeEmployeeMonth. No calculation logic is duplicated here.
        const segmentOutcomes = await this.recomputeEmployeeMonth(
          { employeeId, month: dto.month, year: dto.year },
          actingUser,
        );

        const recomputedHere = segmentOutcomes.filter(
          (r) => r.status === 'RECOMPUTED',
        ).length;
        const frozenHere = segmentOutcomes.filter(
          (r) => r.status === 'FROZEN',
        ).length;
        segmentsRecomputed += recomputedHere;
        segmentsFrozen += frozenHere;
        employeesProcessed++;

        results.push({
          employeeId,
          employeeCode: employee?.employeeCode ?? null,
          employeeName: employee?.fullName ?? null,
          status: frozenHere > 0 ? 'PARTIAL_RECOMPUTE' : 'RECOMPUTED',
          segments: segmentOutcomes
            .filter((r) => r.status !== 'NO_EXISTING_ENTRY') // this run's universe only has employees with an existing entry already
            .map((r) => ({
              stipendRecordId: r.stipendRecordId,
              payrollEntryId: r.entry?.id ?? null,
              statusBefore:
                currentEntries.find(
                  (e) => e.stipendRecordId === r.stipendRecordId,
                )?.status ?? r.entry!.status,
              outcome: r.status as 'RECOMPUTED' | 'FROZEN',
            })),
        });
      } catch (err) {
        employeesFailed++;
        failures.push({
          employeeId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Re-read the closed, batch-scoped entry-id universe fresh from the DB
    // for the final totals — actual physical state, never accumulated
    // in-memory values. For a dry run this is identical to beforeTotals,
    // since nothing was written; for apply it reflects exactly what was
    // persisted for this batch.
    const finalEntries = await this.prisma.payrollEntry.findMany({
      where: { id: { in: batchEntryIdUniverse } },
    });
    const afterTotals = sumTotals(finalEntries);

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const roundTotals = (t: {
      basicStipend: number;
      totalAllowances: number;
      totalDeductions: number;
      netStipend: number;
    }) => ({
      basicStipend: round2(t.basicStipend),
      totalAllowances: round2(t.totalAllowances),
      totalDeductions: round2(t.totalDeductions),
      netStipend: round2(t.netStipend),
    });

    const nextOffset = offset + batchEmployeesFound;
    const hasMore = nextOffset < totalEmployeesInScope;

    return {
      month: dto.month,
      year: dto.year,
      dryRun: isDryRun,
      totalEmployeesInScope,
      offset,
      limit,
      batchEmployeesFound,
      employeesProcessed,
      employeesSkipped,
      employeesFailed,
      segmentsRecomputed,
      segmentsFrozen,
      nextOffset,
      hasMore,
      beforeTotals: roundTotals(beforeTotals),
      afterTotals: roundTotals(afterTotals),
      results,
      failures,
    };
  }

  /**
   * Deletes unpaid (PENDING / PROCESSED) payroll rows so they can be rebuilt
   * from attendance and fine letters. PAID rows are never touched.
   */
  async resetUnpaidPayroll(
    dto: ResetUnpaidPayrollDto,
    actingUser: { id: string; role: UserRole },
  ) {
    if (dto.confirm !== 'RESET_UNPAID_PAYROLL') {
      throw new BadRequestException(
        'Reset requires confirm: "RESET_UNPAID_PAYROLL"',
      );
    }

    const unpaidWhere: Prisma.PayrollEntryWhereInput = {
      status: { in: [PayrollStatus.PENDING, PayrollStatus.PROCESSED] },
      ...(dto.allUnpaidMonths
        ? {}
        : { month: dto.month, year: dto.year }),
      ...(dto.branchId
        ? {
            stipendRecord: {
              employee: { currentBranchId: dto.branchId },
            },
          }
        : {}),
    };

    if (!this.transactionBound) {
      const candidates = await this.prisma.payrollEntry.findMany({ where: unpaidWhere, select: { stipendRecord: { select: { employeeId: true } } } });
      return withPayrollEmployeeTransaction(this.prisma, candidates.map(row => row.stipendRecord.employeeId), tx => this.inTransaction(tx).resetUnpaidPayroll(dto, actingUser));
    }
    const unpaid = await this.prisma.payrollEntry.findMany({
      where: unpaidWhere,
      select: { id: true },
    });
    const ids = unpaid.map((row) => row.id);

    const paidSkipped = await this.prisma.payrollEntry.count({
      where: {
        status: PayrollStatus.PAID,
        ...(dto.allUnpaidMonths
          ? {}
          : { month: dto.month, year: dto.year }),
        ...(dto.branchId
          ? {
              stipendRecord: {
                employee: { currentBranchId: dto.branchId },
              },
            }
          : {}),
      },
    });

    const CHUNK = 400;
    await this.prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          await tx.stipendReceipt.deleteMany({
            where: { payrollEntryId: { in: chunk } },
          });
          await tx.payrollDeduction.deleteMany({
            where: { payrollEntryId: { in: chunk } },
          });
          await tx.allowance.deleteMany({
            where: { payrollEntryId: { in: chunk } },
          });
          await tx.payrollEntry.deleteMany({
            where: { id: { in: chunk } },
          });
        }
        await tx.auditLog.create({
          data: {
            userId: actingUser.id,
            action: 'PAYROLL_UNPAID_RESET',
            entity: 'PayrollEntry',
            entityId: actingUser.id,
            changes: {
              month: dto.month,
              year: dto.year,
              branchId: dto.branchId ?? null,
              allUnpaidMonths: dto.allUnpaidMonths === true,
              deleted: ids.length,
              paidSkipped,
            },
          },
        });
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    return {
      deleted: ids.length,
      paidSkipped,
      month: dto.month,
      year: dto.year,
      allUnpaidMonths: dto.allUnpaidMonths === true,
    };
  }

  /**
   * Creates/refreshes payroll for ACTIVE / ON_REST employees from current
   * attendance and issued FINE letters (late + missing-checkout).
   */
  async rebuildPayrollFromAttendanceAndLetters(
    dto: RebuildPayrollDto,
    actingUser: { id: string; role: UserRole },
  ) {
    if (dto.confirm !== 'REBUILD_PAYROLL') {
      throw new BadRequestException(
        'Rebuild requires confirm: "REBUILD_PAYROLL"',
      );
    }

    const DEFAULT_LIMIT = 25;
    const MAX_LIMIT = 50;
    const limit = Math.min(Math.max(1, dto.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const offset = Math.max(0, dto.offset ?? 0);

    const employeeWhere: Prisma.EmployeeWhereInput = {
      status: { in: PAYROLL_DEFAULT_EMPLOYEE_STATUSES },
      ...(dto.branchId ? { currentBranchId: dto.branchId } : {}),
    };

    const totalEmployeesInScope = await this.prisma.employee.count({
      where: employeeWhere,
    });
    const employees = await this.prisma.employee.findMany({
      where: employeeWhere,
      orderBy: { id: 'asc' },
      skip: offset,
      take: limit,
      select: { id: true, fullName: true, employeeCode: true },
    });

    let generated = 0;
    const skipped: Array<{ employeeId: string; reason: string }> = [];
    const failures: Array<{ employeeId: string; error: string }> = [];

    for (const emp of employees) {
      try {
        await this.createOrGetEntry(
          {
            employeeId: emp.id,
            month: dto.month,
            year: dto.year,
          },
          actingUser,
        );
        generated += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('No stipend record found covering')) {
          skipped.push({ employeeId: emp.id, reason: message });
          continue;
        }
        failures.push({ employeeId: emp.id, error: message });
      }
    }

    const nextOffset = offset + employees.length;
    return {
      month: dto.month,
      year: dto.year,
      generated,
      skipped: skipped.length,
      failed: failures.length,
      skippedDetails: skipped.slice(0, 20),
      failures,
      totalEmployeesInScope,
      offset,
      limit,
      nextOffset,
      hasMore: nextOffset < totalEmployeesInScope,
    };
  }

  /** Persist non-negative deduction/allowance totals; recompute net from parts. */
  private clampPayrollTotals(breakdown: HourlyPayrollBreakdown) {
    const basicStipend = roundMoney(Math.max(0, breakdown.payrollBasicStipend));
    const totalAllowances = roundMoney(
      Math.max(0, breakdown.fixedAllowances + breakdown.extraAllowances),
    );
    const totalDeductions = roundMoney(
      Math.max(
        0,
        breakdown.fixedPackageDeductions + breakdown.disciplineDeductions,
      ),
    );
    return {
      basicStipend,
      totalAllowances,
      totalDeductions,
      netStipend: roundMoney(
        Math.max(0, basicStipend + totalAllowances - totalDeductions),
      ),
    };
  }

  /**
   * Finds every StipendRecord that overlaps the target payroll month at
   * all — not just the currently-active one (effectiveTo: null). Overlap
   * test, using the established half-open [effectiveFrom, effectiveTo)
   * semantics (see computeHourlyBreakdown's segment-bounds comment):
   *   effectiveFrom <= monthEnd AND (effectiveTo is null OR effectiveTo > monthStart)
   * Ordered oldest-first so callers can reliably pick "the active one" as
   * either the null-effectiveTo record or, failing that, the most recent.
   */
  private pakistanMonthWindow(year: number, month: number): {
    monthStart: Date;
    monthEnd: Date;
  } {
    const { start: monthStart } = pakistanMonthDateRange(year, month);
    return {
      monthStart,
      monthEnd: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
    };
  }

  private async findOverlappingStipendRecords(
    employeeId: string,
    month: number,
    year: number,
  ) {
    const { monthStart, monthEnd } = this.pakistanMonthWindow(year, month);
    return this.prisma.stipendRecord.findMany({
      where: {
        employeeId,
        effectiveFrom: { lte: monthEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: monthStart } }],
      },
      orderBy: { effectiveFrom: 'asc' },
    });
  }

  /**
   * Stipend overlap for payroll generation. When no package overlaps the
   * calendar month but the employee already has payable attendance there
   * (common when joiningDate/stipend effectiveFrom were set after work
   * started), use the nearest future stipend and backfill the month from
   * month-start using that package's rates.
   */
  private async resolveStipendRecordsForPayrollMonth(
    employeeId: string,
    month: number,
    year: number,
  ): Promise<{
    records: Awaited<ReturnType<PayrollService['findOverlappingStipendRecords']>>;
    backfillFromAttendance: boolean;
  }> {
    const overlapping = await this.findOverlappingStipendRecords(
      employeeId,
      month,
      year,
    );
    if (overlapping.length > 0) {
      return { records: overlapping, backfillFromAttendance: false };
    }

    const { monthStart, monthEnd } = this.pakistanMonthWindow(year, month);
    const hasPayableAttendance = await this.prisma.attendanceLog.count({
      where: {
        employeeId,
        type: AttendanceLogType.REGULAR,
        date: { gte: monthStart, lte: monthEnd },
        NOT: { note: PRE_JOIN_UNMARKED_NOTE },
      },
    });
    if (hasPayableAttendance === 0) {
      return { records: [], backfillFromAttendance: false };
    }

    const nearestFutureStipend = await this.prisma.stipendRecord.findFirst({
      where: {
        employeeId,
        effectiveFrom: { gt: monthEnd },
      },
      orderBy: { effectiveFrom: 'asc' },
    });
    if (!nearestFutureStipend) {
      return { records: [], backfillFromAttendance: false };
    }

    return {
      records: [nearestFutureStipend],
      backfillFromAttendance: true,
    };
  }

  /** Shared by computeHourlyBreakdown and every segment-bounded child-row
   * helper — the single source of truth for "which dates, clamped to this
   * calendar month, does this StipendRecord's [effectiveFrom, effectiveTo)
   * window cover." */
  private resolveSegmentDateBounds(
    stipendRecord: { effectiveFrom: Date; effectiveTo?: Date | null },
    month: number,
    year: number,
    opts?: {
      joiningDate?: Date | null;
      backfillFromJoining?: boolean;
      backfillFromAttendance?: boolean;
    },
  ): { segmentStart: Date; segmentEndExclusive: Date | null; monthEnd: Date } {
    const { monthStart, monthEnd } = this.pakistanMonthWindow(year, month);
    let segmentStart =
      stipendRecord.effectiveFrom > monthStart
        ? stipendRecord.effectiveFrom
        : monthStart;
    if (
      opts?.backfillFromAttendance &&
      stipendRecord.effectiveFrom.getTime() > monthEnd.getTime()
    ) {
      segmentStart = monthStart;
    }
    // Active (open) payroll slip: credit from month start / joining, not
    // stipend effectiveFrom, so generate-on-the-28th includes 1st–28th.
    if (opts?.backfillFromJoining) {
      let fromJoinOrMonth = monthStart;
      if (opts.joiningDate) {
        const join = toPakistanDateOnly(opts.joiningDate);
        if (join > fromJoinOrMonth) {
          fromJoinOrMonth = join;
        }
      }
      if (fromJoinOrMonth < segmentStart) {
        segmentStart = fromJoinOrMonth;
      }
    }
    return {
      segmentStart,
      segmentEndExclusive: stipendRecord.effectiveTo ?? null,
      monthEnd,
    };
  }

  /** JS-side equivalent of the Prisma gte/lte/lt segment window above, for
   * items (like unpaid-leave dates) that must be pre-computed month-globally
   * and then split across segments in memory rather than re-queried per
   * segment. */
  private dateWithinSegment(
    date: Date,
    segmentStart: Date,
    segmentEndExclusive: Date | null,
    monthEnd: Date,
  ): boolean {
    if (date.getTime() < segmentStart.getTime()) return false;
    if (date.getTime() > monthEnd.getTime()) return false;
    if (segmentEndExclusive && date.getTime() >= segmentEndExclusive.getTime()) {
      return false;
    }
    return true;
  }

  /**
   * Keep at most one open (effectiveTo: null) stipend's PENDING payroll row
   * per employee/month when duplicate open packages exist. Closed overlapping
   * segments are intentionally retained so mid-month stipend changes keep
   * separate contractual Basic/allowance periods.
   */
  private async pruneDuplicateOpenActivePayrollEntries(
    employeeId: string,
    month: number,
    year: number,
    overlappingStipendRecords: Array<{
      id: string;
      effectiveFrom: Date;
      effectiveTo: Date | null;
    }>,
  ) {
    const activeSegments = overlappingStipendRecords.filter(
      (r) => r.effectiveTo === null,
    );
    if (activeSegments.length <= 1) return;

    const keepActive = activeSegments[activeSegments.length - 1]!;
    const staleSegmentIds = activeSegments
      .filter((segment) => segment.id !== keepActive.id)
      .map((segment) => segment.id);
    if (staleSegmentIds.length === 0) return;

    const staleEntries = await this.prisma.payrollEntry.findMany({
      where: {
        month,
        year,
        status: PayrollStatus.PENDING,
        stipendRecordId: { in: staleSegmentIds },
        stipendRecord: { employeeId },
      },
      select: { id: true },
    });

    for (const entry of staleEntries) {
      await this.prisma.stipendReceipt.deleteMany({
        where: { payrollEntryId: entry.id },
      });
      await this.prisma.payrollDeduction.deleteMany({
        where: { payrollEntryId: entry.id },
      });
      await this.prisma.allowance.deleteMany({
        where: { payrollEntryId: entry.id },
      });
      await this.prisma.payrollEntry.delete({ where: { id: entry.id } });
    }
  }

  /** @deprecated Alias kept for any residual call sites during rollout. */
  private async pruneStaleClosedSegmentPayrollEntries(
    employeeId: string,
    month: number,
    year: number,
    overlappingStipendRecords: Array<{
      id: string;
      effectiveFrom: Date;
      effectiveTo: Date | null;
    }>,
  ) {
    return this.pruneDuplicateOpenActivePayrollEntries(
      employeeId,
      month,
      year,
      overlappingStipendRecords,
    );
  }

  /** One history row per calendar month; drops leftover duplicate segments, sums real increments. */
  private aggregatePayrollHistoryByMonth<
    T extends {
      id: string;
      month: number;
      year: number;
      basicStipend: unknown;
      totalAllowances: unknown;
      totalDeductions: unknown;
      netStipend: unknown;
      status: PayrollStatus;
      stipendRecord?: {
        effectiveFrom?: Date;
        effectiveTo?: Date | null;
      } | null;
      deductions?: unknown[];
      allowances?: unknown[];
    },
  >(entries: T[]): T[] {
    return aggregatePayrollHistoryByMonthUtil(entries);
  }

  /**
   * Month-global unpaid-leave-date computation — see the doc comment on
   * upsertUnpaidLeaveDeductionRow for why the paid/unpaid QUOTA split must
   * be computed once across the whole month (never per-segment) while the
   * resulting individual dates are still attributed to exactly one
   * stipend segment each. Called once per employee/month by
   * createOrGetEntry / recomputeEmployeeMonth and the same result reused
   * for every segment, so the quota can never be granted twice.
   */
  private async computeMonthlyUnpaidLeaveDates(
    employeeId: string,
    month: number,
    year: number,
    monthlyAllowedLeaves: number | null | undefined,
  ): Promise<Date[]> {
    const card = await loadAttendanceCard(this.prisma, employeeId, month, year);
    return card.days.filter(d => d.status === AttendanceStatus.ON_LEAVE && !card.paidLeaveDateKeys.includes(d.date)).map(d => new Date(d.date));
  }

  /**
   * Creates or refreshes exactly one PayrollEntry for one StipendRecord
   * segment. This is the single place that owns the create-vs-refresh
   * flow, the PROCESSED/PAID freeze, and wiring the three child-row
   * helpers with this segment's own date bounds — shared by
   * createOrGetEntry (the existing single-"active"-segment entry point)
   * and recomputeEmployeeMonth (the explicit multi-segment entry point),
   * so the two can never drift apart on what "correct" means for a single
   * segment.
   *
   * `forceNonActiveOverride`: true forces forcedNonActive on this entry
   * (mirrors createOrGetEntry's own force-generate flow); undefined
   * preserves whatever the entry's own forcedNonActive value already is
   * (used for every OTHER segment besides the one a given createOrGetEntry
   * call is explicitly about — force-generating payroll for a non-active
   * employee is a decision about THAT call, not something that should
   * retroactively re-flag unrelated historical segments).
   */
  private async upsertPayrollEntryForStipendSegment(
    stipendRecord: {
      id: string;
      basicStipend: unknown;
      allowances?: unknown;
      reward?: unknown;
      progressReward?: unknown;
      fuelAllowance?: unknown;
      loanDeduction?: unknown;
      advanceDeduction?: unknown;
      fineDeduction?: unknown;
      healthDeduction?: unknown;
      lumpsumTotal?: unknown;
      effectiveFrom: Date;
      effectiveTo: Date | null;
    },
    dto: { employeeId: string; month: number; year: number },
    employee: {
      relieverOnly?: boolean;
      dutyTotalHours?: number | null;
      dutyStartTime?: string | null;
      dutyEndTime?: string | null;
      monthlyAllowedLeaves?: number | null;
      joiningDate?: Date | null;
      status?: EmployeeStatus;
      statusEffectiveFrom?: Date | null;
      shift?: { startTime: string; endTime: string } | null;
      weeklyOffWeekdays?: number[] | null;
    },
    forceNonActiveOverride: boolean | undefined,
    unpaidLeaveDatesForMonth: Date[],
    applyContractualPackage = stipendRecord.effectiveTo == null,
    options: {
      backfillFromJoining?: boolean;
      backfillFromAttendance?: boolean;
      backfillContractualFromEmployment?: boolean;
    } = {},
  ) {
    let entry = await this.prisma.payrollEntry.findUnique({ where: { stipendRecordId_month_year: { stipendRecordId: stipendRecord.id, month: dto.month, year: dto.year } }, include: { deductions: true, allowances: true } });
    if (entry && entry.status !== PayrollStatus.PENDING) return entry;
    const frozenSibling = applyContractualPackage ? await this.prisma.payrollEntry.findFirst({ where: {
      month: dto.month, year: dto.year, stipendRecord: { employeeId: dto.employeeId },
      stipendRecordId: { not: stipendRecord.id }, status: { in: [PayrollStatus.PROCESSED, PayrollStatus.PAID] },
      OR: [{ basicStipend: { gt: 0 } }, { totalAllowances: { gt: 0 } }, { totalDeductions: { gt: 0 } }],
    } }) : null;
    if (frozenSibling) throw new ConflictException('FROZEN_PAYROLL_SEGMENT: a frozen sibling already carries money; cannot replace it with whole-month Card salary');
    const attendanceCard = await loadAttendanceCard(this.prisma, dto.employeeId, dto.month, dto.year);
    if (attendanceCard.missingDates.length) throw new ConflictException('INCOMPLETE_ATTENDANCE_CARD: final attendance is missing for ' + attendanceCard.missingDates.join(', '));
    const context = { stipendRecord, employee, applyContractualPackage, attendanceCard, existingDeductions: entry?.deductions ?? [], existingAllowances: entry?.allowances ?? [] };
    const breakdown = await this.computeHourlyBreakdown(dto.employeeId, dto.month, dto.year, context);
    const salary = calculateCardSalary(attendanceCard, Number(stipendRecord.basicStipend), resolveDailyDutyHours(employee));
    if (!entry) entry = await this.prisma.payrollEntry.create({ data: { stipendRecordId: stipendRecord.id, month: dto.month, year: dto.year, ...this.clampPayrollTotals(breakdown), status: PayrollStatus.PENDING, forcedNonActive: forceNonActiveOverride === true }, include: { deductions: true, allowances: true } });
    // Card owns all attendance money. Replace legacy managed rows, retain unrelated stored adjustments.
    const legacyDeductions = entry.deductions.filter(isLegacyAttendanceDeduction);
    if (legacyDeductions.length) await this.prisma.payrollDeduction.deleteMany({ where: { id: { in: legacyDeductions.map(d => d.id) } } });
    const legacyAllowances = entry.allowances.filter(a => [AllowanceType.ADDITIONAL_WORKING_DAYS, AllowanceType.OVERTIME, AllowanceType.RELIEVER].includes(a.type as any));
    if (legacyAllowances.length) await this.prisma.allowance.deleteMany({ where: { id: { in: legacyAllowances.map(a => a.id) } } });
    if (applyContractualPackage) {
      for (const [reason, description, amount] of [[DeductionType.UNINFORMED_ABSENCE, CARD_ABSENCE_DESCRIPTION, salary.absencePenalty], [DeductionType.LATE_ARRIVAL, CARD_LATE_DESCRIPTION, salary.latePenalty]] as const) {
        if (amount > 0) await this.prisma.payrollDeduction.create({ data: { payrollEntryId: entry.id, reason, description, amount } });
      }
      for (const [type, description, amount, hours] of [[AllowanceType.ADDITIONAL_WORKING_DAYS, 'Attendance Card: Additional Working Days', salary.additionalWorkingDayPay, attendanceCard.additionalWorkingDays * resolveDailyDutyHours(employee)], [AllowanceType.OVERTIME, 'Attendance Card: Overtime', salary.overtimePay, attendanceCard.overtimeHours]] as const) {
        if (amount > 0) await this.prisma.allowance.create({ data: { payrollEntryId: entry.id, type, description, amount, hours } });
      }
    }
    return this.prisma.payrollEntry.update({ where: { id: entry.id }, data: { ...this.clampPayrollTotals(breakdown), forcedNonActive: forceNonActiveOverride === true || entry.forcedNonActive === true }, include: { deductions: true, allowances: true } });
  }

  async addDeduction(dto: AddDeductionDto) {
    if (isLegacyAttendanceDeduction(dto)) throw new BadRequestException('Attendance deductions are owned by the Attendance Card');
    if (!this.transactionBound) return withPayrollEmployeeTransaction(this.prisma, await this.entryEmployeeId(dto.payrollEntryId), tx => this.inTransaction(tx).addDeduction(dto));

    const entry = await this.prisma.payrollEntry.findUnique({
      where: { id: dto.payrollEntryId },
    });

    if (!entry) {
      throw new NotFoundException(
        `Payroll entry with id ${dto.payrollEntryId} not found`,
      );
    }

    if (
      entry.status === PayrollStatus.PROCESSED ||
      entry.status === PayrollStatus.PAID
    ) {
      throw new BadRequestException(
        'Cannot add deductions to processed or paid payroll entries',
      );
    }

    await this.prisma.payrollDeduction.create({
      data: {
        payrollEntryId: dto.payrollEntryId,
        reason: dto.reason,
        amount: dto.amount,
        description: dto.description,
      },
    });

    return this.prisma.payrollEntry.update({
      where: { id: dto.payrollEntryId },
      data: {
        totalDeductions: Number(entry.totalDeductions) + dto.amount,
        netStipend: Number(entry.netStipend) - dto.amount,
      },
      include: { deductions: true },
    });
  }

  async updateStatus(
    entryId: string,
    dto: UpdatePayrollStatusDto,
    actingUserId: string,
  ) {
    if (!this.transactionBound) return withPayrollEmployeeTransaction(this.prisma, await this.entryEmployeeId(entryId), tx => this.inTransaction(tx).updateStatus(entryId, dto, actingUserId));

    const entry = await this.prisma.payrollEntry.findUnique({
      where: { id: entryId },
      include: {
        stipendRecord: { select: { employeeId: true } },
      },
    });

    if (!entry) {
      throw new NotFoundException(`Payroll entry with id ${entryId} not found`);
    }

    this.validateStatusTransition(entry.status, dto.status);

    // Freeze the hourly calculation just before processing.
    if (
      entry.status === PayrollStatus.PENDING &&
      dto.status === PayrollStatus.PROCESSED
    ) {
      await this.createOrGetEntry({
        employeeId: entry.stipendRecord.employeeId,
        month: entry.month,
        year: entry.year,
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payrollEntry.update({
        where: { id: entryId },
        data: {
          status: dto.status,
          processedAt:
            dto.status === PayrollStatus.PROCESSED ? new Date() : undefined,
        },
        include: { deductions: true, allowances: true },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'PAYROLL_STATUS_CHANGED',
          entity: 'PayrollEntry',
          entityId: entryId,
          changes: { from: entry.status, to: dto.status },
        },
      });

      return result;
    });

    return updated;
  }

  async addAllowance(dto: AddAllowanceDto) {
    if (['ADDITIONAL_WORKING_DAYS','OVERTIME','RELIEVER'].includes(dto.type)) throw new BadRequestException('Attendance extras must be recorded on the Attendance Card');
    if (!this.transactionBound) return withPayrollEmployeeTransaction(this.prisma, await this.entryEmployeeId(dto.payrollEntryId), tx => this.inTransaction(tx).addAllowance(dto));

    const entry = await this.prisma.payrollEntry.findUnique({
      where: { id: dto.payrollEntryId },
      include: {
        stipendRecord: {
          include: {
            employee: {
              include: {
                shift: { select: { startTime: true, endTime: true } },
              },
            },
          },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException(
        `Payroll entry with id ${dto.payrollEntryId} not found`,
      );
    }

    if (
      entry.status === PayrollStatus.PROCESSED ||
      entry.status === PayrollStatus.PAID
    ) {
      throw new BadRequestException(
        'Cannot add allowances to processed or paid payroll entries',
      );
    }

    const pkg = stipendRecordToPackage(entry.stipendRecord);
    const hourlyRate = computeHourlyRate(
      pkg.basicStipend,
      resolveDailyDutyHours(entry.stipendRecord.employee),
      daysInPayrollMonth(entry.year, entry.month),
    );

    let pay: { hours: number | null; amount: number };
    try {
      pay = resolveManualAllowancePay({
        hours: dto.hours,
        amount: dto.amount,
        hourlyRate,
      });
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      throw new BadRequestException(
        code === 'HOURLY_RATE_UNAVAILABLE'
          ? 'Cannot calculate extra hours: hourly rate is 0 for this payroll entry'
          : 'Provide hours or a lump-sum amount',
      );
    }

    await this.prisma.allowance.create({
      data: {
        payrollEntryId: dto.payrollEntryId,
        type: dto.type,
        description: dto.description,
        amount: pay.amount,
        hours: pay.hours,
      },
    });

    return this.prisma.payrollEntry.update({
      where: { id: dto.payrollEntryId },
      data: {
        totalAllowances: Number(entry.totalAllowances) + pay.amount,
        netStipend: Number(entry.netStipend) + pay.amount,
      },
      include: { deductions: true, allowances: true },
    });
  }

  /**
   * Hourly rate = basicStipend / (daily duty hours × days in month).
   * Overtime pay = recorded OT hours × hourly rate.
   */
  /**
   * Overtime is recorded per AttendanceLog row (one date each), so — like
   * every other child-row calculation since Step 3 — it is date-based and
   * must be attributed to whichever StipendRecord segment is effective on
   * each attendance date, never to "the currently active" segment or to an
   * arbitrary PayrollEntry picked via findFirst. This walks every
   * overlapping segment (see findOverlappingStipendRecords) and buckets
   * each OT-bearing attendance date into exactly one segment via
   * resolveSegmentDateBounds/dateWithinSegment, so no OT minute can ever
   * land in two segments' totals. The top-level fields mirror the
   * pre-segmentation response shape exactly (and are byte-identical to it
   * whenever the employee has only one overlapping segment, the common
   * case) so existing callers keep working; `segments` is purely additive
   * detail for callers that want per-segment breakdown.
   */
  async getOvertimePreview(employeeId: string, month: number, year: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        shift: { select: { startTime: true, endTime: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id ${employeeId} not found`);
    }

    const { records: overlappingStipendRecords } =
      await this.resolveStipendRecordsForPayrollMonth(employeeId, month, year);
    if (overlappingStipendRecords.length === 0) {
      throw new BadRequestException(
        'No active stipend record found for this employee',
      );
    }
    const activeStipendRecord =
      overlappingStipendRecords.find((r) => r.effectiveTo === null) ??
      overlappingStipendRecords[overlappingStipendRecords.length - 1];

    const { monthStart, monthEnd } = this.pakistanMonthWindow(year, month);
    const daysInMonth = daysInPayrollMonth(year, month);
    const dailyHours = resolveDailyDutyHours(employee);
    const monthlyWorkingHours = dailyHours * daysInMonth;

    // Preview the same Card overtime used by salary; this endpoint does not approve attendance.
    const card = await loadAttendanceCard(this.prisma,employeeId,month,year);
    const existingEntries = await this.prisma.payrollEntry.findMany({
      where: {
        month,
        year,
        stipendRecordId: { in: overlappingStipendRecords.map((r) => r.id) },
      },
      include: {
        allowances: { where: { type: AllowanceType.OVERTIME } },
      },
    });

    const segments = overlappingStipendRecords.map((stipendRecord) => {
      const { segmentStart, segmentEndExclusive, monthEnd: segMonthEnd } =
        this.resolveSegmentDateBounds(stipendRecord, month, year);
      const segOvertimeHours = stipendRecord.id === activeStipendRecord.id ? card.overtimeHours : 0;
      const segOvertimeMinutes = segOvertimeHours * 60;
      const segPendingOvertimeMinutes = stipendRecord.id === activeStipendRecord.id ? card.pendingOvertimeMinutes : 0;
      const segBasicStipend = Number(stipendRecord.basicStipend);
      const segHourlyRate = computeHourlyRate(
        segBasicStipend,
        dailyHours,
        daysInMonth,
      );
      const segAmount = stipendRecord.id === activeStipendRecord.id ? calculateCardSalary(card, segBasicStipend, dailyHours).overtimePay : 0;

      const existingEntry = existingEntries.find(
        (e) => e.stipendRecordId === stipendRecord.id,
      );
      const existingOvertime = existingEntry?.allowances[0] ?? null;

      return {
        stipendRecordId: stipendRecord.id,
        isActiveSegment: stipendRecord.id === activeStipendRecord.id,
        effectiveFrom: stipendRecord.effectiveFrom,
        effectiveTo: stipendRecord.effectiveTo,
        basicStipend: segBasicStipend,
        overtimeMinutes: segOvertimeMinutes,
        pendingOvertimeMinutes: segPendingOvertimeMinutes,
        overtimeHours: segOvertimeHours,
        hourlyRate: segHourlyRate,
        amount: segAmount,
        alreadyApplied: Boolean(existingOvertime),
        existingAmount: existingOvertime
          ? Number(existingOvertime.amount)
          : null,
        payrollEntryId: existingEntry?.id ?? null,
        payrollStatus: existingEntry?.status ?? null,
      };
    });

    const activeSegment = segments.find((s) => s.isActiveSegment)!;
    const overtimeMinutes = segments.reduce(
      (sum, s) => sum + s.overtimeMinutes,
      0,
    );
    const pendingOvertimeMinutes = segments.reduce(
      (sum, s) => sum + s.pendingOvertimeMinutes,
      0,
    );
    const overtimeHours = Math.round((overtimeMinutes / 60) * 100) / 100;
    const amount = roundMoney(
      segments.reduce((sum, s) => sum + s.amount, 0),
    );

    return {
      employeeId,
      month,
      year,
      basicStipend: activeSegment.basicStipend,
      dailyHours,
      daysInMonth,
      monthlyWorkingHours,
      overtimeMinutes,
      pendingOvertimeMinutes,
      overtimeHours,
      hourlyRate: activeSegment.hourlyRate,
      amount,
      alreadyApplied: activeSegment.alreadyApplied,
      existingAmount: activeSegment.existingAmount,
      payrollEntryId: activeSegment.payrollEntryId,
      payrollStatus: activeSegment.payrollStatus,
      risks: card.risks,
      segments,
    };
  }

  /**
   * Mirrors createOrGetEntry/recomputeEmployeeMonth's segment discipline:
   * each stipend segment's own share of this month's overtime (see
   * getOvertimePreview) is applied to that segment's own PayrollEntry
   * only. No segment is picked arbitrarily and no overtime minute can
   * contribute to more than one segment's row, since getOvertimePreview
   * already partitioned every OT-bearing attendance date into exactly one
   * segment. PROCESSED/PAID segments are skipped (frozen) rather than
   * throwing for the whole request, EXCEPT the active segment — throwing
   * there preserves this method's pre-segmentation behavior exactly for
   * the common single-segment case.
   */
  async applyOvertime(
    dto: ApplyOvertimeDto,
    actingUser: { id: string; role: UserRole },
  ) {
    await this.accessScopeService.assertEmployeeAccess(actingUser.id,actingUser.role,Permission.PAYROLL_MANAGE,dto.employeeId);
    return this.createOrGetEntry({ employeeId: dto.employeeId, month: dto.month, year: dto.year },actingUser);
  }

  async getEntryWithAllowances(
    entryId: string,
    actingUser?: { id: string; role: UserRole; employeeId?: string | null },
  ) {
    const entry = await this.prisma.payrollEntry.findUnique({
      where: { id: entryId },
      include: {
        deductions: true,
        allowances: true,
        stipendRecord: {
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                cnic: true,
                currentDesignation: true,
                dutyStartTime: true,
                dutyEndTime: true,
                dutyTotalHours: true,
                monthlyAllowedLeaves: true,
                joiningDate: true,
                status: true,
                statusEffectiveFrom: true,
                weeklyOffWeekdays: true,
                currentBranch: {
                  select: {
                    id: true,
                    name: true,
                    address: true,
                    phone: true,
                  },
                },
                currentDepartment: { select: { id: true, name: true } },
                shift: { select: { startTime: true, endTime: true } },
              },
            },
          },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException(`Payroll entry with id ${entryId} not found`);
    }

    if (actingUser?.role === UserRole.EMPLOYEE) {
      if (
        !actingUser.employeeId ||
        actingUser.employeeId !== entry.stipendRecord.employeeId
      ) {
        throw new ForbiddenException(
          'You can only view your own payroll entry',
        );
      }
    }

    let current = entry;
    if (entry.status === PayrollStatus.PENDING) {
      const refreshed = await this.createOrGetEntry({
        employeeId: entry.stipendRecord.employeeId,
        month: entry.month,
        year: entry.year,
      });
      current = {
        ...entry,
        ...refreshed,
        stipendRecord: entry.stipendRecord,
      };
    }

    // Mirror the Payroll tab/History aggregation: when a mid-month raise or
    // package edit produced multiple stipend segments for this employee in
    // this month, merge them so the detail view and payslip show the same
    // totals as everywhere else instead of just this one segment.
    const siblingEntries = await this.prisma.payrollEntry.findMany({
      where: {
        month: entry.month,
        year: entry.year,
        stipendRecord: { employeeId: entry.stipendRecord.employeeId },
      },
      include: { deductions: true, allowances: true, stipendRecord: true },
    });
    const segmentsForMerge = siblingEntries.map((seg) =>
      seg.id === current.id ? current : seg,
    );
    const kept = keepPayrollSegmentsForMonth(segmentsForMerge);
    const orderedPackages = siblingEntries.map(s => s.stipendRecord).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
    const monthlyPackage = orderedPackages.find(s => s.effectiveTo == null) ?? orderedPackages[0] ?? entry.stipendRecord;
    const displayPackage = { ...monthlyPackage, employee: entry.stipendRecord.employee };
    current =
      kept.length > 0
        ? { ...mergePayrollSegments(kept), stipendRecord: displayPackage }
        : current;

    const employee = entry.stipendRecord.employee;
    // Same unpaidLeaveDateKeys the persisted totals were computed with
    // (createOrGetEntry above, when PENDING) — recomputed here too so this
    // purely-for-display breakdown never disagrees with what was actually
    // saved (the same class of tab/modal/payslip mismatch bug fixed
    // 2026-09-04 for the old hourly formula).
    const unpaidLeaveDatesForBreakdown = await this.computeMonthlyUnpaidLeaveDates(
      entry.stipendRecord.employeeId,
      entry.month,
      entry.year,
      employee.monthlyAllowedLeaves,
    );
    const breakdown = await this.computeHourlyBreakdown(
      entry.stipendRecord.employeeId,
      entry.month,
      entry.year,
      {
        stipendRecord: displayPackage,
        employee,
        applyContractualPackage: true,
        existingDeductions: current.deductions ?? [],
        existingAllowances: current.allowances ?? [],
        unpaidLeaveDateKeys: new Set(
          unpaidLeaveDatesForBreakdown.map((d) => dateKey(d)),
        ),
      },
    );

    const card = await loadAttendanceCard(this.prisma, entry.stipendRecord.employeeId, entry.month, entry.year);
    const totalRelieverMinutes = 0; // AWD is the sole extra-day source; no duration-based salary credit.
    const presenceDays = card.present + card.late + card.shortLeave + card.swapCovered + card.halfDay * 0.5;
    const leaveSplit = { leaveDays: card.onLeave, paidLeaveDays: card.paidLeaveDays, unpaidLeaveDays: card.unpaidLeaveDays };
    const slip = this.buildPayslipSlipData({
      entry: current,
      stipendRecord: displayPackage,
      employee,
      presenceDays,
      leaveSplit,
    });

    const [withAttendance] = await this.attachPayrollAttendanceReport(
      [
        {
          ...current,
          totalRelieverHours:
            Math.round((totalRelieverMinutes / 60) * 100) / 100,
          hourlyBreakdown: breakdown,
          slip,
        },
      ],
      entry.month,
      entry.year,
    );
    return withAttendance;
  }

  private buildPayslipSlipData(input: {
    entry: {
      month: number;
      year: number;
      basicStipend: unknown;
      netStipend: unknown;
      deductions?: Array<{
        reason: DeductionType;
        amount: unknown;
        description?: string | null;
      }>;
      allowances?: Array<{ type: AllowanceType; amount: unknown }>;
    };
    stipendRecord: {
      basicStipend?: unknown;
      allowances?: unknown;
      reward?: unknown;
      progressReward?: unknown;
      fuelAllowance?: unknown;
      loanDeduction?: unknown;
      advanceDeduction?: unknown;
      fineDeduction?: unknown;
      healthDeduction?: unknown;
    };
    employee: {
      fullName: string;
      employeeCode: string;
      cnic?: string | null;
      currentDesignation?: string | null;
      dutyStartTime?: string | null;
      dutyEndTime?: string | null;
      dutyTotalHours?: number | null;
      currentBranch?: {
        name?: string;
        address?: string | null;
        phone?: string | null;
      } | null;
      currentDepartment?: { name?: string } | null;
      shift?: { startTime: string; endTime: string } | null;
    };
    presenceDays: number;
    leaveSplit: {
      leaveDays: number;
      paidLeaveDays: number;
      unpaidLeaveDays: number;
    };
  }): PayslipSlipData {
    const { entry, stipendRecord, employee, presenceDays, leaveSplit } = input;
    const pkg = stipendRecordToPackage({
      basicStipend: stipendRecord.basicStipend ?? 0,
      ...stipendRecord,
    });
    const allowances = entry.allowances ?? [];
    const deductions = entry.deductions ?? [];

    const absenceDeduction = deductions
      .filter(
        (d) =>
          d.reason === DeductionType.UNINFORMED_ABSENCE ||
          d.reason === DeductionType.UNPAID_LEAVE ||
          d.reason === DeductionType.HALF_DAY ||
          (d.reason === DeductionType.OTHER &&
            (d.description ?? '').startsWith('Unmarked day')),
      )
      .reduce((sum, d) => sum + Number(d.amount), 0);

    const fineFromEntries = deductions
      .filter(
        (d) =>
          d.reason === DeductionType.DISCIPLINARY_FINE ||
          d.reason === DeductionType.LATE_ARRIVAL,
      )
      .reduce((sum, d) => sum + Number(d.amount), 0);

    const categorizedDeductionIds = new Set(
      deductions
        .filter(
          (d) =>
            d.reason === DeductionType.UNINFORMED_ABSENCE ||
            d.reason === DeductionType.UNPAID_LEAVE ||
            d.reason === DeductionType.HALF_DAY ||
            (d.reason === DeductionType.OTHER &&
              (d.description ?? '').startsWith('Unmarked day')) ||
            d.reason === DeductionType.DISCIPLINARY_FINE ||
            d.reason === DeductionType.LATE_ARRIVAL,
        )
        .map((d) => d),
    );
    const otherDeduction = deductions
      .filter((d) => !categorizedDeductionIds.has(d))
      .reduce((sum, d) => sum + Number(d.amount), 0);

    const extraDutyAmount = allowances
      .filter(
        (a) =>
          a.type === AllowanceType.ADDITIONAL_WORKING_DAYS ||
          a.type === AllowanceType.RELIEVER,
      )
      .reduce((sum, a) => sum + Number(a.amount), 0);
    const overtimeAmount = allowances
      .filter((a) => a.type === AllowanceType.OVERTIME)
      .reduce((sum, a) => sum + Number(a.amount), 0);
    const otherExtraAllowances = allowances
      .filter(
        (a) =>
          a.type !== AllowanceType.ADDITIONAL_WORKING_DAYS &&
          a.type !== AllowanceType.RELIEVER &&
          a.type !== AllowanceType.OVERTIME,
      )
      .reduce((sum, a) => sum + Number(a.amount), 0);

    const dailyDutyHours = resolveDailyDutyHours(employee);
    const totalDays = daysInPayrollMonth(entry.year, entry.month);
    const payPeriod = new Date(Date.UTC(entry.year, entry.month - 1, 1)).toLocaleString(
      'en-US',
      { month: 'long', year: 'numeric', timeZone: 'UTC' },
    );

    const earnings = {
      stipend: Number(entry.basicStipend) || 0,
      previousMonth: 0,
      rewardOnProgress: pkg.progressReward || 0,
      rewards: pkg.reward || 0,
      otherAllowance:
        (pkg.allowances || 0) + overtimeAmount + otherExtraAllowances,
      fuel: pkg.fuelAllowance || 0,
      mobileLoad: 0,
      extraDuty: extraDutyAmount,
    };

    const deductionsBlock = {
      advance: pkg.advanceDeduction || 0,
      loan: pkg.loanDeduction || 0,
      mobileLoad: 0,
      absence: absenceDeduction,
      fine: (pkg.fineDeduction || 0) + fineFromEntries,
      health: pkg.healthDeduction || 0,
      providentFund: 0,
      tax: 0,
      auditDifference: 0,
      staffPendingMed: 0,
      other: otherDeduction,
    };

    const deductionItems = deductions.map((d) => ({
      reason: d.reason,
      description: d.description ?? null,
      amount: Number(d.amount) || 0,
    }));

    const earningsTotal = computeEarningsTotal(earnings);
    const deductionsTotal = computeDeductionsTotal(deductionsBlock);

    return {
      orgName: PAYSLIP_ORG_NAME,
      title: formatSlipMonthTitle(entry.month, entry.year),
      hospital: employee.currentBranch?.name || '',
      workPlace:
        employee.currentBranch?.address ||
        employee.currentBranch?.name ||
        '',
      phone: employee.currentBranch?.phone || '',
      employeeId: employee.employeeCode,
      cnic: employee.cnic || '',
      employeeName: employee.fullName,
      department: employee.currentDepartment?.name || '',
      designation: employee.currentDesignation || '',
      period: formatSlipPeriod(entry.month, entry.year),
      payPeriod,
      totalDays,
      leaveDays: leaveSplit.leaveDays,
      paidLeaveDays: leaveSplit.paidLeaveDays,
      unpaidLeaveDays: leaveSplit.unpaidLeaveDays,
      dutyTime: formatSlipDutyTime(employee),
      dutyHoursPerDay: dailyDutyHours,
      presence: presenceDays,
      earnings,
      deductions: deductionsBlock,
      deductionItems,
      earningsTotal,
      deductionsTotal,
      netPay: Number(entry.netStipend) || 0,
      totalAmount: Number(entry.netStipend) || 0,
      paidThrough: 'Nil',
    };
  }

  async generateBranchPayrollReport(
    branchId: string,
    month: number,
    year: number,
    actingUser?: { id: string; role: UserRole },
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (!branchId) {
      throw new BadRequestException('branchId is required');
    }
    if (!month || month < 1 || month > 12) {
      throw new BadRequestException('month must be between 1 and 12');
    }
    if (!year || year < 2000) {
      throw new BadRequestException('year is invalid');
    }

    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, name: true },
    });
    if (!branch) {
      throw new NotFoundException(`Branch ${branchId} not found`);
    }

    let employeeWhere: Prisma.EmployeeWhereInput = {
      currentBranchId: branchId,
    };
    if (actingUser?.id) {
      employeeWhere =
        await this.accessScopeService.narrowEmployeeWhereForActor(
          actingUser.id,
          actingUser.role,
          employeeWhere,
        );
    }

    const entries = await this.prisma.payrollEntry.findMany({
      where: {
        month,
        year,
        stipendRecord: {
          employee: employeeWhere,
        },
      },
      include: {
        deductions: true,
        allowances: true,
        stipendRecord: {
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                cnic: true,
                currentDesignation: true,
                dutyStartTime: true,
                dutyEndTime: true,
                dutyTotalHours: true,
                monthlyAllowedLeaves: true,
                currentBranch: {
                  select: {
                    id: true,
                    name: true,
                    address: true,
                    phone: true,
                  },
                },
                currentDepartment: { select: { id: true, name: true } },
                shift: { select: { startTime: true, endTime: true } },
              },
            },
          },
        },
      },
      orderBy: {
        stipendRecord: { employee: { fullName: 'asc' } },
      },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'YCDO HRMS';
    workbook.created = new Date();

    if (entries.length === 0) {
      const empty = workbook.addWorksheet('No entries');
      empty.getCell('A1').value = PAYSLIP_ORG_NAME;
      empty.getCell('A2').value = formatSlipMonthTitle(month, year);
      empty.getCell('A3').value = `No payroll entries for ${branch.name}`;
    }

    const usedNames = new Set<string>();

    const includedEmployees = new Set<string>();
    for (const entry of entries) {
      const employeeId = entry.stipendRecord.employeeId;
      if (includedEmployees.has(employeeId)) continue;
      includedEmployees.add(employeeId);
      // Use the same monthly Card and package owner as the individual live slip.
      const current = await this.getEntryWithAllowances(entry.id, actingUser);
      const employee = current.stipendRecord.employee;
      const slip = current.slip;

      let sheetName = sanitizeSheetName(
        employee.fullName,
        employee.employeeCode || 'Employee',
      );
      if (usedNames.has(sheetName)) {
        const suffix = ` (${employee.employeeCode || usedNames.size})`;
        sheetName = sanitizeSheetName(
          `${employee.fullName}`.slice(0, 31 - suffix.length) + suffix,
          employee.employeeCode || 'Employee',
        );
      }
      usedNames.add(sheetName);

      const ws = workbook.addWorksheet(sheetName);
      this.writePayslipSheet(ws, slip);
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const monthLabel = String(month).padStart(2, '0');
    const safeBranch = branch.name.replace(/[^\w\- ]+/g, '').trim() || 'Branch';
    return {
      buffer,
      filename: `Payroll-${safeBranch}-${year}-${monthLabel}.xlsx`,
    };
  }

  private writePayslipSheet(
    ws: ExcelJS.Worksheet,
    slip: PayslipSlipData,
  ) {
    const money = (n: number) => (n ? Math.round(n * 100) / 100 : 'Nil');

    ws.getCell('A1').value = slip.orgName;
    ws.getCell('A2').value = slip.title;

    ws.getCell('A3').value = 'CNIC';
    ws.getCell('C3').value = slip.cnic || 'Nil';
    ws.getCell('G3').value = 'Hospital';
    ws.getCell('H3').value = slip.hospital || 'Nil';

    ws.getCell('A4').value = 'Name';
    ws.getCell('C4').value = slip.employeeName || 'Nil';
    ws.getCell('G4').value = 'Work Place';
    ws.getCell('H4').value = slip.workPlace || 'Nil';

    ws.getCell('A5').value = 'Designation';
    ws.getCell('C5').value = slip.designation || 'Nil';
    ws.getCell('G5').value = 'Period';
    ws.getCell('H5').value = slip.period;

    ws.getCell('A6').value = 'Total Day ';
    ws.getCell('C6').value = 'Leave ';
    ws.getCell('G6').value = 'Time ';
    ws.getCell('H6').value = slip.dutyTime;

    ws.getCell('A7').value = slip.totalDays;
    ws.getCell('C7').value = slip.leaveDays;
    ws.getCell('G7').value = 'Presence';
    ws.getCell('H7').value = slip.presence;

    ws.getCell('A8').value = 'Pay & Allowances';
    ws.getCell('D8').value = 'Amount';
    ws.getCell('E8').value = 'Deduction';
    ws.getCell('G8').value = 'Amount';
    ws.getCell('H8').value = 'Paid Through';

    const earnRows: Array<[string, number]> = [
      ['Stipend', slip.earnings.stipend],
      ['Extra Day', slip.earnings.extraDuty],
      ['Previous Month', slip.earnings.previousMonth],
      ['Reward On Progress', slip.earnings.rewardOnProgress],
      ['Rewards', slip.earnings.rewards],
      ['Other Allowance', slip.earnings.otherAllowance],
      ['Fuel', slip.earnings.fuel],
      ['Mobile Load', slip.earnings.mobileLoad],
    ];
    const dedRows: Array<[string, number]> = [
      ['Advance', slip.deductions.advance],
      ['Loan', slip.deductions.loan],
      ['MobileLoad', slip.deductions.mobileLoad],
      ['Absence', slip.deductions.absence],
      ['Fine', slip.deductions.fine],
      ['Health', slip.deductions.health],
      ['Provident Fund', slip.deductions.providentFund],
      ['Tax', slip.deductions.tax],
    ];

    for (let i = 0; i < Math.max(earnRows.length, dedRows.length); i++) {
      const row = 9 + i;
      if (earnRows[i]) {
        ws.getCell(`A${row}`).value = earnRows[i][0];
        ws.getCell(`D${row}`).value = money(earnRows[i][1]);
      }
      if (dedRows[i]) {
        ws.getCell(`E${row}`).value = dedRows[i][0];
        ws.getCell(`G${row}`).value = money(dedRows[i][1]);
      }
      if (i === 0) {
        ws.getCell('H9').value = slip.paidThrough;
      }
    }

    const totalRow = 9 + Math.max(earnRows.length, dedRows.length);
    ws.getCell(`A${totalRow}`).value = 'Stipend & Other Allowances';
    ws.getCell(`D${totalRow}`).value = money(slip.earningsTotal);
    ws.getCell(`E${totalRow}`).value = 'Deduction';
    ws.getCell(`G${totalRow}`).value = money(slip.deductionsTotal);
    ws.getCell(`H${totalRow}`).value = 'Net Pay';
    ws.getCell(`J${totalRow}`).value = money(slip.netPay);

    const noteRow = totalRow + 1;
    ws.getCell(`A${noteRow}`).value =
      'Bank Charges (if any) will be deducted from Stipend by the bank';

    const sigRow = noteRow + 2;
    ws.getCell(`B${sigRow}`).value = 'President YCDO ';
    ws.getCell(`E${sigRow}`).value = 'Chairman Admin YCDO';
    ws.getCell(`H${sigRow}`).value = 'Chairman Finance YCDO';

    ws.getColumn(1).width = 28;
    ws.getColumn(3).width = 22;
    ws.getColumn(4).width = 12;
    ws.getColumn(5).width = 18;
    ws.getColumn(7).width = 12;
    ws.getColumn(8).width = 24;
    ws.getColumn(10).width = 12;
  }

  private async computeHourlyBreakdown(
    employeeId: string,
    month: number,
    year: number,
    context: {
      stipendRecord: {
        basicStipend: unknown;
        allowances?: unknown;
        reward?: unknown;
        progressReward?: unknown;
        fuelAllowance?: unknown;
        loanDeduction?: unknown;
        advanceDeduction?: unknown;
        fineDeduction?: unknown;
        healthDeduction?: unknown;
        lumpsumTotal?: unknown;
        /** When this stipend segment started applying. Combined with
         * effectiveTo below to bound which AttendanceLog dates this
         * specific StipendRecord may earn basic pay for — see the
         * segment-bounds comment further down. */
        effectiveFrom: Date;
        /** When this stipend segment stopped applying (exclusive), or
         * null if it is still the currently-active record. */
        effectiveTo?: Date | null;
      };
      employee: {
        dutyTotalHours?: number | null;
        dutyStartTime?: string | null;
        dutyEndTime?: string | null;
        monthlyAllowedLeaves?: number | null;
        joiningDate?: Date | null;
        status?: EmployeeStatus;
        statusEffectiveFrom?: Date | null;
        shift?: { startTime: string; endTime: string } | null;
        weeklyOffWeekdays?: number[] | null;
      };
      attendanceCard?: AttendanceCard;
      existingDeductions: Array<{ amount: unknown; reason?: string; description?: string | null }>;
      existingAllowances: Array<{ amount: unknown; type?: string }>;
      /** Calendar dates (as dateKey strings) this employee is ON_LEAVE
       * beyond the monthly paid-leave quota — see computeMonthlyUnpaidLeaveDates
       * / splitPaidUnpaidLeaveDays. These do NOT count toward payableDays
       * under the day-based Basic formula (2026-09-04 rewrite): unpaid
       * leave is now handled solely by excluding the day here, never by a
       * separate UNPAID_LEAVE PayrollDeduction (removed — see
       * upsertUnpaidLeaveDeductionRow), so this must be the only place the
       * day is dropped or the day would silently just not get paid without
       * a visible reason, which is fine, but double-dropping (deduction +
       * exclusion) is not.
       */
      unpaidLeaveDateKeys?: Set<string>;
      /** Full contractual allowances/health apply on exactly one segment
       * per month (the currently-active stipend), so a mid-month increment
       * cannot double-count the package. Historical closed segments get 0. */
      applyContractualPackage?: boolean;
      backfillFromJoining?: boolean;
      /** Payable attendance exists before the stipend package's
       * effectiveFrom (joining date set after work started). */
      backfillFromAttendance?: boolean;
      /** Oldest/only open package in the month: Basic starts at
       * month-start/joining, not a late stipend.effectiveFrom. Must stay
       * false on a mid-month increment's NEW segment so the closed prior
       * package still owns the earlier Basic days. Allowances do not use
       * this flag — they are the full monthly package on the active slip. */
      backfillContractualFromEmployment?: boolean;
      /** Pakistan "as of" instant used as the elapsed-day cutoff for the
       * gap-day credit pass below (a segment date is only gap-filled once
       * it is strictly before this date) — defaults to the real current
       * time in production, overridable by tests for determinism. */
      asOf?: Date;
    },
  ): Promise<HourlyPayrollBreakdown> {
    const card = context.attendanceCard ?? await loadAttendanceCard(this.prisma, employeeId, month, year);
    const pkg = stipendRecordToPackage(context.stipendRecord);
    const hours = resolveDailyDutyHours(context.employee);
    const salary = calculateCardSalary(card, pkg.basicStipend, hours);
    // Preserve the existing month-wide package-bearing convention. Other segments cannot pay the Card twice.
    const ownsMonth = context.applyContractualPackage ?? context.stipendRecord.effectiveTo == null;
    const { monthStart, monthEnd } = this.pakistanMonthWindow(year, month);
    const fixedAllowances = ownsMonth ? prorateMonthlyPackageAmount({
      monthlyAmount: (pkg.allowances || 0) + (pkg.reward || 0) + (pkg.progressReward || 0) + (pkg.fuelAllowance || 0),
      year, month, segmentStart: monthStart, segmentEndExclusive: null, monthEnd,
      employmentStart: context.backfillFromAttendance ? null : context.employee.joiningDate,
      employmentEndExclusive: context.employee.status && isExitEmployeeStatus(context.employee.status) ? context.employee.statusEffectiveFrom : null,
    }) : 0;
    const fixedPackageDeductions = ownsMonth ? (pkg.loanDeduction || 0) + (pkg.advanceDeduction || 0) + (pkg.fineDeduction || 0) + (pkg.healthDeduction || 0) : 0;
    const storedDeductions = context.existingDeductions.filter(d => !isLegacyAttendanceDeduction(d)).reduce((sum,d) => sum + Number(d.amount),0);
    const storedAllowances = context.existingAllowances.filter(a => !['ADDITIONAL_WORKING_DAYS','OVERTIME','RELIEVER'].includes(a.type ?? '')).reduce((sum,a) => sum + Number(a.amount),0);
    return buildHourlyPayrollBreakdown({ contractualBasicStipend: ownsMonth ? pkg.basicStipend : 0, payrollBasicStipend: ownsMonth ? salary.earnedBasic : 0, dailyDutyHours: hours, daysInMonth: card.calendarDays,
      workedMinutes: 0, paidLeaveMinutes: ownsMonth ? card.paidLeaveDays * hours * 60 : 0,
      policyCreditMinutes: ownsMonth ? (salary.paidDays - card.paidLeaveDays) * hours * 60 : 0,
      payableDays: ownsMonth ? salary.paidDays : 0, creditedAttendanceDays: ownsMonth ? salary.paidDays : 0,
      fixedAllowances, fixedPackageDeductions,
      disciplineDeductions: storedDeductions + (ownsMonth ? salary.absencePenalty + salary.latePenalty : 0),
      extraAllowances: storedAllowances + (ownsMonth ? salary.additionalWorkingDayPay + salary.overtimePay : 0) });
  }

  async findAll(
    query: PayrollQueryDto,
    actingUser?: { id: string; role: UserRole },
  ) {
    const year = query.year ?? new Date().getFullYear();
    const where: Prisma.PayrollEntryWhereInput = { year };

    if (query.month) {
      where.month = query.month;
    }

    if (query.status) {
      where.status = query.status;
    }

    let employeeFilter: Prisma.EmployeeWhereInput = {};

    if (query.employeeId) {
      employeeFilter.id = query.employeeId;
    }

    if (query.branchId) {
      employeeFilter.currentBranchId = query.branchId;
    }

    const departmentDesignationWhere =
      this.accessScopeService.employeeMatchesDepartmentDesignationFilter({
        departmentId: query.departmentId,
        designation: query.designation,
      });
    if (departmentDesignationWhere) {
      employeeFilter = {
        AND: [employeeFilter, departmentDesignationWhere],
      };
    }

    if (actingUser?.id) {
      employeeFilter =
        await this.accessScopeService.narrowEmployeeWhereForActor(
          actingUser.id,
          actingUser.role,
          employeeFilter,
        );
    }

    const eligibilityOr: Prisma.PayrollEntryWhereInput[] = [
      {
        stipendRecord: {
          employee: {
            ...employeeFilter,
            status: { in: PAYROLL_DEFAULT_EMPLOYEE_STATUSES },
          },
        },
      },
      {
        forcedNonActive: true,
        ...(Object.keys(employeeFilter).length > 0
          ? { stipendRecord: { employee: employeeFilter } }
          : {}),
      },
    ];

    where.OR = eligibilityOr;

    const entries = await this.prisma.payrollEntry.findMany({
      where,
      include: {
        deductions: true,
        stipendRecord: {
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                status: true,
                cnic: true,
                currentDesignation: true,
                dutyStartTime: true,
                dutyEndTime: true,
                dutyTotalHours: true,
                currentBranch: {
                  select: {
                    id: true,
                    name: true,
                    address: true,
                    phone: true,
                  },
                },
                currentDepartment: { select: { id: true, name: true } },
                shift: { select: { startTime: true, endTime: true } },
              },
            },
          },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    if (!query.month || entries.length === 0) {
      return entries;
    }

    const withAttendance = await this.attachPayrollAttendanceReport(
      entries,
      query.month,
      year,
    );
    // One row per employee — same month totals as profile Payroll History.
    return aggregateMonthlyPayrollByEmployee(withAttendance);
  }

  private async attachPayrollAttendanceReport<
    T extends {
      stipendRecord?: { employee?: { id?: string } | null } | null;
    },
  >(entries: T[], month: number, year: number): Promise<
    Array<T & { attendance: ReturnType<typeof toPayrollAttendanceReport> }>
  > {
    const cards = new Map<string, AttendanceCard>();
    for (const entry of entries) { const id = entry.stipendRecord?.employee?.id; if (id && !cards.has(id)) cards.set(id, await loadAttendanceCard(this.prisma,id,month,year)); }
    return entries.map(entry => { const card = cards.get(entry.stipendRecord?.employee?.id ?? ''); return { ...entry, attendance: card ? toPayrollAttendanceReport(card,card.additionalWorkingDays) : EMPTY_PAYROLL_ATTENDANCE_REPORT }; });
  }

  async findOne(entryId: string) {
    const entry = await this.prisma.payrollEntry.findUnique({
      where: { id: entryId },
      include: {
        deductions: true,
        stipendRecord: {
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                cnic: true,
                currentDesignation: true,
                dutyStartTime: true,
                dutyEndTime: true,
                dutyTotalHours: true,
                currentBranch: {
                  select: {
                    id: true,
                    name: true,
                    address: true,
                    phone: true,
                  },
                },
                currentDepartment: { select: { id: true, name: true } },
                shift: { select: { startTime: true, endTime: true } },
              },
            },
          },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException(`Payroll entry with id ${entryId} not found`);
    }

    const [withAttendance] = await this.attachPayrollAttendanceReport(
      [entry],
      entry.month,
      entry.year,
    );
    return withAttendance;
  }

  async getEmployeePayrollHistory(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id ${employeeId} not found`);
    }

    return this.aggregatePayrollHistoryByMonth(
      await this.prisma.payrollEntry.findMany({
      where: {
        stipendRecord: { employeeId },
      },
      include: {
        deductions: true,
        allowances: true,
        stipendRecord: {
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                cnic: true,
                currentDesignation: true,
                dutyStartTime: true,
                dutyEndTime: true,
                dutyTotalHours: true,
                currentBranch: {
                  select: {
                    id: true,
                    name: true,
                    address: true,
                    phone: true,
                  },
                },
                currentDepartment: { select: { id: true, name: true } },
                shift: { select: { startTime: true, endTime: true } },
              },
            },
          },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    }),
    );
  }

  async getMonthlyPayrollSummary(
    month: number,
    year: number,
    branchId?: string,
    fromDate?: string,
    toDate?: string,
  ) {
    const daysInMonth = daysInPayrollMonth(year, month);
    const { monthStart, monthEnd } = this.pakistanMonthWindow(year, month);

    let periodDays = daysInMonth;
    if (fromDate || toDate) {
      if (!fromDate || !toDate) {
        throw new BadRequestException(
          'Both fromDate and toDate are required together',
        );
      }
      const from = toPakistanDateOnly(new Date(`${fromDate}T00:00:00+05:00`));
      const to = toPakistanDateOnly(new Date(`${toDate}T00:00:00+05:00`));
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new BadRequestException('fromDate and toDate must be YYYY-MM-DD');
      }
      if (to < from) {
        throw new BadRequestException('toDate must be on or after fromDate');
      }
      if (
        from.getUTCFullYear() !== year ||
        from.getUTCMonth() + 1 !== month ||
        to.getUTCFullYear() !== year ||
        to.getUTCMonth() + 1 !== month
      ) {
        throw new BadRequestException(
          'fromDate and toDate must fall within the selected month and year',
        );
      }
      if (from < monthStart || to > monthEnd) {
        throw new BadRequestException(
          'Date range must be within the selected month',
        );
      }
      periodDays =
        Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    }

    const where: Prisma.PayrollEntryWhereInput = {
      month,
      year,
      OR: [
        {
          stipendRecord: {
            employee: {
              status: { in: PAYROLL_DEFAULT_EMPLOYEE_STATUSES },
              ...(branchId ? { currentBranchId: branchId } : {}),
            },
          },
        },
        {
          forcedNonActive: true,
          ...(branchId
            ? {
                stipendRecord: {
                  employee: { currentBranchId: branchId },
                },
              }
            : {}),
        },
      ],
    };

    const entries = await this.prisma.payrollEntry.findMany({
      where,
      include: {
        stipendRecord: {
          select: {
            basicStipend: true,
            employeeId: true,
            employee: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: {
        stipendRecord: { employee: { fullName: 'asc' } },
      },
    });

    const byStatus = {
      PENDING: 0,
      PROCESSED: 0,
      PAID: 0,
    };

    let totalBasicSalary = 0;
    let totalDeductions = 0;
    let totalAllowances = 0;
    let totalNetSalary = 0;
    let periodStipendTotal = 0;

    const employees = entries.map((entry) => {
      byStatus[entry.status]++;
      const earnedBasic = Math.max(0, Number(entry.basicStipend));
      const contractualBasic = Number(entry.stipendRecord.basicStipend);
      const deductions = Math.max(0, Number(entry.totalDeductions));
      const allowances = Math.max(0, Number(entry.totalAllowances));
      const net = Number(entry.netStipend);
      totalBasicSalary += earnedBasic;
      totalDeductions += deductions;
      totalAllowances += allowances;
      totalNetSalary += net;

      const dailyRate =
        daysInMonth > 0 && contractualBasic > 0
          ? contractualBasic / daysInMonth
          : 0;
      const periodStipend = roundMoney(dailyRate * periodDays);
      periodStipendTotal = roundMoney(periodStipendTotal + periodStipend);

      return {
        entryId: entry.id,
        employeeId: entry.stipendRecord.employee.id,
        fullName: entry.stipendRecord.employee.fullName,
        employeeCode: entry.stipendRecord.employee.employeeCode,
        basicStipend: earnedBasic,
        contractualBasic,
        totalDeductions: deductions,
        totalAllowances: allowances,
        netStipend: net,
        status: entry.status,
        periodDays,
        periodStipend,
      };
    });

    // A stipend change mid-month can legitimately produce more than one
    // PayrollEntry row for the same employee/month (one per segment — see
    // computeHourlyBreakdown's segment-bounds comment). entries.length
    // would double-count that employee's headcount even though their
    // dollar totals above (summed per-row) are correct once each row is
    // segment-bounded. Row-level detail is preserved unchanged in
    // `employees` below for auditability — only this one aggregate is
    // employee-deduplicated.
    const distinctEmployeeCount = new Set(
      entries.map((e) => e.stipendRecord.employeeId),
    ).size;

    return {
      month,
      year,
      totalEmployees: distinctEmployeeCount,
      totalBasicSalary,
      totalDeductions,
      totalAllowances,
      totalNetSalary,
      byStatus,
      fromDate: fromDate || null,
      toDate: toDate || null,
      periodDays,
      employees,
      periodTotals: {
        periodStipend: periodStipendTotal,
      },
    };
  }

  async salaryIncrement(dto: SalaryIncrementDto, actingUserId: string) {
    if (!this.transactionBound) return withPayrollEmployeeTransaction(this.prisma, dto.employeeId, tx => this.inTransaction(tx).salaryIncrement(dto, actingUserId));

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: {
        stipendRecords: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
          take: 2,
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    if (employee.stipendRecords.length > 1) {
      throw new BadRequestException('Multiple open stipend packages; resolve package history before editing');
    }
    const activeStipendRecord = employee.stipendRecords[0];
    if (!activeStipendRecord) {
      throw new NotFoundException(
        `No active stipend record found for employee ${dto.employeeId}`,
      );
    }

    const effectiveFrom = toUtcMonthStart(new Date(dto.effectiveFrom));
    if (Number.isNaN(effectiveFrom.getTime())) {
      throw new BadRequestException('effectiveFrom is not a valid date');
    }
    const history = await this.prisma.stipendRecord.findMany({ where: { employeeId: dto.employeeId } });
    validatePackageTimeline([
      ...history.map(record => record.id === activeStipendRecord.id ? { ...record, effectiveTo: effectiveFrom } : record),
      { id: 'new-package', effectiveFrom, effectiveTo: null },
    ]);
    const previousSalary = Number(activeStipendRecord.basicStipend);
    const packageValues = resolvePackageComponents(activeStipendRecord, dto);
    const lumpsumTotal = calculateLumpsumTotal(packageValues);

    return this.prisma.$transaction(async (tx) => {
      await tx.stipendRecord.update({
        where: { id: activeStipendRecord.id },
        data: { effectiveTo: effectiveFrom },
      });

      const newRecord = await tx.stipendRecord.create({
        data: {
          employeeId: dto.employeeId,
          ...packageValues,
          lumpsumTotal,
          effectiveFrom,
        },
      });

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'SALARY_INCREMENT',
          message: `Your stipend package has been updated to PKR ${lumpsumTotal} (lumpsum) effective ${effectiveFrom.toISOString().split('T')[0]}`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'SALARY_INCREMENT',
          entity: 'StipendRecord',
          entityId: newRecord.id,
          changes: {
            previousSalary,
            newBasicStipend: dto.basicStipend,
            lumpsumTotal,
            previousPackage: { ...resolvePackageComponents(activeStipendRecord, { basicStipend: Number(activeStipendRecord.basicStipend) }) },
            newPackage: { ...packageValues },
            suppliedComponents: Object.keys(packageValues).filter(key => dto[key] != null),
            reason: dto.reason,
          },
        },
      });

      return newRecord;
    });
  }

  /**
   * Undated edits apply from the current Pakistan month, preserving older
   * package versions. Explicit dates retain the validated correction path.
   */
  async updateActiveStipend(dto: UpdateActiveStipendDto, actingUserId: string) {
    if (!this.transactionBound) return withPayrollEmployeeTransaction(this.prisma, dto.employeeId, tx => this.inTransaction(tx).updateActiveStipend(dto, actingUserId));

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: {
        stipendRecords: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
          take: 2,
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    if (employee.stipendRecords.length > 1) {
      throw new BadRequestException('Multiple open stipend packages; resolve package history before editing');
    }
    const activeStipendRecord = employee.stipendRecords[0];
    if (!activeStipendRecord) {
      throw new NotFoundException(
        `No active stipend record found for employee ${dto.employeeId}`,
      );
    }

    const packageValues = resolvePackageComponents(activeStipendRecord, dto);
    const lumpsumTotal = calculateLumpsumTotal(packageValues);

    const previousEffectiveFrom = activeStipendRecord.effectiveFrom;
    const currentMonthStart = toUtcMonthStart(pakistanDateOnly(new Date()));
    const undatedEdit = !dto.effectiveFrom;
    if (undatedEdit && toUtcMonthStart(previousEffectiveFrom) > currentMonthStart) {
      throw new BadRequestException('Cannot edit a future stipend package without an explicit effective date');
    }
    const createMonthlyVersion = undatedEdit && toUtcMonthStart(previousEffectiveFrom) < currentMonthStart;
    const nextEffectiveFrom = dto.effectiveFrom
      ? new Date(dto.effectiveFrom)
      : createMonthlyVersion ? currentMonthStart : null;
    const effectiveFromChanging =
      !!nextEffectiveFrom &&
      nextEffectiveFrom.getTime() !== previousEffectiveFrom.getTime();

    if (effectiveFromChanging && nextEffectiveFrom) {
      if (Number.isNaN(nextEffectiveFrom.getTime())) {
        throw new BadRequestException('effectiveFrom is not a valid date');
      }
      if (nextEffectiveFrom.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
        throw new BadRequestException(
          'effectiveFrom cannot be more than one day in the future',
        );
      }
    }

    if (effectiveFromChanging && nextEffectiveFrom) {
      const history = await this.prisma.stipendRecord.findMany({ where: { employeeId: dto.employeeId } });
      const proposed = history.map(record => {
        if (createMonthlyVersion) return record.id === activeStipendRecord.id
          ? { ...record, effectiveTo: currentMonthStart } : record;
        if (record.id === activeStipendRecord.id) return { ...record, effectiveFrom: nextEffectiveFrom };
        return record.effectiveTo?.getTime() === previousEffectiveFrom.getTime()
          ? { ...record, effectiveTo: nextEffectiveFrom } : record;
      });
      if (createMonthlyVersion) proposed.push({ ...activeStipendRecord, id: 'new-monthly-package', effectiveFrom: currentMonthStart, effectiveTo: null });
      validatePackageTimeline(proposed);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (createMonthlyVersion) {
        await tx.stipendRecord.update({
          where: { id: activeStipendRecord.id },
          data: { effectiveTo: currentMonthStart },
        });
      } else if (effectiveFromChanging && nextEffectiveFrom) {
        // Keep half-open chain: prior package closed exactly when the open
        // package started. Moving the raise to day-1 moves that seam too.
        await tx.stipendRecord.updateMany({
          where: {
            employeeId: dto.employeeId,
            id: { not: activeStipendRecord.id },
            effectiveTo: previousEffectiveFrom,
          },
          data: { effectiveTo: nextEffectiveFrom },
        });
      }

      const record = createMonthlyVersion
        ? await tx.stipendRecord.create({
            data: { employeeId: dto.employeeId, ...packageValues, lumpsumTotal, effectiveFrom: currentMonthStart },
          })
        : await tx.stipendRecord.update({
        where: { id: activeStipendRecord.id },
        data: {
          ...packageValues,
          lumpsumTotal,
          ...(effectiveFromChanging && nextEffectiveFrom
            ? { effectiveFrom: nextEffectiveFrom }
            : {}),
        },
      });

      if (createMonthlyVersion) {
        // Preserve the pending entry and its child rows while changing its package owner.
        await tx.payrollEntry.updateMany({
          where: {
            stipendRecordId: activeStipendRecord.id,
            status: PayrollStatus.PENDING,
            OR: [
              { year: { gt: currentMonthStart.getUTCFullYear() } },
              { year: currentMonthStart.getUTCFullYear(), month: { gte: currentMonthStart.getUTCMonth() + 1 } },
            ],
          },
          data: { stipendRecordId: record.id },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'STIPEND_PACKAGE_CORRECTED',
          entity: 'StipendRecord',
          entityId: record.id,
          changes: {
            previousBasicStipend: Number(activeStipendRecord.basicStipend),
            newBasicStipend: dto.basicStipend,
            lumpsumTotal,
            previousPackage: { ...resolvePackageComponents(activeStipendRecord, { basicStipend: Number(activeStipendRecord.basicStipend) }) },
            newPackage: { ...packageValues },
            suppliedComponents: Object.keys(packageValues).filter(key => dto[key] != null),
            reason: dto.reason?.trim() || null,
            previousEffectiveFrom,
            newEffectiveFrom: effectiveFromChanging
              ? nextEffectiveFrom
              : previousEffectiveFrom,
          },
        },
      });

      return record;
    });

    const pendingMonths = await this.prisma.payrollEntry.findMany({
      where: {
        status: PayrollStatus.PENDING,
        stipendRecord: { employeeId: dto.employeeId },
      },
      select: { month: true, year: true },
      distinct: ['month', 'year'],
    });
    for (const row of pendingMonths) {
      if (undatedEdit && Date.UTC(row.year, row.month - 1, 1) < currentMonthStart.getTime()) continue;
      await this.recomputeEmployeeMonth({
        employeeId: dto.employeeId,
        month: row.month,
        year: row.year,
      });
    }

    return updated;
  }

  private validateStatusTransition(
    current: PayrollStatus,
    next: PayrollStatus,
  ): void {
    if (next === PayrollStatus.PENDING) {
      throw new BadRequestException('Cannot revert payroll entry to pending');
    }

    if (current === PayrollStatus.PENDING && next === PayrollStatus.PROCESSED) {
      return;
    }

    if (current === PayrollStatus.PROCESSED && next === PayrollStatus.PAID) {
      return;
    }

    if (current === PayrollStatus.PENDING && next === PayrollStatus.PAID) {
      throw new BadRequestException(
        'Payroll must be processed before it can be marked as paid',
      );
    }

    throw new BadRequestException(
      `Invalid status transition from ${current} to ${next}`,
    );
  }
}
