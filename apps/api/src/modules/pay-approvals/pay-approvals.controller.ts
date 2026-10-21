import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';
import { fileResponse } from '../../common/employee-files.util';
import { notificationUploadConfig } from '../../common/notification-upload.multer';
import { resolveUploadPath, safeFileName } from '../documents/documents.service';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  EmployeeApproverTarget,
  PayChangeStatus,
  UserRole,
} from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, StrictRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PayApprovalsService } from './pay-approvals.service';
import {
  PayChangeRequestsService,
  type PayActor,
} from './pay-change-requests.service';

class PayApprovalQueryDto {
  @IsOptional()
  @IsEnum(PayChangeStatus)
  status?: PayChangeStatus;

  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

class ApprovePayChangeDto {
  @IsOptional()
  @IsString()
  reviewNote?: string;

  /** Incentive requests only: the amount the approver settles on. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount?: number;
}

class RejectPayChangeDto {
  @IsString()
  @IsNotEmpty({ message: 'A reason is required to reject this request' })
  @MinLength(5, { message: 'Please give a reason of at least 5 characters' })
  reviewNote: string;
}

class ForwardPayChangeDto {
  @IsEnum(EmployeeApproverTarget)
  approverTarget: EmployeeApproverTarget;

  @IsString()
  @IsNotEmpty({ message: 'A reason is required to forward this request' })
  @MinLength(5, { message: 'Please give a reason of at least 5 characters' })
  reason: string;
}

class EditIncentiveRequestDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsUUID()
  typeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @Type(() => Number)
  @IsInt()
  @Min(2020)
  year: number;

  @IsEnum(EmployeeApproverTarget)
  approverTarget: EmployeeApproverTarget;
}

class ApproveManyDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids: string[];

  @IsOptional()
  @IsString()
  reviewNote?: string;
}

class CancelPayChangeDto {
  @IsString()
  @IsNotEmpty({ message: 'A reason is required to cancel this request' })
  @MinLength(5, { message: 'Please give a reason of at least 5 characters' })
  reason: string;
}

/** Finance sends pay requests, so Finance may correct or withdraw them. */
const SENDER_ROLES = [UserRole.PAYROLL_OFFICER, UserRole.SUPER_ADMIN];

const DECIDE_ROLES = [
  UserRole.PRESIDENT,
  UserRole.FOUNDER,
  UserRole.CHAIRMAN,
  UserRole.SUPER_ADMIN,
];

@Controller('pay-approvals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayApprovalsController {
  constructor(
    private requests: PayChangeRequestsService,
    private approvals: PayApprovalsService,
  ) {}

  @Get()
  @Roles(
    ...DECIDE_ROLES,
    UserRole.IT_ADMIN,
    UserRole.PAYROLL_OFFICER,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
  )
  list(@Query() query: PayApprovalQueryDto, @CurrentUser() user: PayActor) {
    return this.requests.list(query, user);
  }

  /** Approve several at once (one by one stays available below). */
  @Post('approve-many')
  @Roles(...DECIDE_ROLES)
  approveMany(@Body() dto: ApproveManyDto, @CurrentUser() user: PayActor) {
    return this.approvals.approveMany(dto.ids, user, dto.reviewNote);
  }

  @Post(':id/approve')
  @Roles(...DECIDE_ROLES)
  async approve(
    @Param('id') id: string,
    @Body() dto: ApprovePayChangeDto,
    @CurrentUser() user: PayActor,
  ) {
    // The approver may change a suggested incentive amount while approving.
    if (dto.amount != null) {
      const request = await this.requests.findOne(id);
      const p = (request.payload ?? {}) as Record<string, unknown>;
      if (request.kind === 'INCENTIVE' && Number(p.amount) !== dto.amount) {
        await this.requests.editIncentiveRequest(id, user, {
          amount: dto.amount,
          typeId: (p.typeId as string | undefined) ?? undefined,
          reason: (p.reason as string | undefined) ?? undefined,
          month: Number(p.month),
          year: Number(p.year),
          approverTarget: request.approverTarget,
        });
      }
    }
    return this.approvals.approve(id, user, dto.reviewNote);
  }

  @Post(':id/reject')
  @Roles(...DECIDE_ROLES)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectPayChangeDto,
    @CurrentUser() user: PayActor,
  ) {
    return this.requests.reject(id, user, dto.reviewNote);
  }

  /** The sender (Finance) or the request's approver corrects a pending incentive request. */
  @Patch(':id')
  @Roles(...SENDER_ROLES, ...DECIDE_ROLES)
  @StrictRoles()
  edit(
    @Param('id') id: string,
    @Body() dto: EditIncentiveRequestDto,
    @CurrentUser() user: PayActor,
  ) {
    return this.requests.editIncentiveRequest(id, user, dto);
  }

  @Post(':id/cancel')
  @Roles(...SENDER_ROLES)
  @StrictRoles()
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelPayChangeDto,
    @CurrentUser() user: PayActor,
  ) {
    return this.requests.cancel(id, user, dto.reason);
  }

  /** Finance attaches the signed notification (Basic / increment of a verified package). */
  @Post(':id/attachment')
  @Roles(...SENDER_ROLES)
  @UseInterceptors(FileInterceptor('file', notificationUploadConfig('pay-change-notifications')))
  attach(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: PayActor,
  ) {
    return this.requests.attach(id, file, user);
  }

  @Get(':id/attachment')
  @Roles(...SENDER_ROLES, ...DECIDE_ROLES, UserRole.IT_ADMIN)
  async attachment(@Param('id', ParseUUIDPipe) id: string) {
    const request = await this.requests.findOne(id);
    if (!request.attachmentUrl) throw new NotFoundException('No notification attached');
    const fullPath = resolveUploadPath(request.attachmentUrl);
    return fileResponse(
      fs.createReadStream(fullPath),
      safeFileName(request.attachmentFileName ?? `notification${path.extname(fullPath)}`),
    );
  }

  /** IT re-routes a pending request to another executive. */
  @Post(':id/forward')
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  forward(
    @Param('id') id: string,
    @Body() dto: ForwardPayChangeDto,
    @CurrentUser() user: PayActor,
  ) {
    return this.requests.forward(id, user, dto.approverTarget, dto.reason);
  }
}
