import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeOnboardingStatus,
  EmployeeStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LettersService } from '../letters/letters.service';
import { LetterType, StaffType } from '@prisma/client';
import {
  APPROVER_TARGET_LABELS,
  approverTargetForUserRole,
  canReviewApproval,
} from './employee-onboarding.util';
import type { OnboardingQueryDto } from './employee-onboarding.dto';

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

        await this.lettersService.generate(
          {
            employeeId: employee.id,
            letterType: LetterType.ADVICE,
            extraFields: {
              adviceReason: 'Training / Joining Notification',
              adviceDetails: `Welcome to YCDO. Joining Date: ${this.formatDate(employee.joiningDate)}. Designation: ${employee.currentDesignation}. Department: ${employee.currentDepartment?.name ?? '—'}. Branch: ${employee.currentBranch.name}.`,
              joiningDate: this.formatDate(employee.joiningDate),
              designation: employee.currentDesignation ?? '',
              department: employee.currentDepartment?.name ?? '',
              branch: employee.currentBranch.name,
              basicStipend,
              workingHours: '9:00 AM - 5:00 PM',
              probationPeriod: '3 months',
            },
          },
          'SYSTEM',
        );
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
    const approval = await this.getPendingForReview(id, user);

    await this.prisma.$transaction(async (tx) => {
      await tx.employeeOnboardingApproval.update({
        where: { id },
        data: {
          status: EmployeeOnboardingStatus.REJECTED,
          reviewedById: user.id,
          reviewedAt: new Date(),
          reviewNote: reviewNote?.trim() || null,
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
          reviewNote,
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

  private formatDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
