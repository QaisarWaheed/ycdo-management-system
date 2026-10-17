import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, StrictRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateAdditionalWorkingDayDto,
  ReviewExtraTimeDto,
} from './additional-working-days.dto';
import { AdditionalWorkingDaysService } from './additional-working-days.service';

@Controller('additional-working-days')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdditionalWorkingDaysController {
  constructor(private service: AdditionalWorkingDaysService) {}

  @Post()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
  )
  create(
    @Body() dto: CreateAdditionalWorkingDayDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.create(dto, user.id);
  }

  @Get('employee/:employeeId')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.PRESIDENT,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
    UserRole.IT_ADMIN,
    UserRole.EMPLOYEE,
  )
  findByEmployee(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: { role: UserRole; employeeId?: string | null },
  ) {
    if (user.role === UserRole.EMPLOYEE && user.employeeId !== employeeId) {
      throw new ForbiddenException(
        'You can only view your own additional working days',
      );
    }
    return this.service.findByEmployee(employeeId);
  }

  @Delete(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
  )
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}

const EXTRA_TIME_KINDS = { day: 'day', overtime: 'overtime' } as const;
type ExtraTimeKind = keyof typeof EXTRA_TIME_KINDS;
const reviewer = (user: { id: string; role: UserRole; roles?: UserRole[] }) => ({
  id: user.id,
  roles: user.roles?.length ? user.roles : [user.role],
});

/** Point 20: HR enters extra days / overtime; HR Operations approves, rejections go to the Chairman. */
@Controller('extra-time')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_OPERATIONS_MANAGER, UserRole.CHAIRMAN)
@StrictRoles()
export class ExtraTimeController {
  constructor(private service: AdditionalWorkingDaysService) {}

  @Get('pending')
  findPending() {
    return this.service.findPendingExtraTime();
  }

  @Post(':kind/:id/approve')
  approve(
    @Param('kind', new ParseEnumPipe(EXTRA_TIME_KINDS)) kind: ExtraTimeKind,
    @Param('id') id: string,
    @Body() dto: ReviewExtraTimeDto,
    @CurrentUser() user: { id: string; role: UserRole; roles?: UserRole[] },
  ) {
    return this.service.reviewExtraTime(kind, id, true, reviewer(user), dto.note);
  }

  @Post(':kind/:id/reject')
  reject(
    @Param('kind', new ParseEnumPipe(EXTRA_TIME_KINDS)) kind: ExtraTimeKind,
    @Param('id') id: string,
    @Body() dto: ReviewExtraTimeDto,
    @CurrentUser() user: { id: string; role: UserRole; roles?: UserRole[] },
  ) {
    return this.service.reviewExtraTime(kind, id, false, reviewer(user), dto.note);
  }
}
