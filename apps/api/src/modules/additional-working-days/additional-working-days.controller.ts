import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateAdditionalWorkingDayDto } from './additional-working-days.dto';
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
