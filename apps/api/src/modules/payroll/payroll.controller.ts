import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { PayrollStatus } from '@prisma/client';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Permission, UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  AlsoAllowPermission,
  Roles,
  RoutePermission,
  StrictRoles,
} from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AddDeductionDto,
  AddDeductionsDto,
  UpdateDeductionDto,
  PayslipBatchDto,
  AddAllowanceDto,
  ApplyOvertimeDto,
  CreatePayrollEntryDto,
  PayrollQueryDto,
  RecomputeMonthAllDto,
  RebuildPayrollDto,
  ResetUnpaidPayrollDto,
  SalaryIncrementDto,
  UpdateActiveStipendDto,
  UpdatePayrollStatusDto,
} from './payroll.dto';
import { PayrollService } from './payroll.service';
import { PayChangeKind } from '@prisma/client';
import {
  isPayExecutive,
  PayChangeRequestsService,
  type PayActor,
} from '../pay-approvals/pay-change-requests.service';

const PAYROLL_READ_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_EXECUTIVE,
  UserRole.IT_ADMIN,
  UserRole.CHAIRMAN,
  UserRole.FOUNDER,
  UserRole.PRESIDENT,
];

const PAYROLL_WRITE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.IT_ADMIN,
];

/**
 * Pay-increasing changes: HR / IT / Accounts send them for executive approval;
 * executives (and Super Admin) apply them directly.
 */
const PAY_CHANGE_ROLES = [
  UserRole.PAYROLL_OFFICER,
  UserRole.PRESIDENT,
  UserRole.FOUNDER,
  UserRole.CHAIRMAN,
  UserRole.SUPER_ADMIN,
];

const OVERTIME_APPLY_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_EXECUTIVE,
];

class ItemizedReportQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @Type(() => Number)
  @IsInt()
  @Min(2020)
  year: number;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  designation?: string;
}

class FinalizeBranchMonthDto {
  @IsUUID()
  branchId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @Type(() => Number)
  @IsInt()
  @Min(2020)
  year: number;

  @IsEnum(PayrollStatus)
  status: PayrollStatus;
}

