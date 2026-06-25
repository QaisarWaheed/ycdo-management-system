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
  UpdateEmployeeDto,
} from './employees.dto';
import { EmployeesService } from './employees.service';

@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeesController {
  constructor(private employeesService: EmployeesService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.BRANCH_MANAGER)
  create(@Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(dto);
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_MANAGER,
    UserRole.ADMIN_OFFICER,
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

  @Patch(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
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
}
