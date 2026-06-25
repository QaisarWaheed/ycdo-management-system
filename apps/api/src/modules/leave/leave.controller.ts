import {
  BadRequestException,
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
  HRAssignRelieverDto,
  LeaveQueryDto,
  RequestRelieverDto,
  RespondRelieverDto,
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
    UserRole.BRANCH_MANAGER,
    UserRole.EMPLOYEE,
  )
  apply(@Body() dto: ApplyLeaveDto) {
    return this.leaveService.apply(dto);
  }

  @Get('balance/:employeeId')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_MANAGER,
    UserRole.ADMIN_OFFICER,
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

  @Get('today-relievers')
  @Roles(
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.SUPER_ADMIN,
    UserRole.BRANCH_MANAGER,
  )
  getTodayRelievers() {
    return this.leaveService.getTodayRelievers();
  }

  @Get('incoming-reliever-requests')
  @Roles(UserRole.EMPLOYEE)
  getIncomingRelieverRequests(
    @CurrentUser() user: { employeeId?: string | null },
  ) {
    if (!user.employeeId) {
      throw new ForbiddenException('Employee profile required');
    }
    return this.leaveService.getIncomingRelieverRequests(user.employeeId);
  }

  @Get('reliever-candidates')
  @Roles(
    UserRole.EMPLOYEE,
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.BRANCH_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  getRelieverCandidates(@Query('search') search?: string) {
    return this.leaveService.getRelieverCandidates(search);
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_MANAGER,
    UserRole.ADMIN_OFFICER,
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

  @Patch('reliever/:requestId/respond')
  @Roles(UserRole.EMPLOYEE)
  respondToReliever(
    @Param('requestId') requestId: string,
    @Body() dto: RespondRelieverDto,
    @CurrentUser() user: { employeeId?: string | null },
  ) {
    if (!user.employeeId) {
      throw new ForbiddenException('Employee profile required');
    }
    return this.leaveService.respondToRelieverRequest(
      requestId,
      dto,
      user.employeeId,
    );
  }

  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  findOne(@Param('id') id: string) {
    return this.leaveService.findOne(id);
  }

  @Patch(':id/status')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.BRANCH_MANAGER)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLeaveStatusDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.leaveService.updateStatus(id, dto, user.id);
  }

  @Post(':id/request-reliever')
  @Roles(
    UserRole.EMPLOYEE,
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.BRANCH_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  requestReliever(
    @Param('id') id: string,
    @Body() dto: RequestRelieverDto,
    @CurrentUser() user: {
      employeeId?: string | null
      role: UserRole
    },
  ) {
    if (dto.leaveRecordId !== id) {
      throw new BadRequestException('Leave record id mismatch');
    }
    const onBehalf = user.role !== UserRole.EMPLOYEE;
    if (!onBehalf && !user.employeeId) {
      throw new ForbiddenException('Employee profile required');
    }
    return this.leaveService.requestReliever(
      dto,
      user.employeeId ?? '',
      onBehalf,
    );
  }

  @Post(':id/hr-assign-reliever')
  @Roles(
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  hrAssignReliever(
    @Param('id') id: string,
    @Body() dto: HRAssignRelieverDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.leaveService.hrAssignReliever(id, dto, user.id);
  }

  @Delete(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_MANAGER,
    UserRole.EMPLOYEE,
  )
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: UserRole; employeeId?: string },
  ) {
    return this.leaveService.cancel(id, user);
  }
}
