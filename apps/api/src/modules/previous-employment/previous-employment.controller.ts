import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { assertCanEditPersonalInfo } from '../../common/hr-executive.util';
import {
  CreatePreviousEmploymentDto,
  UpdatePreviousEmploymentDto,
} from './previous-employment.dto';
import { PreviousEmploymentService } from './previous-employment.service';

@Controller('previous-employment')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PreviousEmploymentController {
  constructor(private previousEmploymentService: PreviousEmploymentService) {}

  @Post()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.IT_ADMIN,
  )
  create(
    @Body() dto: CreatePreviousEmploymentDto,
    @CurrentUser() user: { role: UserRole },
  ) {
    assertCanEditPersonalInfo(user.role);
    return this.previousEmploymentService.create(dto);
  }

  @Get(':employeeId')
  findAll(@Param('employeeId') employeeId: string) {
    return this.previousEmploymentService.findAll(employeeId);
  }

  @Patch(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.IT_ADMIN,
  )
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePreviousEmploymentDto,
    @CurrentUser() user: { role: UserRole },
  ) {
    assertCanEditPersonalInfo(user.role);
    return this.previousEmploymentService.update(id, dto);
  }

  @Delete(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.IT_ADMIN,
  )
  delete(
    @Param('id') id: string,
    @CurrentUser() user: { role: UserRole },
  ) {
    assertCanEditPersonalInfo(user.role);
    return this.previousEmploymentService.delete(id);
  }
}
