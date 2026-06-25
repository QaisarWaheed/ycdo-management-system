import {
  Body,
  Controller,
  ForbiddenException,
  Get,
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
  GenerateStipendReceiptsDto,
  RespondStipendDto,
  StipendReceiptQueryDto,
} from './stipend-receipts.dto';
import { StipendReceiptsService } from './stipend-receipts.service';

@Controller('stipend-receipts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StipendReceiptsController {
  constructor(private stipendReceiptsService: StipendReceiptsService) {}

  @Post('generate')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
  )
  generate(@Body() dto: GenerateStipendReceiptsDto) {
    return this.stipendReceiptsService.generateMonthlyReceipts(
      dto.month,
      dto.year,
    );
  }

  @Patch('respond')
  @Roles(UserRole.EMPLOYEE)
  respond(
    @Body() dto: RespondStipendDto,
    @CurrentUser() user: { employeeId?: string | null },
  ) {
    if (!user.employeeId) {
      throw new ForbiddenException('Employee profile required');
    }
    return this.stipendReceiptsService.respond(dto, user.employeeId);
  }

  @Get('my')
  @Roles(UserRole.EMPLOYEE)
  findMy(
    @CurrentUser() user: { employeeId?: string | null },
  ) {
    if (!user.employeeId) {
      throw new ForbiddenException('Employee profile required');
    }
    return this.stipendReceiptsService.findMyReceipts(user.employeeId);
  }

  @Get('pending')
  @Roles(UserRole.EMPLOYEE)
  findPending(
    @CurrentUser() user: { employeeId?: string | null },
  ) {
    if (!user.employeeId) {
      throw new ForbiddenException('Employee profile required');
    }
    return this.stipendReceiptsService.getPendingReceipts(user.employeeId);
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.BRANCH_MANAGER,
  )
  findAll(@Query() query: StipendReceiptQueryDto) {
    return this.stipendReceiptsService.findAll(query.month, query.year);
  }
}
