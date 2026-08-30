import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { Response } from 'express';
import {
  CloseInquiryDto,
  CreateDisciplinaryDto,
  DecideSuspensionDto,
  DisciplinaryQueryDto,
  PrepareSuspensionDto,
  RecordInquiryFindingDto,
  RejectSuspensionDto,
  ResolveInquiryDto,
  StartInquiryDto,
  SubmitInquiryFinalDecisionDto,
  UpdateSuspensionRequestDto,
} from './disciplinary.dto';
import { DisciplinaryService } from './disciplinary.service';
import { InquiryDecisionService } from './inquiry-decision.service';
import { InquiryOpeningService } from './inquiry-opening.service';
import { SuspensionRequestService } from './suspension-request.service';

const SUSPENSION_PREPARE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.ADMIN_MANAGER,
] as const;

const SUSPENSION_APPROVER_ROUTE_ROLES = [
  UserRole.FOUNDER,
  UserRole.PRESIDENT,
  UserRole.CHAIRMAN,
  UserRole.ADMIN_MANAGER,
] as const;

@Controller('disciplinary')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DisciplinaryController {
  constructor(
    private disciplinaryService: DisciplinaryService,
    private suspensionRequestService: SuspensionRequestService,
    private inquiryDecisionService: InquiryDecisionService,
    private inquiryOpeningService: InquiryOpeningService,
  ) {}

  @Post('inquiry')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER)
  startInquiry(
    @Body() dto: StartInquiryDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.disciplinaryService.startInquiry(dto, user.id);
  }

  @Patch('inquiry/resolve')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER)
  resolveInquiry(
    @Body() dto: ResolveInquiryDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.disciplinaryService.resolveInquiry(dto, user.id);
  }

  @Get('suspension/eligible-approvers')
  @Roles(...SUSPENSION_PREPARE_ROLES)
  listEligibleApprovers() {
    return this.suspensionRequestService.listEligibleApprovers();
  }

  @Get('suspension/inquiry-officers')
  @Roles(...SUSPENSION_PREPARE_ROLES)
  listInquiryOfficers() {
    return this.suspensionRequestService.listInquiryOfficerCandidates();
  }

  @Post(':actionId/suspension/prepare')
  @Roles(...SUSPENSION_PREPARE_ROLES)
  prepareSuspension(
    @Param('actionId') actionId: string,
    @Body() dto: PrepareSuspensionDto,
    @CurrentUser() user: { id: string; role: UserRole; roles?: UserRole[] },
  ) {
    return this.suspensionRequestService.prepare(
      actionId,
      {
        reason: dto.reason,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        inquiryOfficerUserId: dto.inquiryOfficerUserId,
        inquiryDeadlineAt: new Date(dto.inquiryDeadlineAt),
        selectedApproverUserId: dto.selectedApproverUserId,
      },
      user.id,
      user.role,
      user.roles,
    );
  }

  @Get('suspension-requests/:id')
  @Roles(...SUSPENSION_PREPARE_ROLES)
  getSuspensionRequest(@Param('id') id: string) {
    return this.suspensionRequestService.findOne(id);
  }

  @Patch('suspension-requests/:id')
  @Roles(...SUSPENSION_PREPARE_ROLES)
  updateSuspensionRequest(
    @Param('id') id: string,
    @Body() dto: UpdateSuspensionRequestDto,
    @CurrentUser() user: { id: string; role: UserRole; roles?: UserRole[] },
  ) {
    return this.suspensionRequestService.updateDraft(
      id,
      {
        reason: dto.reason,
        periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
        inquiryOfficerUserId: dto.inquiryOfficerUserId,
        inquiryDeadlineAt: dto.inquiryDeadlineAt
          ? new Date(dto.inquiryDeadlineAt)
          : undefined,
        selectedApproverUserId: dto.selectedApproverUserId,
      },
      user.id,
      user.role,
      user.roles,
    );
  }

  @Post('suspension-requests/:id/submit')
  @Roles(...SUSPENSION_PREPARE_ROLES)
  submitSuspensionRequest(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: UserRole; roles?: UserRole[] },
  ) {
    return this.suspensionRequestService.submit(
      id,
      user.id,
      user.role,
      user.roles,
    );
  }

  @Get('suspension-approvals/my-pending')
  @Roles(...SUSPENSION_APPROVER_ROUTE_ROLES)
  listMyPendingApprovals(@CurrentUser() user: { id: string }) {
    return this.suspensionRequestService.listMyPending(user.id);
  }

  @Get('suspension-approvals/:id/letter-pdf')
  @Roles(...SUSPENSION_APPROVER_ROUTE_ROLES)
  async getAssignedLetterPdf(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Res() res: Response,
  ) {
    const { buffer, filename } =
      await this.suspensionRequestService.getAssignedLetterPdf(id, user.id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    });
    res.send(buffer);
  }

  @Get('suspension-approvals/:id')
  @Roles(...SUSPENSION_APPROVER_ROUTE_ROLES)
  getAssignedApproval(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.suspensionRequestService.findOneForApprover(id, user.id);
  }

  @Post('suspension-requests/:id/approve')
  @Roles(...SUSPENSION_APPROVER_ROUTE_ROLES)
  approveSuspensionRequest(
    @Param('id') id: string,
    @Body() dto: DecideSuspensionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.suspensionRequestService.approve(id, user.id, dto.note);
  }

  @Post('suspension-requests/:id/reject')
  @Roles(...SUSPENSION_APPROVER_ROUTE_ROLES)
  rejectSuspensionRequest(
    @Param('id') id: string,
    @Body() dto: RejectSuspensionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.suspensionRequestService.reject(id, user.id, dto.reason);
  }

  @Post('inquiries/:id/close')
  @Roles(...SUSPENSION_PREPARE_ROLES)
  closeInquiry(
    @Param('id') id: string,
    @Body() dto: CloseInquiryDto,
    @CurrentUser() user: { id: string; role: UserRole; roles?: UserRole[] },
  ) {
    return this.inquiryDecisionService.closeInquiry(
      id,
      dto,
      user.id,
      user.role,
      user.roles,
    );
  }

  @Get('inquiry-open-approvals/my-pending')
  @Roles(...SUSPENSION_APPROVER_ROUTE_ROLES)
  listMyPendingOpenApprovals(@CurrentUser() user: { id: string }) {
    return this.inquiryOpeningService.listMyPending(user.id);
  }

  @Post('inquiries/:id/open/approve')
  @Roles(...SUSPENSION_APPROVER_ROUTE_ROLES)
  approveInquiryOpen(
    @Param('id') id: string,
    @Body() dto: DecideSuspensionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.inquiryOpeningService.approveOpen(id, user.id, dto.note);
  }

  @Post('inquiries/:id/open/reject')
  @Roles(...SUSPENSION_APPROVER_ROUTE_ROLES)
  rejectInquiryOpen(
    @Param('id') id: string,
    @Body() dto: RejectSuspensionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.inquiryOpeningService.rejectOpen(id, user.id, dto.reason);
  }

  @Post('inquiries/:id/finding')
  recordInquiryFinding(
    @Param('id') id: string,
    @Body() dto: RecordInquiryFindingDto,
    @CurrentUser() user: { id: string; role: UserRole; roles?: UserRole[] },
  ) {
    return this.inquiryDecisionService.recordFinding(
      id,
      dto.finding,
      user.id,
      dto.notes,
      user.role,
      user.roles,
    );
  }

  @Post('inquiries/:id/final-decision')
  @Roles(...SUSPENSION_PREPARE_ROLES)
  submitInquiryFinalDecision(
    @Param('id') id: string,
    @Body() dto: SubmitInquiryFinalDecisionDto,
    @CurrentUser() user: { id: string; role: UserRole; roles?: UserRole[] },
  ) {
    return this.inquiryDecisionService.submitFinalDecision(
      id,
      dto,
      user.id,
      user.role,
      user.roles,
    );
  }

  @Get('inquiry-decisions/my-pending')
  @Roles(...SUSPENSION_APPROVER_ROUTE_ROLES)
  listMyPendingInquiryDecisions(@CurrentUser() user: { id: string }) {
    return this.inquiryDecisionService.listMyPending(user.id);
  }

  @Get('inquiry-decisions/:id')
  @Roles(...SUSPENSION_APPROVER_ROUTE_ROLES)
  getAssignedInquiryDecision(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.inquiryDecisionService.findOneForApprover(id, user.id);
  }

  @Post('inquiries/:id/final-decision/approve')
  @Roles(...SUSPENSION_APPROVER_ROUTE_ROLES)
  approveInquiryFinalDecision(
    @Param('id') id: string,
    @Body() dto: DecideSuspensionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.inquiryDecisionService.approve(id, user.id, dto.note);
  }

  @Post('inquiries/:id/final-decision/reject')
  @Roles(...SUSPENSION_APPROVER_ROUTE_ROLES)
  rejectInquiryFinalDecision(
    @Param('id') id: string,
    @Body() dto: RejectSuspensionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.inquiryDecisionService.reject(id, user.id, dto.reason);
  }

  @Post('inquiries/:id/final-letters/generate-missing')
  @Roles(...SUSPENSION_PREPARE_ROLES)
  generateMissingFinalLetters(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: UserRole; roles?: UserRole[] },
  ) {
    return this.inquiryDecisionService.generateMissingFinalLetters(
      id,
      user.id,
      user.role,
      user.roles,
    );
  }

  @Post()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.HR_EXECUTIVE,
  )
  create(
    @Body() dto: CreateDisciplinaryDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.disciplinaryService.create(dto, user.id, user.role);
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
  )
  findAll(
    @Query() query: DisciplinaryQueryDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.disciplinaryService.findAll(query, user);
  }

  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.IT_ADMIN,
  )
  findOne(@Param('id') id: string) {
    return this.disciplinaryService.findOne(id);
  }
}
