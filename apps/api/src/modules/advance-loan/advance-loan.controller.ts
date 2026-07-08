import {
  BadRequestException,
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
  AdvanceLoanQueryDto,
  CreateAdvanceLoanDto,
  RejectAdvanceLoanDto,
} from './advance-loan.dto';
import { AdvanceLoanService } from './advance-loan.service';

@Controller('advance-loan')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdvanceLoanController {
  constructor(private advanceLoanService: AdvanceLoanService) {}

  @Post()
  @Roles(UserRole.EMPLOYEE)
  create(
    @Body() dto: CreateAdvanceLoanDto,
    @CurrentUser() user: { employeeId?: string | null },
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('Employee profile required');
    }
    return this.advanceLoanService.create(dto, user.employeeId);
  }

  @Get('my')
  @Roles(UserRole.EMPLOYEE)
  findMy(@CurrentUser() user: { employeeId?: string | null }) {
    if (!user.employeeId) {
      throw new BadRequestException('Employee profile required');
    }
    return this.advanceLoanService.findMy(user.employeeId);
  }

  @Get('employee/:employeeId')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  findByEmployee(@Param('employeeId') employeeId: string) {
    return this.advanceLoanService.findByEmployee(employeeId);
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
  )
  findAll(@Query() query: AdvanceLoanQueryDto) {
    return this.advanceLoanService.findAll(query);
  }

  @Patch(':id/approve')
  @Roles(UserRole.HR_MANAGER, UserRole.HR_ADMIN_MANAGER)
  approve(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.advanceLoanService.approve(id, user.id);
  }

  @Patch(':id/reject')
  @Roles(UserRole.HR_MANAGER, UserRole.HR_ADMIN_MANAGER)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectAdvanceLoanDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.advanceLoanService.reject(id, dto, user.id);
  }
}
