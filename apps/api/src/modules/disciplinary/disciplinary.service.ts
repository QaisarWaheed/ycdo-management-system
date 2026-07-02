import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DisciplinaryStatus,
  DisciplinaryType,
  EmployeeStatus,
  InquiryOutcome,
  LetterType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LettersService } from '../letters/letters.service';
import {
  CreateDisciplinaryDto,
  DisciplinaryQueryDto,
  ResolveInquiryDto,
  StartInquiryDto,
} from './disciplinary.dto';

@Injectable()
export class DisciplinaryService {
  constructor(
    private prisma: PrismaService,
    private lettersService: LettersService,
  ) {}

  async create(dto: CreateDisciplinaryDto, actingUserId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: {
        currentDepartment: { select: { name: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    if (
      employee.status !== EmployeeStatus.ACTIVE &&
      employee.status !== EmployeeStatus.SUSPENDED
    ) {
      throw new BadRequestException(
        'Disciplinary action can only be issued to active or suspended employees',
      );
    }

    const issuedAt = dto.issuedAt ? new Date(dto.issuedAt) : new Date();

    const action = await this.prisma.$transaction(async (tx) => {
      const disciplinaryAction = await tx.disciplinaryAction.create({
        data: {
          employeeId: dto.employeeId,
          type: dto.type,
          reason: dto.reason,
          issuedAt,
        },
      });

      if (dto.type === DisciplinaryType.SUSPENSION) {
        await tx.employee.update({
          where: { id: dto.employeeId },
          data: { status: EmployeeStatus.SUSPENDED },
        });
      }

      await tx.notification.create({
        data: {
          employeeId: dto.employeeId,
          type: 'DISCIPLINARY_ACTION',
          message: `A ${dto.type.toLowerCase().replace('_', ' ')} disciplinary action has been issued against you.`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'DISCIPLINARY_CREATED',
          entity: 'DisciplinaryAction',
          entityId: disciplinaryAction.id,
          changes: { type: dto.type, reason: dto.reason },
        },
      });

      return disciplinaryAction;
    });

    await this.generateLetterForDisciplinary(
      dto.employeeId,
      dto.type,
      dto.reason,
      issuedAt,
      actingUserId,
    );

    return action;
  }

  findAll(query: DisciplinaryQueryDto) {
    const where: Prisma.DisciplinaryActionWhereInput = {};

    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }

    if (query.type) {
      where.type = query.type;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.startDate && query.endDate) {
      where.issuedAt = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      };
    }

    return this.prisma.disciplinaryAction.findMany({
      where,
      include: {
        employee: {
          select: { fullName: true, employeeCode: true },
        },
        inquiry: true,
      },
      orderBy: { issuedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const action = await this.prisma.disciplinaryAction.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            currentDesignation: true,
            status: true,
          },
        },
        inquiry: true,
      },
    });

    if (!action) {
      throw new NotFoundException(
        `Disciplinary action with id ${id} not found`,
      );
    }

