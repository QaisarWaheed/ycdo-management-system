import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { FinanceQueryDto } from './finance.dto';
import { FinanceService } from './finance.service';

const FINANCE_READ_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.FOUNDER,
  UserRole.CHAIRMAN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.IT_ADMIN,
] as const;

@Controller('finance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceController {
  constructor(private financeService: FinanceService) {}

  @Get('status')
  @Roles(...FINANCE_READ_ROLES)
  getStatus() {
    return this.financeService.getStatus();
  }

  @Get()
  @Roles(...FINANCE_READ_ROLES)
  findAll(@Query() query: FinanceQueryDto) {
    return this.financeService.findAll(query);
  }
}
