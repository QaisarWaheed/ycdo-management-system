import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateIncentiveDto, IncentiveQueryDto } from './incentives.dto';
import { IncentivesService } from './incentives.service';

@Controller('incentives')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IncentivesController {
  constructor(private incentivesService: IncentivesService) {}

  @Post()
  @Roles(
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  create(
    @Body() dto: CreateIncentiveDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.incentivesService.create(dto, user.id);
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
  )
  findAll(@Query() query: IncentiveQueryDto) {
    return this.incentivesService.findAll(query);
  }

  @Get('employee/:employeeId')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
    UserRole.EMPLOYEE,
  )
  findByEmployee(@Param('employeeId') employeeId: string) {
    return this.incentivesService.findByEmployee(employeeId);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN_MANAGER)
  delete(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.incentivesService.delete(id, user.id);
  }
}
