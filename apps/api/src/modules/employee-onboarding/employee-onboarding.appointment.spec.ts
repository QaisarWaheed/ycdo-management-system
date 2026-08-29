import {
  EmployeeApproverTarget,
  EmployeeOnboardingStatus,
  EmployeeStatus,
  LetterType,
  StaffType,
  UserRole,
} from '@prisma/client';

jest.mock('../letters/pdf.helper', () => ({
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

jest.mock('../../config/cloudinary.config', () => ({
  isCloudinaryEnabled: () => false,
  uploadPdfToCloudinary: jest.fn(),
}));

import { EmployeeOnboardingService } from './employee-onboarding.service';

describe('EmployeeOnboardingService appointment Phase 3A', () => {
  const approvalId = 'apr-1';
  const employeeId = 'emp-1';
  const user = { id: 'super-1', role: UserRole.SUPER_ADMIN };

  function build(opts?: { letterFails?: boolean; existingStaff?: boolean }) {
    const approval = {
      id: approvalId,
      employeeId,
      status: EmployeeOnboardingStatus.PENDING,
      approverTarget: EmployeeApproverTarget.FOUNDER,
      formSnapshot: { basicStipend: 1000 },
    };

    const tx = {
      employeeOnboardingApproval: { update: jest.fn().mockResolvedValue({}) },
      employee: { update: jest.fn().mockResolvedValue({}) },
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };

    const prisma = {
      employeeOnboardingApproval: {
        findUnique: jest.fn().mockImplementation(async () => {
          const calls = prisma.employeeOnboardingApproval.findUnique.mock.calls
            .length;
          if (calls <= 1) return approval;
          return { ...approval, status: EmployeeOnboardingStatus.APPROVED };
        }),
      },
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: employeeId,
          staffType: opts?.existingStaff
            ? StaffType.EXISTING
            : StaffType.NEW,
          stipendRecords: [{ basicStipend: 1000 }],
          currentBranch: { name: 'Main' },
          currentDepartment: { name: 'OPD' },
          shift: { name: 'General' },
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) =>
        fn(tx),
      ),
    };

    const lettersService = {
      generateSystemLetter: jest.fn().mockImplementation(async () => {
        if (opts?.letterFails) {
          throw new Error('mapping missing');
        }
        return { letter: { status: 'DRAFT', letterType: LetterType.APPOINTMENT } };
      }),
    };

    const service = new EmployeeOnboardingService(
      prisma as never,
      lettersService as never,
    );

    return { service, prisma, tx, lettersService };
  }

  it('approval generates Appointment DRAFT via generateSystemLetter and does not WhatsApp itself', async () => {
    const { service, lettersService, tx } = build();
    await service.approve(approvalId, user);
    expect(tx.employeeOnboardingApproval.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: EmployeeOnboardingStatus.APPROVED,
        }),
      }),
    );
    expect(tx.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: EmployeeStatus.ACTIVE },
      }),
    );
    expect(lettersService.generateSystemLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId,
        letterType: LetterType.APPOINTMENT,
      }),
    );
  });

  it('does not roll back approval when appointment letter generation fails', async () => {
    const { service, tx, prisma } = build({ letterFails: true });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(service.approve(approvalId, user)).resolves.toBeTruthy();
    expect(tx.employeeOnboardingApproval.update).toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('skips appointment generation for EXISTING staff', async () => {
    const { service, lettersService } = build({ existingStaff: true });
    await service.approve(approvalId, user);
    expect(lettersService.generateSystemLetter).not.toHaveBeenCalled();
  });
});
