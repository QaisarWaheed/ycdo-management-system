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

  it('verified package: Basic goes to the Founder with a notification, deductions apply directly', async () => {
    const describe = jest.fn();
    const submit = jest.fn().mockResolvedValue({ pendingApproval: true });
    const isPackageVerified = jest.fn();
    const packageChangeScope = jest.fn();
    const controller = Object.assign(
      Object.create(PayrollController.prototype),
      {
        payChangeRequests: {
          describePackageChange: describe,
          submit,
          isPackageVerified,
          packageChangeScope,
        },
      },
    ) as unknown as {
      packageApproval: (
        k: PayChangeKind,
        d: unknown,
        u: unknown,
      ) => Promise<unknown>;
    };
    const dto = { employeeId: 'e1', approverTarget: EmployeeApproverTarget.PRESIDENT };

    // Not verified yet: Finance saves directly.
    isPackageVerified.mockResolvedValueOnce(false);
    await expect(
      controller.packageApproval(PayChangeKind.PACKAGE_EDIT, dto, finance),
    ).resolves.toBeNull();

    // Verified, Basic cut: Founder, notification required.
    isPackageVerified.mockResolvedValue(true);
    packageChangeScope.mockResolvedValueOnce({ earnings: true, basic: true });
    describe.mockResolvedValueOnce({ isIncrease: false, summary: 'Basic 30,000 → 25,000' });
    await expect(
      controller.packageApproval(PayChangeKind.PACKAGE_EDIT, dto, finance),
    ).resolves.toEqual({ pendingApproval: true, notificationRequired: true });
    expect(submit.mock.calls[0][0]).toMatchObject({
      approverTarget: EmployeeApproverTarget.FOUNDER,
      payload: { _needsNotification: true },
    });

    // Verified, only a deduction changed: saves directly.
    packageChangeScope.mockResolvedValueOnce({ earnings: false, basic: false });
    await expect(
      controller.packageApproval(PayChangeKind.PACKAGE_EDIT, dto, finance),
    ).resolves.toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('a Basic / increment request cannot be approved before the notification is attached', async () => {
    const request = {
      id: 'r2',
      kind: PayChangeKind.SALARY_INCREMENT,
      employeeId: 'e1',
      payload: { basicStipend: 35000, _needsNotification: true },
      summary: 'Basic 30,000 → 35,000',
      approverTarget: EmployeeApproverTarget.FOUNDER,
      status: PayChangeStatus.PENDING,
      submittedById: 'fin',
      attachmentUrl: null,
    };
    const prisma = {
      payChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new PayApprovalsService(
      prisma as never,
      new PayChangeRequestsService(prisma as never),
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.approve('r2', founder)).rejects.toThrow('signed notification is not attached');
    expect(prisma.payChangeRequest.updateMany).not.toHaveBeenCalled();
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

  it('Finance verifies a package once; verifying again is refused', async () => {
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({ payPackageVerifiedAt: null }),
        update: jest.fn(),
      },
      stipendRecord: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
      auditLog: { create: jest.fn() },
    };
    const service = new PayChangeRequestsService(prisma as never);
    await service.verifyPackage('e1', finance);
    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: expect.objectContaining({ payPackageVerifiedById: finance.id }),
    });
    prisma.employee.findUnique.mockResolvedValue({ payPackageVerifiedAt: new Date() });
    await expect(service.verifyPackage('e1', finance)).rejects.toThrow('already verified');
  });
});
