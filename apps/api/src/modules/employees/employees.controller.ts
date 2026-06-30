import {
  Body,
  Controller,
  ForbiddenException,
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
  ChangeStatusDto,
  CreateEmployeeDto,
  EmployeeQueryDto,
  TransferDto,
  UpdateBranchDutyDto,
  UpdateEmployeeDto,
} from './employees.dto';
import { EmployeesService } from './employees.service';

@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeesController {
  constructor(private employeesService: EmployeesService) {}

  @Post()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.BRANCH_MANAGER,
  )
  create(@Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(dto);
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.CHAIRMAN,
    UserRole.FOUNDER,
  )
  findAll(@Query() query: EmployeeQueryDto) {
    return this.employeesService.findAll(query);
  }

  @Get('filter-options')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  getFilterOptions() {
    return this.employeesService.getFilterOptions();
  }

  @Post('backfill-users')
  @Roles(UserRole.SUPER_ADMIN)
  backfillUsers() {
    return this.employeesService.backfillUsers();
  }

  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.EMPLOYEE,
  )
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: { role: UserRole; employeeId?: string | null },
  ) {
    if (user.role === UserRole.EMPLOYEE && user.employeeId !== id) {
      throw new ForbiddenException('Access denied');
    }
    return this.employeesService.findOne(id);
  }

  @Get(':id/working-hours')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.BRANCH_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.CHAIRMAN,
    UserRole.FOUNDER,
    UserRole.EMPLOYEE,
  )
  getWorkingHours(
    @Param('id') id: string,
    @CurrentUser() user: { role: UserRole; employeeId?: string | null },
  ) {
    if (user.role === UserRole.EMPLOYEE && user.employeeId !== id) {
      throw new ForbiddenException('Access denied');
    }
    return this.employeesService.getTotalWorkingHours(id);
  }

  @Patch(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.BRANCH_MANAGER,
    UserRole.EMPLOYEE,
  )
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: { role: UserRole; employeeId?: string | null },
  ) {
    if (user.role === UserRole.EMPLOYEE) {
      if (user.employeeId !== id) {
        throw new ForbiddenException('Access denied');
      }
      return this.employeesService.update(id, {
        phone: dto.phone,
        email: dto.email,
      });
    }
    return this.employeesService.update(id, dto);
  }

  @Post(':id/transfer')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER)
  transfer(@Param('id') id: string, @Body() dto: TransferDto) {
    return this.employeesService.transfer(id, dto);
  }

  @Patch(':id/status')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER)
  changeStatus(@Param('id') id: string, @Body() dto: ChangeStatusDto) {
    return this.employeesService.changeStatus(id, dto);
  }

  @Patch(':id/branch-duty')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  updateBranchDuty(
    @Param('id') id: string,
    @Body() dto: UpdateBranchDutyDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.employeesService.updateBranchDuty(id, dto, user.id);
  }
}
