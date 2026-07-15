import {
  Body,
  Controller,
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
  CreateMutualSwapDto,
  EligibleCoveringQueryDto,
  MutualSwapQueryDto,
} from './mutual-swap.dto';
import { MutualSwapService } from './mutual-swap.service';

const HR_READ_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_EXECUTIVE,
];

const HR_WRITE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
];

const HR_CANCEL_ROLES = [UserRole.SUPER_ADMIN, UserRole.HR_MANAGER];

@Controller('mutual-swap')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MutualSwapController {
  constructor(private mutualSwapService: MutualSwapService) {}

  @Post()
  @Roles(...HR_WRITE_ROLES)
  create(
    @Body() dto: CreateMutualSwapDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.mutualSwapService.createSwap(dto, user.id);
  }

  @Get('eligible-covering')
  @Roles(...HR_READ_ROLES)
  getEligibleCovering(@Query() query: EligibleCoveringQueryDto) {
    return this.mutualSwapService.getEligibleCoveringEmployees(
      query.coveredEmployeeId,
      query.date,
    );
  }

  @Get()
  @Roles(...HR_READ_ROLES)
  getSwaps(@Query() query: MutualSwapQueryDto) {
    return this.mutualSwapService.getSwaps(query);
  }

  @Patch(':id/cancel')
  @Roles(...HR_CANCEL_ROLES)
  cancel(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.mutualSwapService.cancelSwap(id, user.id);
  }
}
