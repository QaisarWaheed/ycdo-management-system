import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PayChangeKind,
  PayChangeRequest,
  PayChangeStatus,
  PayrollStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AllowancesService } from '../allowances/allowances.service';
import { IncentivesService } from '../incentives/incentives.service';
import { PayrollService } from '../payroll/payroll.service';
import {
  PayChangeRequestsService,
  type PayActor,
} from './pay-change-requests.service';

/** Applies an approved pay change through the same service a direct change uses. */
@Injectable()
export class PayApprovalsService {
  constructor(
    private prisma: PrismaService,
    private requests: PayChangeRequestsService,
    private payroll: PayrollService,
    private allowances: AllowancesService,
    private incentives: IncentivesService,
  ) {}

  async approve(id: string, user: PayActor, reviewNote?: string) {
    const request = await this.requests.getPending(id);
    this.requests.assertCanReview(user, request.approverTarget);
    if (!(await this.requests.claim(id, PayChangeStatus.APPROVED, user, reviewNote))) {
      throw new BadRequestException('This request has already been decided');
    }
    let result: unknown;
    try {
      result = await this.apply(request, user);
      if (
        request.kind === PayChangeKind.SALARY_INCREMENT ||
        request.kind === PayChangeKind.PACKAGE_EDIT
      ) {
        await this.requests.afterPackageChange(request.employeeId);
      }
    } catch (err) {
      await this.requests.release(id);
      throw err;
    }
    await this.requests.audit(user, 'PAY_CHANGE_APPROVED', request, {
      reviewNote: reviewNote?.trim() || null,
    });
    return { id, status: PayChangeStatus.APPROVED, result };
  }

  private async apply(request: PayChangeRequest, user: PayActor) {
    const payload = { ...(request.payload as Record<string, any>) };
    switch (request.kind) {
      case PayChangeKind.SALARY_INCREMENT:
        payload.effectiveFrom = await this.openMonthIso(request.employeeId, payload.effectiveFrom);
        return this.payroll.salaryIncrement(payload as any, user.id);
      case PayChangeKind.PACKAGE_EDIT:
        if (payload.effectiveFrom) {
          payload.effectiveFrom = await this.openMonthIso(request.employeeId, payload.effectiveFrom);
        }
        return this.payroll.updateActiveStipend(payload as any, user.id);
      case PayChangeKind.ALLOWANCE: {
        const [y, m] = String(payload.startMonth).split('-').map(Number);
        const open = await this.firstOpenMonth(request.employeeId, y, m);
        if (payload.endMonth) {
          const [ey, em] = String(payload.endMonth).split('-').map(Number);
          if (ey * 12 + em < open.year * 12 + open.month) {
            throw new BadRequestException(
              'All months of this allowance are already closed in payroll; reject it instead',
            );
          }
        }
        payload.startMonth = `${open.year}-${String(open.month).padStart(2, '0')}`;
        return this.allowances.assign(payload as any, user);
      }
      case PayChangeKind.INCENTIVE: {
        // Recorded as added by whoever asked for it; the approval is in the audit log.
        const submitter = await this.prisma.user.findUnique({
          where: { id: request.submittedById },
          select: { role: true },
        });
        return this.incentives.create(
          payload as any,
          request.submittedById,
          submitter?.role ?? UserRole.HR_MANAGER,
        );
      }
      case PayChangeKind.PAYROLL_ADDITION:
        return this.payroll.addAllowance(payload as any);
    }
  }

  /**
   * A change approved after its month was processed or paid starts from the
   * next month that is still open (processed / paid months never change).
   */
  async firstOpenMonth(employeeId: string, year: number, month: number) {
    let key = year * 12 + month;
    for (let i = 0; i < 36; i++) {
      const y = Math.floor((key - 1) / 12);
      const m = key - y * 12;
      const closed = await this.prisma.payrollEntry.findFirst({
        where: {
          month: m,
          year: y,
          status: { not: PayrollStatus.PENDING },
          stipendRecord: { employeeId },
        },
        select: { id: true },
      });
      if (!closed) return { year: y, month: m };
      key++;
    }
    throw new BadRequestException('Could not find an open payroll month');
  }

  private async openMonthIso(employeeId: string, iso: string) {
    const d = new Date(iso);
    const open = await this.firstOpenMonth(employeeId, d.getUTCFullYear(), d.getUTCMonth() + 1);
    if (open.year === d.getUTCFullYear() && open.month === d.getUTCMonth() + 1) return iso;
    return new Date(Date.UTC(open.year, open.month - 1, 1)).toISOString();
  }
}
