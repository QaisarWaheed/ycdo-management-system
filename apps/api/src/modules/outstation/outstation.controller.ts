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
  CreateOutstationDto,
  OutstationQueryDto,
  UpdateOutstationStatusDto,
} from './outstation.dto';
import { OutstationService } from './outstation.service';

@Controller('outstation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OutstationController {
  constructor(private outstationService: OutstationService) {}

  @Post()
  @Roles(
    UserRole.HR_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.EMPLOYEE,
  )
  create(@Body() dto: CreateOutstationDto) {
    return this.outstationService.create(dto);
  }

  @Get('district-summary')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.HR_OPERATIONS_MANAGER,
  )
  getDistrictSummary() {
    return this.outstationService.getDistrictSummary();
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.FOUNDER,
    UserRole.CHAIRMAN,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.HR_MANAGER,
    UserRole.BRANCH_MANAGER,
    UserRole.EMPLOYEE,
  )
  findAll(
    @Query() query: OutstationQueryDto,
    @CurrentUser() user: { role: UserRole; employeeId?: string | null },
  ) {
    if (user.role === UserRole.EMPLOYEE) {
      if (!user.employeeId) {
        throw new ForbiddenException('Employee profile required');
      }
      return this.outstationService.findAll({
        ...query,
        employeeId: user.employeeId,
      });
    }
    return this.outstationService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.outstationService.findOne(id);
  }

  @Patch(':id/status')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
  )
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOutstationStatusDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.outstationService.updateStatus(id, dto, user.id);
  }
}