    return action;
  }

  async startInquiry(dto: StartInquiryDto, actingUserId: string) {
    const action = await this.prisma.disciplinaryAction.findUnique({
      where: { id: dto.disciplinaryActionId },
      include: { inquiry: true },
    });

    if (!action) {
      throw new NotFoundException(
        `Disciplinary action with id ${dto.disciplinaryActionId} not found`,
      );
    }

    if (action.status !== DisciplinaryStatus.OPEN) {
      throw new BadRequestException(
        'Inquiry can only be started on open disciplinary actions',
      );
    }

    if (action.inquiry) {
      throw new BadRequestException(
        'An inquiry already exists for this disciplinary action',
      );
    }

    const now = new Date();
    const deadlineDays = dto.deadlineDays ?? 3;
    const deadlineAt = this.addDays(now, deadlineDays);

    const inquiry = await this.prisma.$transaction(async (tx) => {
      const created = await tx.inquiry.create({
        data: {
          disciplinaryActionId: dto.disciplinaryActionId,
          deadlineAt,
          notes: dto.notes,
        },
      });

      await tx.disciplinaryAction.update({
        where: { id: dto.disciplinaryActionId },
        data: { status: DisciplinaryStatus.UNDER_INQUIRY },
      });

      await tx.notification.create({
        data: {
          employeeId: action.employeeId,
          type: 'INQUIRY_STARTED',
          message: `An inquiry has been initiated regarding your disciplinary action. Deadline: ${this.formatDate(deadlineAt)}`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'INQUIRY_STARTED',
          entity: 'Inquiry',
          entityId: created.id,
          changes: { disciplinaryActionId: dto.disciplinaryActionId },
        },
      });

      return created;
    });

    await this.lettersService.generate(
      {
        employeeId: action.employeeId,
        letterType: LetterType.INQUIRY,
        extraFields: {
          inquiryReason: action.reason,
          inquiryDate: this.formatDate(now),
          committeeMembers: 'HR Committee',
        },
      },
      actingUserId,
    );

    return this.prisma.inquiry.findUnique({
      where: { id: inquiry.id },
      include: { disciplinaryAction: true },
    });
  }

  async resolveInquiry(dto: ResolveInquiryDto, actingUserId: string) {
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id: dto.inquiryId },
      include: {
        disciplinaryAction: {
          include: {
            employee: {
              include: {
                currentDepartment: { select: { name: true } },
                stipendRecords: {
                  orderBy: { effectiveFrom: 'desc' },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!inquiry) {
      throw new NotFoundException(`Inquiry with id ${dto.inquiryId} not found`);
    }

    if (inquiry.outcome) {
      throw new BadRequestException('Inquiry has already been resolved');
    }

    const action = inquiry.disciplinaryAction;
    const employee = action.employee;
    const today = this.formatDate(new Date());

    await this.prisma.$transaction(async (tx) => {
      await tx.inquiry.update({
        where: { id: dto.inquiryId },
        data: {
          outcome: dto.outcome,
          notes: dto.notes,
          closedAt: new Date(),
        },
      });

      const actionStatus =
        dto.outcome === InquiryOutcome.DISMISSED
          ? DisciplinaryStatus.DISMISSED
          : DisciplinaryStatus.RESOLVED;

      await tx.disciplinaryAction.update({
        where: { id: action.id },
        data: {
          status: actionStatus,
          resolvedAt: new Date(),
          resolution: dto.notes,
        },
      });

      if (dto.outcome === InquiryOutcome.REINSTATED) {
        await tx.employee.update({
          where: { id: employee.id },
          data: { status: EmployeeStatus.ACTIVE },
        });
      } else if (dto.outcome === InquiryOutcome.TERMINATED) {
        await tx.employee.update({
          where: { id: employee.id },
          data: { status: EmployeeStatus.TERMINATED },
        });
      } else if (dto.outcome === InquiryOutcome.REJOINED) {
        await tx.employee.update({
          where: { id: employee.id },
          data: { status: EmployeeStatus.ACTIVE },
        });
      } else if (dto.outcome === InquiryOutcome.DISMISSED) {
        await tx.employee.update({
          where: { id: employee.id },
          data: { status: EmployeeStatus.DISMISSED },
        });
        await tx.user.updateMany({
          where: { employeeId: employee.id },
          data: { isActive: false },
        });
      }

      await tx.notification.create({
        data: {
          employeeId: employee.id,
          type: 'INQUIRY_RESOLVED',
          message: `Your inquiry has been resolved with outcome: ${dto.outcome}`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'INQUIRY_RESOLVED',
          entity: 'Inquiry',
          entityId: dto.inquiryId,
          changes: { outcome: dto.outcome, notes: dto.notes },
        },
      });
    });

    const letterExtra = dto.extraLetterFields ?? {};

    if (dto.outcome === InquiryOutcome.REINSTATED) {
      await this.lettersService.generate(
        {
          employeeId: employee.id,
          letterType: LetterType.REINSTATEMENT,
          extraFields: {
            reinstatementDate: today,
            reinstatedDesignation: employee.currentDesignation,
            reinstatedDepartment: employee.currentDepartment.name,
            ...letterExtra,
          },
        },
        actingUserId,
      );
    } else if (dto.outcome === InquiryOutcome.TERMINATED) {
      await this.lettersService.generate(
        {
          employeeId: employee.id,
          letterType: LetterType.TERMINATION,
          extraFields: {
            terminationReason:
              dto.notes || inquiry.notes || action.reason,
            terminationDate: today,
            settlementDetails: 'As per HR policy',
            ...letterExtra,
          },
        },
        actingUserId,
      );
    } else if (dto.outcome === InquiryOutcome.REJOINED) {
      await this.lettersService.generate(
        {
          employeeId: employee.id,
          letterType: LetterType.REJOINING,
          extraFields: {
            rejoiningDate: today,
            rejoiningDesignation: employee.currentDesignation,
            ...letterExtra,
          },
        },
        actingUserId,
      );
    } else if (dto.outcome === InquiryOutcome.DISMISSED) {
      await this.lettersService.generate(
        {
          employeeId: employee.id,
          letterType: LetterType.TERMINATION,
          extraFields: {
            terminationReason: 'Dismissed due to corruption inquiry',
            terminationDate: today,
            settlementDetails: dto.notes || inquiry.notes || action.reason,
            ...letterExtra,
          },
        },
        actingUserId,
      );

      await this.prisma.notification.create({
        data: {
          employeeId: employee.id,
          type: 'DISMISSED',
          message:
            'You have been dismissed from YCDO following the inquiry. You are no longer eligible to rejoin.',
        },
      });

      await this.prisma.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'EMPLOYEE_DISMISSED',
          entity: 'Employee',
          entityId: employee.id,
          changes: {
            inquiryId: dto.inquiryId,
            outcome: dto.outcome,
            notes: dto.notes,
          },
        },
      });
    }

    return this.prisma.inquiry.findUnique({
      where: { id: dto.inquiryId },
      include: { disciplinaryAction: { include: { employee: true } } },
    });
  }

  private async generateLetterForDisciplinary(
    employeeId: string,
    type: DisciplinaryType,
    reason: string,
    issuedAt: Date,
    actingUserId: string,
  ) {
    const formattedDate = this.formatDate(issuedAt);
    const monthYear = `${issuedAt.getMonth() + 1}/${issuedAt.getFullYear()}`;

    switch (type) {
      case DisciplinaryType.SUSPENSION:
        await this.lettersService.generate(
          {
            employeeId,
            letterType: LetterType.SUSPENSION,
            extraFields: {
              suspensionReason: reason,
              suspensionStartDate: formattedDate,
              suspensionDuration: 'Pending inquiry',
            },
          },
          actingUserId,
        );
        break;

      case DisciplinaryType.WARNING: {
        const warningCount = await this.prisma.disciplinaryAction.count({
          where: { employeeId, type: DisciplinaryType.WARNING },
        });
        await this.lettersService.generate(
          {
            employeeId,
            letterType: LetterType.WARNING,
            extraFields: {
              warningReason: reason,
              incidentDate: formattedDate,
              warningNumber: this.ordinal(warningCount),
            },
          },
          actingUserId,
        );
        break;
      }

      case DisciplinaryType.SHOW_CAUSE:
        await this.lettersService.generate(
          {
            employeeId,
            letterType: LetterType.SHOW_CAUSE,
            extraFields: {
              allegation: reason,
              responseDeadline: '3 working days',
            },
          },
          actingUserId,
        );
        break;

      case DisciplinaryType.FINE:
        await this.lettersService.generate(
          {
            employeeId,
            letterType: LetterType.FINE,
            extraFields: {
              fineReason: reason,
              fineAmount: 'As per policy',
              deductionMonth: monthYear,
            },
          },
          actingUserId,
        );
        break;

      default:
        break;
    }
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  private formatDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  private ordinal(n: number): string {
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`;
  }
}
