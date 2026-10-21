import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LoanKind, LoanPurpose, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import * as fs from 'fs';
import * as path from 'path';
import { fileResponse } from '../../common/employee-files.util';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  resolveUploadPath,
  safeFileName,
} from '../documents/documents.service';
import { notificationUploadConfig } from '../../common/notification-upload.multer';
import { LoansService } from './loans.service';

/** Finance and HR make loan applications and record the Founder's decision. */
const LOAN_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.PAYROLL_OFFICER,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_EXECUTIVE,
];
const LOAN_READ_ROLES = [
  ...LOAN_ROLES,
  UserRole.FOUNDER,
  UserRole.CHAIRMAN,
  UserRole.PRESIDENT,
];

class CreateLoanDto {
  @IsUUID() employeeId: string;
  @Type(() => Number) @IsNumber() @IsPositive() amount: number;
  @Type(() => Number) @IsNumber() @IsPositive() monthlyInstallment: number;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) startMonth: string;
  @IsOptional() @IsEnum(LoanKind) kind?: LoanKind;
  @IsOptional() @IsEnum(LoanPurpose) purpose?: LoanPurpose;
  @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

class AmendLoanDto {
  @Type(() => Number) @IsNumber() @IsPositive() monthlyInstallment: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class DecisionDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

@Controller('loans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LoansController {
  constructor(private loans: LoansService) {}

  @Get('employee/:employeeId')
  @Roles(...LOAN_READ_ROLES)
  forEmployee(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.loans.forEmployee(employeeId);
  }

  @Post()
  @Roles(...LOAN_ROLES)
  create(@Body() dto: CreateLoanDto, @CurrentUser() user: { id: string }) {
    return this.loans.create(dto, user.id);
  }

  /** Multipart: `file` = signed notification (required), `note` optional. */
  @Post(':id/approve')
  @Roles(...LOAN_ROLES)
  @UseInterceptors(FileInterceptor('file', notificationUploadConfig('loan-notifications')))
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: DecisionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.loans.approve(id, file, dto.note, user.id);
  }

  @Post(':id/reject')
  @Roles(...LOAN_ROLES)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.loans.decide(id, 'REJECTED', dto.note, user.id);
  }

  @Post(':id/cancel')
  @Roles(...LOAN_ROLES)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.loans.decide(id, 'CANCELLED', dto.note, user.id);
  }

  /** Change the monthly installment of an approved loan. */
  @Post(':id/amend')
  @Roles(...LOAN_ROLES)
  amend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AmendLoanDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.loans.amendInstallment(id, dto.monthlyInstallment, dto.note, user.id);
  }

  @Get(':id/notification')
  @Roles(...LOAN_READ_ROLES)
  async notification(@Param('id', ParseUUIDPipe) id: string) {
    const loan = await this.loans.findOne(id);
    if (!loan.notificationUrl)
      throw new NotFoundException('No notification uploaded');
    const fullPath = resolveUploadPath(loan.notificationUrl);
    return fileResponse(
      fs.createReadStream(fullPath),
      safeFileName(
        loan.notificationFileName ?? `notification${path.extname(fullPath)}`,
      ),
    );
  }
}
