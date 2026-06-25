import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChangeType, EmployeeStatus, LetterType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LettersService } from '../letters/letters.service';
import { PayrollService } from '../payroll/payroll.service';
import { PromotionDto, ResignationDto } from './separation.dto';

@Injectable()
export class SeparationService {
  constructor(
    private prisma: PrismaService,
    private lettersService: LettersService,
    private payrollService: PayrollService,
  ) {}

  async resign(dto: ResignationDto, actingUserId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    if (employee.status === EmployeeStatus.DISMISSED) {
      throw new BadRequestException('Cannot process dismissed employee');
    }

    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException('Only active employees can resign');
    }

    const lastWorkingDate = new Date(dto.lastWorkingDate);
    const totalExperience = this.calculateExperience(
      employee.joiningDate,
      lastWorkingDate,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.employee.update({
        where: { id: dto.employeeId },
        data: { status: EmployeeStatus.RESIGNED },
      });

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'RESIGNATION',
          message: `Your resignation has been recorded. Last working date: ${this.formatDate(lastWorkingDate)}`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'RESIGNATION',
          entity: 'Employee',
          entityId: dto.employeeId,
          changes: {
            resignationDate: dto.resignationDate,
            lastWorkingDate: dto.lastWorkingDate,
            reason: dto.reason,
          },
        },
      });

      return result;
    });

    await this.lettersService.generate(
      {
        employeeId: dto.employeeId,
        letterType: LetterType.EXPERIENCE,
        extraFields: {
          lastWorkingDate: this.formatDate(lastWorkingDate),
          totalExperience,
          jobDescription: employee.currentDesignation,
        },
      },
      actingUserId,
    );

    return updated;
  }

  async promote(dto: PromotionDto, actingUserId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException('Only active employees can be promoted');
    }

    if (dto.newDepartmentId) {
      const department = await this.prisma.department.findFirst({
        where: {
          id: dto.newDepartmentId,
          branchId: employee.currentBranchId,
          isActive: true,
        },
      });

      if (!department) {
        throw new NotFoundException(
          `Department with id ${dto.newDepartmentId} not found in employee branch`,
        );
      }
    }

    const effectiveDate = new Date(dto.effectiveDate);

    const updated = await this.prisma.$transaction(async (tx) => {
      const openHistory = await tx.employmentHistory.findFirst({
        where: { employeeId: dto.employeeId, endDate: null },
        orderBy: { effectiveDate: 'desc' },
      });

      if (openHistory) {
        await tx.employmentHistory.update({
          where: { id: openHistory.id },
          data: { endDate: effectiveDate },
        });
      }

      const result = await tx.employee.update({
        where: { id: dto.employeeId },
        data: {
          currentDesignation: dto.newDesignation,
          ...(dto.newDepartmentId
            ? { currentDepartmentId: dto.newDepartmentId }
            : {}),
        },
      });

      await tx.employmentHistory.create({
        data: {
          employeeId: dto.employeeId,
          branchId: employee.currentBranchId,
          departmentId: dto.newDepartmentId ?? employee.currentDepartmentId,
          designation: dto.newDesignation,
          changeType: ChangeType.PROMOTED,
          changeReason: dto.reason,
          effectiveDate,
        },
      });

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'PROMOTION',
          message: `You have been promoted to ${dto.newDesignation} effective ${this.formatDate(effectiveDate)}`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'PROMOTION',
          entity: 'Employee',
          entityId: dto.employeeId,
          changes: {
            newDesignation: dto.newDesignation,
            newDepartmentId: dto.newDepartmentId,
            effectiveDate: dto.effectiveDate,
            newBasicStipend: dto.newBasicStipend,
          },
        },
      });

      return result;
    });

    if (dto.newBasicStipend) {
      await this.payrollService.salaryIncrement(
        {
          employeeId: dto.employeeId,
          newBasicStipend: dto.newBasicStipend,
          effectiveFrom: dto.effectiveDate,
          reason: dto.reason || 'Promotion',
        },
        actingUserId,
      );

      const activeStipend = await this.prisma.stipendRecord.findFirst({
        where: { employeeId: dto.employeeId, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });

      const previousRecord = await this.prisma.stipendRecord.findFirst({
        where: {
          employeeId: dto.employeeId,
          effectiveTo: effectiveDate,
        },
      });

      if (activeStipend && previousRecord) {
        await this.lettersService.generate(
          {
            employeeId: dto.employeeId,
            letterType: LetterType.SALARY_INCREMENT,
            extraFields: {
              previousStipend: Number(previousRecord.basicStipend),
              newStipend: dto.newBasicStipend,
              incrementAmount:
                dto.newBasicStipend - Number(previousRecord.basicStipend),
              effectiveDate: this.formatDate(effectiveDate),
              incrementReason: dto.reason || 'Promotion',
            },
          },
          actingUserId,
        );
      }
    }

    return updated;
  }

  private calculateExperience(joiningDate: Date, lastWorkingDate: Date): string {
    let years = lastWorkingDate.getFullYear() - joiningDate.getFullYear();
    let months = lastWorkingDate.getMonth() - joiningDate.getMonth();

    if (months < 0) {
      years -= 1;
      months += 12;
    }

    const yearPart = years > 0 ? `${years} year${years !== 1 ? 's' : ''}` : '';
    const monthPart =
      months > 0 ? `${months} month${months !== 1 ? 's' : ''}` : '';

    if (yearPart && monthPart) {
      return `${yearPart} and ${monthPart}`;
    }

    return yearPart || monthPart || 'Less than 1 month';
  }

  private formatDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
