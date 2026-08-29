import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeApproverTarget,
  EmployeeOnboardingStatus,
  EmployeeStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LettersService } from '../letters/letters.service';
import { appointmentExtraFieldsFromEmployee } from '../letters/selection-letter.helper';
import { LetterType, StaffType } from '@prisma/client';
import { normalizePakistanPhone } from '../whatsapp/phone.util';
import {
  APPROVER_TARGET_LABELS,
  approverTargetForUserRole,
  canReviewApproval,
  userRoleForApproverTarget,
} from './employee-onboarding.util';
import type {
  OnboardingQueryDto,
  WhatsAppShareQueryDto,
} from './employee-onboarding.dto';

type ActingUser = {
  id: string;
  role: UserRole | string;
};

@Injectable()
export class EmployeeOnboardingService {
  constructor(
    private prisma: PrismaService,
    private lettersService: LettersService,
  ) {}

  async findPending(user: ActingUser) {
    const target = approverTargetForUserRole(user.role);
    if (!target && user.role !== UserRole.SUPER_ADMIN) {
      return [];
    }

    return this.prisma.employeeOnboardingApproval.findMany({
      where: {
        status: EmployeeOnboardingStatus.PENDING,
        ...(user.role === UserRole.SUPER_ADMIN ? {} : { approverTarget: target! }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        employee: {
          include: {
            currentBranch: { select: { name: true, abbreviation: true } },
            currentDepartment: { select: { name: true } },
            academicQualifications: true,
            previousEmployments: true,
            stipendRecords: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
          },
        },
        submittedBy: {
          select: {
            id: true,
            email: true,
            employee: { select: { fullName: true } },
          },
        },
      },
    });
  }

  async findAll(query: OnboardingQueryDto, user: ActingUser) {
    const target = approverTargetForUserRole(user.role);
    const status = query.status ?? EmployeeOnboardingStatus.PENDING;

    return this.prisma.employeeOnboardingApproval.findMany({
      where: {
        status,
        ...(user.role === UserRole.SUPER_ADMIN ? {} : { approverTarget: target! }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        employee: {
          include: {
            currentBranch: { select: { name: true, abbreviation: true } },
            currentDepartment: { select: { name: true } },
          },
        },
        submittedBy: {
          select: {
            id: true,
            email: true,
            employee: { select: { fullName: true } },
          },
        },
        reviewedBy: {
          select: {
            id: true,
            email: true,
            employee: { select: { fullName: true } },
          },
        },
      },
    });
  }

  async findOne(id: string, user: ActingUser) {
    const approval = await this.prisma.employeeOnboardingApproval.findUnique({
      where: { id },
      include: {
        employee: {
          include: {
            currentBranch: { select: { name: true, abbreviation: true, address: true } },
            currentDepartment: { select: { name: true } },
            shift: true,
            academicQualifications: true,
            previousEmployments: true,
            stipendRecords: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
          },
        },
        submittedBy: {
          select: {
            id: true,
            email: true,
            employee: { select: { fullName: true } },
          },
        },
        reviewedBy: {
          select: {
            id: true,
            email: true,
            employee: { select: { fullName: true } },
          },
        },
      },
    });

    if (!approval) {
      throw new NotFoundException('Onboarding approval request not found');
    }

    if (
      user.role !== UserRole.SUPER_ADMIN &&
      !canReviewApproval(user.role, approval.approverTarget)
    ) {
      throw new ForbiddenException('You cannot view this approval request');
    }

    return approval;
  }

  async uploadPhysicalForm(
    employeeId: string,
    file: Express.Multer.File,
    user: ActingUser,
  ) {
    if (!file) {
      throw new BadRequestException('Physical form file is required');
    }

    const approval = await this.prisma.employeeOnboardingApproval.findUnique({
      where: { employeeId },
    });

    if (!approval) {
      throw new NotFoundException(
        'No pending onboarding approval found for this employee',
      );
    }

    if (approval.status !== EmployeeOnboardingStatus.PENDING) {
      throw new BadRequestException(
        'Physical form can only be attached while the request is pending',
      );
    }

    if (
      user.role !== UserRole.SUPER_ADMIN &&
      approval.submittedById !== user.id
    ) {
      const hrRoles: UserRole[] = [
        UserRole.HR_MANAGER,
        UserRole.HR_ADMIN_MANAGER,
        UserRole.ADMIN_OFFICER,
        UserRole.ADMIN_MANAGER,
        UserRole.HR_EXECUTIVE,
      ];
      if (!hrRoles.includes(user.role as UserRole)) {
        throw new ForbiddenException(
          'You cannot upload a physical form for this request',
        );
      }
    }

    const fileUrl = `/uploads/onboarding-forms/${employeeId}/${file.filename}`;

    return this.prisma.employeeOnboardingApproval.update({
      where: { id: approval.id },
      data: {
        physicalFormUrl: fileUrl,
        physicalFormMimeType: file.mimetype,
        physicalFormFileName: file.originalname,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
          },
        },
      },
    });
  }

