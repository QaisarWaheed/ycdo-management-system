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
import { EmployeeStatus, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  ChangeStatusDto,
  CreateEmployeeDto,
  TransferDto,
  UpdateEmployeeDto,
} from './employees.dto';
import { EmployeesService } from './employees.service';

@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeesController {
  constructor(private employeesService: EmployeesService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.BRANCH_HR)
  create(@Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(dto);
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_HR,
    UserRole.DEPARTMENT_HEAD,
  )
  findAll(
    @Query('branchId') branchId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: EmployeeStatus,
    @Query('search') search?: string,
  ) {
    return this.employeesService.findAll({
      branchId,
      departmentId,
      status,
      search,
    });
  }

  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_HR,
    UserRole.DEPARTMENT_HEAD,
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

  @Patch(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_HR,
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
}
