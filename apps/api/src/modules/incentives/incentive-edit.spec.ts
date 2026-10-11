import {
  EmployeeApproverTarget,
  PayChangeKind,
  PayChangeStatus,
  PayrollStatus,
  UserRole,
} from '@prisma/client';

jest.mock('../letters/pdf.helper', () => ({ generatePdf: jest.fn() }));

import { IncentivesService } from './incentives.service';
import { incentiveAllowanceDescription } from './incentives.dto';
import { PayApprovalsService } from '../pay-approvals/pay-approvals.service';
import { PayChangeRequestsService } from '../pay-approvals/pay-change-requests.service';

const incentive = {
  id: 'inc-1',
  employeeId: 'e1',
  amount: 1500,
  month: 10,
  year: 2026,
  reason: 'On Progress: ward shifting',
  typeId: 't1',
};

function buildService(status: PayrollStatus = PayrollStatus.PENDING) {
  const entry = {
    id: 'pe-1',
    status,
    netStipend: 30000,
    allowances: [
      { id: 'al-1', description: incentiveAllowanceDescription(incentive.reason) },
    ],
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    incentive: {
      findUnique: jest.fn().mockResolvedValue(incentive),
      update: jest.fn(async ({ data }) => ({ ...incentive, ...data })),
      delete: jest.fn(),
    },
    incentiveType: { findUnique: jest.fn() },
    payrollEntry: {
      findFirst: jest.fn().mockResolvedValue(entry),
      update: jest.fn().mockResolvedValue({ netStipend: 29500 }),
    },
    allowance: { create: jest.fn(), delete: jest.fn() },
    auditLog: { create: jest.fn() },
    payrollChangeLog: { create: jest.fn() },
  };
  const prisma = {
    incentive: { findUnique: jest.fn().mockResolvedValue(incentive) },
    incentiveType: {
      findUnique: jest.fn().mockResolvedValue({ id: 't1', name: 'On Progress' }),
    },
    $transaction: jest.fn(async (work: (c: typeof tx) => unknown) => work(tx)),
  };
  const service = new IncentivesService(prisma as never, {
    assertEmployeeAccess: jest.fn(),
  } as never);
  return { service, tx };
}

describe('editing an incentive', () => {
  it('lowers the amount in place and logs old → new on the payroll entry', async () => {
    const { service, tx } = buildService();
    await service.update(
      'inc-1',
      { amount: 1000, typeId: 't1', reason: 'ward shifting', month: 10, year: 2026 },
      'fin-1',
    );
    expect(tx.allowance.delete).toHaveBeenCalledWith({ where: { id: 'al-1' } });
    expect(tx.allowance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payrollEntryId: 'pe-1',
        amount: 1000,
        description: incentiveAllowanceDescription('On Progress: ward shifting'),
      }),
    });
    expect(tx.incentive.update).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      data: expect.objectContaining({ amount: 1000, month: 10, year: 2026 }),
    });
    expect(tx.payrollChangeLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'INCENTIVE_CHANGED',
      summary:
        'Incentive changed: On Progress: ward shifting PKR 1,500 → On Progress: ward shifting PKR 1,000',
      netBefore: 30000,
      netAfter: 29500,
    });
  });

  it('cannot edit or delete once the month is processed or paid', async () => {
    const edit = buildService(PayrollStatus.PROCESSED);
    await expect(
      edit.service.update(
        'inc-1',
        { amount: 1000, typeId: 't1', reason: 'x', month: 10, year: 2026 },
        'fin-1',
      ),
    ).rejects.toThrow('can no longer be changed');
    expect(edit.tx.allowance.delete).not.toHaveBeenCalled();

    const del = buildService(PayrollStatus.PAID);
    await expect(del.service.delete('inc-1', 'fin-1')).rejects.toThrow(
      'can no longer be changed',
    );
    expect(del.tx.incentive.delete).not.toHaveBeenCalled();
  });
});

describe('pending incentive requests', () => {
  const finance = { id: 'fin-1', role: UserRole.PAYROLL_OFFICER };

  function buildRequests(payload: Record<string, unknown>) {
    const request = {
      id: 'r1',
      kind: PayChangeKind.INCENTIVE,
      employeeId: 'e1',
      payload,
      summary: 'old',
      approverTarget: EmployeeApproverTarget.FOUNDER,
      status: PayChangeStatus.PENDING,
      submittedById: 'fin-1',
    };
    const prisma = {
      payChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      incentive: { findUnique: jest.fn().mockResolvedValue(incentive) },
      incentiveType: {
        findUnique: jest.fn().mockResolvedValue({ id: 't1', name: 'On Progress' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ role: UserRole.PAYROLL_OFFICER }),
      },
      auditLog: { create: jest.fn() },
    };
    return { prisma, requests: new PayChangeRequestsService(prisma as never) };
  }

  it('Finance edits a pending request; it stays pending with the new values and approver', async () => {
    const { prisma, requests } = buildRequests({
      employeeId: 'e1', amount: 5000, typeId: 't1', reason: 'typo', month: 10, year: 2026,
    });
    await requests.editIncentiveRequest('r1', finance, {
      amount: 500, typeId: 't1', reason: 'ward shifting', month: 10, year: 2026,
      approverTarget: EmployeeApproverTarget.PRESIDENT,
    });
    const call = prisma.payChangeRequest.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'r1', status: PayChangeStatus.PENDING });
    expect(call.data).toMatchObject({
      summary: 'Incentive (On Progress) 500 for Oct 2026',
      reason: 'ward shifting',
      approverTarget: EmployeeApproverTarget.PRESIDENT,
      payload: { employeeId: 'e1', amount: 500, reason: 'ward shifting' },
    });
    expect(call.data.payload._editedAt).toEqual(expect.any(String));
  });

  it('Finance cancels a pending request with a reason', async () => {
    const { prisma, requests } = buildRequests({ employeeId: 'e1', amount: 5000 });
    const res = await requests.cancel('r1', finance, 'entered twice');
    expect(res.status).toBe(PayChangeStatus.CANCELLED);
    expect(prisma.payChangeRequest.updateMany.mock.calls[0][0].data).toMatchObject({
      status: PayChangeStatus.CANCELLED,
      reviewNote: 'entered twice',
    });
  });

  it('approving a raise of an existing incentive updates that incentive', async () => {
    const { prisma, requests } = buildRequests({
      incentiveId: 'inc-1', amount: 2000, typeId: 't1', reason: 'ward shifting',
      month: 10, year: 2026, _editedAt: '2026-10-11T00:00:00Z',
    });
    const incentives = { update: jest.fn().mockResolvedValue({}), create: jest.fn() };
    const service = new PayApprovalsService(
      prisma as never, requests, {} as never, {} as never, incentives as never,
    );
    await service.approve('r1', { id: 'f1', role: UserRole.FOUNDER });
    expect(incentives.update).toHaveBeenCalledWith(
      'inc-1',
      { amount: 2000, typeId: 't1', reason: 'ward shifting', month: 10, year: 2026 },
      'fin-1',
    );
    expect(incentives.create).not.toHaveBeenCalled();
  });
});