  async approve(id: string, user: ActingUser, reviewNote?: string) {
    const approval = await this.getPendingForReview(id, user);

    await this.prisma.$transaction(async (tx) => {
      await tx.employeeOnboardingApproval.update({
        where: { id },
        data: {
          status: EmployeeOnboardingStatus.APPROVED,
          reviewedById: user.id,
          reviewedAt: new Date(),
          reviewNote: reviewNote?.trim() || null,
        },
      });

      await tx.employee.update({
        where: { id: approval.employeeId },
        data: { status: EmployeeStatus.ACTIVE },
      });

      await tx.user.updateMany({
        where: { employeeId: approval.employeeId },
        data: { isActive: true },
      });
    });

    const employee = await this.prisma.employee.findUnique({
      where: { id: approval.employeeId },
      include: {
        currentBranch: { select: { name: true } },
        currentDepartment: { select: { name: true } },
        shift: { select: { name: true } },
        stipendRecords: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
      },
    });

    if (employee && employee.staffType !== StaffType.EXISTING) {
      try {
        const snapshot = approval.formSnapshot as Record<string, unknown>;
        const stipendRecord = employee.stipendRecords[0]?.basicStipend;
        const basicStipend = Number(
          stipendRecord ?? snapshot.basicStipend ?? 0,
        );

        // Appointment letter is created as DRAFT. HR must send explicitly.
        await this.lettersService.generateSystemLetter({
          employeeId: employee.id,
          letterType: LetterType.APPOINTMENT,
          extraFields: appointmentExtraFieldsFromEmployee(
            employee,
            basicStipend,
          ),
        });
      } catch (error) {
        console.error('Post-approval letter generation failed:', error);
      }
    }

    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'EMPLOYEE_ONBOARDING_APPROVED',
        entity: 'EmployeeOnboardingApproval',
        entityId: id,
        changes: {
          employeeId: approval.employeeId,
          approverTarget: approval.approverTarget,
        },
      },
    });

    return this.findOne(id, user);
  }

  async reject(id: string, user: ActingUser, reviewNote?: string) {
    const reason = reviewNote?.trim();
    if (!reason) {
      throw new BadRequestException(
        'A reason is required to reject this application',
      );
    }

    const approval = await this.getPendingForReview(id, user);

    await this.prisma.$transaction(async (tx) => {
      await tx.employeeOnboardingApproval.update({
        where: { id },
        data: {
          status: EmployeeOnboardingStatus.REJECTED,
          reviewedById: user.id,
          reviewedAt: new Date(),
          reviewNote: reason,
        },
      });

      await tx.employee.update({
        where: { id: approval.employeeId },
        data: { status: EmployeeStatus.TERMINATED },
      });

      await tx.user.updateMany({
        where: { employeeId: approval.employeeId },
        data: { isActive: false },
      });
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'EMPLOYEE_ONBOARDING_REJECTED',
        entity: 'EmployeeOnboardingApproval',
        entityId: id,
        changes: {
          employeeId: approval.employeeId,
          approverTarget: approval.approverTarget,
          reviewNote: reason,
        },
      },
    });

    return this.findOne(id, user);
  }

  private async getPendingForReview(id: string, user: ActingUser) {
    const approval = await this.prisma.employeeOnboardingApproval.findUnique({
      where: { id },
    });

    if (!approval) {
      throw new NotFoundException('Onboarding approval request not found');
    }

    if (approval.status !== EmployeeOnboardingStatus.PENDING) {
      throw new BadRequestException('This request has already been reviewed');
    }

    if (!canReviewApproval(user.role, approval.approverTarget)) {
      throw new ForbiddenException(
        `Only ${APPROVER_TARGET_LABELS[approval.approverTarget]} can review this request`,
      );
    }

    return approval;
  }

  /**
   * Build a WhatsApp Web / wa.me URL so HR can notify the executive with a
   * prefilled message + HRMS login link (no Meta Cloud API required).
   */
  async buildWhatsAppShare(query: WhatsAppShareQueryDto) {
    let approverTarget = query.approverTarget;
    let employeeName = 'a new employee';
    let employeeCode = '';

    if (query.employeeId) {
      const employee = await this.prisma.employee.findUnique({
        where: { id: query.employeeId },
        select: { fullName: true, employeeCode: true },
      });
      if (employee) {
        employeeName = employee.fullName;
        employeeCode = employee.employeeCode;
      }

      if (!approverTarget) {
        const pending = await this.prisma.employeeOnboardingApproval.findFirst({
          where: {
            employeeId: query.employeeId,
            status: EmployeeOnboardingStatus.PENDING,
          },
          orderBy: { createdAt: 'desc' },
        });
        if (!pending) {
          throw new BadRequestException(
            'No pending onboarding approval found for this employee',
          );
        }
        approverTarget = pending.approverTarget;
      }
    }

    if (!approverTarget) {
      throw new BadRequestException(
        'approverTarget or employeeId with a pending approval is required',
      );
    }

    const label = APPROVER_TARGET_LABELS[approverTarget];

    const phoneE164 =
      normalizePakistanPhone(query.phone) ??
      (await this.resolveApproverPhone(approverTarget));

    const hrmsBase = (
      query.hrmsBaseUrl ||
      process.env.HRMS_PUBLIC_URL ||
      process.env.PUBLIC_HRMS_URL ||
      'https://hrms-web.ycdo.org.pk'
    ).replace(/\/$/, '');

    const loginUrl = `${hrmsBase}/login`;

    // WhatsApp inherits paragraph direction from the first strong character.
    // Isolate Urdu (RTL) and English (LTR) so each block aligns correctly.
    const RLI = '\u2067';
    const LRI = '\u2066';
    const PDI = '\u2069';

    const employeeLine = `${employeeName}${employeeCode ? ` (${employeeCode})` : ''}`;

    const urdu = [
      `السلام علیکم ${label} صاحب،`,
      '',
      `ایک نیا ملازم آن بورڈنگ کی درخواست آپ کی منظوری کا منتظر ہے:`,
      `نام: ${employeeLine}`,
      '',
      `براہ کرم HRMS میں لاگ اِن کر کے Approve / Reject کریں:`,
      loginUrl,
    ].join('\n');

    const english = [
      `Assalam-o-Alaikum ${label},`,
      `A new employee onboarding request awaits your approval: ${employeeLine}.`,
      `Please login to HRMS to Approve or Reject:`,
      loginUrl,
    ].join('\n');

    const message = `${RLI}${urdu}${PDI}\n\n${LRI}${english}${PDI}`;

    const encoded = encodeURIComponent(message);
    const waUrl = phoneE164
      ? `https://wa.me/${phoneE164}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;

    return {
      approverTarget,
      approverLabel: label,
      phoneE164,
      phoneConfigured: Boolean(phoneE164),
      message,
      waUrl,
      loginUrl,
    };
  }

  private async resolveApproverPhone(
    target: EmployeeApproverTarget,
  ): Promise<string | null> {
    const envKeyMap: Record<EmployeeApproverTarget, string> = {
      [EmployeeApproverTarget.PRESIDENT]: 'ONBOARDING_WHATSAPP_PRESIDENT',
      [EmployeeApproverTarget.FOUNDER]: 'ONBOARDING_WHATSAPP_FOUNDER',
      [EmployeeApproverTarget.CHAIRMAN_ADMIN]: 'ONBOARDING_WHATSAPP_CHAIRMAN',
    };

    const fromEnv = normalizePakistanPhone(process.env[envKeyMap[target]]);
    if (fromEnv) return fromEnv;

    const role = userRoleForApproverTarget(target);
    const users = await this.prisma.user.findMany({
      where: { role, isActive: true },
      include: {
        employee: { select: { phone: true } },
      },
      take: 10,
    });

    for (const user of users) {
      const phone = normalizePakistanPhone(user.employee?.phone);
      if (phone) return phone;
    }

    // Also check additional roles
    const extra = await this.prisma.userAdditionalRole.findMany({
      where: { role },
      include: {
        user: {
          include: { employee: { select: { phone: true } } },
        },
      },
      take: 10,
    });
    for (const row of extra) {
      if (!row.user.isActive) continue;
      const phone = normalizePakistanPhone(row.user.employee?.phone);
      if (phone) return phone;
    }

    return null;
  }
}
