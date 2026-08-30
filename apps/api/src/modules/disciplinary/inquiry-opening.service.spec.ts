import { InquiryOpenApprovalStatus } from '@prisma/client';
import { InquiryOpeningService } from './inquiry-opening.service';

describe('InquiryOpeningService', () => {
  const employeeId = 'emp-1';
  const officerId = 'off-1';
  const approverId = 'apr-1';
  const actingUserId = 'hr-1';

  function build() {
    const inquiryRow = {
      id: 'inq-1',
      durationDays: 3,
      disciplinaryActionId: 'act-1',
      selectedOpenApprover: {
        employee: { fullName: 'Founder', phone: '03001234567' },
      },
      inquiryOfficer: {
        employee: { fullName: 'Officer', phone: '03007654321' },
      },
      disciplinaryAction: {
        id: 'act-1',
        reason: 'Due for suspension',
        employee: {
          id: employeeId,
          fullName: 'Abida',
          employeeCode: 'E-1',
          status: 'ACTIVE',
        },
      },
    };
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: employeeId,
          fullName: 'Abida',
          employeeCode: 'E-1',
          status: 'ACTIVE',
        }),
      },
      disciplinaryAction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      inquiry: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(inquiryRow),
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: officerId, isActive: true }),
      },
      notification: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    const access = { assertEmployeeAccess: jest.fn() };
    const suspension = {
      listEligibleApprovers: jest.fn().mockResolvedValue([{ id: approverId }]),
    };
    const whatsapp = { sendPlainText: jest.fn().mockResolvedValue({ sent: true }) };
    const service = new InquiryOpeningService(
      prisma as never,
      access as never,
      suspension as never,
      whatsapp as never,
    );
    return { service, prisma, whatsapp };
  }

  it('keeps the employee ACTIVE when submitting opening approval', async () => {
    const { service, prisma, whatsapp } = build();
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      prisma.disciplinaryAction.create.mockResolvedValue({ id: 'act-1' });
      prisma.inquiry.create.mockResolvedValue({ id: 'inq-1' });
      return fn(prisma);
    });

    await service.submitPendingOpen(
      {
        employeeId,
        reason: 'Due for suspension (2026-08). Late days: 10.',
        durationDays: 3,
        inquiryOfficerUserId: officerId,
        selectedApproverUserId: approverId,
      },
      actingUserId,
      'HR_MANAGER' as never,
    );

    expect(prisma.inquiry.create).toHaveBeenCalled();
    expect(whatsapp.sendPlainText).toHaveBeenCalled();
  });
});
