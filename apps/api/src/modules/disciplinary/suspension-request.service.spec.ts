import {
  DisciplinaryStatus,
  DisciplinaryType,
  EmployeeStatus,
  LetterStatus,
  LetterType,
  Permission,
  SuspensionRequestStatus,
  UserRole,
} from '@prisma/client';

jest.mock('../letters/letters.service', () => ({
  LettersService: class LettersService {},
}));

import { SuspensionRequestService } from './suspension-request.service';

describe('SuspensionRequestService', () => {
  const actionId = 'action-1';
  const employeeId = 'emp-1';
  const letterId = 'letter-1';
  const actingUserId = 'user-hr';
  const officerId = 'user-officer';
  const approverId = 'user-founder';
  const periodStart = new Date('2026-09-01T00:00:00.000Z');
  const periodEnd = new Date('2026-09-10T00:00:00.000Z');
  const inquiryDeadlineAt = new Date('2026-09-15T00:00:00.000Z');

  const prepareDto = {
    reason: 'Repeated late arrivals',
    periodStart,
    periodEnd,
    inquiryOfficerUserId: officerId,
    inquiryDeadlineAt,
    selectedApproverUserId: approverId,
  };

  function eligibleUser(overrides: Record<string, unknown> = {}) {
    return {
      id: approverId,
      isActive: true,
      role: UserRole.FOUNDER,
      additionalRoles: [],
      email: 'founder@ycdo.org',
      employee: { fullName: 'Founder Name', employeeCode: 'F-1' },
      ...overrides,
    };
  }

  function openAction(overrides: Record<string, unknown> = {}) {
    return {
      id: actionId,
      employeeId,
      type: DisciplinaryType.SUSPENSION,
      status: DisciplinaryStatus.OPEN,
      suspensionRequest: null,
      employee: { status: EmployeeStatus.ACTIVE },
      ...overrides,
    };
  }

  function builtRequest(
    status: SuspensionRequestStatus = SuspensionRequestStatus.DRAFT,
  ) {
    return {
      id: 'req-1',
      disciplinaryActionId: actionId,
      letterId,
      employeeId,
      status,
      reason: prepareDto.reason,
      periodStart,
      periodEnd,
      inquiryOfficerUserId: officerId,
      inquiryDeadlineAt,
      selectedApproverUserId: approverId,
      submittedById: null,
      submittedAt: null,
      decidedById: null,
      decidedAt: null,
      decisionNote: null,
      letter: {
        id: letterId,
        letterType: LetterType.SUSPENSION,
        status: LetterStatus.DRAFT,
      },
      employee: {
        id: employeeId,
        fullName: 'Test',
        employeeCode: 'E-1',
        status: EmployeeStatus.ACTIVE,
      },
    };
  }

  function buildService() {
    const prisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      disciplinaryAction: {
        findUnique: jest.fn().mockResolvedValue(openAction()),
      },
      letter: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({
          id: letterId,
          letterType: LetterType.SUSPENSION,
          status: LetterStatus.DRAFT,
        }),
      },
      suspensionRequest: {
        create: jest.fn().mockResolvedValue(builtRequest()),
        findUnique: jest.fn().mockResolvedValue(builtRequest()),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue(
          builtRequest(SuspensionRequestStatus.PENDING_APPROVAL),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) },
      employee: { update: jest.fn() },
      $transaction: jest.fn(),
    };

    prisma.$transaction.mockImplementation(
      async (fn: (client: typeof prisma) => unknown) => fn(prisma),
    );

    const lettersService = {
      generate: jest.fn().mockResolvedValue({
        letter: {
          id: letterId,
          letterType: LetterType.SUSPENSION,
          status: LetterStatus.DRAFT,
        },
      }),
      updateLetter: jest.fn().mockResolvedValue({
        letter: {
          id: letterId,
          letterType: LetterType.SUSPENSION,
          status: LetterStatus.DRAFT,
        },
      }),
    };

    const accessScopeService = {
      assertEmployeeAccess: jest.fn().mockResolvedValue(undefined),
    };

    const service = new SuspensionRequestService(
      prisma as never,
      lettersService as never,
      accessScopeService as never,
    );

    prisma.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === officerId) {
        return Promise.resolve({
          id: officerId,
          isActive: true,
          role: UserRole.HR_MANAGER,
          additionalRoles: [],
          email: 'officer@ycdo.org',
          employee: { fullName: 'Inquiry Officer' },
        });
      }
      if (where.id === approverId) {
        return Promise.resolve(eligibleUser());
      }
      return Promise.resolve(null);
    });

    return { service, prisma, lettersService, accessScopeService };
  }

  describe('prepare', () => {
    it('creates a DRAFT SuspensionRequest and DRAFT SUSPENSION letter without changing employee status', async () => {
      const { service, prisma, lettersService, accessScopeService } =
        buildService();

      const result = await service.prepare(
        actionId,
        prepareDto,
        actingUserId,
        UserRole.HR_MANAGER,
      );

      expect(accessScopeService.assertEmployeeAccess).toHaveBeenCalledWith(
        actingUserId,
        UserRole.HR_MANAGER,
        Permission.DISCIPLINARY_MANAGE,
        employeeId,
      );
      expect(lettersService.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId,
          letterType: LetterType.SUSPENSION,
          extraFields: expect.objectContaining({
            disciplinaryActionId: actionId,
            suspensionReason: prepareDto.reason,
          }),
        }),
        actingUserId,
        UserRole.HR_MANAGER,
      );
      expect(prisma.suspensionRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            disciplinaryActionId: actionId,
            letterId,
            employeeId,
            status: SuspensionRequestStatus.DRAFT,
          }),
        }),
      );
      expect(result.status).toBe(SuspensionRequestStatus.DRAFT);
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('does not create a second request when one already exists in DRAFT', async () => {
      const { service, prisma, lettersService } = buildService();
      prisma.disciplinaryAction.findUnique.mockResolvedValue(
        openAction({ suspensionRequest: builtRequest() }),
      );

      await service.prepare(
        actionId,
        prepareDto,
        actingUserId,
        UserRole.HR_MANAGER,
      );

      expect(prisma.suspensionRequest.create).not.toHaveBeenCalled();
      expect(lettersService.generate).not.toHaveBeenCalled();
      expect(lettersService.updateLetter).toHaveBeenCalled();
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('rejects when periodEnd is before periodStart', async () => {
      const { service, prisma } = buildService();

      await expect(
        service.prepare(
          actionId,
          { ...prepareDto, periodEnd: new Date('2026-08-01T00:00:00.000Z') },
          actingUserId,
          UserRole.HR_MANAGER,
        ),
      ).rejects.toThrow(/on or after the start date/i);

      expect(prisma.suspensionRequest.create).not.toHaveBeenCalled();
    });

    it('rejects HR Executive from preparing a suspension request', async () => {
      const { service, prisma } = buildService();

      await expect(
        service.prepare(
          actionId,
          prepareDto,
          actingUserId,
          UserRole.HR_EXECUTIVE,
        ),
      ).rejects.toThrow(/Super Admin, HR Manager, or Admin Manager/i);

      expect(prisma.suspensionRequest.create).not.toHaveBeenCalled();
    });

    it('rejects WARNING disciplinary actions', async () => {
      const { service, prisma } = buildService();
      prisma.disciplinaryAction.findUnique.mockResolvedValue(
        openAction({ type: DisciplinaryType.WARNING }),
      );

      await expect(
        service.prepare(actionId, prepareDto, actingUserId, UserRole.HR_MANAGER),
      ).rejects.toThrow(/SUSPENSION disciplinary cases/i);

      expect(prisma.suspensionRequest.create).not.toHaveBeenCalled();
    });

    it('rejects prepare when the request is already COMPLETED', async () => {
      const { service, prisma } = buildService();
      prisma.disciplinaryAction.findUnique.mockResolvedValue(
        openAction({
          status: DisciplinaryStatus.UNDER_INQUIRY,
          suspensionRequest: builtRequest(SuspensionRequestStatus.COMPLETED),
        }),
      );

      await expect(
        service.prepare(actionId, prepareDto, actingUserId, UserRole.HR_MANAGER),
      ).rejects.toThrow(/COMPLETED/);

      expect(prisma.suspensionRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('listEligibleApprovers', () => {
    it('returns only active users with Founder, President, Chairman, or Admin Manager', async () => {
      const { service, prisma } = buildService();
      prisma.user.findMany.mockResolvedValue([
        eligibleUser({ id: 'founder-1', role: UserRole.FOUNDER }),
        eligibleUser({
          id: 'president-1',
          role: UserRole.PRESIDENT,
          additionalRoles: [],
        }),
        eligibleUser({
          id: 'super-with-chair',
          role: UserRole.SUPER_ADMIN,
          additionalRoles: [{ role: UserRole.CHAIRMAN }],
        }),
      ]);

      const result = await service.listEligibleApprovers();

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
            OR: [
              {
                role: {
                  in: [
                    UserRole.FOUNDER,
                    UserRole.PRESIDENT,
                    UserRole.CHAIRMAN,
                    UserRole.ADMIN_MANAGER,
                  ],
                },
              },
              {
                additionalRoles: {
                  some: {
                    role: {
                      in: [
                        UserRole.FOUNDER,
                        UserRole.PRESIDENT,
                        UserRole.CHAIRMAN,
                        UserRole.ADMIN_MANAGER,
                      ],
                    },
                  },
                },
              },
            ],
          }),
        }),
      );
      expect(result.map((row) => row.id)).toEqual([
        'founder-1',
        'president-1',
        'super-with-chair',
      ]);
    });
  });

  describe('updateDraft', () => {
    it('updates proposal fields and does not change employee status', async () => {
      const { service, prisma, lettersService } = buildService();
      prisma.suspensionRequest.findUnique.mockResolvedValue(builtRequest());
      prisma.suspensionRequest.update.mockResolvedValue(builtRequest());

      await service.updateDraft(
        'req-1',
        { reason: 'Updated reason' },
        actingUserId,
        UserRole.HR_MANAGER,
      );

      expect(lettersService.updateLetter).toHaveBeenCalled();
      expect(prisma.suspensionRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reason: 'Updated reason' }),
        }),
      );
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });
  });

  describe('submit', () => {
    it('moves DRAFT to PENDING_APPROVAL without sending the letter or suspending', async () => {
      const { service, prisma } = buildService();
      prisma.suspensionRequest.findUnique.mockResolvedValue(builtRequest());
      prisma.suspensionRequest.update.mockResolvedValue({
        ...builtRequest(SuspensionRequestStatus.PENDING_APPROVAL),
        submittedById: actingUserId,
        submittedAt: new Date(),
      });

      const result = await service.submit(
        'req-1',
        actingUserId,
        UserRole.HR_MANAGER,
      );

      expect(prisma.suspensionRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SuspensionRequestStatus.PENDING_APPROVAL,
            submittedById: actingUserId,
            decidedById: null,
            decidedAt: null,
            decisionNote: null,
          }),
        }),
      );
      expect(result.status).toBe(SuspensionRequestStatus.PENDING_APPROVAL);
      expect(result.letter.status).toBe(LetterStatus.DRAFT);
      expect(prisma.employee.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'SUSPENSION_REQUEST_SUBMITTED',
          }),
        }),
      );
    });

    it('returns an already-submitted request without duplicating side effects', async () => {
      const { service, prisma } = buildService();
      prisma.suspensionRequest.findUnique.mockResolvedValue(
        builtRequest(SuspensionRequestStatus.PENDING_APPROVAL),
      );

      const result = await service.submit(
        'req-1',
        actingUserId,
        UserRole.HR_MANAGER,
      );

      expect(result.alreadySubmitted).toBe(true);
      expect(prisma.suspensionRequest.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('rejects an inactive selected approver', async () => {
      const { service, prisma } = buildService();
      prisma.suspensionRequest.findUnique.mockResolvedValue(builtRequest());
      prisma.user.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) => {
          if (where.id === officerId) {
            return Promise.resolve({ id: officerId, isActive: true });
          }
          if (where.id === approverId) {
            return Promise.resolve(eligibleUser({ isActive: false }));
          }
          return Promise.resolve(null);
        },
      );

      await expect(
        service.submit('req-1', actingUserId, UserRole.HR_MANAGER),
      ).rejects.toThrow(/active user/i);

      expect(prisma.suspensionRequest.update).not.toHaveBeenCalled();
    });

    it('rejects an ineligible selected approver', async () => {
      const { service, prisma } = buildService();
      prisma.suspensionRequest.findUnique.mockResolvedValue(builtRequest());
      prisma.user.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) => {
          if (where.id === officerId) {
            return Promise.resolve({ id: officerId, isActive: true });
          }
          if (where.id === approverId) {
            return Promise.resolve(
              eligibleUser({
                role: UserRole.ADMIN_OFFICER,
                additionalRoles: [],
              }),
            );
          }
          return Promise.resolve(null);
        },
      );

      await expect(
        service.submit('req-1', actingUserId, UserRole.HR_MANAGER),
      ).rejects.toThrow(/Founder, President, Chairman, or Admin Manager/i);
    });

    it('clears stale rejection metadata when resubmitting a REJECTED request', async () => {
      const { service, prisma } = buildService();
      prisma.suspensionRequest.findUnique.mockResolvedValue({
        ...builtRequest(SuspensionRequestStatus.REJECTED),
        decidedById: approverId,
        decidedAt: new Date('2026-09-01T00:00:00.000Z'),
        decisionNote: 'Need more evidence',
      });
      prisma.suspensionRequest.update.mockResolvedValue(
        builtRequest(SuspensionRequestStatus.PENDING_APPROVAL),
      );

      await service.submit('req-1', actingUserId, UserRole.HR_MANAGER);

      expect(prisma.suspensionRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SuspensionRequestStatus.PENDING_APPROVAL,
            decidedById: null,
            decidedAt: null,
            decisionNote: null,
          }),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'SUSPENSION_REQUEST_SUBMITTED',
            changes: expect.objectContaining({
              previousDecidedById: approverId,
              previousDecisionNote: 'Need more evidence',
            }),
          }),
        }),
      );
    });
  });

  describe('listMyPending', () => {
    it('returns only PENDING_APPROVAL requests assigned to the current user', async () => {
      const { service, prisma } = buildService();
      prisma.suspensionRequest.findMany.mockResolvedValue([
        builtRequest(SuspensionRequestStatus.PENDING_APPROVAL),
      ]);

      await service.listMyPending(approverId);

      expect(prisma.suspensionRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            selectedApproverUserId: approverId,
            status: SuspensionRequestStatus.PENDING_APPROVAL,
          },
        }),
      );
    });
  });

  describe('approve and reject', () => {
    function pendingForApprover() {
      return builtRequest(SuspensionRequestStatus.PENDING_APPROVAL);
    }

    it('lets the selected approver approve without sending the letter or suspending', async () => {
      const { service, prisma } = buildService();
      prisma.suspensionRequest.findUnique
        .mockResolvedValueOnce(pendingForApprover())
        .mockResolvedValueOnce({
          ...pendingForApprover(),
          status: SuspensionRequestStatus.APPROVED,
          decidedById: approverId,
        });

      const result = await service.approve('req-1', approverId, 'Ok');

      expect(prisma.suspensionRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'req-1',
            status: SuspensionRequestStatus.PENDING_APPROVAL,
            selectedApproverUserId: approverId,
          },
          data: expect.objectContaining({
            status: SuspensionRequestStatus.APPROVED,
            decidedById: approverId,
            decisionNote: 'Ok',
          }),
        }),
      );
      expect(result.status).toBe(SuspensionRequestStatus.APPROVED);
      expect(result.letter.status).toBe(LetterStatus.DRAFT);
      expect(prisma.employee.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'SUSPENSION_REQUEST_APPROVED',
          }),
        }),
      );
    });

    it('lets the selected approver reject with a reason without changing the letter or employee', async () => {
      const { service, prisma } = buildService();
      prisma.suspensionRequest.findUnique
        .mockResolvedValueOnce(pendingForApprover())
        .mockResolvedValueOnce({
          ...pendingForApprover(),
          status: SuspensionRequestStatus.REJECTED,
          decisionNote: 'Insufficient evidence',
        });

      const result = await service.reject(
        'req-1',
        approverId,
        'Insufficient evidence',
      );

      expect(prisma.suspensionRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SuspensionRequestStatus.REJECTED,
            decisionNote: 'Insufficient evidence',
          }),
        }),
      );
      expect(result.status).toBe(SuspensionRequestStatus.REJECTED);
      expect(result.letter.status).toBe(LetterStatus.DRAFT);
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('forbids a different user with the same eligible role from approving', async () => {
      const { service, prisma } = buildService();
      prisma.suspensionRequest.findUnique.mockResolvedValue(pendingForApprover());
      prisma.user.findUnique.mockResolvedValue({
        id: 'founder-b',
        isActive: true,
        role: UserRole.FOUNDER,
        additionalRoles: [],
      });

      await expect(
        service.approve('req-1', 'founder-b'),
      ).rejects.toThrow(/selected approver/i);
      expect(prisma.suspensionRequest.updateMany).not.toHaveBeenCalled();
    });

    it('forbids Super Admin from approving when they are not the selected person', async () => {
      const { service, prisma } = buildService();
      prisma.suspensionRequest.findUnique.mockResolvedValue(pendingForApprover());
      prisma.user.findUnique.mockResolvedValue({
        id: 'super-1',
        isActive: true,
        role: UserRole.SUPER_ADMIN,
        additionalRoles: [],
      });

      await expect(service.approve('req-1', 'super-1')).rejects.toThrow(
        /selected approver/i,
      );
      expect(prisma.suspensionRequest.updateMany).not.toHaveBeenCalled();
    });

    it('forbids a different user from rejecting', async () => {
      const { service, prisma } = buildService();
      prisma.suspensionRequest.findUnique.mockResolvedValue(pendingForApprover());
      prisma.user.findUnique.mockResolvedValue({
        id: 'founder-b',
        isActive: true,
      });

      await expect(
        service.reject('req-1', 'founder-b', 'No'),
      ).rejects.toThrow(/selected approver/i);
    });

    it.each([
      SuspensionRequestStatus.DRAFT,
      SuspensionRequestStatus.APPROVED,
      SuspensionRequestStatus.REJECTED,
      SuspensionRequestStatus.ISSUED,
      SuspensionRequestStatus.COMPLETED,
      SuspensionRequestStatus.CANCELLED,
    ])('does not decide a request in status %s', async (status) => {
      const { service, prisma } = buildService();
      prisma.suspensionRequest.findUnique.mockResolvedValue(builtRequest(status));

      await expect(service.approve('req-1', approverId)).rejects.toThrow(
        /Cannot decide/,
      );
      await expect(
        service.reject('req-1', approverId, 'No'),
      ).rejects.toThrow(/Cannot decide/);
      expect(prisma.suspensionRequest.updateMany).not.toHaveBeenCalled();
    });

    it('does not apply a second approve when updateMany matches no pending row', async () => {
      const { service, prisma } = buildService();
      prisma.suspensionRequest.findUnique.mockResolvedValue(pendingForApprover());
      prisma.suspensionRequest.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.approve('req-1', approverId)).rejects.toThrow(
        /already been decided/i,
      );
    });

    it('requires a non-empty rejection reason', async () => {
      const { service, prisma } = buildService();

      await expect(service.reject('req-1', approverId, '   ')).rejects.toThrow(
        /rejection reason/i,
      );
      expect(prisma.suspensionRequest.updateMany).not.toHaveBeenCalled();
    });
  });
});