@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayrollController {
  constructor(
    private payrollService: PayrollService,
    private payChangeRequests: PayChangeRequestsService,
  ) {}
  @Post('entries')
  @Roles(...PAYROLL_WRITE_ROLES)
  @RoutePermission(Permission.PAYROLL_MANAGE)
  createOrGetEntry(
    @Body() dto: CreatePayrollEntryDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.payrollService.createOrGetEntry(dto, user);
  }

  /**
   * Explicit multi-segment recompute for one employee/month — refreshes
   * every overlapping PENDING StipendRecord segment's PayrollEntry
   * (skipping PROCESSED/PAID), reporting which segments have no entry yet
   * at all. Does not create new entries — use POST /payroll/entries for
   * that. See PayrollService.recomputeEmployeeMonth.
   */
  @Post('recompute-month')
  @Roles(...PAYROLL_WRITE_ROLES)
  @RoutePermission(Permission.PAYROLL_MANAGE)
  recomputeEmployeeMonth(
    @Body() dto: ApplyOvertimeDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.payrollService.recomputeEmployeeMonth(dto, user);
  }

  /**
   * Bulk, generic-by-month/year recompute for EXISTING stale payroll data
   * (built for the August 2026 cleanup after Steps 1-6). Batched at the
   * unique-employee level via optional `limit` (default 25, max 50) /
   * `offset` against a deterministic ordering, so a large month can be
   * walked in several short requests instead of one that risks a 504 —
   * page with the previous response's `nextOffset` until `hasMore` is
   * false. Never called automatically — no cron, no bootstrap hook, this
   * route is the only entry point. See PayrollService.recomputeMonthAll
   * for the full safety contract: employee-level (not row-level)
   * processing, PROCESSED/PAID always frozen, no new PayrollEntry ever
   * created, strictly sequential, one employee's failure never aborts the
   * batch, and mutation requires `confirm: "RECOMPUTE_PENDING_PAYROLL"`
   * unless `dryRun: true`.
   */
  @Post('recompute-month-all')
  @Roles(...PAYROLL_WRITE_ROLES)
  @RoutePermission(Permission.PAYROLL_MANAGE)
  recomputeMonthAll(
    @Body() dto: RecomputeMonthAllDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.payrollService.recomputeMonthAll(dto, user);
  }

  @Post('reset-unpaid')
  @Roles(...PAYROLL_WRITE_ROLES)
  @RoutePermission(Permission.PAYROLL_MANAGE)
  resetUnpaidPayroll(
    @Body() dto: ResetUnpaidPayrollDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.payrollService.resetUnpaidPayroll(dto, user);
  }

  @Post('rebuild-from-attendance')
  @Roles(...PAYROLL_WRITE_ROLES)
  @RoutePermission(Permission.PAYROLL_MANAGE)
  rebuildPayrollFromAttendanceAndLetters(
    @Body() dto: RebuildPayrollDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.payrollService.rebuildPayrollFromAttendanceAndLetters(dto, user);
  }

  @Post('deductions')
  @Roles(...PAY_CHANGE_ROLES)
  @StrictRoles()
  addDeduction(@Body() dto: AddDeductionDto, @CurrentUser() user: { id: string }) {
    return this.payrollService.addDeduction(dto, user.id);
  }

  @Post('deductions/batch')
  @Roles(...PAY_CHANGE_ROLES)
  @StrictRoles()
  addDeductions(@Body() dto: AddDeductionsDto, @CurrentUser() user: { id: string }) {
    return this.payrollService.addDeductions(dto, user.id);
  }

  @Patch('deductions/:id')
  @Roles(...PAY_CHANGE_ROLES)
  @StrictRoles()
  updateDeduction(
    @Param('id') id: string,
    @Body() dto: UpdateDeductionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.payrollService.updateDeduction(id, dto, user.id);
  }

  @Delete('deductions/:id')
  @Roles(...PAY_CHANGE_ROLES)
  @StrictRoles()
  removeDeduction(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.payrollService.removeDeduction(id, user.id);
  }

  @Post('allowances')
  @Roles(...PAY_CHANGE_ROLES)
  @StrictRoles()
  async addAllowance(@Body() dto: AddAllowanceDto, @CurrentUser() user: PayActor) {
    if (!isPayExecutive(user)) {
      const { employeeId, summary } =
        await this.payChangeRequests.describePayrollAddition(dto);
      return this.payChangeRequests.submit(
        {
          kind: PayChangeKind.PAYROLL_ADDITION,
          employeeId,
          payload: { ...dto },
          summary,
          reason: dto.description,
          approverTarget: dto.approverTarget,
        },
        user,
      );
    }
    return this.payrollService.addAllowance(dto, user.id);
  }

  @Get('overtime-preview/:employeeId')
  @Roles(...OVERTIME_APPLY_ROLES)
  getOvertimePreview(
    @Param('employeeId') employeeId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.payrollService.getOvertimePreview(
      employeeId,
      Number(month),
      Number(year),
    );
  }

  @Post('apply-overtime')
  @Roles(...OVERTIME_APPLY_ROLES)
  applyOvertime(
    @Body() dto: ApplyOvertimeDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.payrollService.applyOvertime(dto, user);
  }

  /** Accounts mark a whole branch month Processed (verified attendance only) or Paid. */
  @Post('finalize')
  @Roles(UserRole.SUPER_ADMIN, UserRole.PAYROLL_OFFICER)
  @RoutePermission(Permission.PAYROLL_FINALIZE)
  finalizeBranchMonth(
    @Body() dto: FinalizeBranchMonthDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.payrollService.finalizeBranchMonth(dto, user.id);
  }

  @Get('reports/itemized')
  @Roles(...PAYROLL_READ_ROLES, UserRole.PAYROLL_OFFICER)
  @RoutePermission(Permission.PAYROLL_VIEW)
  itemizedReport(@Query() q: ItemizedReportQueryDto) {
    return this.payrollService.itemizedReport(q);
  }

  @Get('entries/:id/changes')
  @Roles(...PAYROLL_READ_ROLES, UserRole.PAYROLL_OFFICER)
  @RoutePermission(Permission.PAYROLL_VIEW)
  getChangeLog(@Param('id') id: string) {
    return this.payrollService.getChangeLog(id);
  }

  @Patch('entries/:id/status')
  @Roles(UserRole.SUPER_ADMIN, UserRole.PAYROLL_OFFICER)
  @RoutePermission(Permission.PAYROLL_FINALIZE)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePayrollStatusDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.payrollService.updateStatus(id, dto, user.id);
  }

  @Get('summary')
  @Roles(...PAYROLL_READ_ROLES)
  @RoutePermission(Permission.PAYROLL_VIEW)
  getMonthlyPayrollSummary(
    @Query('month') month: string,
    @Query('year') year: string,
    @Query('branchId') branchId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.payrollService.getMonthlyPayrollSummary(
      Number(month),
      Number(year),
      branchId,
      fromDate,
      toDate,
    );
  }

  @Get('report')
  @Roles(...PAYROLL_READ_ROLES)
  @RoutePermission(Permission.PAYROLL_VIEW)
  async downloadPayrollReport(
    @Query('branchId') branchId: string,
    @Query('month') month: string,
    @Query('year') year: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Res() res: Response,
  ) {
    const { buffer, filename } =
      await this.payrollService.generateBranchPayrollReport(
        branchId,
        Number(month),
        Number(year),
        user,
      );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.send(buffer);
  }

  @Get('history/:employeeId')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.IT_ADMIN,
    UserRole.EMPLOYEE,
  )
  getEmployeePayrollHistory(@Param('employeeId') employeeId: string) {
    return this.payrollService.getEmployeePayrollHistory(employeeId);
  }

  @Get('entries')
  @Roles(...PAYROLL_READ_ROLES)
  @RoutePermission(Permission.PAYROLL_VIEW)
  findAll(
    @Query() query: PayrollQueryDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.payrollService.findAll(query, user);
  }

  @Post('payslips')
  @Roles(...PAYROLL_READ_ROLES)
  @RoutePermission(Permission.PAYROLL_VIEW)
  getPayslips(
    @Body() dto: PayslipBatchDto,
    @CurrentUser()
    user: { id: string; role: UserRole; employeeId?: string | null },
  ) {
    return this.payrollService.getPayslips(dto, user);
  }

  @Get('entries/:id/full')
  @AlsoAllowPermission(Permission.PAYROLL_VIEW)
  @Roles(...PAYROLL_WRITE_ROLES, UserRole.EMPLOYEE, UserRole.HR_EXECUTIVE)
  getEntryWithAllowances(
    @Param('id') id: string,
    @CurrentUser()
    user: { id: string; role: UserRole; employeeId?: string | null },
  ) {
    return this.payrollService.getEntryWithAllowances(id, user);
  }

  @Get('entries/:id')
  @AlsoAllowPermission(Permission.PAYROLL_VIEW)
  @Roles(...PAYROLL_WRITE_ROLES)
  findOne(@Param('id') id: string) {
    return this.payrollService.findOne(id);
  }

  @Post('increment')
  @Roles(...PAY_CHANGE_ROLES)
  @StrictRoles()
  async salaryIncrement(
    @Body() dto: SalaryIncrementDto,
    @CurrentUser() user: PayActor,
  ) {
    const pending = await this.packageApproval(PayChangeKind.SALARY_INCREMENT, dto, user);
    if (pending) return pending;
    const result = await this.payrollService.salaryIncrement(dto, user.id);
    await this.payChangeRequests.afterPackageChange(dto.employeeId);
    return result;
  }

  @Patch('stipend')
  @Roles(...PAY_CHANGE_ROLES)
  @StrictRoles()
  async updateActiveStipend(
    @Body() dto: UpdateActiveStipendDto,
    @CurrentUser() user: PayActor,
  ) {
    const pending = await this.packageApproval(PayChangeKind.PACKAGE_EDIT, dto, user);
    if (pending) return pending;
    const result = await this.payrollService.updateActiveStipend(dto, user.id);
    await this.payChangeRequests.afterPackageChange(dto.employeeId);
    return result;
  }

  /** A package change that raises pay, from a non-executive, becomes a request. */
  private async packageApproval(
    kind: PayChangeKind,
    dto: SalaryIncrementDto | UpdateActiveStipendDto,
    user: PayActor,
  ) {
    if (isPayExecutive(user)) return null;
    const { isIncrease, summary } = await this.payChangeRequests.describePackageChange(
      dto.employeeId,
      { ...dto },
    );
    if (!isIncrease) return null;
    return this.payChangeRequests.submit(
      {
        kind,
        employeeId: dto.employeeId,
        payload: { ...dto },
        summary,
        reason: dto.reason,
        approverTarget: dto.approverTarget,
      },
      user,
    );
  }
}
