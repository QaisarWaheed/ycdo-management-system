import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AddDeductionDto,
  AddAllowanceDto,
  ApplyOvertimeDto,
  CreatePayrollEntryDto,
  PayrollQueryDto,
  RecomputeMonthAllDto,
  SalaryIncrementDto,
  UpdatePayrollStatusDto,
} from './payroll.dto';
import { PayrollService } from './payroll.service';

const PAYROLL_READ_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_EXECUTIVE,
  UserRole.IT_ADMIN,
  UserRole.CHAIRMAN,
  UserRole.FOUNDER,
];

const PAYROLL_WRITE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.IT_ADMIN,
];

const OVERTIME_APPLY_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_EXECUTIVE,
];

@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayrollController {
  constructor(private payrollService: PayrollService) {}
  @Post('entries')
  @Roles(...PAYROLL_WRITE_ROLES)
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
  recomputeMonthAll(
    @Body() dto: RecomputeMonthAllDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.payrollService.recomputeMonthAll(dto, user);
  }

  @Post('deductions')
  @Roles(...PAYROLL_WRITE_ROLES)
  addDeduction(@Body() dto: AddDeductionDto) {
    return this.payrollService.addDeduction(dto);
  }

  @Post('allowances')
  @Roles(...PAYROLL_WRITE_ROLES)
  addAllowance(@Body() dto: AddAllowanceDto) {
    return this.payrollService.addAllowance(dto);
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

  @Patch('entries/:id/status')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_OPERATIONS_MANAGER, UserRole.IT_ADMIN)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePayrollStatusDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.payrollService.updateStatus(id, dto, user.id);
  }

  @Get('summary')
  @Roles(...PAYROLL_READ_ROLES)
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
  findAll(
    @Query() query: PayrollQueryDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.payrollService.findAll(query, user);
  }

  @Get('entries/:id/full')
  @Roles(...PAYROLL_WRITE_ROLES, UserRole.EMPLOYEE, UserRole.HR_EXECUTIVE)
  getEntryWithAllowances(
    @Param('id') id: string,
    @CurrentUser()
    user: { id: string; role: UserRole; employeeId?: string | null },
  ) {
    return this.payrollService.getEntryWithAllowances(id, user);
  }

  @Get('entries/:id')
  @Roles(...PAYROLL_WRITE_ROLES)
  findOne(@Param('id') id: string) {
    return this.payrollService.findOne(id);
  }

  @Post('increment')
  @Roles(...PAYROLL_WRITE_ROLES)
  salaryIncrement(
    @Body() dto: SalaryIncrementDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.payrollService.salaryIncrement(dto, user.id);
  }
}
