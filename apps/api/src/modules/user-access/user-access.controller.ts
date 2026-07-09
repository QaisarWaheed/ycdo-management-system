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
  CreateSystemLoginDto,
  ResetLoginPasswordDto,
  UpdateUserAccessDto,
  UserAccessQueryDto,
} from './user-access.dto';
import { UserAccessService } from './user-access.service';

@Controller('user-access')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
export class UserAccessController {
  constructor(private userAccessService: UserAccessService) {}

  @Get()
  findAll(@Query() query: UserAccessQueryDto) {
    return this.userAccessService.findAll(query);
  }

  @Get('meta')
  getMeta(@CurrentUser() user: { role: UserRole }) {
    return {
      permissions: this.userAccessService.getPermissionCatalog(),
      assignableRoles: this.userAccessService.assignableRoles(user.role),
      permissionLabels: this.userAccessService.permissionLabels(),
    };
  }

  @Get(':userId')
  findOne(@Param('userId') userId: string) {
    return this.userAccessService.findOne(userId);
  }

  @Patch(':userId')
  update(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserAccessDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.userAccessService.update(userId, dto, user.id, user.role);
  }

  @Post()
  create(
    @Body() dto: CreateSystemLoginDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.userAccessService.createSystemLogin(dto, user.id, user.role);
  }

  @Patch(':userId/password')
  resetPassword(
    @Param('userId') userId: string,
    @Body() dto: ResetLoginPasswordDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.userAccessService.resetPassword(userId, dto, user.id);
  }
}
