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
import { AccessScopeService } from '../permissions/access-scope.service';
import { GenerateLetterDto, LetterQueryDto } from './letters.dto';
import { LettersService } from './letters.service';

@Controller('letters')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LettersController {
  constructor(
    private lettersService: LettersService,
    private accessScopeService: AccessScopeService,
  ) {}

  @Post()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  generate(
    @Body() dto: GenerateLetterDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.lettersService.generate(dto, user.id, user.role);
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.EMPLOYEE,
  )
  async findAll(
    @Query() query: LetterQueryDto,
    @CurrentUser()
    user: {
      id: string;
      role: UserRole;
      roles?: UserRole[];
      employeeId?: string | null;
    },
  ) {
    const effectiveRoles = user.roles?.length ? user.roles : [user.role];
    const isPortalOnly =
      effectiveRoles.length === 1 && effectiveRoles[0] === UserRole.EMPLOYEE;
    const hasManagerScopes =
      await this.accessScopeService.userHasManagerScopes(user.id);

    if (isPortalOnly && !hasManagerScopes) {
      if (!user.employeeId) {
        throw new ForbiddenException('Employee profile required');
      }
      return this.lettersService.findAll(
        {
          ...query,
          employeeId: user.employeeId,
        },
        user,
      );
    }
    return this.lettersService.findAll(query, user);
  }

  @Get(':id/pdf')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.IT_ADMIN,
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
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.IT_ADMIN,
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
