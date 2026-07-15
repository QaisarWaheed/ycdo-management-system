import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Permission, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { HR_PERSONAL_EDIT_ROLES } from '../../common/hr-executive.util';
import { PermissionsService } from '../permissions/permissions.service';
import { UploadDocumentDto } from './documents.dto';
import { DocumentsService } from './documents.service';
import { multerConfig } from './multer.config';

@Controller('employees/:id/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(
    private documentsService: DocumentsService,
    private permissionsService: PermissionsService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', multerConfig))
  @Roles(...HR_PERSONAL_EDIT_ROLES)
  async upload(
    @Param('id') id: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    const canEdit = await this.permissionsService.userHasPermission(
      user.id,
      user.role,
      Permission.EMPLOYEES_EDIT,
    );
    if (!canEdit) {
      throw new ForbiddenException(
        'You do not have permission to upload employee documents',
      );
    }
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    return this.documentsService.upload(id, dto, file);
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_EXECUTIVE,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.IT_ADMIN,
    UserRole.EMPLOYEE,
  )
  findAll(
    @Param('id') id: string,
    @CurrentUser() user: { role: UserRole; employeeId?: string | null },
  ) {
    if (user.role === UserRole.EMPLOYEE && user.employeeId !== id) {
      throw new ForbiddenException('Access denied');
    }
    return this.documentsService.findAll(id);
  }

  @Delete(':documentId')
  @Roles(...HR_PERSONAL_EDIT_ROLES)
  async delete(
    @Param('documentId') documentId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    const canEdit = await this.permissionsService.userHasPermission(
      user.id,
      user.role,
      Permission.EMPLOYEES_EDIT,
    );
    if (!canEdit) {
      throw new ForbiddenException(
        'You do not have permission to delete employee documents',
      );
    }
    return this.documentsService.delete(documentId);
  }
}
