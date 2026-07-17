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
  CreateDisciplinaryDto,
  DisciplinaryQueryDto,
  ResolveInquiryDto,
  StartInquiryDto,
} from './disciplinary.dto';
import { DisciplinaryService } from './disciplinary.service';

@Controller('disciplinary')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DisciplinaryController {
  constructor(private disciplinaryService: DisciplinaryService) {}

  @Post('inquiry')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER)
  startInquiry(
    @Body() dto: StartInquiryDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.disciplinaryService.startInquiry(dto, user.id);
  }

  @Patch('inquiry/resolve')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER)
  resolveInquiry(
    @Body() dto: ResolveInquiryDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.disciplinaryService.resolveInquiry(dto, user.id);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.ADMIN_MANAGER)
  create(
    @Body() dto: CreateDisciplinaryDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.disciplinaryService.create(dto, user.id, user.role);
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.IT_ADMIN,
  )
  findAll(
    @Query() query: DisciplinaryQueryDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.disciplinaryService.findAll(query, user);
  }

  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.IT_ADMIN,
  )
  findOne(@Param('id') id: string) {
    return this.disciplinaryService.findOne(id);
  }
}
