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
import { PayChangeKind, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  isPayExecutive,
  PayChangeRequestsService,
  type PayActor,
} from '../pay-approvals/pay-change-requests.service';
import {
  AssignAllowanceDto,
  CreateAllowanceTypeDto,
  CreateIncentiveTypeDto,
  EndAllowanceDto,
  UpdateAllowanceTypeDto,
  UpdateIncentiveTypeDto,
} from './allowances.dto';
import { AllowancesService } from './allowances.service';

/** Accounts + executives manage allowance / incentive types and assignments. */
export const ALLOWANCE_MANAGE_ROLES = [
  UserRole.PAYROLL_OFFICER,
  UserRole.PRESIDENT,
  UserRole.FOUNDER,
  UserRole.CHAIRMAN,
  UserRole.SUPER_ADMIN,
];

/** Everyone who can read payroll can see them (HR read-only). */
const ALLOWANCE_READ_ROLES = [
  ...ALLOWANCE_MANAGE_ROLES,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_EXECUTIVE,
  UserRole.ADMIN_OFFICER,
  UserRole.IT_ADMIN,
];

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AllowancesController {
  constructor(
    private allowances: AllowancesService,
    private requests: PayChangeRequestsService,
  ) {}

  @Get('allowance-types')
  @Roles(...ALLOWANCE_READ_ROLES)
  listTypes() {
    return this.allowances.listTypes();
  }

  @Post('allowance-types')
  @Roles(...ALLOWANCE_MANAGE_ROLES)
  createType(@Body() dto: CreateAllowanceTypeDto, @CurrentUser() user: PayActor) {
    return this.allowances.createType(dto, user);
  }

  @Patch('allowance-types/:id')
  @Roles(...ALLOWANCE_MANAGE_ROLES)
  updateType(
    @Param('id') id: string,
    @Body() dto: UpdateAllowanceTypeDto,
    @CurrentUser() user: PayActor,
  ) {
    return this.allowances.updateType(id, dto, user);
  }

  @Get('incentive-types')
  @Roles(...ALLOWANCE_READ_ROLES)
  listIncentiveTypes() {
    return this.allowances.listIncentiveTypes();
  }

  @Post('incentive-types')
  @Roles(...ALLOWANCE_MANAGE_ROLES)
  createIncentiveType(@Body() dto: CreateIncentiveTypeDto, @CurrentUser() user: PayActor) {
    return this.allowances.createIncentiveType(dto, user);
  }

  @Patch('incentive-types/:id')
  @Roles(...ALLOWANCE_MANAGE_ROLES)
  updateIncentiveType(
    @Param('id') id: string,
    @Body() dto: UpdateIncentiveTypeDto,
    @CurrentUser() user: PayActor,
  ) {
    return this.allowances.updateIncentiveType(id, dto, user);
  }

  /** Switch-over check: old package fields vs copied allowances. */
  @Get('employee-allowances/migration-check')
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  migrationCheck() {
    return this.allowances.migrationCheck();
  }

  @Get('employee-allowances')
  @Roles(...ALLOWANCE_READ_ROLES)
  listForEmployee(@Query('employeeId') employeeId: string) {
    return this.allowances.listForEmployee(employeeId);
  }

  /** Executives apply at once; an increase from Accounts goes for approval. */
  @Post('employee-allowances')
  @Roles(...ALLOWANCE_MANAGE_ROLES)
  async assign(@Body() dto: AssignAllowanceDto, @CurrentUser() user: PayActor) {
    if (!isPayExecutive(user)) {
      const { isIncrease, summary } = await this.allowances.describeAssign(dto);
      if (isIncrease) {
        return this.requests.submit(
          {
            kind: PayChangeKind.ALLOWANCE,
            employeeId: dto.employeeId,
            payload: { ...dto },
            summary,
            reason: dto.note,
            approverTarget: dto.approverTarget,
          },
          user,
        );
      }
    }
    return this.allowances.assign(dto, user);
  }

  @Patch('employee-allowances/:id/end')
  @Roles(...ALLOWANCE_MANAGE_ROLES)
  end(
    @Param('id') id: string,
    @Body() dto: EndAllowanceDto,
    @CurrentUser() user: PayActor,
  ) {
    return this.allowances.end(id, dto.endMonth, user);
  }
}
