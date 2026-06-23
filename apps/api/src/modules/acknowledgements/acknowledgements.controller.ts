import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AcknowledgeDto } from './acknowledgements.dto';
import { AcknowledgementsService } from './acknowledgements.service';

@Controller('acknowledgements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AcknowledgementsController {
  constructor(private acknowledgementsService: AcknowledgementsService) {}

  @Post()
  @Roles(UserRole.EMPLOYEE)
  acknowledge(
    @Body() dto: AcknowledgeDto,
    @CurrentUser() user: { id: string; employeeId?: string | null },
    @Req() req: Request,
  ) {
    if (!user.employeeId) {
      throw new ForbiddenException('Employee profile required');
    }

    const forwarded = req.headers['x-forwarded-for'];
    const ipAddress =
      (typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : undefined) ??
      req.ip ??
      '';

    return this.acknowledgementsService.acknowledge(
      dto,
      user.employeeId,
      user.id,
      ipAddress,
    );
  }

  @Get('my')
  @Roles(UserRole.EMPLOYEE)
  findByEmployee(@CurrentUser() user: { employeeId?: string | null }) {
    if (!user.employeeId) {
      throw new ForbiddenException('Employee profile required');
    }

    return this.acknowledgementsService.findByEmployee(user.employeeId);
  }

  @Get('pending')
  @Roles(UserRole.EMPLOYEE)
  getPendingAcknowledgements(
    @CurrentUser() user: { employeeId?: string | null },
  ) {
    if (!user.employeeId) {
      throw new ForbiddenException('Employee profile required');
    }

    return this.acknowledgementsService.getPendingAcknowledgements(
      user.employeeId,
    );
  }

  @Get('letter/:letterId')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  findByLetter(@Param('letterId') letterId: string) {
    return this.acknowledgementsService.findByLetter(letterId);
  }
}
