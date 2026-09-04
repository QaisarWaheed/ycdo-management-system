import {
  calculateLumpsumTotal,
  dailyStipendRate,
  daysInPayrollMonth,
  stipendRecordToPackage,
  prorateContractualBasicForPayrollSegment,
  prorateMonthlyPackageAmount,
} from '../../common/stipend.util';
import {
  getDutyWindow,
  resolveAttendanceDutyTimes,
} from '../../common/duty.util';
import {
  BadRequestException,
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
  DEFAULT_MONTHLY_ALLOWED_LEAVES,
  dateKey,
  hoursFromDutyWindow,
  leaveCreditMinutes,
  payableMinutesWithinDutyWindow,
  resolveDailyDutyHours,
  resolveManualAllowancePay,
  roundMoney,
  splitPaidUnpaidLeaveDays,
  unpaidLeaveDeductionAmount,
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

const UNPAID_LEAVE_DESC_PREFIX = 'Unpaid leave';

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private prisma: PrismaService,
    private accessScopeService: AccessScopeService,
  ) {}

  async createOrGetEntry(
    dto: CreatePayrollEntryDto,
    actingUser?: { id: string; role: UserRole },
  ) {
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
    const byMonth = new Map<string, T[]>();
    for (const entry of entries) {
      const key = `${entry.year}-${entry.month}`;
      const bucket = byMonth.get(key) ?? [];
      bucket.push(entry);
      byMonth.set(key, bucket);
    }

    const merged: T[] = [];
    for (const group of byMonth.values()) {
      const active = group
        .filter((e) => e.stipendRecord?.effectiveTo == null)
        .sort(
          (a, b) =>
            (a.stipendRecord?.effectiveFrom?.getTime() ?? 0) -
            (b.stipendRecord?.effectiveFrom?.getTime() ?? 0),
        );
      const newestActive = active[active.length - 1];
      const newestActiveFrom = newestActive?.stipendRecord?.effectiveFrom;

      const kept = group.filter((e) => {
        const sr = e.stipendRecord;
        if (!sr) return true;
        if (sr.effectiveTo == null) {
          return !newestActive || e.id === newestActive.id;
        }
        // Keep closed packages that started before the current open one
        // (real mid-month increment). Drop closed leftovers that started
        // on/after the open package's effectiveFrom.
        if (
          newestActiveFrom &&
          sr.effectiveFrom &&
          sr.effectiveFrom.getTime() >= newestActiveFrom.getTime()
        ) {
          return false;
        }
        return true;
      });

      if (kept.length === 0) continue;
      if (kept.length === 1) {
        merged.push(kept[0]!);
        continue;
      }

      const primary =
        kept.find((e) => e.stipendRecord?.effectiveTo == null) ?? kept[0]!;

      const statusRank = (s: PayrollStatus) =>
        s === PayrollStatus.PAID ? 3 : s === PayrollStatus.PROCESSED ? 2 : 1;

      merged.push({
        ...primary,
        basicStipend: roundMoney(
          kept.reduce((sum, e) => sum + Number(e.basicStipend), 0),
        ),
        totalAllowances: roundMoney(
          kept.reduce((sum, e) => sum + Number(e.totalAllowances), 0),
        ),
        totalDeductions: roundMoney(
          kept.reduce((sum, e) => sum + Number(e.totalDeductions), 0),
        ),
        netStipend: roundMoney(
          kept.reduce((sum, e) => sum + Number(e.netStipend), 0),
        ),
        status: kept.reduce<T>(
          (best, e) =>
            statusRank(e.status) > statusRank(best.status) ? e : best,
          kept[0]!,
        ).status,
        deductions: kept.flatMap((e) => e.deductions ?? []),
        allowances: kept.flatMap((e) => e.allowances ?? []),
      });
    }

    return merged.sort((a, b) =>
      a.year !== b.year ? b.year - a.year : b.month - a.month,
    );
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
    const { monthStart, monthEnd } = this.pakistanMonthWindow(year, month);

    const onLeaveLogs = await this.prisma.attendanceLog.findMany({
      where: {
        employeeId,
        type: AttendanceLogType.REGULAR,
        status: AttendanceStatus.ON_LEAVE,
        date: { gte: monthStart, lte: monthEnd },
      },
      select: { date: true },
      orderBy: { date: 'asc' },
    });

    const exceptionLeaves = await this.prisma.leaveRecord.findMany({
      where: {
        employeeId,
        status: LeaveStatus.APPROVED,
        leaveType: { not: LeaveType.SHORT_LEAVE },
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
        approvals: {
          some: {
            stage: LeaveApprovalStage.QUOTA_EXCEPTION,
            action: LeaveApprovalAction.APPROVED,
          },
        },
      },
      select: { startDate: true, endDate: true },
    });
    const exceptionDateKeys = new Set<string>();
    for (const leave of exceptionLeaves) {
      for (
        let t = leave.startDate.getTime();
        t <= leave.endDate.getTime();
        t += 24 * 60 * 60 * 1000
      ) {
        const d = new Date(t);
        if (d.getTime() >= monthStart.getTime() && d.getTime() <= monthEnd.getTime()) {
          exceptionDateKeys.add(dateKey(d));
        }
      }
    }

    const dates = onLeaveLogs.map((l) => l.date);
    const datesForMonthlyQuota = dates.filter(
      (d) => !exceptionDateKeys.has(dateKey(d)),
    );
    const split = splitPaidUnpaidLeaveDays({
      onLeaveDates: datesForMonthlyQuota,
      monthlyAllowedLeaves,
    });
    const uniqueSorted = [
      ...new Map(dates.map((d) => [dateKey(d), d] as const)).values(),
    ].sort((a, b) => a.getTime() - b.getTime());

    return uniqueSorted.filter(
      (d) =>
        !split.paidLeaveDateKeys.has(dateKey(d)) &&
        !exceptionDateKeys.has(dateKey(d)),
    );
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
    let entry = await this.prisma.payrollEntry.findUnique({
      where: {
        stipendRecordId_month_year: {
          stipendRecordId: stipendRecord.id,
          month: dto.month,
          year: dto.year,
        },
      },
      include: { deductions: true, allowances: true },
    });

    if (
      entry &&
      (entry.status === PayrollStatus.PAID ||
        entry.status === PayrollStatus.PROCESSED)
    ) {
      return entry; // PROCESSED and PAID financial totals are frozen
    }

    const markForced =
      forceNonActiveOverride === true ? true : entry?.forcedNonActive === true;
    const contractualBasic = Number(stipendRecord.basicStipend);

    if (!entry) {
      const initialBreakdown = await this.computeHourlyBreakdown(
        dto.employeeId,
        dto.month,
        dto.year,
        {
          stipendRecord,
          employee,
          existingDeductions: [],
          existingAllowances: [],
          applyContractualPackage,
          backfillFromJoining: options.backfillFromJoining,
          backfillFromAttendance: options.backfillFromAttendance,
          backfillContractualFromEmployment:
            options.backfillContractualFromEmployment,
        },
      );
      const createdTotals = this.clampPayrollTotals(initialBreakdown);
      entry = await this.prisma.payrollEntry.create({
        data: {
          stipendRecordId: stipendRecord.id,
          month: dto.month,
          year: dto.year,
          ...createdTotals,
          forcedNonActive: markForced,
          status: PayrollStatus.PENDING,
        },
        include: { deductions: true, allowances: true },
      });
    }

    const { segmentStart, segmentEndExclusive, monthEnd } =
      this.resolveSegmentDateBounds(stipendRecord, dto.month, dto.year, {
        joiningDate: employee.joiningDate,
        backfillFromJoining: options.backfillFromJoining,
        backfillFromAttendance: options.backfillFromAttendance,
      });
    const unpaidLeaveDaysInSegment = unpaidLeaveDatesForMonth.filter((d) =>
      this.dateWithinSegment(d, segmentStart, segmentEndExclusive, monthEnd),
    ).length;

    await this.upsertAdditionalWorkingDaysAllowanceRow(
      entry.id,
      dto.employeeId,
      dto.month,
      dto.year,
      employee,
      contractualBasic,
      segmentStart,
      segmentEndExclusive,
    );
    await this.upsertUnpaidLeaveDeductionRow(
      entry.id,
      dto.month,
      dto.year,
      unpaidLeaveDaysInSegment,
      employee.monthlyAllowedLeaves,
      contractualBasic,
    );
    await this.upsertRelieverAllowanceRow(
      entry.id,
      dto.employeeId,
      dto.month,
      dto.year,
      employee,
      contractualBasic,
      segmentStart,
      segmentEndExclusive,
    );
    await this.upsertOvertimeAllowanceRow(
      entry.id,
      dto.employeeId,
      dto.month,
      dto.year,
      employee,
      contractualBasic,
      segmentStart,
      segmentEndExclusive,
    );

    if (entry.status === PayrollStatus.PENDING) {
      const repairStats = await this.prisma.$transaction(
        (tx) =>
          repairLateDisciplineForPayrollMonth(
            tx,
            dto.employeeId,
            dto.month,
            dto.year,
          ),
        { timeout: 120_000 },
      );
      if (repairStats.applied > 0 || repairStats.repaired > 0) {
        this.logger.log(
          `Late discipline repair ${dto.employeeId} ${dto.year}-${String(dto.month).padStart(2, '0')}: applied=${repairStats.applied} repaired=${repairStats.repaired} skipped=${repairStats.skipped}`,
        );
      }
    }

    await this.syncAttendancePenaltyDeductions(
      entry.id,
      dto.employeeId,
      dto.month,
      dto.year,
      contractualBasic,
      employee.joiningDate,
      segmentStart,
      segmentEndExclusive,
      monthEnd,
      options.backfillFromAttendance,
      employee.status,
      employee.statusEffectiveFrom,
    );
    await this.syncFineLetterDeductions(
      entry.id,
      dto.employeeId,
      contractualBasic,
      segmentStart,
      segmentEndExclusive,
      monthEnd,
    );

    const refreshed = await this.prisma.payrollEntry.findUnique({
      where: { id: entry.id },
      include: { deductions: true, allowances: true },
    });
    const breakdown = await this.computeHourlyBreakdown(
      dto.employeeId,
      dto.month,
      dto.year,
      {
        stipendRecord,
        employee,
        existingDeductions: refreshed?.deductions ?? [],
        existingAllowances: refreshed?.allowances ?? [],
        applyContractualPackage,
        backfillFromJoining: options.backfillFromJoining,
        backfillFromAttendance: options.backfillFromAttendance,
        backfillContractualFromEmployment:
          options.backfillContractualFromEmployment,
      },
    );
    const totals = this.clampPayrollTotals(breakdown);
    const statusNow = await this.prisma.payrollEntry.findUnique({
      where: { id: entry.id },
      select: { status: true },
    });
    if (
      statusNow?.status === PayrollStatus.PAID ||
      statusNow?.status === PayrollStatus.PROCESSED
    ) {
      return this.prisma.payrollEntry.findUniqueOrThrow({
        where: { id: entry.id },
        include: { deductions: true, allowances: true },
      });
    }
    return this.prisma.payrollEntry.update({
      where: { id: entry.id },
      data: {
        ...totals,
        forcedNonActive: markForced,
      },
      include: { deductions: true, allowances: true },
    });
  }

  private async keepSingleAllowance(
    payrollEntryId: string,
    type: AllowanceType,
  ) {
    const rows = await this.prisma.allowance.findMany({
      where: { payrollEntryId, type },
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length <= 1) return rows[0] ?? null;
    const [keep, ...extras] = rows;
    await this.prisma.allowance.deleteMany({
      where: { id: { in: extras.map((r) => r.id) } },
    });
    return keep;
  }

  private async keepSingleDeduction(
    payrollEntryId: string,
    reason: DeductionType,
  ) {
    const rows = await this.prisma.payrollDeduction.findMany({
      where: { payrollEntryId, reason },
      orderBy: { id: 'asc' },
    });
    if (rows.length <= 1) return rows[0] ?? null;
    const [keep, ...extras] = rows;
    await this.prisma.payrollDeduction.deleteMany({
      where: { id: { in: extras.map((r) => r.id) } },
    });
    return keep;
  }

  /**
   * Upserts or removes ADDITIONAL_WORKING_DAYS allowance row only (totals
   * recalculated by caller). Date-based (each AdditionalWorkingDay row has
   * its own date) — segment-bounded via segmentStart/segmentEndExclusive
   * (same [effectiveFrom, effectiveTo) semantics as computeHourlyBreakdown)
   * so a mid-month stipend change never has this allowance counted twice
   * across two PayrollEntry rows for the same physical day.
   */
  private async upsertAdditionalWorkingDaysAllowanceRow(
    payrollEntryId: string,
    employeeId: string,
    month: number,
    year: number,
    employee: {
      dutyTotalHours?: number | null;
      dutyStartTime?: string | null;
      dutyEndTime?: string | null;
      shift?: { startTime: string; endTime: string } | null;
    },
    contractualBasic: number,
    segmentStart: Date,
    segmentEndExclusive: Date | null,
  ) {
    const daysInMonth = daysInPayrollMonth(year, month);
    const { monthEnd } = this.pakistanMonthWindow(year, month);
    const dayRows = await this.prisma.additionalWorkingDay.findMany({
      where: {
        employeeId,
        relieverSessionId: null,
        date: {
          gte: segmentStart,
          lte: monthEnd,
          ...(segmentEndExclusive ? { lt: segmentEndExclusive } : {}),
        },
      },
      select: { id: true },
    });
    const dayCount = dayRows.length;

    const dailyHours = resolveDailyDutyHours(employee);
    const hourlyRate = computeHourlyRate(
      contractualBasic,
      dailyHours,
      daysInMonth,
    );
    const hours = roundMoney(dayCount * dailyHours);
    const amount = roundMoney(hours * hourlyRate);

    const existing = await this.keepSingleAllowance(
      payrollEntryId,
      AllowanceType.ADDITIONAL_WORKING_DAYS,
    );

    if (dayCount <= 0 || amount <= 0) {
      if (existing) {
        await this.prisma.allowance.delete({ where: { id: existing.id } });
      }
      return;
    }

    const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });
    const label = 'Extra duty / additional working days';
    const description = `${label}: ${dayCount} day(s) × ${dailyHours}h = ${hours}h @ PKR ${hourlyRate}/hr (${monthLabel})`;

    if (existing) {
      await this.prisma.allowance.update({
        where: { id: existing.id },
        data: { hours, amount, description },
      });
      return;
    }

    await this.prisma.allowance.create({
      data: {
        payrollEntryId,
        type: AllowanceType.ADDITIONAL_WORKING_DAYS,
        hours,
        amount,
        description,
      },
    });
  }

  /**
   * Same pattern as extra-duty / reliever: attendance OT hours × hourly
   * rate, one OVERTIME row per payroll entry. Called on generate/refresh
   * so HR typing extra hours on attendance updates pending payroll.
   */
  private async upsertOvertimeAllowanceRow(
    payrollEntryId: string,
    employeeId: string,
    month: number,
    year: number,
    employee: {
      dutyTotalHours?: number | null;
      dutyStartTime?: string | null;
      dutyEndTime?: string | null;
      shift?: { startTime: string; endTime: string } | null;
    },
    contractualBasic: number,
    segmentStart: Date,
    segmentEndExclusive: Date | null,
  ) {
    const daysInMonth = daysInPayrollMonth(year, month);
    const { monthEnd } = this.pakistanMonthWindow(year, month);
    const otLogs = await this.prisma.attendanceLog.findMany({
      where: {
        employeeId,
        overtimeMinutes: { gt: 0 },
        overtimePending: false,
        date: {
          gte: segmentStart,
          lte: monthEnd,
          ...(segmentEndExclusive ? { lt: segmentEndExclusive } : {}),
        },
      },
      select: { overtimeMinutes: true },
    });
    const minutes = otLogs.reduce(
      (sum, log) => sum + (Number(log.overtimeMinutes) || 0),
      0,
    );
    const dailyHours = resolveDailyDutyHours(employee);
    const hourlyRate = computeHourlyRate(
      contractualBasic,
      dailyHours,
      daysInMonth,
    );
    const hours = roundMoney(minutes / 60);
    const amount = roundMoney(hours * hourlyRate);

    const existing = await this.keepSingleAllowance(
      payrollEntryId,
      AllowanceType.OVERTIME,
    );

    if (minutes <= 0 || amount <= 0) {
      if (existing) {
        await this.prisma.allowance.delete({ where: { id: existing.id } });
      }
      return;
    }

    const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });
    const description = `Overtime ${hours}h @ PKR ${hourlyRate}/hr (${monthLabel})`;

    if (existing) {
      await this.prisma.allowance.update({
        where: { id: existing.id },
        data: { hours, amount, description },
      });
      return;
    }

    await this.prisma.allowance.create({
      data: {
        payrollEntryId,
        type: AllowanceType.OVERTIME,
        hours,
        amount,
        description,
      },
    });
  }

  private skipPreJoinPayrollDay(
    date: Date,
    joiningDate: Date | null | undefined,
    backfillFromAttendance?: boolean,
  ): boolean {
    if (backfillFromAttendance) return false;
    return isPreJoinAttendanceDate(date, joiningDate);
  }

  private skipStatusTransitionPayrollDay(
    date: Date,
    employee: {
      joiningDate?: Date | null;
      status?: EmployeeStatus;
      statusEffectiveFrom?: Date | null;
    },
    backfillFromAttendance?: boolean,
  ): boolean {
    if (this.skipPreJoinPayrollDay(date, employee.joiningDate, backfillFromAttendance)) {
      return true;
    }
    if (
      employee.status &&
      isPostExitAttendanceDate(
        date,
        employee.status,
        employee.statusEffectiveFrom,
      )
    ) {
      return true;
    }
    if (
      employee.status &&
      isPreActiveAttendanceDate(
        date,
        employee.status,
        employee.statusEffectiveFrom,
      )
    ) {
      return true;
    }
    return false;
  }

  /**
   * Keeps HALF_DAY / ABSENT / UNINFORMED_ABSENT / elapsed-UNMARKED
   * deduction rows in sync with this segment's attendance logs so generate
   * and recompute show the same penalties as a live attendance edit.
   */
  private async syncAttendancePenaltyDeductions(
    payrollEntryId: string,
    employeeId: string,
    month: number,
    year: number,
    contractualBasic: number,
    joiningDate: Date | null | undefined,
    segmentStart: Date,
    segmentEndExclusive: Date | null,
    monthEnd: Date,
    backfillFromAttendance?: boolean,
    employeeStatus?: EmployeeStatus,
    statusEffectiveFrom?: Date | null,
  ) {
    const logs = await this.prisma.attendanceLog.findMany({
      where: {
        employeeId,
        type: AttendanceLogType.REGULAR,
        date: {
          gte: segmentStart,
          lte: monthEnd,
          ...(segmentEndExclusive ? { lt: segmentEndExclusive } : {}),
        },
      },
      select: { date: true, status: true, note: true },
    });

    const today = toPakistanDateOnly(new Date());
    const wanted = new Map<
      string,
      { reason: DeductionType; amount: number }
    >();

    for (const log of logs) {
      if (
        this.skipStatusTransitionPayrollDay(
          log.date,
          {
            joiningDate,
            status: employeeStatus,
            statusEffectiveFrom,
          },
          backfillFromAttendance,
        )
      ) {
        continue;
      }
      const label = log.date.toISOString().slice(0, 10);
      const daily = dailyStipendRate(contractualBasic, log.date);

      if (
        log.status === AttendanceStatus.HALF_DAY &&
        !(log.note ?? '').toLowerCase().includes('short leave')
      ) {
        wanted.set(`Half day deduction (0.5 day stipend) — ${label}`, {
          reason: DeductionType.HALF_DAY,
          amount: roundMoney(daily * 0.5),
        });
      } else if (log.status === AttendanceStatus.ABSENT) {
        wanted.set(`Absent without approved leave (2 days stipend) — ${label}`, {
          reason: DeductionType.UNINFORMED_ABSENCE,
          amount: roundMoney(daily * 2),
        });
      } else if (log.status === AttendanceStatus.UNINFORMED_ABSENT) {
        wanted.set(`Uninformed absence deduction (2 days) — ${label}`, {
          reason: DeductionType.UNINFORMED_ABSENCE,
          amount: roundMoney(daily * 2),
        });
      } else if (
        log.status === AttendanceStatus.UNMARKED &&
        log.date.getTime() <= today.getTime() &&
        log.note !== PRE_JOIN_UNMARKED_NOTE
      ) {
        wanted.set(`Unmarked day (1 day stipend) — ${label}`, {
          reason: DeductionType.OTHER,
          amount: roundMoney(daily),
        });
      }
    }

    const managedPrefixes = [
      'Half day deduction (0.5 day stipend) — ',
      'Unmarked day (1 day stipend) — ',
      'Absent without approved leave (2 days stipend) — ',
      'Uninformed absence deduction (2 days) — ',
    ];
    const existing = await this.prisma.payrollDeduction.findMany({
      where: { payrollEntryId },
    });
    const managed = existing.filter((row) =>
      managedPrefixes.some((prefix) => (row.description ?? '').startsWith(prefix)),
    );

    for (const row of managed) {
      const next = wanted.get(row.description ?? '');
      if (!next) {
        await this.prisma.payrollDeduction.delete({ where: { id: row.id } });
        continue;
      }
      if (
        row.reason !== next.reason ||
        Number(row.amount) !== next.amount
      ) {
        await this.prisma.payrollDeduction.update({
          where: { id: row.id },
          data: { reason: next.reason, amount: next.amount },
        });
      }
      wanted.delete(row.description ?? '');
    }

    for (const [description, row] of wanted) {
      await this.prisma.payrollDeduction.create({
        data: {
          payrollEntryId,
          reason: row.reason,
          amount: row.amount,
          description,
        },
      });
    }
  }

  /**
   * Re-applies 1-day fines from issued FINE letters (late arrival and
   * missing checkout) onto this segment. DisciplineEvent claims mean
   * applyLateDiscipline will not recreate these after a payroll wipe.
   */
  private async syncFineLetterDeductions(
    payrollEntryId: string,
    employeeId: string,
    contractualBasic: number,
    segmentStart: Date,
    segmentEndExclusive: Date | null,
    monthEnd: Date,
  ) {
    const letters = await this.prisma.letter.findMany({
      where: { employeeId, letterType: LetterType.FINE },
      select: { variables: true },
    });

    const wanted = new Map<
      string,
      { reason: DeductionType; amount: number }
    >();

    for (const letter of letters) {
      const vars = (letter.variables ?? {}) as {
        incidentDate?: string;
        monthlyLateOccurrence?: number;
        monthlyMissingCheckoutOccurrence?: number;
        reversedDueToShortLeave?: boolean;
        reversed?: boolean;
        fineAmount?: string;
      };
      if (vars.reversedDueToShortLeave || vars.reversed) continue;
      if (!vars.incidentDate) continue;

      const incident = toPakistanDateOnly(
        parseAttendanceDateTime(`${vars.incidentDate}T12:00:00`),
      );
      if (
        !this.dateWithinSegment(
          incident,
          segmentStart,
          segmentEndExclusive,
          monthEnd,
        )
      ) {
        continue;
      }

      const parsedAmount = this.parseFineAmountLabel(vars.fineAmount);
      const amount = roundMoney(
        parsedAmount ?? dailyStipendRate(contractualBasic, incident),
      );
      if (amount <= 0) continue;

      if (vars.monthlyLateOccurrence != null) {
        wanted.set(
          `Late arrival deduction — monthly occurrence ${vars.monthlyLateOccurrence}`,
          { reason: DeductionType.LATE_ARRIVAL, amount },
        );
      } else if (vars.monthlyMissingCheckoutOccurrence != null) {
        wanted.set(
          `Missing checkout deduction — monthly occurrence ${vars.monthlyMissingCheckoutOccurrence}`,
          { reason: DeductionType.DISCIPLINARY_FINE, amount },
        );
      } else {
        wanted.set(`Fine letter — ${vars.incidentDate}`, {
          reason: DeductionType.DISCIPLINARY_FINE,
          amount,
        });
      }
    }

    const managedPrefixes = [
      'Late arrival deduction — monthly occurrence ',
      'Missing checkout deduction — monthly occurrence ',
      'Fine letter — ',
    ];
    const existing = await this.prisma.payrollDeduction.findMany({
      where: { payrollEntryId },
    });
    const managed = existing.filter((row) =>
      managedPrefixes.some((prefix) => (row.description ?? '').startsWith(prefix)),
    );

    for (const row of managed) {
      const next = wanted.get(row.description ?? '');
      if (!next) {
        await this.prisma.payrollDeduction.delete({ where: { id: row.id } });
        continue;
      }
      if (row.reason !== next.reason || Number(row.amount) !== next.amount) {
        await this.prisma.payrollDeduction.update({
          where: { id: row.id },
          data: { reason: next.reason, amount: next.amount },
        });
      }
      wanted.delete(row.description ?? '');
    }

    for (const [description, row] of wanted) {
      await this.prisma.payrollDeduction.create({
        data: {
          payrollEntryId,
          reason: row.reason,
          amount: row.amount,
          description,
        },
      });
    }
  }

  private parseFineAmountLabel(label?: string): number | null {
    if (!label) return null;
    const match = label.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const amount = Number(match[1]);
    return Number.isFinite(amount) ? amount : null;
  }

  /**
   * The "first N leave days of the month are paid" QUOTA is a genuinely
   * month-global policy — it can only be computed correctly by looking at
   * every ON_LEAVE date in the whole month together, in chronological
   * order (splitPaidUnpaidLeaveDays). Computed exactly ONCE per
   * employee/month by the caller (see computeMonthlyUnpaidLeaveDates) and
   * shared across every stipend segment — never recomputed per segment,
   * which would incorrectly reset the quota for each segment in isolation
   * (e.g. 2 unpaid-eligible days in segment A + 1 in segment B, allowance
   * 2, would wrongly grant a fresh "first 2 free" in EACH segment instead
   * of one combined quota for the month).
   *
   * The RESULTING unpaid dates are then attributed to exactly one
   * PayrollEntry each — whichever stipend segment's
   * [effectiveFrom, effectiveTo) window contains that date — via the
   * `unpaidLeaveDaysInSegment` count the caller passes in, already
   * filtered to this segment.
   */
  private async upsertUnpaidLeaveDeductionRow(
    payrollEntryId: string,
    month: number,
    year: number,
    unpaidLeaveDaysInSegment: number,
    monthlyAllowedLeaves: number | null | undefined,
    contractualBasic: number,
  ) {
    const daysInMonth = daysInPayrollMonth(year, month);
    const amount = unpaidLeaveDeductionAmount(
      unpaidLeaveDaysInSegment,
      contractualBasic,
      daysInMonth,
    );

    const existing = await this.keepSingleDeduction(
      payrollEntryId,
      DeductionType.UNPAID_LEAVE,
    );

    if (unpaidLeaveDaysInSegment <= 0 || amount <= 0) {
      if (existing) {
        await this.prisma.payrollDeduction.delete({ where: { id: existing.id } });
      }
      return;
    }

    const description = `${UNPAID_LEAVE_DESC_PREFIX} (${unpaidLeaveDaysInSegment} day(s) beyond allowance of ${monthlyAllowedLeaves ?? DEFAULT_MONTHLY_ALLOWED_LEAVES})`;

    if (existing) {
      await this.prisma.payrollDeduction.update({
        where: { id: existing.id },
        data: { amount, description },
      });
      return;
    }

    await this.prisma.payrollDeduction.create({
      data: {
        payrollEntryId,
        reason: DeductionType.UNPAID_LEAVE,
        amount,
        description,
      },
    });
  }

  /**
   * Upserts/removes the single RELIEVER allowance row for this payroll
   * entry (one row per entry, mirroring upsertUnpaidLeaveDeductionRow /
   * upsertAdditionalWorkingDaysAllowanceRow above), computed as a full
   * recompute from every completed RelieverSession this month every time
   * payroll is generated/refreshed. Because it's always a fresh recompute
   * rather than a per-session write, this is naturally idempotent (reruns,
   * payroll regeneration, and any future correction to a RelieverSession's
   * checkOut/totalMinutes all converge to the same correct total) without
   * needing a stored source-session reference.
   */
  private async upsertRelieverAllowanceRow(
    payrollEntryId: string,
    employeeId: string,
    month: number,
    year: number,
    employee: {
      relieverOnly?: boolean;
      dutyTotalHours?: number | null;
      dutyStartTime?: string | null;
      dutyEndTime?: string | null;
      shift?: { startTime: string; endTime: string } | null;
    },
    contractualBasic: number,
    segmentStart: Date,
    segmentEndExclusive: Date | null,
  ) {
    const daysInMonth = daysInPayrollMonth(year, month);
    const { monthEnd } = this.pakistanMonthWindow(year, month);

    // Date-based (each RelieverSession has its own date, no month-global
    // policy entanglement unlike unpaid leave) — segment-bounded the same
    // way as computeHourlyBreakdown / upsertAdditionalWorkingDaysAllowanceRow.
    const sessions = await this.prisma.relieverSession.findMany({
      where: {
        employeeId,
        date: {
          gte: segmentStart,
          lte: monthEnd,
          ...(segmentEndExclusive ? { lt: segmentEndExclusive } : {}),
        },
        checkOut: { not: null },
      },
    });

    const dailyHours = resolveDailyDutyHours(employee);
    const hourlyRate = computeHourlyRate(
      contractualBasic,
      dailyHours,
      daysInMonth,
    );
    const scheduledMinutes = Math.round(dailyHours * 60);
    let payableMinutes = 0;
    for (const session of sessions) {
      if (!session.checkOut) continue;
      const extraMinutes = computeRelieverPayableMinutes(employee, {
        checkIn: session.checkIn,
        checkOut: session.checkOut,
        totalMinutes: session.totalMinutes,
      });
      // Full duty day (or more) → 1 additional daily stipend; partial → hours.
      if (extraMinutes >= scheduledMinutes) {
        payableMinutes += scheduledMinutes;
      } else {
        payableMinutes += Math.max(0, extraMinutes);
      }
    }
    const hours = roundMoney(payableMinutes / 60);
    const amount = roundMoney(hours * hourlyRate);

    const existing = await this.keepSingleAllowance(
      payrollEntryId,
      AllowanceType.RELIEVER,
    );

    if (sessions.length === 0 || amount <= 0) {
      if (existing) {
        await this.prisma.allowance.delete({ where: { id: existing.id } });
      }
      return;
    }

    const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });
    const description = `Reliever extra duty: ${sessions.length} session(s), ${hours}h @ PKR ${hourlyRate}/hr (${monthLabel})`;

    if (existing) {
      await this.prisma.allowance.update({
        where: { id: existing.id },
        data: { hours, amount, description },
      });
      return;
    }

    await this.prisma.allowance.create({
      data: {
        payrollEntryId,
        type: AllowanceType.RELIEVER,
        hours,
        amount,
        description,
      },
    });
  }

  async addDeduction(dto: AddDeductionDto) {
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

    // Include all recorded OT for this month (pending + approved).
    // Clicking Apply Overtime is the HR approval step for payroll.
    const otLogs = await this.prisma.attendanceLog.findMany({
      where: {
        employeeId,
        date: { gte: monthStart, lte: monthEnd },
        overtimeMinutes: { gt: 0 },
      },
      select: { date: true, overtimeMinutes: true, overtimePending: true },
    });

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
      const segLogs = otLogs.filter((l) =>
        this.dateWithinSegment(
          l.date,
          segmentStart,
          segmentEndExclusive,
          segMonthEnd,
        ),
      );
      const segOvertimeMinutes = segLogs.reduce(
        (sum, l) => sum + l.overtimeMinutes,
        0,
      );
      const segPendingOvertimeMinutes = segLogs
        .filter((l) => l.overtimePending)
        .reduce((sum, l) => sum + l.overtimeMinutes, 0);
      const segOvertimeHours =
        Math.round((segOvertimeMinutes / 60) * 100) / 100;
      const segBasicStipend = Number(stipendRecord.basicStipend);
      const segHourlyRate = computeHourlyRate(
        segBasicStipend,
        dailyHours,
        daysInMonth,
      );
      const segAmount = roundMoney(segOvertimeHours * segHourlyRate);

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
    await this.accessScopeService.assertEmployeeAccess(
      actingUser.id,
      actingUser.role,
      Permission.PAYROLL_MANAGE,
      dto.employeeId,
    );

    const preview = await this.getOvertimePreview(
      dto.employeeId,
      dto.month,
      dto.year,
    );

    if (preview.overtimeMinutes <= 0) {
      throw new BadRequestException(
        'No overtime hours recorded for this employee in the selected month',
      );
    }

    if (preview.amount <= 0) {
      throw new BadRequestException(
        'Calculated overtime amount is zero; check base stipend and duty hours',
      );
    }

    if (
      preview.payrollStatus === PayrollStatus.PROCESSED ||
      preview.payrollStatus === PayrollStatus.PAID
    ) {
      throw new BadRequestException(
        'Cannot apply overtime to a processed or paid payroll entry',
      );
    }

    // Ensures a PayrollEntry exists for every overlapping stipend segment
    // (createOrGetEntry creates/refreshes the active one AND upserts every
    // other overlapping segment as a side effect — see its doc comment),
    // not just the segment this call happens to be "about".
    const activeEntry = await this.createOrGetEntry(
      {
        employeeId: dto.employeeId,
        month: dto.month,
        year: dto.year,
      },
      actingUser,
    );

    const monthLabel = new Date(dto.year, dto.month - 1, 1).toLocaleString(
      'en-US',
      { month: 'long', year: 'numeric' },
    );

    const segmentEntries = await this.prisma.payrollEntry.findMany({
      where: {
        month: dto.month,
        year: dto.year,
        stipendRecordId: { in: preview.segments.map((s) => s.stipendRecordId) },
      },
      include: { allowances: true },
    });

    const updatedEntries: Array<
      Prisma.PayrollEntryGetPayload<{
        include: { deductions: true; allowances: true };
      }>
    > = [];

    for (const seg of preview.segments) {
      const segEntry = segmentEntries.find(
        (e) => e.stipendRecordId === seg.stipendRecordId,
      );
      if (!segEntry) continue; // no entry for this segment — nothing to apply to

      if (
        segEntry.status === PayrollStatus.PROCESSED ||
        segEntry.status === PayrollStatus.PAID
      ) {
        continue; // frozen — never overwritten, mirrors recomputeEmployeeMonth
      }

      const existingOtAllowance = segEntry.allowances.find(
        (a) => a.type === AllowanceType.OVERTIME,
      );

      // Nothing to apply and nothing to clear for this segment.
      if (seg.overtimeMinutes <= 0 && !existingOtAllowance) continue;

      const updated = await this.prisma.$transaction(async (tx) => {
        const current = await tx.payrollEntry.findUnique({
          where: { id: segEntry.id },
          include: { allowances: true },
        });
        if (!current) {
          throw new NotFoundException('Payroll entry not found');
        }

        const existingOt = current.allowances.find(
          (a) => a.type === AllowanceType.OVERTIME,
        );

        let totalAllowances = Number(current.totalAllowances);
        let netStipend = Number(current.netStipend);

        if (existingOt) {
          totalAllowances -= Number(existingOt.amount);
          netStipend -= Number(existingOt.amount);
          await tx.allowance.delete({ where: { id: existingOt.id } });
        }

        if (seg.overtimeMinutes > 0) {
          await tx.allowance.create({
            data: {
              payrollEntryId: segEntry.id,
              type: AllowanceType.OVERTIME,
              hours: seg.overtimeHours,
              amount: seg.amount,
              description: `Overtime ${seg.overtimeHours}h @ PKR ${seg.hourlyRate}/hr (${monthLabel})`,
            },
          });
          totalAllowances += seg.amount;
          netStipend += seg.amount;
        }

        // Applying OT for payroll also clears pending flags for this
        // segment's own date window only, never a sibling segment's dates.
        const { segmentStart, segmentEndExclusive, monthEnd } =
          this.resolveSegmentDateBounds(
            { effectiveFrom: seg.effectiveFrom, effectiveTo: seg.effectiveTo },
            dto.month,
            dto.year,
          );
        await tx.attendanceLog.updateMany({
          where: {
            employeeId: dto.employeeId,
            date: {
              gte: segmentStart,
              lte: monthEnd,
              ...(segmentEndExclusive ? { lt: segmentEndExclusive } : {}),
            },
            overtimeMinutes: { gt: 0 },
            overtimePending: true,
          },
          data: { overtimePending: false },
        });

        const updatedEntry = await tx.payrollEntry.update({
          where: { id: segEntry.id },
          data: {
            totalAllowances,
            netStipend,
          },
          include: { deductions: true, allowances: true },
        });

        await tx.auditLog.create({
          data: {
            userId: actingUser.id,
            action: 'PAYROLL_OVERTIME_APPLIED',
            entity: 'PayrollEntry',
            entityId: segEntry.id,
            changes: {
              employeeId: dto.employeeId,
              stipendRecordId: seg.stipendRecordId,
              month: dto.month,
              year: dto.year,
              overtimeHours: seg.overtimeHours,
              hourlyRate: seg.hourlyRate,
              amount: seg.amount,
              replaced: Boolean(existingOt),
            },
          },
        });

        return updatedEntry;
      });

      updatedEntries.push(updated);
    }

    const primary =
      updatedEntries.find((e) => e.id === activeEntry.id) ??
      updatedEntries[0] ??
      activeEntry;

    return {
      ...primary,
      overtime: preview,
      segments: updatedEntries,
    };
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

    const employee = entry.stipendRecord.employee;
    const breakdown = await this.computeHourlyBreakdown(
      entry.stipendRecord.employeeId,
      entry.month,
      entry.year,
      {
        stipendRecord: entry.stipendRecord,
        employee,
        existingDeductions: current.deductions ?? [],
        existingAllowances: current.allowances ?? [],
      },
    );

    const { monthStart, monthEnd } = this.pakistanMonthWindow(
      entry.year,
      entry.month,
    );

    const relieverSummary = await this.prisma.relieverSession.aggregate({
      where: {
        employeeId: entry.stipendRecord.employeeId,
        date: { gte: monthStart, lte: monthEnd },
      },
      _sum: { totalMinutes: true },
    });

    const totalRelieverMinutes = relieverSummary._sum.totalMinutes ?? 0;

    const presenceLogs = await this.prisma.attendanceLog.findMany({
      where: {
        employeeId: entry.stipendRecord.employeeId,
        type: AttendanceLogType.REGULAR,
        date: { gte: monthStart, lte: monthEnd },
        status: {
          in: [
            AttendanceStatus.PRESENT,
            AttendanceStatus.LATE,
            AttendanceStatus.HALF_DAY,
            AttendanceStatus.SHORT_LEAVE,
          ],
        },
      },
      select: { id: true, status: true },
    });

    const presenceDays = presenceLogs.reduce((sum, log) => {
      return sum + (log.status === AttendanceStatus.HALF_DAY ? 0.5 : 1);
    }, 0);

    const onLeaveLogs = await this.prisma.attendanceLog.findMany({
      where: {
        employeeId: entry.stipendRecord.employeeId,
        type: AttendanceLogType.REGULAR,
        status: AttendanceStatus.ON_LEAVE,
        date: { gte: monthStart, lte: monthEnd },
      },
      select: { date: true },
      orderBy: { date: 'asc' },
    });
    const leaveSplit = splitPaidUnpaidLeaveDays({
      onLeaveDates: onLeaveLogs.map((l) => l.date),
      monthlyAllowedLeaves: employee.monthlyAllowedLeaves,
    });

    const slip = this.buildPayslipSlipData({
      entry: current,
      stipendRecord: entry.stipendRecord,
      employee,
      presenceDays,
      leaveSplit,
    });

    return {
      ...current,
      totalRelieverHours: Math.round((totalRelieverMinutes / 60) * 100) / 100,
      hourlyBreakdown: breakdown,
      slip,
    };
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
    };

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

    for (const entry of entries) {
      let current = entry;
      if (entry.status === PayrollStatus.PENDING) {
        const refreshed = await this.createOrGetEntry({
          employeeId: entry.stipendRecord.employeeId,
          month,
          year,
        });
        current = {
          ...entry,
          ...refreshed,
          stipendRecord: entry.stipendRecord,
        };
      }

      const employee = entry.stipendRecord.employee;
      const { monthStart, monthEnd } = this.pakistanMonthWindow(year, month);

      const presenceLogs = await this.prisma.attendanceLog.findMany({
        where: {
          employeeId: entry.stipendRecord.employeeId,
          type: AttendanceLogType.REGULAR,
          date: { gte: monthStart, lte: monthEnd },
          status: {
            in: [
              AttendanceStatus.PRESENT,
              AttendanceStatus.LATE,
              AttendanceStatus.HALF_DAY,
              AttendanceStatus.SHORT_LEAVE,
            ],
          },
        },
        select: { status: true },
      });
      const presenceDays = presenceLogs.reduce(
        (sum, log) =>
          sum + (log.status === AttendanceStatus.HALF_DAY ? 0.5 : 1),
        0,
      );

      const onLeaveLogs = await this.prisma.attendanceLog.findMany({
        where: {
          employeeId: entry.stipendRecord.employeeId,
          type: AttendanceLogType.REGULAR,
          status: AttendanceStatus.ON_LEAVE,
          date: { gte: monthStart, lte: monthEnd },
        },
        select: { date: true },
        orderBy: { date: 'asc' },
      });
      const leaveSplit = splitPaidUnpaidLeaveDays({
        onLeaveDates: onLeaveLogs.map((l) => l.date),
        monthlyAllowedLeaves: employee.monthlyAllowedLeaves,
      });

      const slip = this.buildPayslipSlipData({
        entry: current,
        stipendRecord: entry.stipendRecord,
        employee,
        presenceDays,
        leaveSplit,
      });

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
      };
      existingDeductions: Array<{ amount: unknown }>;
      existingAllowances: Array<{ amount: unknown }>;
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
      /** Pakistan business date for diagnostics/tests; basic pay is always
       * derived from logged attendance only (no future-day credit). */
      asOf?: Date;
    },
  ): Promise<HourlyPayrollBreakdown> {
    const pkg = stipendRecordToPackage(context.stipendRecord);
    const daysInMonth = daysInPayrollMonth(year, month);
    // Used only for the monthly hourly-rate calc (computeHourlyRate below)
    // and the breakdown's headline "scheduled hours" figure — both are
    // current-state, forward-looking concepts (what does an hour cost
    // today), not a per-day historical fact. Crediting/worked-minutes
    // inside the loop below use each day's OWN resolved duty window
    // instead — see dayWin/dayDutyMinutes.
    //
    // NOTE: daysInMonth is deliberately the FULL calendar-day count of the
    // target month, never the segment's own day count — the daily-rate
    // denominator is a monthly-package concept (existing business policy),
    // unrelated to how many of those days this particular StipendRecord
    // happens to cover. Only the NUMERATOR (which AttendanceLog dates are
    // read at all) is segment-bounded, below.
    const dailyDutyHours = resolveDailyDutyHours(context.employee);

    // ── Stipend-segment date bounds ─────────────────────────────────────
    // A StipendRecord only ever earns basic pay for the dates on which it
    // was actually effective. Boundary semantics are established (not
    // guessed) from salaryIncrement(): the OLD record's effectiveTo and
    // the NEW record's effectiveFrom are set to the exact same Date value
    // — so this is a half-open interval [effectiveFrom, effectiveTo):
    // effectiveFrom is INCLUSIVE (the boundary date belongs to the record
    // that STARTS there — mirrors how a brand-new employee's very first
    // StipendRecord uses effectiveFrom: joiningDate, and that joining day
    // itself is a paid day), effectiveTo is EXCLUSIVE (the boundary date
    // does NOT belong to the record that ENDS there). This guarantees the
    // transition date is counted by exactly one segment — never both,
    // never neither. See resolveSegmentDateBounds — the same single
    // source of truth used by every segment-bounded child-row helper.
    const { segmentStart, segmentEndExclusive, monthEnd } =
      this.resolveSegmentDateBounds(context.stipendRecord, month, year, {
        joiningDate: context.employee.joiningDate,
        backfillFromJoining: context.backfillFromJoining,
        backfillFromAttendance: context.backfillFromAttendance,
      });

    const logs = await this.prisma.attendanceLog.findMany({
      where: {
        employeeId,
        type: AttendanceLogType.REGULAR,
        date: {
          gte: segmentStart,
          lte: monthEnd,
          ...(segmentEndExclusive ? { lt: segmentEndExclusive } : {}),
        },
      },
      select: {
        date: true,
        checkIn: true,
        checkOut: true,
        status: true,
        note: true,
        dutyStartTimeSnapshot: true,
        dutyEndTimeSnapshot: true,
      },
      orderBy: { date: 'asc' },
    });

    let workedMins = 0;
    let paidLeaveMins = 0;
    let policyCreditMins = 0;
    let creditedAttendanceDays = 0;

    for (const log of logs) {
      if (
        this.skipStatusTransitionPayrollDay(
          log.date,
          context.employee,
          context.backfillFromAttendance,
        )
      ) {
        continue;
      }

      // The duty that actually applied on THIS day — the row's own
      // snapshot when present, current employee duty only as a fallback
      // for legacy pre-snapshot rows (see the audit: there is no reliable
      // historical duty source for those). Resolved per day, never once
      // for the whole month, so a mid-month duty change cannot leak into
      // days on the other side of it.
      const dayDuty = resolveAttendanceDutyTimes(log, context.employee);
      const dayWin = getDutyWindow({
        dutyStartTime:
          dayDuty.dutyStartTime ?? context.employee.shift?.startTime,
        dutyEndTime: dayDuty.dutyEndTime ?? context.employee.shift?.endTime,
      });
      const dayDutyMinutes = Math.round(hoursFromDutyWindow(dayWin) * 60);

      if (log.status === AttendanceStatus.ON_LEAVE) {
        // Paid AND unpaid REGULAR leave days both earn full duty credit
        // here — an unpaid day loses its pay entirely through the explicit
        // UNPAID_LEAVE deduction (upsertUnpaidLeaveDeductionRow) instead.
        // Zeroing credit here too would double the loss: no credit here
        // AND a full day's deduction there for the same single day.
        policyCreditMins += dayDutyMinutes;
        creditedAttendanceDays += 1;
        continue;
      }

      const leaveMins = leaveCreditMinutes(
        log.status,
        log.note,
        dayDutyMinutes,
      );
      if (leaveMins > 0) {
        // SHORT leave — does not consume monthly allowance
        paidLeaveMins += leaveMins;
        creditedAttendanceDays += 1;
        continue;
      }

      if (
        log.status === AttendanceStatus.ABSENT ||
        log.status === AttendanceStatus.UNINFORMED_ABSENT
      ) {
        // The explicit 2-day PayrollDeduction (applyAbsentDeduction /
        // applyUninformedAbsentDeduction) is the sole intended penalty for
        // these statuses. Also zeroing this day's credit would silently
        // add a 3rd day of loss on top of the approved 2-day policy.
        policyCreditMins += dayDutyMinutes;
        creditedAttendanceDays += 1;
        continue;
      }

      if (log.status === AttendanceStatus.LATE) {
        // Lateness (any occurrence) earns full scheduled-day credit.
        // Phase 1C's late-occurrence cycle (Advice/Warning/Fine only at
        // the 3rd/6th occurrence, Suspension at the 9th) is the sole
        // extra monetary consequence — not a daily pro-rata of the gap.
        policyCreditMins += dayDutyMinutes;
        creditedAttendanceDays += 1;
        continue;
      }

      if (log.status === AttendanceStatus.HALF_DAY) {
        // Pay cut is the HALF_DAY PayrollDeduction (0.5 day), not a
        // reduced policy-credit floor — otherwise the same half-day would
        // be taken twice: once from basic and again on the deductions tab.
        policyCreditMins += dayDutyMinutes;
        creditedAttendanceDays += 1;
        continue;
      }

      if (log.status === AttendanceStatus.UNMARKED) {
        // Elapsed unmarked days stay in basic; the 1-day unmarked
        // deduction is the visible penalty. Future days have no log.
        policyCreditMins += dayDutyMinutes;
        creditedAttendanceDays += 1;
        continue;
      }

      if (log.status === AttendanceStatus.SHORT_LEAVE) {
        // HR-approved retroactive Short Leave (distinct from the
        // LeaveType.SHORT_LEAVE request workflow handled by
        // leaveCreditMinutes above) earns full scheduled-day credit, same
        // as every other policy-approved deviation status here — the
        // employee actually worked the rest of the shift; the covered gap
        // is not a pay deduction, it only consumes the monthly Short Leave
        // quota (enforced at write time in attendance.service.ts).
        policyCreditMins += dayDutyMinutes;
        creditedAttendanceDays += 1;
        continue;
      }

      if (
        log.status === AttendanceStatus.PRESENT ||
        log.status === AttendanceStatus.SWAP_COVERED
      ) {
        // A day the employee actually attended (or covered via swap) earns
        // full scheduled-day basic credit, same floor as every other
        // status handled above — basic earning must never depend on the
        // literal checkIn/checkOut gap, which can be short, window-trimmed,
        // or (via workedMinutes' anomalous-session guard) silently zero for
        // reasons unrelated to whether the employee actually worked the
        // day. `continue` here deliberately skips the raw-overlap
        // workedMins block below so PRESENT/SWAP_COVERED never receive
        // BOTH this floor AND clock-derived minutes for the same
        // scheduled period — one scheduled day of basic pay, not more.
        // Any genuine overtime/extra-hours credit is a separate, additive
        // concept (see computeRelieverPayableMinutes / extraAllowances)
        // and is untouched by this floor.
        policyCreditMins += dayDutyMinutes;
        creditedAttendanceDays += 1;
        continue;
      }

      if (log.checkIn && !log.checkOut) {
        // Missing checkout (Phase 1D) or a 24-hour employee's structurally
        // checkout-less row (biometric checkout is intentionally never
        // recorded for 24h staff). Phase 1D's fine cycle (occurrence
        // 3/6/9 only) is the sole monetary consequence for a genuine
        // missing checkout; zeroing this day's credit purely because
        // checkOut is absent would both defeat that policy and
        // permanently zero-pay 24-hour staff.
        policyCreditMins += dayDutyMinutes;
        creditedAttendanceDays += 1;
        continue;
      }

      // Reached only by statuses with no policy-credit branch above (e.g.
      // HOLIDAY, UNMARKED) that nonetheless have a checkIn/checkOut pair —
      // PRESENT and SWAP_COVERED never reach here, see above.
      if (log.checkIn && log.checkOut) {
        const { minutes, anomalous } = payableMinutesWithinDutyWindow(
          log.checkIn,
          log.checkOut,
          dayWin,
        );
        if (!anomalous) workedMins += minutes;
      }
    }

    const applyPackageDeductions = context.applyContractualPackage !== false;
    // Fixed monthly allowances (and reward/fuel) are added on the active
    // salary only. OT and attendance deductions stay on Basic. A late
    // stipend.effectiveFrom must not shrink this package — only joining /
    // exit dates do. Closed increment segments get 0 so the amount is not
    // counted twice.
    const monthlyFixedAllowances =
      (pkg.allowances || 0) +
      (pkg.reward || 0) +
      (pkg.progressReward || 0) +
      (pkg.fuelAllowance || 0);
    const employmentEndExclusive =
      context.employee.status &&
      isExitEmployeeStatus(context.employee.status) &&
      context.employee.statusEffectiveFrom
        ? context.employee.statusEffectiveFrom
        : null;
    // Contractual Basic bounds use stipend effectiveFrom/To, except the
    // oldest/only open package (backfillContractualFromEmployment), which
    // starts at month-start/joining so a late package date does not wipe
    // earlier days. Mid-month increment NEW segments must not get that flag.
    const { monthStart: contractualMonthStart } = this.pakistanMonthWindow(
      year,
      month,
    );
    let contractualSegmentStart =
      context.stipendRecord.effectiveFrom.getTime() >
      contractualMonthStart.getTime()
        ? context.stipendRecord.effectiveFrom
        : contractualMonthStart;
    if (context.backfillContractualFromEmployment) {
      contractualSegmentStart = contractualMonthStart;
    }
    const contractualSegmentEndExclusive =
      context.stipendRecord.effectiveTo ?? null;
    const fixedAllowances = applyPackageDeductions
      ? prorateMonthlyPackageAmount({
          monthlyAmount: monthlyFixedAllowances,
          year,
          month,
          segmentStart: contractualMonthStart,
          segmentEndExclusive: null,
          monthEnd,
          employmentStart: context.backfillFromAttendance
            ? null
            : context.employee.joiningDate,
          employmentEndExclusive,
        })
      : 0;
    // Fixed monthly package deductions (health/loan/advance/fine) apply once
    // per employee/month on the package-bearing segment only.
    const fixedPackageDeductions = applyPackageDeductions
      ? (pkg.loanDeduction || 0) +
        (pkg.advanceDeduction || 0) +
        (pkg.fineDeduction || 0) +
        (pkg.healthDeduction || 0)
      : 0;
    const disciplineDeductions = context.existingDeductions.reduce(
      (sum, d) => sum + Number(d.amount),
      0,
    );
    const extraAllowances = context.existingAllowances.reduce(
      (sum, a) => sum + Number(a.amount),
      0,
    );

    // Final policy: Basic is contractual calendar proration only — attendance
    // never shrinks Basic. Attendance consequences live under deductions.
    const payrollBasicStipend = prorateContractualBasicForPayrollSegment({
      contractualBasic: pkg.basicStipend,
      year,
      month,
      segmentStart: contractualSegmentStart,
      segmentEndExclusive: contractualSegmentEndExclusive,
      monthEnd,
      employmentStart: context.backfillFromAttendance
        ? null
        : context.employee.joiningDate,
      employmentEndExclusive,
    });

    return buildHourlyPayrollBreakdown({
      contractualBasicStipend: pkg.basicStipend,
      dailyDutyHours,
      daysInMonth,
      workedMinutes: workedMins,
      paidLeaveMinutes: paidLeaveMins,
      policyCreditMinutes: policyCreditMins,
      creditedAttendanceDays,
      fixedAllowances,
      fixedPackageDeductions,
      disciplineDeductions,
      extraAllowances,
      payrollBasicStipend,
    });
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

    return this.prisma.payrollEntry.findMany({
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

    return entry;
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
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: {
        stipendRecords: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    const activeStipendRecord = employee.stipendRecords[0];
    if (!activeStipendRecord) {
      throw new NotFoundException(
        `No active stipend record found for employee ${dto.employeeId}`,
      );
    }

    const effectiveFrom = new Date(dto.effectiveFrom);
    const previousSalary = Number(activeStipendRecord.basicStipend);
    const lumpsumTotal = calculateLumpsumTotal({
      basicStipend: dto.basicStipend,
      allowances: dto.allowances,
      reward: dto.reward,
      progressReward: dto.progressReward,
      fuelAllowance: dto.fuelAllowance,
      loanDeduction: dto.loanDeduction,
      advanceDeduction: dto.advanceDeduction,
      fineDeduction: dto.fineDeduction,
      healthDeduction: dto.healthDeduction,
    });

    return this.prisma.$transaction(async (tx) => {
      await tx.stipendRecord.update({
        where: { id: activeStipendRecord.id },
        data: { effectiveTo: effectiveFrom },
      });

      const newRecord = await tx.stipendRecord.create({
        data: {
          employeeId: dto.employeeId,
          basicStipend: dto.basicStipend,
          allowances: dto.allowances ?? 0,
          reward: dto.reward ?? 0,
          progressReward: dto.progressReward ?? 0,
          fuelAllowance: dto.fuelAllowance ?? 0,
          loanDeduction: dto.loanDeduction ?? 0,
          advanceDeduction: dto.advanceDeduction ?? 0,
          fineDeduction: dto.fineDeduction ?? 0,
          healthDeduction: dto.healthDeduction ?? 0,
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
            reason: dto.reason,
          },
        },
      });

      return newRecord;
    });
  }

  /**
   * Correct the currently-open stipend amounts without opening a new
   * package. Edit Payroll must use this for ordinary corrections so a
   * save does not start a mid-month increment from "today".
   */
  async updateActiveStipend(dto: UpdateActiveStipendDto, actingUserId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: {
        stipendRecords: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    const activeStipendRecord = employee.stipendRecords[0];
    if (!activeStipendRecord) {
      throw new NotFoundException(
        `No active stipend record found for employee ${dto.employeeId}`,
      );
    }

    const lumpsumTotal = calculateLumpsumTotal({
      basicStipend: dto.basicStipend,
      allowances: dto.allowances,
      reward: dto.reward,
      progressReward: dto.progressReward,
      fuelAllowance: dto.fuelAllowance,
      loanDeduction: dto.loanDeduction,
      advanceDeduction: dto.advanceDeduction,
      fineDeduction: dto.fineDeduction,
      healthDeduction: dto.healthDeduction,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.stipendRecord.update({
        where: { id: activeStipendRecord.id },
        data: {
          basicStipend: dto.basicStipend,
          allowances: dto.allowances ?? 0,
          reward: dto.reward ?? 0,
          progressReward: dto.progressReward ?? 0,
          fuelAllowance: dto.fuelAllowance ?? 0,
          loanDeduction: dto.loanDeduction ?? 0,
          advanceDeduction: dto.advanceDeduction ?? 0,
          fineDeduction: dto.fineDeduction ?? 0,
          healthDeduction: dto.healthDeduction ?? 0,
          lumpsumTotal,
        },
      });

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
            reason: dto.reason?.trim() || null,
            effectiveFromUnchanged: activeStipendRecord.effectiveFrom,
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
