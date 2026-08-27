import {
  DisciplinaryType,
  EmployeeStatus,
  InquiryOutcome,
  LetterType,
  Permission,
  UserRole,
} from '@prisma/client';

jest.mock('../letters/letters.service', () => ({
  LettersService: class LettersService {},
}));

import { DisciplinaryService } from './disciplinary.service';

describe('DisciplinaryService.create', () => {
  const employeeId = 'emp-1';
  const actingUserId = 'user-hr';
  const createdAction = {
    id: 'action-1',
    employeeId,
    type: DisciplinaryType.SUSPENSION,
    reason: 'Repeated late arrivals',
  };

  function buildService() {
    const tx = {
      disciplinaryAction: {
        create: jest.fn().mockResolvedValue(createdAction),
      },
      notification: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      employee: { update: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: employeeId,
          status: EmployeeStatus.ACTIVE,
          currentDepartment: { name: 'OPD' },
        }),
      },
      disciplinaryAction: {
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) =>
        fn(tx),
      ),
    };

    const lettersService = {
      // Mocked: this spec does not assert a persisted Letter.status = DRAFT.
      generate: jest.fn().mockResolvedValue({
        letter: { status: 'DRAFT' },
      }),
    };
    const accessScopeService = {
      assertEmployeeAccess: jest.fn().mockResolvedValue(undefined),
    };

    const service = new DisciplinaryService(
      prisma as never,
      lettersService as never,
      accessScopeService as never,
    );

    return { service, prisma, tx, lettersService, accessScopeService };
  }

  it('creates a SUSPENSION case and letter without changing Employee.status', async () => {
    const { service, prisma, tx, lettersService, accessScopeService } =
      buildService();

    const result = await service.create(
      {
        employeeId,
        type: DisciplinaryType.SUSPENSION,
        reason: 'Repeated late arrivals',
      },
      actingUserId,
      UserRole.HR_MANAGER,
    );

    expect(accessScopeService.assertEmployeeAccess).toHaveBeenCalledWith(
      actingUserId,
      UserRole.HR_MANAGER,
      Permission.DISCIPLINARY_MANAGE,
      employeeId,
    );
    expect(result).toEqual(createdAction);
    expect(tx.disciplinaryAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employeeId,
          type: DisciplinaryType.SUSPENSION,
          reason: 'Repeated late arrivals',
        }),
      }),
    );
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employeeId,
          type: 'DISCIPLINARY_ACTION',
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'DISCIPLINARY_CREATED',
          entity: 'DisciplinaryAction',
        }),
      }),
    );
    expect(lettersService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId,
        letterType: LetterType.SUSPENSION,
      }),
      actingUserId,
    );
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(prisma.employee.findUnique).toHaveBeenCalled();
  });

  it('rejects a second OPEN SUSPENSION case for the same employee', async () => {
    const { service, prisma, tx } = buildService();
    prisma.disciplinaryAction.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(
      service.create(
        {
          employeeId,
          type: DisciplinaryType.SUSPENSION,
          reason: 'Another reason',
        },
        actingUserId,
        UserRole.HR_MANAGER,
      ),
    ).rejects.toThrow(/already has an open suspension case/i);

    expect(tx.disciplinaryAction.create).not.toHaveBeenCalled();
  });

  it('creates a WARNING case and letter without updating employee status', async () => {
    const { service, tx, lettersService } = buildService();
    tx.disciplinaryAction.create.mockResolvedValue({
      ...createdAction,
      type: DisciplinaryType.WARNING,
      reason: 'Late twice',
    });

    await service.create(
      {
        employeeId,
        type: DisciplinaryType.WARNING,
        reason: 'Late twice',
      },
      actingUserId,
    );

    expect(tx.disciplinaryAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: DisciplinaryType.WARNING,
          reason: 'Late twice',
        }),
      }),
    );
    expect(lettersService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId,
        letterType: LetterType.WARNING,
      }),
      actingUserId,
    );
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  it('creates a FINE case and letter without updating employee status', async () => {
    const { service, tx, lettersService } = buildService();
    tx.disciplinaryAction.create.mockResolvedValue({
      ...createdAction,
      type: DisciplinaryType.FINE,
      reason: 'Policy fine',
    });

    await service.create(
      {
        employeeId,
        type: DisciplinaryType.FINE,
        reason: 'Policy fine',
      },
      actingUserId,
    );

    expect(tx.disciplinaryAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: DisciplinaryType.FINE,
          reason: 'Policy fine',
        }),
      }),
    );
    expect(lettersService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId,
        letterType: LetterType.FINE,
      }),
      actingUserId,
    );
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  it('rejects legacy resolveInquiry for a SUSPENSION inquiry', async () => {
    const { service, prisma, tx } = buildService();
    Object.assign(prisma, {
      inquiry: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'inq-1',
          outcome: null,
          notes: null,
          disciplinaryAction: {
            id: 'action-1',
            type: DisciplinaryType.SUSPENSION,
            reason: 'Suspension case',
            employee: { id: employeeId, currentDesignation: 'Staff' },
          },
        }),
      },
    });

    await expect(
      service.resolveInquiry(
        {
          inquiryId: 'inq-1',
          outcome: InquiryOutcome.REINSTATED,
        },
        actingUserId,
      ),
    ).rejects.toThrow(/finding and final-decision workflow/);

    expect((tx as { inquiry?: { update?: unknown } }).inquiry?.update).toBeUndefined();
  });
});

