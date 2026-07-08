import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateShiftDto, UpdateShiftDto } from './shifts.dto';
import { ShiftsService } from './shifts.service';

@Controller('shifts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShiftsController {
  constructor(private shiftsService: ShiftsService) {}

  @Get()
  findAll(@Query('branchId') branchId?: string) {
    return this.shiftsService.findAll(branchId);
  }

  @Get('branch/:branchId')
  getShiftsByBranch(@Param('branchId') branchId: string) {
    return this.shiftsService.getShiftsByBranch(branchId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.shiftsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  create(@Body() dto: CreateShiftDto) {
    return this.shiftsService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateShiftDto) {
    return this.shiftsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  deactivate(@Param('id') id: string) {
    return this.shiftsService.deactivate(id);
  }
}
