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
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
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
  @Roles(UserRole.HR_MANAGER, UserRole.ADMIN_OFFICER)
  create(@Body() dto: CreatePreviousEmploymentDto) {
    return this.previousEmploymentService.create(dto);
  }

  @Get(':employeeId')
  findAll(@Param('employeeId') employeeId: string) {
    return this.previousEmploymentService.findAll(employeeId);
  }

  @Patch(':id')
  @Roles(UserRole.HR_MANAGER, UserRole.ADMIN_OFFICER)
  update(@Param('id') id: string, @Body() dto: UpdatePreviousEmploymentDto) {
    return this.previousEmploymentService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.HR_MANAGER, UserRole.HR_ADMIN_MANAGER)
  delete(@Param('id') id: string) {
    return this.previousEmploymentService.delete(id);
  }
}
