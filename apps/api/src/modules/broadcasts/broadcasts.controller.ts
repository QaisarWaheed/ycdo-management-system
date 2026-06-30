import {
  Body,
  Controller,
  Delete,
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
import { CreateBroadcastDto } from './broadcasts.dto';
import { BroadcastsService } from './broadcasts.service';

@Controller('broadcasts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BroadcastsController {
  constructor(private broadcastsService: BroadcastsService) {}

  @Post()
  @Roles(UserRole.IT_ADMIN)
  create(
    @Body() dto: CreateBroadcastDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.broadcastsService.create(dto, user.id);
  }

  @Get()
  @Roles(UserRole.IT_ADMIN)
  findAll() {
    return this.broadcastsService.findAll();
  }

  @Delete(':id')
  @Roles(UserRole.IT_ADMIN)
  deactivate(@Param('id') id: string) {
    return this.broadcastsService.deactivate(id);
  }
}
