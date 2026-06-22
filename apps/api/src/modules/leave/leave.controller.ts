import {
  Body,
  Controller,
  Delete,
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
  ApplyLeaveDto,
  LeaveQueryDto,
  UpdateLeaveStatusDto,
} from './leave.dto';
import { LeaveService } from './leave.service';

@Controller('leave')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeaveController {
  constructor(private leaveService: LeaveService) {}

  @Post()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_HR,
    UserRole.EMPLOYEE,
  )
  apply(@Body() dto: ApplyLeaveDto) {
    return this.leaveService.apply(dto);
  }

  @Get('balance/:employeeId')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_HR,
    UserRole.DEPARTMENT_HEAD,
    UserRole.EMPLOYEE,
  )
  getLeaveBalance(
    @Param('employeeId') employeeId: string,
    @Query('year') year?: string,
  ) {
    return this.leaveService.getLeaveBalance(
      employeeId,
      year ? Number(year) : undefined,
    );
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_HR,
    UserRole.DEPARTMENT_HEAD,
    UserRole.EMPLOYEE,
  )
  findAll(
    @Query() query: LeaveQueryDto,
    @CurrentUser() user: { role: UserRole; employeeId?: string | null },
  ) {
    if (user.role === UserRole.EMPLOYEE) {
      if (!user.employeeId) {
        throw new ForbiddenException('Employee profile required');
      }
      return this.leaveService.findAll({
        ...query,
        employeeId: user.employeeId,
      });
    }
    return this.leaveService.findAll(query);
  }

  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_HR,
    UserRole.DEPARTMENT_HEAD,
  )
  findOne(@Param('id') id: string) {
    return this.leaveService.findOne(id);
  }

  @Patch(':id/status')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.BRANCH_HR)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLeaveStatusDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.leaveService.updateStatus(id, dto, user.id);
  }

  @Delete(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_HR,
    UserRole.EMPLOYEE,
  )
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: UserRole; employeeId?: string },
  ) {
    return this.leaveService.cancel(id, user);
  }
}
