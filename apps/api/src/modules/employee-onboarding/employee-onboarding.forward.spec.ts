import {
  EmployeeApproverTarget,
  EmployeeOnboardingStatus,
  UserRole,
} from '@prisma/client';

jest.mock('../letters/pdf.helper', () => ({
  generatePdf: jest.fn(),
}));

import { EmployeeOnboardingService } from './employee-onboarding.service';

describe('EmployeeOnboardingService.forward', () => {
  const itUser = { id: 'it-1', role: UserRole.IT_ADMIN };

  function build(status: EmployeeOnboardingStatus = EmployeeOnboardingStatus.PENDING, updated = 1) {
    const prisma = {
      employeeOnboardingApproval: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'apr-1',
          employeeId: 'emp-1',
          status,
          approverTarget: EmployeeApproverTarget.FOUNDER,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: updated }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new EmployeeOnboardingService(prisma as never, {} as never);
    return { prisma, service };
  }

  it('moves a pending approval to the new executive and audits it', async () => {
    const { prisma, service } = build();
    await service.forward('apr-1', itUser, EmployeeApproverTarget.PRESIDENT, 'Founder abroad');
    expect(prisma.employeeOnboardingApproval.updateMany).toHaveBeenCalledWith({
      where: { id: 'apr-1', status: EmployeeOnboardingStatus.PENDING },
      data: { approverTarget: EmployeeApproverTarget.PRESIDENT },
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'EMPLOYEE_ONBOARDING_FORWARDED',
      changes: { from: 'FOUNDER', to: 'PRESIDENT', reason: 'Founder abroad' },
    });
  });

  it('refuses reviewed, same-target, and raced requests', async () => {
    await expect(
      build(EmployeeOnboardingStatus.APPROVED).service.forward(
        'apr-1', itUser, EmployeeApproverTarget.PRESIDENT, 'reason here'),
    ).rejects.toThrow('already been reviewed');
    await expect(
      build().service.forward('apr-1', itUser, EmployeeApproverTarget.FOUNDER, 'reason here'),
    ).rejects.toThrow('already with the Founder');
    const raced = build(EmployeeOnboardingStatus.PENDING, 0);
    await expect(
      raced.service.forward('apr-1', itUser, EmployeeApproverTarget.CHAIRMAN_ADMIN, 'reason here'),
    ).rejects.toThrow('already been reviewed');
    expect(raced.prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
