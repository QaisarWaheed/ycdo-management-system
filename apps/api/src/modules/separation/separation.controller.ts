import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PromotionDto, ResignationDto } from './separation.dto';
import { SeparationService } from './separation.service';

@Controller('separation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SeparationController {
  constructor(private separationService: SeparationService) {}

  @Post('resign')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER)
  resign(
    @Body() dto: ResignationDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.separationService.resign(dto, user.id);
  }

  @Post('promote')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER)
  promote(
    @Body() dto: PromotionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.separationService.promote(dto, user.id);
  }
}
