import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateUserPasswordDto } from './user-passwords.dto';
import { UserPasswordsService } from './user-passwords.service';

@Controller('user-passwords')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UserPasswordsController {
  constructor(private userPasswordsService: UserPasswordsService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN_MANAGER)
  findAll() {
    return this.userPasswordsService.findAll();
  }

  @Patch(':userId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN_MANAGER)
  update(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserPasswordDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.userPasswordsService.update(userId, dto, user.id);
  }
}
