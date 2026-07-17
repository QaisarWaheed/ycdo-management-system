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
  ApproveLeaveDto,
  EmergencyLeaveDto,
  VerifiedLeaveDto,
  HRAssignRelieverDto,
  LeaveQueryDto,
  RequestRelieverDto,
  RespondRelieverDto,
  UpdateLeaveStatusDto,
} from './leave.dto';
import { AccessScopeService } from '../permissions/access-scope.service';
import { LeaveService } from './leave.service';

const LEAVE_READ_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.ADMIN_MANAGER,
  UserRole.ADMIN_OFFICER,
  UserRole.IT_ADMIN,
  UserRole.CHAIRMAN,
  UserRole.FOUNDER,
  UserRole.EMPLOYEE,
];

@Controller('leave')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeaveController {
  constructor(
    private leaveService: LeaveService,
    private accessScopeService: AccessScopeService,
  ) {}

  @Post()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.EMPLOYEE,
  )
  apply(@Body() dto: ApplyLeaveDto) {
    return this.leaveService.apply(dto);
  }

  @Get('balance/:employeeId')
  @Roles(...LEAVE_READ_ROLES)
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
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  getTodayRelievers(
    @Query('branchId') branchId: string | undefined,
    @CurrentUser() user: { role: UserRole; branchId?: string | null },
  ) {
    const scopedBranchId =
      user.role === UserRole.ADMIN_MANAGER && user.branchId
        ? user.branchId
        : branchId;
    return this.leaveService.getTodayRelievers(scopedBranchId);
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
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  getRelieverCandidates(@Query('search') search?: string) {
    return this.leaveService.getRelieverCandidates(search);
  }

  @Get('my-pending-reliever')
  @Roles(UserRole.EMPLOYEE)
  getMyPendingReliever(
    @CurrentUser() user: { employeeId?: string | null },
  ) {
    if (!user.employeeId) {
      throw new ForbiddenException('Employee profile required');
    }
    return this.leaveService.getMyPendingReliever(user.employeeId);
  }

  @Post('emergency')
  @Roles(
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.SUPER_ADMIN,
  )
  markEmergencyLeave(
    @Body() dto: EmergencyLeaveDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.leaveService.markEmergencyLeave(dto, user);
  }

  @Post('verified')
  @Roles(
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.MEDICINE_MANAGER,
  )
  markVerifiedLeave(
    @Body() dto: VerifiedLeaveDto,
    @CurrentUser()
    user: { id: string; role: UserRole; branchId?: string | null },
  ) {
    return this.leaveService.markVerifiedLeave(dto, user);
  }

  @Get()
  @Roles(...LEAVE_READ_ROLES)
  async findAll(
    @Query() query: LeaveQueryDto,
    @CurrentUser()
    user: {
      id: string;
      role: UserRole;
      roles?: UserRole[];
      employeeId?: string | null;
      branchId?: string | null;
    },
  ) {
    const effectiveRoles = user.roles?.length ? user.roles : [user.role];
    const isPortalOnly =
      effectiveRoles.length === 1 && effectiveRoles[0] === UserRole.EMPLOYEE;
    const hasManagerScopes =
      await this.accessScopeService.userHasManagerScopes(user.id);

    if (isPortalOnly && !hasManagerScopes) {
      if (!user.employeeId) {
        throw new ForbiddenException('Employee profile required');
      }
      return this.leaveService.findAll(
        {
          ...query,
          employeeId: user.employeeId,
        },
        user,
      );
    }
    return this.leaveService.findAll(query, user);
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

  @Get(':id/approvals')
  @Roles(...LEAVE_READ_ROLES)
  getApprovals(@Param('id') id: string) {
    return this.leaveService.getLeaveWithApprovals(id);
  }

  @Patch(':id/branch-approve')
  @Roles(UserRole.ADMIN_MANAGER, UserRole.SUPER_ADMIN)
  branchApprove(
    @Param('id') id: string,
    @Body() dto: ApproveLeaveDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.leaveService.branchManagerApprove(id, dto, user);
  }

  @Patch(':id/dept-approve')
  @Roles(UserRole.ADMIN_OFFICER, UserRole.SUPER_ADMIN)
  deptApprove(
    @Param('id') id: string,
    @Body() dto: ApproveLeaveDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.leaveService.deptInchargeApprove(id, dto, user);
  }

  @Patch(':id/hr-approve')
  @Roles(UserRole.HR_OPERATIONS_MANAGER, UserRole.SUPER_ADMIN)
  hrApprove(
    @Param('id') id: string,
    @Body() dto: ApproveLeaveDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.leaveService.hrOperationsApprove(id, dto, user);
  }

  @Get(':id')
  @Roles(...LEAVE_READ_ROLES)
  findOne(@Param('id') id: string) {
    return this.leaveService.findOne(id);
  }

  /** @deprecated Use branch/dept/hr-approve endpoints */
  @Patch(':id/status')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
  )
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
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
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
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.SUPER_ADMIN,
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
    UserRole.ADMIN_MANAGER,
    UserRole.EMPLOYEE,
  )
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: UserRole; employeeId?: string },
  ) {
    return this.leaveService.cancel(id, user);
  }
}
