import {
  EmployeeApproverTarget,
  PayChangeKind,
  PayChangeStatus,
  UserRole,
} from '@prisma/client';

jest.mock('../letters/pdf.helper', () => ({ generatePdf: jest.fn() }));

import { AllowancesController } from '../allowances/allowances.controller';
import { PayrollController } from '../payroll/payroll.controller';
import { PayApprovalsService } from './pay-approvals.service';
import { PayChangeRequestsService } from './pay-change-requests.service';

const finance = { id: 'fin', role: UserRole.PAYROLL_OFFICER };
const founder = { id: 'f1', role: UserRole.FOUNDER };

describe('Accounts cannot cut pay without approval', () => {
  function allowancesController() {
    const allowances = {
      describeEnd: jest.fn().mockResolvedValue({
        employeeId: 'e1',
        summary: 'End Incharge 5,000 after Oct 2026',
      }),
      describeAssign: jest.fn().mockResolvedValue({
        isIncrease: false,
        summary: 'Incharge 5,000 → 3,000 from Oct 2026',
      }),
      end: jest.fn().mockResolvedValue({ id: 'a1' }),
      assign: jest.fn().mockResolvedValue({ id: 'a1' }),
    };
    const requests = {
      submit: jest.fn().mockResolvedValue({ pendingApproval: true }),
    };
    const controller = Object.assign(
      Object.create(AllowancesController.prototype),
      {
        allowances,
        requests,
      },
    ) as AllowancesController;
    return { controller, allowances, requests };
  }

  it('ending an allowance from Accounts becomes an approval request', async () => {
    const { controller, allowances, requests } = allowancesController();
    await controller.end(
      'a1',
      { endMonth: '2026-10', approverTarget: EmployeeApproverTarget.FOUNDER },
      finance,
    );
    expect(allowances.end).not.toHaveBeenCalled();
    expect(requests.submit.mock.calls[0][0]).toMatchObject({
      kind: PayChangeKind.ALLOWANCE,
      employeeId: 'e1',
      payload: { action: 'END', allowanceId: 'a1', endMonth: '2026-10' },
    });
  });

  it('lowering an allowance from Accounts also needs approval; executives apply directly', async () => {
    const { controller, allowances, requests } = allowancesController();
    const dto = {
      employeeId: 'e1',
      typeId: 't',
      amount: 3000,
      startMonth: '2026-10',
      note: 'cut',
    };
    await controller.assign(dto as never, finance);
    expect(requests.submit).toHaveBeenCalled();
    expect(allowances.assign).not.toHaveBeenCalled();
    await controller.assign(dto as never, founder);
    expect(allowances.assign).toHaveBeenCalled();
  });

  it('a package cut from Accounts is submitted; a no-money edit is not', async () => {
    const describe = jest.fn();
    const submit = jest.fn().mockResolvedValue({ pendingApproval: true });
    const controller = Object.assign(
      Object.create(PayrollController.prototype),
      {
        payChangeRequests: { describePackageChange: describe, submit },
      },
    ) as unknown as {
      packageApproval: (
        k: PayChangeKind,
        d: unknown,
        u: unknown,
      ) => Promise<unknown>;
    };
    describe.mockResolvedValueOnce({
      isIncrease: false,
      summary: 'Basic 30,000 → 25,000',
    });
    await expect(
      controller.packageApproval(
        PayChangeKind.PACKAGE_EDIT,
        { employeeId: 'e1' },
        finance,
      ),
    ).resolves.toEqual({ pendingApproval: true });
    describe.mockResolvedValueOnce({ isIncrease: false, summary: 'No change' });
    await expect(
      controller.packageApproval(
        PayChangeKind.PACKAGE_EDIT,
        { employeeId: 'e1' },
        finance,
      ),
    ).resolves.toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('approving an end request ends the allowance', async () => {
    const request = {
      id: 'r1',
      kind: PayChangeKind.ALLOWANCE,
      employeeId: 'e1',
      payload: { action: 'END', allowanceId: 'a1', endMonth: '2026-10' },
      summary: 'End Incharge',
      approverTarget: EmployeeApproverTarget.FOUNDER,
      status: PayChangeStatus.PENDING,
      submittedById: 'fin',
    };
    const prisma = {
      payChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const allowances = { end: jest.fn().mockResolvedValue({ id: 'a1' }) };
    const service = new PayApprovalsService(
      prisma as never,
      new PayChangeRequestsService(prisma as never),
      {} as never,
      allowances as never,
      {} as never,
    );
    await service.approve('r1', founder);
    expect(allowances.end).toHaveBeenCalledWith('a1', '2026-10', founder, undefined);
  });
});
