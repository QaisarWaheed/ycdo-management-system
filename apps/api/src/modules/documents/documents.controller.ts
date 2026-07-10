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
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { assertCanEditPersonalInfo } from '../../common/hr-executive.util';
import { UploadDocumentDto } from './documents.dto';
import { DocumentsService } from './documents.service';
import { multerConfig } from './multer.config';

@Controller('employees/:id/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', multerConfig))
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
    UserRole.IT_ADMIN,
  )
  upload(
    @Param('id') id: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { role: UserRole },
  ) {
    assertCanEditPersonalInfo(user.role);
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    return this.documentsService.upload(id, dto, file);
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
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.IT_ADMIN)
  delete(
    @Param('documentId') documentId: string,
    @CurrentUser() user: { role: UserRole },
  ) {
    assertCanEditPersonalInfo(user.role);
    return this.documentsService.delete(documentId);
  }
}
