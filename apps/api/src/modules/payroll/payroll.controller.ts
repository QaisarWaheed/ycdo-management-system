import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AddDeductionDto,
  AddAllowanceDto,
  CreatePayrollEntryDto,
  PayrollQueryDto,
  SalaryIncrementDto,
  UpdatePayrollStatusDto,
} from './payroll.dto';
import { PayrollService } from './payroll.service';

const PAYROLL_READ_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.CHAIRMAN,
  UserRole.FOUNDER,
];

@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayrollController {
  constructor(private payrollService: PayrollService) {}
  @Post('entries')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.HR_OPERATIONS_MANAGER)
  createOrGetEntry(@Body() dto: CreatePayrollEntryDto) {
    return this.payrollService.createOrGetEntry(dto);
  }

  @Post('deductions')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.HR_OPERATIONS_MANAGER)
  addDeduction(@Body() dto: AddDeductionDto) {
    return this.payrollService.addDeduction(dto);
  }

  @Post('allowances')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.HR_OPERATIONS_MANAGER)
  addAllowance(@Body() dto: AddAllowanceDto) {
    return this.payrollService.addAllowance(dto);
  }

  @Patch('entries/:id/status')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_OPERATIONS_MANAGER)
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
  ) {
    return this.payrollService.getMonthlyPayrollSummary(
      Number(month),
      Number(year),
      branchId,
    );
  }

  @Get('history/:employeeId')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.EMPLOYEE,
  )
  getEmployeePayrollHistory(@Param('employeeId') employeeId: string) {
    return this.payrollService.getEmployeePayrollHistory(employeeId);
  }

  @Get('entries')
  @Roles(...PAYROLL_READ_ROLES)
  findAll(@Query() query: PayrollQueryDto) {
    return this.payrollService.findAll(query);
  }

  @Get('entries/:id/full')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.HR_OPERATIONS_MANAGER)
  getEntryWithAllowances(@Param('id') id: string) {
    return this.payrollService.getEntryWithAllowances(id);
  }

  @Get('entries/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.HR_OPERATIONS_MANAGER)
  findOne(@Param('id') id: string) {
    return this.payrollService.findOne(id);
  }

  @Post('increment')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER)
  salaryIncrement(
    @Body() dto: SalaryIncrementDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.payrollService.salaryIncrement(dto, user.id);
  }
}
