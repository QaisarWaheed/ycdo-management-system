import {
  EmployeeApproverTarget,
  PayChangeKind,
  PayChangeStatus,
  UserRole,
} from '@prisma/client';

jest.mock('../letters/pdf.helper', () => ({ generatePdf: jest.fn() }));

import { PayApprovalsService } from './pay-approvals.service';
import {
  approvalBlockedReason,
  isPayExecutive,
  PayChangeRequestsService,
  requestPayMonth,
} from './pay-change-requests.service';

describe('pay approvals', () => {
  it('treats President / Founder / Chairman / Super Admin as executives only', () => {
    expect(isPayExecutive({ id: 'u', role: UserRole.FOUNDER })).toBe(true);
    expect(isPayExecutive({ id: 'u', role: UserRole.SUPER_ADMIN })).toBe(true);
    expect(isPayExecutive({ id: 'u', role: UserRole.HR_EXECUTIVE })).toBe(
      false,
    );
    expect(isPayExecutive({ id: 'u', role: UserRole.PAYROLL_OFFICER })).toBe(
      false,
    );
    expect(
      isPayExecutive({
        id: 'u',
        role: UserRole.HR_MANAGER,
        roles: ['HR_MANAGER', 'CHAIRMAN'],
      }),
    ).toBe(true);
  });

  describe('describePackageChange', () => {
    const service = new PayChangeRequestsService({
      stipendRecord: {
        findFirst: jest.fn().mockResolvedValue({
          basicStipend: 25000,
          reward: 1000,
          loanDeduction: 2000,
        }),
      },
    } as never);

    it('a higher basic needs approval', async () => {
      const r = await service.describePackageChange('e', {
        basicStipend: 30000,
        effectiveFrom: '2026-11-01T00:00:00.000Z',
      });
      expect(r).toEqual({
        isIncrease: true,
        summary: 'Basic 25,000 → 30,000 from Nov 2026',
      });
    });

    it('a lower deduction raises pay too', async () => {
      const r = await service.describePackageChange('e', {
        basicStipend: 25000,
        loanDeduction: 0,
      });
      expect(r.isIncrease).toBe(true);
    });

    it('a cut or a bigger deduction does not need approval', async () => {
      const r = await service.describePackageChange('e', {
        basicStipend: 24000,
        reward: 0,
        loanDeduction: 3000,
      });
      expect(r.isIncrease).toBe(false);
    });
  });

  describe('approve', () => {
    function build(
      opts: {
        applyFails?: boolean;
        claimed?: boolean;
        closedMonths?: string[];
      } = {},
    ) {
      const request = {
        id: 'r1',
        kind: PayChangeKind.SALARY_INCREMENT,
        employeeId: 'e1',
        payload: {
          employeeId: 'e1',
          basicStipend: 30000,
          effectiveFrom: '2026-10-01T00:00:00.000Z',
          reason: 'raise',
        },
        summary: 'Basic 25,000 → 30,000',
        approverTarget: EmployeeApproverTarget.FOUNDER,
        status: PayChangeStatus.PENDING,
        submittedById: 'hr1',
      };
      const prisma = {
        payChangeRequest: {
          findUnique: jest.fn().mockResolvedValue(request),
          updateMany: jest
            .fn()
            .mockResolvedValue({ count: opts.claimed === false ? 0 : 1 }),
          update: jest.fn().mockResolvedValue({}),
        },
        payrollEntry: {
          findFirst: jest
            .fn()
            .mockImplementation(async ({ where }) =>
              (opts.closedMonths ?? []).includes(`${where.year}-${where.month}`)
                ? { id: 'x' }
                : null,
            ),
        },
        stipendRecord: { findFirst: jest.fn().mockResolvedValue(null) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      const requests = new PayChangeRequestsService(prisma as never);
      const payroll = {
        salaryIncrement: opts.applyFails
          ? jest
              .fn()
              .mockRejectedValue(new Error('Multiple open stipend packages'))
          : jest.fn().mockResolvedValue({ id: 'new-pkg' }),
      };
      const service = new PayApprovalsService(
        prisma as never,
        requests,
        payroll as never,
        {} as never,
        {} as never,
      );
      return { service, prisma, payroll };
    }
    const founder = { id: 'f1', role: UserRole.FOUNDER };

    it('only the chosen executive can decide', async () => {
      const { service } = build();
      await expect(
        service.approve('r1', { id: 'p1', role: UserRole.PRESIDENT }),
      ).rejects.toThrow('Only the Founder');
    });

    it('applies through the payroll service and records the approval', async () => {
      const { service, payroll, prisma } = build();
      const res = await service.approve('r1', founder, 'ok');
      expect(res.status).toBe(PayChangeStatus.APPROVED);
      expect(payroll.salaryIncrement).toHaveBeenCalledWith(
        expect.objectContaining({
          basicStipend: 30000,
          effectiveFrom: '2026-10-01T00:00:00.000Z',
        }),
        'f1',
      );
      expect(
        prisma.auditLog.create.mock.calls[
          prisma.auditLog.create.mock.calls.length - 1
        ][0].data.action,
      ).toBe('PAY_CHANGE_APPROVED');
    });

    it('moves a late approval to the next open month', async () => {
      const { service, payroll } = build({ closedMonths: ['2026-10'] });
      await service.approve('r1', founder);
      expect(payroll.salaryIncrement.mock.calls[0][0].effectiveFrom).toBe(
        '2026-11-01T00:00:00.000Z',
      );
    });

    it('puts the request back to pending when applying fails', async () => {
      const { service, prisma } = build({ applyFails: true });
      await expect(service.approve('r1', founder)).rejects.toThrow(
        'Multiple open',
      );
      expect(prisma.payChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PayChangeStatus.PENDING }),
        }),
      );
    });

    it('refuses a request someone else already decided', async () => {
      const { service, payroll } = build({ claimed: false });
      await expect(service.approve('r1', founder)).rejects.toThrow(
        'already been decided',
      );
      expect(payroll.salaryIncrement).not.toHaveBeenCalled();
    });
  });

  describe('approval context', () => {
    it('finds the payroll month a request touches', () => {
      expect(requestPayMonth({ month: 9, year: 2026, amount: 1 })).toEqual({ year: 2026, month: 9 });
      expect(requestPayMonth({ effectiveFrom: '2026-11-01T00:00:00.000Z' })).toEqual({ year: 2026, month: 11 });
      expect(requestPayMonth({ startMonth: '2026-12' })).toEqual({ year: 2026, month: 12 });
      expect(requestPayMonth({})).toBeNull();
    });

    it('flags incentives for staff who are not active, with the date', () => {
      const onRest = {
        kind: PayChangeKind.INCENTIVE,
        employee: { status: 'ON_REST', statusEffectiveFrom: new Date('2026-10-07T00:00:00Z') },
      };
      expect(approvalBlockedReason(onRest)).toMatch(/^ON REST since 2026-10-07: incentives are only for active staff/);
      expect(
        approvalBlockedReason({ ...onRest, employee: { status: 'ACTIVE', statusEffectiveFrom: null } }),
      ).toBeNull();
      expect(approvalBlockedReason({ ...onRest, kind: PayChangeKind.SALARY_INCREMENT })).toBeNull();
    });

    it('bulk approve keeps going when one request fails and reports it', async () => {
      const service = Object.assign(Object.create(PayApprovalsService.prototype), {
        approve: jest.fn(async (id: string) => {
          if (id === 'bad') throw new Error('Incentives can only be added for active or appointed employees');
          return { id };
        }),
      });
      const res = await service.approveMany(['a', 'bad', 'b', 'a'], { id: 'f1', role: UserRole.FOUNDER });
      expect(res.approved).toEqual(['a', 'b']);
      expect(res.failed).toEqual([{ id: 'bad', error: 'Incentives can only be added for active or appointed employees' }]);
    });
  });
});
