import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { GenerateLetterDto, LetterQueryDto } from './letters.dto';
import { LettersService } from './letters.service';

@Controller('letters')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LettersController {
  constructor(private lettersService: LettersService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.ADMIN_MANAGER)
  generate(
    @Body() dto: GenerateLetterDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.lettersService.generate(dto, user.id);
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.EMPLOYEE,
  )
  findAll(
    @Query() query: LetterQueryDto,
    @CurrentUser() user: { role: UserRole; employeeId?: string | null },
  ) {
    if (user.role === UserRole.EMPLOYEE) {
      if (!user.employeeId) {
        throw new ForbiddenException('Employee profile required');
      }
      return this.lettersService.findAll({
        ...query,
        employeeId: user.employeeId,
      });
    }
    return this.lettersService.findAll(query);
  }

  @Get(':id/pdf')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.EMPLOYEE,
  )
  async getPdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.lettersService.getPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.EMPLOYEE,
  )
  findOne(@Param('id') id: string) {
    return this.lettersService.findOne(id);
  }

  @Patch(':id/printed')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.ADMIN_MANAGER)
  markPrinted(@Param('id') id: string) {
    return this.lettersService.markPrinted(id);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER)
  deleteLetter(@Param('id') id: string) {
    return this.lettersService.deleteLetterr(id);
  }
}