describe('DisciplinaryService.startInquiry', () => {
  const employeeId = 'emp-1';
  const actingUserId = 'user-hr';

  function buildStartInquiry(action: {
    id: string;
    employeeId: string;
    type: DisciplinaryType;
    status: string;
    reason: string;
    inquiry: unknown;
  }) {
    const createdInquiry = { id: 'inq-new', disciplinaryActionId: action.id };
    const tx = {
      inquiry: { create: jest.fn().mockResolvedValue(createdInquiry) },
      disciplinaryAction: { update: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      disciplinaryAction: {
        findUnique: jest.fn().mockResolvedValue(action),
      },
      inquiry: {
        findUnique: jest.fn().mockResolvedValue({
          ...createdInquiry,
          disciplinaryAction: action,
        }),
      },
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) =>
        fn(tx),
      ),
    };
    const lettersService = {
      generate: jest.fn().mockResolvedValue({ letter: { status: 'DRAFT' } }),
    };
    const service = new DisciplinaryService(
      prisma as never,
      lettersService as never,
      { assertEmployeeAccess: jest.fn() } as never,
    );
    return { service, prisma, tx, lettersService };
  }

  it('rejects startInquiry for SUSPENSION actions', async () => {
    const { service, tx, lettersService } = buildStartInquiry({
      id: 'action-susp',
      employeeId,
      type: DisciplinaryType.SUSPENSION,
      status: 'OPEN',
      reason: 'Repeated late',
      inquiry: null,
    });

    await expect(
      service.startInquiry(
        { disciplinaryActionId: 'action-susp', deadlineDays: 3 },
        actingUserId,
      ),
    ).rejects.toThrow(
      'Suspension inquiries are started automatically after an approved suspension letter is issued.',
    );

    expect(tx.inquiry.create).not.toHaveBeenCalled();
    expect(lettersService.generate).not.toHaveBeenCalled();
  });

  it('still starts inquiry for non-suspension OPEN actions', async () => {
    const { service, tx, lettersService } = buildStartInquiry({
      id: 'action-warn',
      employeeId,
      type: DisciplinaryType.WARNING,
      status: 'OPEN',
      reason: 'Late twice',
      inquiry: null,
    });

    const result = await service.startInquiry(
      { disciplinaryActionId: 'action-warn', deadlineDays: 3 },
      actingUserId,
    );

    expect(tx.inquiry.create).toHaveBeenCalled();
    expect(tx.disciplinaryAction.update).toHaveBeenCalled();
    expect(lettersService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId,
        letterType: LetterType.INQUIRY,
      }),
      actingUserId,
    );
    expect(result).toEqual(
      expect.objectContaining({ id: 'inq-new' }),
    );
  });
});
