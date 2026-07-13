import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationStatus, ChangeType, EmployeeStatus, Gender, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeDesignationName } from '../../common/org-structure';
import {
  AcceptCandidateDto,
  ApplicationQueryDto,
  SubmitApplicationDto,
  UpdateApplicationStatusDto,
} from './recruitment.dto';
import * as bcrypt from 'bcryptjs';
import { generateEmployeeCode } from '../employees/employee-code.helper';

@Injectable()
export class RecruitmentService {
  constructor(private prisma: PrismaService) {}

  async submit(dto: SubmitApplicationDto) {
    const existing = await this.prisma.jobApplication.findFirst({
      where: {
        email: dto.email,
        position: dto.position,
      },
    });

    if (existing) {
      throw new ConflictException('You have already applied for this position');
    }

    return this.prisma.jobApplication.create({
      data: dto,
    });
  }

  findAll(query: ApplicationQueryDto) {
    const where: Prisma.JobApplicationWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.position) {
      where.position = { contains: query.position, mode: 'insensitive' };
    }

    if (query.branchId) {
      where.branchId = query.branchId;
    }

    if (query.startDate && query.endDate) {
      where.appliedAt = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      };
    }

    return this.prisma.jobApplication.findMany({
      where,
      orderBy: { appliedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const application = await this.prisma.jobApplication.findUnique({
      where: { id },
    });

    if (!application) {
      throw new NotFoundException(
        `Job application with id ${id} not found`,
      );
    }

    return application;
  }

  async updateStatus(id: string, dto: UpdateApplicationStatusDto) {
    const application = await this.findOne(id);

    if (application.status === ApplicationStatus.REJECTED) {
      throw new BadRequestException(
        'Cannot update application in a terminal state',
      );
    }

    if (
      dto.status === ApplicationStatus.INTERVIEW_SCHEDULED &&
      !dto.interviewDate
    ) {
      throw new BadRequestException('Interview date required');
    }

    return this.prisma.jobApplication.update({
      where: { id },
      data: {
        status: dto.status,
        interviewDate: dto.interviewDate
          ? new Date(dto.interviewDate)
          : undefined,
        notes: dto.notes,
      },
    });
  }

  scheduleInterview(id: string, interviewDate: string, notes?: string) {
    return this.updateStatus(id, {
      status: ApplicationStatus.INTERVIEW_SCHEDULED,
      interviewDate,
      notes,
    });
  }

  async acceptCandidate(id: string, dto: AcceptCandidateDto) {
    const application = await this.findOne(id);

    if (application.status !== ApplicationStatus.INTERVIEW_SCHEDULED) {
      throw new BadRequestException(
        'Only interview-scheduled applications can be accepted',
      );
    }

    dto.selectedDesignation = normalizeDesignationName(dto.selectedDesignation);

    const department = await this.prisma.department.findFirst({
      where: { id: dto.selectedDeptId, isActive: true },
    });
    if (!department) {
      throw new NotFoundException(
        `Department with id ${dto.selectedDeptId} not found`,
      );
    }

    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.selectedBranchId, isActive: true },
    });
    if (!branch) {
      throw new NotFoundException(
        `Branch with id ${dto.selectedBranchId} not found`,
      );
    }

    if (dto.shiftId) {
      const shift = await this.prisma.shift.findFirst({
        where: {
          id: dto.shiftId,
          isActive: true,
        },
      });
      if (!shift) {
        throw new NotFoundException(`Shift with id ${dto.shiftId} not found`);
      }
    }

    const nameParts = application.fullName.trim().split(/\s+/);
    const fullName = application.fullName.trim() || nameParts.join(' ');
    const employeeCode = await generateEmployeeCode(this.prisma);
    const joiningDate = new Date();
    const cnic =
      application.cnic ??
      this.generatePlaceholderCnic(application.id);

    const existingEmail = await this.prisma.employee.findUnique({
      where: { email: application.email },
    });
    if (existingEmail) {
      throw new ConflictException('An employee with this email already exists');
    }

    const existingCnic = await this.prisma.employee.findUnique({
      where: { cnic },
    });
    if (existingCnic) {
      throw new ConflictException('An employee with this CNIC already exists');
    }

    const hashedPassword = await bcrypt.hash(employeeCode, 10);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.jobApplication.update({
        where: { id },
        data: {
          status: ApplicationStatus.SELECTED,
          selectedSalary: dto.selectedSalary,
          selectedDeptId: dto.selectedDeptId,
          selectedBranchId: dto.selectedBranchId,
          selectedDesignation: dto.selectedDesignation,
          interviewNotes: dto.interviewNotes,
        },
      });

      const employee = await tx.employee.create({
        data: {
          fullName,
          cnic,
          gender: Gender.MALE,
          email: application.email,
          phone: application.phone,
          joiningDate,
          status: EmployeeStatus.TRAINEE,
          currentBranchId: dto.selectedBranchId,
          currentDepartmentId: dto.selectedDeptId,
          currentDesignation: dto.selectedDesignation,
          employeeCode,
          shiftId: dto.shiftId,
        },
      });

      await tx.stipendRecord.create({
        data: {
          employeeId: employee.id,
          basicStipend: dto.selectedSalary,
          effectiveFrom: joiningDate,
        },
      });

      await tx.employmentHistory.create({
        data: {
          employeeId: employee.id,
          branchId: dto.selectedBranchId,
          departmentId: dto.selectedDeptId,
          designation: dto.selectedDesignation,
          changeType: ChangeType.JOINED,
          effectiveDate: joiningDate,
        },
      });

      await tx.user.create({
        data: {
          email: application.email,
          password: hashedPassword,
          role: UserRole.EMPLOYEE,
          employeeId: employee.id,
        },
      });

      await tx.notification.create({
        data: {
          employeeId: employee.id,
          message:
            'Welcome to YCDO. Your account has been created. Your temporary password is your employee code.',
          type: 'ACCOUNT_CREATED',
        },
      });

      return employee;
    });

    return { employee: result, temporaryPassword: employeeCode };
  }

  private generatePlaceholderCnic(applicationId: string): string {
    const digits = applicationId.replace(/\D/g, '').padEnd(12, '0').slice(0, 12);
    return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-0`;
  }

  async convertToEmployee(applicationId: string) {
    const application = await this.findOne(applicationId);

    if (application.status !== ApplicationStatus.SELECTED) {
      throw new BadRequestException(
        'Only selected applications can be converted to employee data',
      );
    }

    const nameParts = application.fullName.trim().split(/\s+/);
    const fullName = application.fullName.trim() || nameParts.join(' ');

    const employeeData = {
      fullName: application.fullName,
      email: application.email,
      phone: application.phone,
      cnic: application.cnic,
      currentDesignation: application.position,
      branchId: application.branchId,
    };

    return {
      message: 'Application ready for employee onboarding',
      employeeData,
      application,
    };
  }
}
