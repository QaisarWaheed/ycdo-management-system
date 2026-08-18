import {
  calculateLumpsumTotal,
  daysInPayrollMonth,
  stipendRecordToPackage,
} from '../../common/stipend.util';
import {
  getDutyWindow,
  resolveAttendanceDutyTimes,
} from '../../common/duty.util';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AllowanceType,
  AttendanceLogType,
  AttendanceStatus,
  DeductionType,
  EmployeeStatus,
  Permission,
  PayrollStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScopeService } from '../permissions/access-scope.service';
import {
  AddDeductionDto,
  AddAllowanceDto,
  ApplyOvertimeDto,
  CreatePayrollEntryDto,
  PayrollQueryDto,
  SalaryIncrementDto,
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
  hoursFromDutyWindow,
  leaveCreditMinutes,
  payableMinutesWithinDutyWindow,
  resolveDailyDutyHours,
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
        stipendRecords: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
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

    const activeStipendRecord = employee.stipendRecords[0];
    if (!activeStipendRecord) {
      throw new NotFoundException(
        `No active stipend record found for employee ${dto.employeeId}`,
      );
    }

    const existing = await this.prisma.payrollEntry.findUnique({
      where: {
        stipendRecordId_month_year: {
          stipendRecordId: activeStipendRecord.id,
          month: dto.month,
          year: dto.year,
        },
      },
      include: { deductions: true, allowances: true },
    });

    if (
      existing &&
      (existing.status === PayrollStatus.PROCESSED ||
        existing.status === PayrollStatus.PAID)
    ) {
      return existing;
    }

    const markForced =
      forceNonActive && !defaultEligible
        ? true
        : existing?.forcedNonActive === true;

    if (forceNonActive && !defaultEligible && actingUser?.id) {
      await this.prisma.auditLog.create({
        data: {
          userId: actingUser.id,
          action: 'PAYROLL_ENTRY_FORCED',
          entity: 'PayrollEntry',
          entityId: existing?.id ?? dto.employeeId,
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

    const contractualBasic = Number(activeStipendRecord.basicStipend);

    if (existing) {
      await this.upsertAdditionalWorkingDaysAllowanceRow(
        existing.id,
        dto.employeeId,
        dto.month,
        dto.year,
        employee,
        contractualBasic,
      );
      await this.upsertUnpaidLeaveDeductionRow(
        existing.id,
        dto.employeeId,
        dto.month,
        dto.year,
        employee.monthlyAllowedLeaves,
        contractualBasic,
      );
      await this.upsertRelieverAllowanceRow(
        existing.id,
        dto.employeeId,
        dto.month,
        dto.year,
        employee,
        contractualBasic,
      );
      const refreshed = await this.prisma.payrollEntry.findUnique({
        where: { id: existing.id },
        include: { deductions: true, allowances: true },
      });
      const breakdown = await this.computeHourlyBreakdown(
        dto.employeeId,
        dto.month,
        dto.year,
        {
          stipendRecord: activeStipendRecord,
          employee,
          existingDeductions: refreshed?.deductions ?? [],
          existingAllowances: refreshed?.allowances ?? [],
        },
      );
      const totals = this.clampPayrollTotals(breakdown);
      return this.prisma.payrollEntry.update({
        where: { id: existing.id },
        data: {
          ...totals,
          forcedNonActive: markForced,
        },
        include: { deductions: true, allowances: true },
      });
    }

    const breakdown = await this.computeHourlyBreakdown(
      dto.employeeId,
      dto.month,
      dto.year,
      {
        stipendRecord: activeStipendRecord,
        employee,
        existingDeductions: [],
        existingAllowances: [],
      },
    );

    const createdTotals = this.clampPayrollTotals(breakdown);
    const created = await this.prisma.payrollEntry.create({
      data: {
        stipendRecordId: activeStipendRecord.id,
        month: dto.month,
        year: dto.year,
        ...createdTotals,
        forcedNonActive: markForced,
        status: PayrollStatus.PENDING,
      },
      include: { deductions: true, allowances: true },
    });

    await this.upsertAdditionalWorkingDaysAllowanceRow(
      created.id,
      dto.employeeId,
      dto.month,
      dto.year,
      employee,
      contractualBasic,
    );
    await this.upsertUnpaidLeaveDeductionRow(
      created.id,
      dto.employeeId,
      dto.month,
      dto.year,
      employee.monthlyAllowedLeaves,
      contractualBasic,
    );
    await this.upsertRelieverAllowanceRow(
      created.id,
      dto.employeeId,
      dto.month,
      dto.year,
      employee,
      contractualBasic,
    );

    const refreshed = await this.prisma.payrollEntry.findUnique({
      where: { id: created.id },
      include: { deductions: true, allowances: true },
    });
    const withAwd = await this.computeHourlyBreakdown(
      dto.employeeId,
      dto.month,
      dto.year,
      {
        stipendRecord: activeStipendRecord,
        employee,
        existingDeductions: refreshed?.deductions ?? [],
        existingAllowances: refreshed?.allowances ?? [],
      },
    );

    const finalTotals = this.clampPayrollTotals(withAwd);
    return this.prisma.payrollEntry.update({
      where: { id: created.id },
      data: {
        ...finalTotals,
        forcedNonActive: markForced,
      },
      include: { deductions: true, allowances: true },
    });
  }

  /** Persist non-negative deduction/allowance totals; recompute net from parts. */
  private clampPayrollTotals(breakdown: HourlyPayrollBreakdown) {
    const basicStipend = roundMoney(Math.max(0, breakdown.hourlyBasicEarned));
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
      netStipend: roundMoney(basicStipend + totalAllowances - totalDeductions),
    };
  }

  /** Upserts or removes ADDITIONAL_WORKING_DAYS allowance row only (totals recalculated by caller). */
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
  ) {
    const daysInMonth = daysInPayrollMonth(year, month);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
    const dayRows = await this.prisma.additionalWorkingDay.findMany({
      where: {
        employeeId,
        date: { gte: monthStart, lte: monthEnd },
      },
      select: { note: true },
    });
    const dayCount = dayRows.length;
    const extraDutyCount = dayRows.filter((d) =>
      (d.note ?? '').toLowerCase().includes('extra duty'),
    ).length;

    const dailyHours = resolveDailyDutyHours(employee);
    const hourlyRate = computeHourlyRate(
      contractualBasic,
      dailyHours,
      daysInMonth,
    );
    const hours = roundMoney(dayCount * dailyHours);
    const amount = roundMoney(hours * hourlyRate);

    const existing = await this.prisma.allowance.findFirst({
      where: {
        payrollEntryId,
        type: AllowanceType.ADDITIONAL_WORKING_DAYS,
      },
    });

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
    const label =
      extraDutyCount > 0 && extraDutyCount === dayCount
        ? 'Extra Duty / Reliever'
        : extraDutyCount > 0
          ? `Additional working days (${extraDutyCount} Extra Duty)`
          : 'Additional working days';
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

  private async upsertUnpaidLeaveDeductionRow(
    payrollEntryId: string,
    employeeId: string,
    month: number,
    year: number,
    monthlyAllowedLeaves: number | null | undefined,
    contractualBasic: number,
  ) {
    const daysInMonth = daysInPayrollMonth(year, month);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

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

    const split = splitPaidUnpaidLeaveDays({
      onLeaveDates: onLeaveLogs.map((l) => l.date),
      monthlyAllowedLeaves,
    });
    const amount = unpaidLeaveDeductionAmount(
      split.unpaidLeaveDays,
      contractualBasic,
      daysInMonth,
    );

    const existing = await this.prisma.payrollDeduction.findFirst({
      where: {
        payrollEntryId,
        reason: DeductionType.UNPAID_LEAVE,
      },
    });

    if (split.unpaidLeaveDays <= 0 || amount <= 0) {
      if (existing) {
        await this.prisma.payrollDeduction.delete({ where: { id: existing.id } });
      }
      return;
    }

    const description = `${UNPAID_LEAVE_DESC_PREFIX} (${split.unpaidLeaveDays} day(s) beyond allowance of ${monthlyAllowedLeaves ?? DEFAULT_MONTHLY_ALLOWED_LEAVES})`;

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
  ) {
    const daysInMonth = daysInPayrollMonth(year, month);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

    const sessions = await this.prisma.relieverSession.findMany({
      where: {
        employeeId,
        date: { gte: monthStart, lte: monthEnd },
        checkOut: { not: null },
      },
    });

    // Own-duty overlap must reflect what this employee's OWN duty actually
    // was on each session's date, not their current duty — RelieverSession
    // itself carries no snapshot, so the employee's own REGULAR
    // AttendanceLog for that same date is the next best historical source.
    // A date with no such row at all (e.g. the reliever's own attendance
    // was never marked that day) falls back to current duty — the same
    // last-resort fallback resolveAttendanceDutyTimes uses everywhere else.
    const ownAttendanceLogs = sessions.length
      ? await this.prisma.attendanceLog.findMany({
          where: {
            employeeId,
            type: AttendanceLogType.REGULAR,
            date: { in: sessions.map((s) => s.date) },
          },
          select: {
            date: true,
            dutyStartTimeSnapshot: true,
            dutyEndTimeSnapshot: true,
          },
        })
      : [];
    const ownDutyByDate = new Map(
      ownAttendanceLogs.map((l) => [l.date.toISOString().slice(0, 10), l]),
    );

    const totalPayableMinutes = sessions.reduce((sum, s) => {
      if (!s.checkOut) return sum;
      const ownLogForDate = ownDutyByDate.get(
        s.date.toISOString().slice(0, 10),
      );
      const dayDuty = resolveAttendanceDutyTimes(ownLogForDate, employee);
      return (
        sum +
        computeRelieverPayableMinutes(
          {
            relieverOnly: employee.relieverOnly,
            dutyStartTime: dayDuty.dutyStartTime,
            dutyEndTime: dayDuty.dutyEndTime,
          },
          {
            checkIn: s.checkIn,
            checkOut: s.checkOut,
            totalMinutes: s.totalMinutes,
          },
        )
      );
    }, 0);

    const dailyHours = resolveDailyDutyHours(employee);
    const hourlyRate = computeHourlyRate(
      contractualBasic,
      dailyHours,
      daysInMonth,
    );
    const hours = roundMoney(totalPayableMinutes / 60);
    const amount = roundMoney(hours * hourlyRate);

    const existing = await this.prisma.allowance.findFirst({
      where: { payrollEntryId, type: AllowanceType.RELIEVER },
    });

    if (totalPayableMinutes <= 0 || amount <= 0) {
      if (existing) {
        await this.prisma.allowance.delete({ where: { id: existing.id } });
      }
      return;
    }

    const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });
    const description = `Reliever extra duty: ${sessions.length} session(s), ${hours}h payable @ PKR ${hourlyRate}/hr (${monthLabel})`;

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

    await this.prisma.allowance.create({
      data: {
        payrollEntryId: dto.payrollEntryId,
        type: dto.type,
        description: dto.description,
        amount: dto.amount,
        hours: dto.hours,
      },
    });

    return this.prisma.payrollEntry.update({
      where: { id: dto.payrollEntryId },
      data: {
        totalAllowances: Number(entry.totalAllowances) + dto.amount,
        netStipend: Number(entry.netStipend) + dto.amount,
      },
      include: { deductions: true, allowances: true },
    });
  }

  /**
   * Hourly rate = basicStipend / (daily duty hours × days in month).
   * Overtime pay = recorded OT hours × hourly rate.
   */
  async getOvertimePreview(employeeId: string, month: number, year: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        stipendRecords: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        shift: { select: { startTime: true, endTime: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id ${employeeId} not found`);
    }

    const stipend = employee.stipendRecords[0];
    if (!stipend) {
      throw new BadRequestException(
        'No active stipend record found for this employee',
      );
    }

    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
    const daysInMonth = daysInPayrollMonth(year, month);

    const [otAgg, pendingAgg] = await Promise.all([
      this.prisma.attendanceLog.aggregate({
        where: {
          employeeId,
          date: { gte: monthStart, lte: monthEnd },
          overtimeMinutes: { gt: 0 },
        },
        _sum: { overtimeMinutes: true },
      }),
      this.prisma.attendanceLog.aggregate({
        where: {
          employeeId,
          date: { gte: monthStart, lte: monthEnd },
          overtimeMinutes: { gt: 0 },
          overtimePending: true,
        },
        _sum: { overtimeMinutes: true },
      }),
    ]);

    // Include all recorded OT for this month (pending + approved).
    // Clicking Apply Overtime is the HR approval step for payroll.
    const overtimeMinutes = otAgg._sum.overtimeMinutes ?? 0;
    const pendingOvertimeMinutes = pendingAgg._sum.overtimeMinutes ?? 0;
    const overtimeHours = Math.round((overtimeMinutes / 60) * 100) / 100;

    const dailyHours = resolveDailyDutyHours(employee);
    const monthlyWorkingHours = dailyHours * daysInMonth;
    const basicStipend = Number(stipend.basicStipend);
    const hourlyRate = computeHourlyRate(basicStipend, dailyHours, daysInMonth);
    const amount = roundMoney(overtimeHours * hourlyRate);

    const existingEntry = await this.prisma.payrollEntry.findFirst({
      where: {
        month,
        year,
        stipendRecord: { employeeId },
      },
      include: {
        allowances: {
          where: { type: AllowanceType.OVERTIME },
        },
      },
    });

    const existingOvertime = existingEntry?.allowances[0] ?? null;

    return {
      employeeId,
      month,
      year,
      basicStipend,
      dailyHours,
      daysInMonth,
      monthlyWorkingHours,
      overtimeMinutes,
      pendingOvertimeMinutes,
      overtimeHours,
      hourlyRate,
      amount,
      alreadyApplied: Boolean(existingOvertime),
      existingAmount: existingOvertime ? Number(existingOvertime.amount) : null,
      payrollEntryId: existingEntry?.id ?? null,
      payrollStatus: existingEntry?.status ?? null,
    };
  }

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

    const entry = await this.createOrGetEntry(
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

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.payrollEntry.findUnique({
        where: { id: entry.id },
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

      await tx.allowance.create({
        data: {
          payrollEntryId: entry.id,
          type: AllowanceType.OVERTIME,
          hours: preview.overtimeHours,
          amount: preview.amount,
          description: `Overtime ${preview.overtimeHours}h @ PKR ${preview.hourlyRate}/hr (${monthLabel})`,
        },
      });

      // Applying OT for payroll also clears pending flags for the month.
      const monthStart = new Date(dto.year, dto.month - 1, 1);
      const monthEnd = new Date(dto.year, dto.month, 0, 23, 59, 59, 999);
      await tx.attendanceLog.updateMany({
        where: {
          employeeId: dto.employeeId,
          date: { gte: monthStart, lte: monthEnd },
          overtimeMinutes: { gt: 0 },
          overtimePending: true,
        },
        data: { overtimePending: false },
      });

      totalAllowances += preview.amount;
      netStipend += preview.amount;

      const updated = await tx.payrollEntry.update({
        where: { id: entry.id },
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
          entityId: entry.id,
          changes: {
            employeeId: dto.employeeId,
            month: dto.month,
            year: dto.year,
            overtimeHours: preview.overtimeHours,
            hourlyRate: preview.hourlyRate,
            amount: preview.amount,
            replaced: Boolean(existingOt),
          },
        },
      });

      return {
        ...updated,
        overtime: preview,
      };
    });
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

    const monthStart = new Date(entry.year, entry.month - 1, 1);
    const monthEnd = new Date(entry.year, entry.month, 0);

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
      deductions?: Array<{ reason: DeductionType; amount: unknown }>;
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
          d.reason === DeductionType.UNPAID_LEAVE,
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
      .filter((a) => a.type === AllowanceType.ADDITIONAL_WORKING_DAYS)
      .reduce((sum, a) => sum + Number(a.amount), 0);
    const overtimeAmount = allowances
      .filter((a) => a.type === AllowanceType.OVERTIME)
      .reduce((sum, a) => sum + Number(a.amount), 0);
    const otherExtraAllowances = allowances
      .filter(
        (a) =>
          a.type !== AllowanceType.ADDITIONAL_WORKING_DAYS &&
          a.type !== AllowanceType.OVERTIME,
      )
      .reduce((sum, a) => sum + Number(a.amount), 0);

    const dailyDutyHours = resolveDailyDutyHours(employee);
    const totalDays = new Date(entry.year, entry.month, 0).getDate();
    const payPeriod = new Date(entry.year, entry.month - 1, 1).toLocaleString(
      'en-US',
      { month: 'long', year: 'numeric' },
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
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

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
      };
      employee: {
        dutyTotalHours?: number | null;
        dutyStartTime?: string | null;
        dutyEndTime?: string | null;
        monthlyAllowedLeaves?: number | null;
        shift?: { startTime: string; endTime: string } | null;
      };
      existingDeductions: Array<{ amount: unknown }>;
      existingAllowances: Array<{ amount: unknown }>;
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
    const dailyDutyHours = resolveDailyDutyHours(context.employee);

    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

    const logs = await this.prisma.attendanceLog.findMany({
      where: {
        employeeId,
        type: AttendanceLogType.REGULAR,
        date: { gte: monthStart, lte: monthEnd },
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

    for (const log of logs) {
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
        continue;
      }

      if (
        log.status === AttendanceStatus.LATE ||
        log.status === AttendanceStatus.HALF_DAY
      ) {
        // Lateness (any occurrence) and lateness-driven HALF_DAY earn full
        // scheduled-day credit. Phase 1C's late-occurrence cycle (Advice/
        // Warning/Fine only at the 3rd/6th occurrence, Suspension at the
        // 9th) is the sole monetary consequence for lateness — prorating
        // basic pay by the actual late-arrival gap on every occurrence
        // contradicted the explicit "no deduction on 1st/2nd/4th/5th/7th/
        // 8th" policy.
        policyCreditMins += dayDutyMinutes;
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
        continue;
      }

      if (log.checkIn && log.checkOut) {
        const { minutes, anomalous } = payableMinutesWithinDutyWindow(
          log.checkIn,
          log.checkOut,
          dayWin,
        );
        if (!anomalous) workedMins += minutes;
      }
    }

    const fixedAllowances =
      (pkg.allowances || 0) +
      (pkg.reward || 0) +
      (pkg.progressReward || 0) +
      (pkg.fuelAllowance || 0);
    const fixedPackageDeductions =
      (pkg.loanDeduction || 0) +
      (pkg.advanceDeduction || 0) +
      (pkg.fineDeduction || 0) +
      (pkg.healthDeduction || 0);
    const disciplineDeductions = context.existingDeductions.reduce(
      (sum, d) => sum + Number(d.amount),
      0,
    );
    const extraAllowances = context.existingAllowances.reduce(
      (sum, a) => sum + Number(a.amount),
      0,
    );

    return buildHourlyPayrollBreakdown({
      contractualBasicStipend: pkg.basicStipend,
      dailyDutyHours,
      daysInMonth,
      workedMinutes: workedMins,
      paidLeaveMinutes: paidLeaveMins,
      policyCreditMinutes: policyCreditMins,
      fixedAllowances,
      fixedPackageDeductions,
      disciplineDeductions,
      extraAllowances,
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

    return this.prisma.payrollEntry.findMany({
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
    });
  }

  async getMonthlyPayrollSummary(
    month: number,
    year: number,
    branchId?: string,
    fromDate?: string,
    toDate?: string,
  ) {
    const daysInMonth = daysInPayrollMonth(year, month);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);

    let periodDays = daysInMonth;
    if (fromDate || toDate) {
      if (!fromDate || !toDate) {
        throw new BadRequestException(
          'Both fromDate and toDate are required together',
        );
      }
      const from = new Date(`${fromDate}T00:00:00`);
      const to = new Date(`${toDate}T00:00:00`);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new BadRequestException('fromDate and toDate must be YYYY-MM-DD');
      }
      if (to < from) {
        throw new BadRequestException('toDate must be on or after fromDate');
      }
      if (
        from.getFullYear() !== year ||
        from.getMonth() + 1 !== month ||
        to.getFullYear() !== year ||
        to.getMonth() + 1 !== month
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

    return {
      month,
      year,
      totalEmployees: entries.length,
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
