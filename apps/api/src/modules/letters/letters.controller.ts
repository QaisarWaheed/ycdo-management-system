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
import {
  GenerateLetterDto,
  LetterQueryDto,
  PreviewLetterDto,
  ReverseLetterDto,
  UpdateLetterDto,
} from './letters.dto';
import {
  CreateLetterTemplateDto,
  PreviewLetterTemplateDto,
  UpdateLetterTemplateDto,
} from './letter-templates.dto';
import { LettersService } from './letters.service';

@Controller('letters')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LettersController {
  constructor(
    private lettersService: LettersService,
    private accessScopeService: AccessScopeService,
  ) {}

  @Get('templates')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.IT_ADMIN,
  )
  listTemplates(@Query('includeInactive') includeInactive?: string) {
    return this.lettersService.listTemplates(includeInactive === 'true');
  }

  @Get('templates/:code')
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  getTemplate(@Param('code') code: string) {
    return this.lettersService.getTemplate(code);
  }

  @Post('templates')
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  createTemplate(
    @Body() dto: CreateLetterTemplateDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.lettersService.createTemplate(dto, user.id);
  }

  @Post('templates/preview')
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  previewTemplateDraft(@Body() dto: PreviewLetterTemplateDto) {
    return this.lettersService.previewTemplateDraft(dto);
  }

  @Patch('templates/:code')
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  updateTemplate(
    @Param('code') code: string,
    @Body() dto: UpdateLetterTemplateDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.lettersService.updateTemplate(code, dto, user.id);
  }

  @Delete('templates/:code')
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  deleteTemplate(
    @Param('code') code: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.lettersService.deleteTemplate(code, user.id);
  }

  @Post('preview')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  preview(
    @Body() dto: PreviewLetterDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.lettersService.preview(dto, user.id, user.role);
  }

  @Post()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  generate(
    @Body() dto: GenerateLetterDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.lettersService.generate(dto, user.id, user.role);
  }

  @Patch(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  updateLetter(
    @Param('id') id: string,
    @Body() dto: UpdateLetterDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.lettersService.updateLetter(id, dto, user.id, user.role);
  }

  @Post(':id/send')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  sendLetter(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.lettersService.sendLetter(id, user.id, user.role);
  }

  @Post(':id/reverse')
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  reverseLetter(
    @Param('id') id: string,
    @Body() dto: ReverseLetterDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.lettersService.reverseLetter(id, dto, user.id);
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
        { ...user, portalOnly: true },
      );
    }
    return this.lettersService.findAll(query, user);
  }

  @Get('pending')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  async findPending(
    @CurrentUser()
    user: {
      id: string;
      role: UserRole;
    },
  ) {
    return this.lettersService.findPending(user);
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
  async getPdf(
    @Param('id') id: string,
    @CurrentUser()
    user: {
      id: string;
      role: UserRole;
      roles?: UserRole[];
      employeeId?: string | null;
    },
    @Res() res: Response,
  ) {
    const actor = await this.resolveLetterActor(user);
    const { buffer, filename } = await this.lettersService.getPdf(id, actor);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  @Get(':id/whatsapp-share')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  getWhatsAppShare(@Param('id') id: string) {
    return this.lettersService.getWhatsAppShare(id);
  }

  @Post(':id/mark-whatsapp-shared')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  markWhatsAppShared(@Param('id') id: string) {
    return this.lettersService.markWhatsAppShared(id);
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
  findOne(
    @Param('id') id: string,
    @CurrentUser()
    user: {
      id: string;
      role: UserRole;
      roles?: UserRole[];
      employeeId?: string | null;
    },
  ) {
    return this.resolveLetterActor(user).then((actor) =>
      this.lettersService.findOne(id, actor),
    );
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

  private async resolveLetterActor(user: {
    id: string;
    role: UserRole;
    roles?: UserRole[];
    employeeId?: string | null;
  }) {
    const effectiveRoles = user.roles?.length ? user.roles : [user.role];
    const isPortalOnly =
      effectiveRoles.length === 1 && effectiveRoles[0] === UserRole.EMPLOYEE;
    const hasManagerScopes =
      await this.accessScopeService.userHasManagerScopes(user.id);

    if (isPortalOnly && !hasManagerScopes) {
      if (!user.employeeId) {
        throw new ForbiddenException('Employee profile required');
      }
      return { ...user, portalOnly: true as const };
    }
    return user;
  }
}
