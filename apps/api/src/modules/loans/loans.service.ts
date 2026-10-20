import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoanKind, LoanPurpose, LoanStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  INSTALLMENT_PREFIXES,
  installmentLoanId,
  loanEligibility,
} from './loans.util';

/** Today's date in Pakistan (UTC+5) as a UTC midnight Date. */
function pakistanToday() {
  const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

@Injectable()
export class LoansService {
  constructor(private prisma: PrismaService) {}

  /** The employee's loans with what is repaid so far, plus loan eligibility today. */
  async forEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { joiningDate: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const loans = await this.prisma.employeeLoan.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
    const paid = await this.paidByLoan(employeeId);
    return {
      eligibility: loanEligibility(employee.joiningDate, pakistanToday()),
      loans: loans.map((loan) => {
        const repaid = paid.get(loan.id) ?? 0;
        return {
          ...loan,
          amount: Number(loan.amount),
          monthlyInstallment: Number(loan.monthlyInstallment),
          repaid,
          remaining: Math.max(0, Number(loan.amount) - repaid),
        };
      }),
    };
  }

  async create(
    dto: {
      employeeId: string;
      amount: number;
      monthlyInstallment: number;
      startMonth: string;
      reason: string;
      kind?: LoanKind;
      purpose?: LoanPurpose;
    },
    userId: string,
  ) {
    const kind = dto.kind ?? LoanKind.LOAN;
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { joiningDate: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const eligibility = loanEligibility(employee.joiningDate, pakistanToday());
    // The 6-month service rule is for loans only; a salary advance has none.
    if (kind === LoanKind.LOAN && !eligibility.eligible) {
      throw new BadRequestException(
        `Not eligible for loan: ${eligibility.serviceMonths} month(s) of service, at least ${eligibility.minMonths} needed`,
      );
    }
    if (dto.monthlyInstallment > dto.amount) {
      throw new BadRequestException(
        'Monthly installment cannot be more than the loan amount',
      );
    }
    const [y, m] = dto.startMonth.split('-').map(Number);
    const loan = await this.prisma.employeeLoan.create({
      data: {
        employeeId: dto.employeeId,
        amount: dto.amount,
        monthlyInstallment: dto.monthlyInstallment,
        startMonth: new Date(Date.UTC(y, m - 1, 1)),
        kind,
        purpose: dto.purpose ?? LoanPurpose.PERSONAL,
        reason: dto.reason.trim(),
        createdById: userId,
      },
    });
    await this.audit(userId, 'LOAN_APPLICATION_CREATED', loan.id, {
      employeeId: dto.employeeId,
      amount: dto.amount,
      monthlyInstallment: dto.monthlyInstallment,
      startMonth: dto.startMonth,
      kind,
      purpose: dto.purpose ?? LoanPurpose.PERSONAL,
    });
    return loan;
  }

  /** Founder approved on paper: record it with the signed notification. */
  async approve(
    id: string,
    file: Express.Multer.File | undefined,
    note: string | undefined,
    userId: string,
  ) {
    if (!file)
      throw new BadRequestException('Upload the signed approval notification');
    const loan = await this.pending(id);
    const updated = await this.prisma.employeeLoan.update({
      where: { id },
      data: {
        status: LoanStatus.APPROVED,
        decidedById: userId,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
        notificationUrl: `/uploads/loan-notifications/${id}/${file.filename}`,
        notificationFileName: file.originalname,
        notificationMimeType: file.mimetype,
        notificationUploadedAt: new Date(),
      },
    });
    const start = loan.startMonth.toISOString().slice(0, 7);
    await this.prisma.notification.create({
      data: {
        employeeId: loan.employeeId,
        type: 'LOAN_APPROVED',
        message: `Your ${loan.kind === LoanKind.ADVANCE ? 'salary advance' : 'loan'} of PKR ${Number(loan.amount).toLocaleString('en-PK')} is approved. PKR ${Number(loan.monthlyInstallment).toLocaleString('en-PK')} will be deducted from your salary each month from ${start}.`,
      },
    });
    await this.audit(userId, 'LOAN_APPROVED', id, {
      employeeId: loan.employeeId,
      note: note ?? null,
    });
    return updated;
  }

  async decide(
    id: string,
    status: 'REJECTED' | 'CANCELLED',
    note: string | undefined,
    userId: string,
  ) {
    const loan = await this.pending(id);
    const updated = await this.prisma.employeeLoan.update({
      where: { id },
      data: {
        status: LoanStatus[status],
        decidedById: userId,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
      },
    });
    if (status === 'REJECTED') {
      await this.prisma.notification.create({
        data: {
          employeeId: loan.employeeId,
          type: 'LOAN_REJECTED',
          message: `Your ${loan.kind === LoanKind.ADVANCE ? 'salary advance' : 'loan'} application of PKR ${Number(loan.amount).toLocaleString('en-PK')} was not approved.`,
        },
      });
    }
    await this.audit(userId, `LOAN_${status}`, id, {
      employeeId: loan.employeeId,
      note: note ?? null,
    });
    return updated;
  }

  async findOne(id: string) {
    const loan = await this.prisma.employeeLoan.findUnique({ where: { id } });
    if (!loan) throw new NotFoundException('Loan not found');
    return loan;
  }

  private async pending(id: string) {
    const loan = await this.findOne(id);
    if (loan.status !== LoanStatus.PENDING) {
      throw new BadRequestException(
        `This loan is already ${loan.status.toLowerCase()}`,
      );
    }
    return loan;
  }

  /** Installments already taken, from the payroll deduction rows of each loan. */
  private async paidByLoan(employeeId: string) {
    const rows = await this.prisma.payrollDeduction.findMany({
      where: {
        OR: INSTALLMENT_PREFIXES.map((p) => ({ description: { startsWith: p } })),
        payrollEntry: { stipendRecord: { employeeId } },
      },
      select: { description: true, amount: true },
    });
    const paid = new Map<string, number>();
    for (const row of rows) {
      const id = installmentLoanId(row.description);
      if (id) paid.set(id, (paid.get(id) ?? 0) + Number(row.amount));
    }
    return paid;
  }

  private audit(
    userId: string,
    action: string,
    loanId: string,
    changes: Record<string, unknown>,
  ) {
    return this.prisma.auditLog.create({
      data: {
        userId,
        action,
        entity: 'EmployeeLoan',
        entityId: loanId,
        changes: changes as Prisma.InputJsonValue,
      },
    });
  }
}
