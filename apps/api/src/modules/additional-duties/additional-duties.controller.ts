import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ALLOWANCE_MANAGE_ROLES } from '../allowances/allowances.controller';
import {
  CreateAdditionalDutyDto,
  LinkDutyAllowanceDto,
  MissingAllowanceQueryDto,
  UpdateAdditionalDutyDto,
} from './additional-duties.dto';
import { AdditionalDutiesService } from './additional-duties.service';

/** HR records, edits and ends duties on the profile. */
const DUTY_MANAGE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_EXECUTIVE,
];

/** HR + Accounts + executives (who pay the allowance) see them. */
const DUTY_PAY_ROLES = [...DUTY_MANAGE_ROLES, ...ALLOWANCE_MANAGE_ROLES];

const DUTY_READ_ROLES = [...DUTY_PAY_ROLES, UserRole.IT_ADMIN];

@Controller('additional-duties')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdditionalDutiesController {
  constructor(private duties: AdditionalDutiesService) {}

  @Get()
  @Roles(...DUTY_READ_ROLES)
  list(@Query('employeeId') employeeId?: string) {
    return this.duties.list(employeeId);
  }

  /** Payroll reminder: duties held in the month with no allowance paying it. */
  @Get('missing-allowance')
  @Roles(...DUTY_PAY_ROLES)
  missingAllowance(@Query() q: MissingAllowanceQueryDto) {
    return this.duties.missingAllowance(q.year, q.month);
  }

  @Post()
  @Roles(...DUTY_MANAGE_ROLES)
  create(
    @Body() dto: CreateAdditionalDutyDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.duties.create(dto, user);
  }

  @Patch(':id')
  @Roles(...DUTY_MANAGE_ROLES)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAdditionalDutyDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.duties.update(id, dto, user);
  }

  /** Accounts links the allowance it added (or HR links an existing one). */
  @Patch(':id/allowance')
  @Roles(...DUTY_PAY_ROLES)
  linkAllowance(
    @Param('id') id: string,
    @Body() dto: LinkDutyAllowanceDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.duties.linkAllowance(id, dto.allowanceId ?? null, user);
  }

  @Delete(':id')
  @Roles(...DUTY_MANAGE_ROLES)
  remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.duties.remove(id, user);
  }
}
