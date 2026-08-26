import { BadRequestException } from '@nestjs/common';
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

jest.mock('./pdf.helper', () => ({
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

jest.mock('../../config/cloudinary.config', () => ({
  isCloudinaryEnabled: () => false,
  uploadPdfToCloudinary: jest.fn(),
}));

import { LettersService } from './letters.service';

describe('LettersService.sendLetter', () => {
  const letterId = 'letter-1';
  const employeeId = 'emp-1';
  const actingUserId = 'user-hr';
  const actionId = 'action-1';
  const requestId = 'req-1';
  const officerId = 'officer-1';
  const decidedById = 'approver-1';
  const decidedAt = new Date('2026-08-20T10:00:00.000Z');
  const decisionNote = 'Approved after review';

  const employeeEmbed = {
    id: employeeId,
    fullName: 'Test Employee',
    employeeCode: 'E-1',
    phone: '03001234567',
    currentDesignation: 'Staff',
  };

  function draftLetter(
    letterType: LetterType,
    status: LetterStatus = LetterStatus.DRAFT,
    content: Record<string, unknown> = {},
  ) {
    return {
      id: letterId,
      employeeId,
      letterType,
      status,
      letterNo: '1/YCDO/2026',
      fileUrl: '/uploads/letters/x.pdf',
      replyDeadline: null,
      variables: {},
      content,
      employee: employeeEmbed,
      acknowledgement: null,
      replies: [],
    };
  }

  function approvedRequest(overrides: Record<string, unknown> = {}) {
    return {
      id: requestId,
      letterId,
      employeeId,
      status: SuspensionRequestStatus.APPROVED,
      decidedById,
      decidedAt,
      decisionNote,
      periodStart: new Date('2026-08-01'),
      periodEnd: new Date('2026-08-15'),
      inquiryOfficerUserId: officerId,
      inquiryDeadlineAt: new Date('2026-08-10'),
      selectedApproverUserId: decidedById,
      disciplinaryAction: {
        id: actionId,
        type: DisciplinaryType.SUSPENSION,
        employeeId,
        status: DisciplinaryStatus.OPEN,
        inquiry: null,
      },
      ...overrides,
    };
  }

  function build(opts: {
    letterType: LetterType;
    letterStatus?: LetterStatus;
    employeeStatus: EmployeeStatus;
    currentBranchId?: string;
    request?: Record<string, unknown> | null;
    letterUpdateManyCount?: number;
    requestUpdateManyCount?: number;
    content?: Record<string, unknown>;
  }) {
    const letter = draftLetter(
      opts.letterType,
      opts.letterStatus,
      opts.content ?? {},
    );
    const sentLetter = { ...letter, status: LetterStatus.SENT };
    let letterRow = { ...letter };

    const tx = {
      letter: {
        findUnique: jest.fn().mockImplementation(async () => letterRow),
        update: jest.fn().mockImplementation(async () => {
          letterRow = sentLetter;
          return sentLetter;
        }),
        updateMany: jest.fn().mockImplementation(async () => {
          if ((opts.letterUpdateManyCount ?? 1) === 1) {
            letterRow = sentLetter;
          }
          return { count: opts.letterUpdateManyCount ?? 1 };
        }),
      },
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          status: opts.employeeStatus,
          currentBranchId: opts.currentBranchId ?? 'branch-at-issue',
        }),
        update: jest
          .fn()
          .mockResolvedValue({ status: EmployeeStatus.SUSPENDED }),
      },
      suspensionRequest: {
        findUnique: jest.fn().mockResolvedValue(opts.request ?? null),
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: opts.requestUpdateManyCount ?? 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: officerId }),
      },
      disciplinaryAction: {
        update: jest.fn().mockResolvedValue({}),
      },
      inquiry: {
        create: jest.fn().mockResolvedValue({ id: 'inq-1' }),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      notification: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      letter: {
        findUnique: jest.fn().mockResolvedValue(letter),
      },
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) =>
        fn(tx),
      ),
    };

    const accessScopeService = {
      assertEmployeeAccess: jest.fn().mockResolvedValue(undefined),
    };
    const whatsappService = {
      deliverAfterLetterGenerated: jest.fn().mockResolvedValue(undefined),
    };

    const service = new LettersService(
      prisma as never,
      accessScopeService as never,
      whatsappService as never,
    );
    jest
      .spyOn(service, 'getPdf')
      .mockResolvedValue({ buffer: Buffer.from('pdf'), filename: 'letter.pdf' });

    return {
      service,
      prisma,
      tx,
      accessScopeService,
      whatsappService,
      letter,
      sentLetter,
    };
  }

  it('rejects DRAFT SUSPENSION send when no SuspensionRequest exists', async () => {
    const { service, tx, whatsappService } = build({
      letterType: LetterType.SUSPENSION,
      employeeStatus: EmployeeStatus.ACTIVE,
      request: null,
    });

    await expect(
      service.sendLetter(letterId, actingUserId, UserRole.HR_MANAGER),
    ).rejects.toThrow(
      'This suspension cannot be issued until the suspension request has been approved.',
    );

    expect(tx.letter.updateMany).not.toHaveBeenCalled();
    expect(tx.letter.update).not.toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(tx.inquiry.create).not.toHaveBeenCalled();
    expect(whatsappService.deliverAfterLetterGenerated).not.toHaveBeenCalled();
  });

  it.each([
    SuspensionRequestStatus.DRAFT,
    SuspensionRequestStatus.PENDING_APPROVAL,
    SuspensionRequestStatus.REJECTED,
    SuspensionRequestStatus.CANCELLED,
    SuspensionRequestStatus.ISSUED,
    SuspensionRequestStatus.COMPLETED,
  ])('rejects DRAFT SUSPENSION send when request is %s', async (status) => {
    const { service, tx } = build({
      letterType: LetterType.SUSPENSION,
      employeeStatus: EmployeeStatus.ACTIVE,
      request: approvedRequest({ status }),
    });

    await expect(
      service.sendLetter(letterId, actingUserId, UserRole.HR_MANAGER),
    ).rejects.toThrow(
      'This suspension cannot be issued until the suspension request has been approved.',
    );

    expect(tx.letter.updateMany).not.toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(tx.inquiry.create).not.toHaveBeenCalled();
  });

  it('issues an APPROVED suspension atomically', async () => {
    const { service, tx, accessScopeService, whatsappService } = build({
      letterType: LetterType.SUSPENSION,
      employeeStatus: EmployeeStatus.ACTIVE,
      currentBranchId: 'branch-at-issue',
      request: approvedRequest(),
    });

    const result = await service.sendLetter(
      letterId,
      actingUserId,
      UserRole.HR_MANAGER,
    );

    expect(accessScopeService.assertEmployeeAccess).toHaveBeenCalledWith(
      actingUserId,
      UserRole.HR_MANAGER,
      Permission.LETTERS_GENERATE,
      employeeId,
    );
    expect(tx.letter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: letterId, status: LetterStatus.DRAFT },
        data: expect.objectContaining({ status: LetterStatus.SENT }),
      }),
    );
    expect(tx.suspensionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: requestId,
          status: SuspensionRequestStatus.APPROVED,
        }),
        data: expect.objectContaining({
          status: SuspensionRequestStatus.ISSUED,
          suspendedFromBranchId: 'branch-at-issue',
        }),
      }),
    );
    const issuedData = tx.suspensionRequest.updateMany.mock.calls[0][0].data;
    expect(issuedData.decidedById).toBeUndefined();
    expect(issuedData.decidedAt).toBeUndefined();
    expect(issuedData.decisionNote).toBeUndefined();
    expect(issuedData.selectedApproverUserId).toBeUndefined();
    expect(issuedData.issuedAt).toBeInstanceOf(Date);
    expect(tx.employee.update).toHaveBeenCalledWith({
      where: { id: employeeId },
      data: { status: EmployeeStatus.SUSPENDED },
    });
    expect(tx.disciplinaryAction.update).toHaveBeenCalledWith({
      where: { id: actionId },
      data: { status: DisciplinaryStatus.UNDER_INQUIRY },
    });
    expect(tx.inquiry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        disciplinaryActionId: actionId,
        inquiryOfficerUserId: officerId,
        deadlineAt: expect.any(Date),
      }),
    });
    expect(tx.inquiry.update).not.toHaveBeenCalled();
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'INQUIRY_STARTED' }),
      }),
    );
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'LETTER_ISSUED' }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'LETTER_SENT' }),
      }),
    );
    expect(whatsappService.deliverAfterLetterGenerated).toHaveBeenCalledWith(
      expect.objectContaining({
        letterId,
        employeeId,
        letterType: LetterType.SUSPENSION,
      }),
    );
    expect(result.alreadySent).toBe(false);
    expect(result.letter.status).toBe(LetterStatus.SENT);
  });

  it.each([LetterType.WARNING, LetterType.FINE, LetterType.ADVICE])(
    'sends a DRAFT %s letter without a SuspensionRequest or employee status change',
    async (letterType) => {
      const { service, tx, whatsappService } = build({
        letterType,
        employeeStatus: EmployeeStatus.ACTIVE,
        request: null,
      });

      const result = await service.sendLetter(
        letterId,
        actingUserId,
        UserRole.HR_MANAGER,
      );

      expect(tx.letter.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: LetterStatus.SENT }),
        }),
      );
      expect(tx.suspensionRequest.findUnique).not.toHaveBeenCalled();
      expect(tx.employee.findUnique).not.toHaveBeenCalled();
      expect(tx.employee.update).not.toHaveBeenCalled();
      expect(tx.inquiry.create).not.toHaveBeenCalled();
      expect(whatsappService.deliverAfterLetterGenerated).toHaveBeenCalled();
      expect(result.alreadySent).toBe(false);
    },
  );

  it('is idempotent for an already SENT suspension letter with no request', async () => {
    const { service, prisma, tx, whatsappService } = build({
      letterType: LetterType.SUSPENSION,
      letterStatus: LetterStatus.SENT,
      employeeStatus: EmployeeStatus.ACTIVE,
      request: null,
    });

    const result = await service.sendLetter(
      letterId,
      actingUserId,
      UserRole.HR_MANAGER,
    );

    expect(result.alreadySent).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(tx.inquiry.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(whatsappService.deliverAfterLetterGenerated).not.toHaveBeenCalled();
  });

  it('issues an approved suspension to an already SUSPENDED employee without rewriting status', async () => {
    const { service, tx } = build({
      letterType: LetterType.SUSPENSION,
      employeeStatus: EmployeeStatus.SUSPENDED,
      request: approvedRequest(),
    });

    const result = await service.sendLetter(
      letterId,
      actingUserId,
      UserRole.HR_MANAGER,
    );

    expect(result.alreadySent).toBe(false);
    expect(tx.letter.updateMany).toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(tx.inquiry.create).toHaveBeenCalled();
    expect(tx.suspensionRequest.updateMany).toHaveBeenCalled();
  });

  it('rejects issuance when the employee is pending onboarding approval', async () => {
    const { service, tx, whatsappService } = build({
      letterType: LetterType.SUSPENSION,
      employeeStatus: EmployeeStatus.PENDING_APPROVAL,
      request: approvedRequest(),
    });

    await expect(
      service.sendLetter(letterId, actingUserId, UserRole.HR_MANAGER),
    ).rejects.toThrow(
      'An employee pending onboarding approval cannot be suspended.',
    );

    expect(tx.letter.updateMany).not.toHaveBeenCalled();
    expect(tx.letter.update).not.toHaveBeenCalled();
    expect(tx.suspensionRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(tx.inquiry.create).not.toHaveBeenCalled();
    expect(tx.inquiry.update).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(whatsappService.deliverAfterLetterGenerated).not.toHaveBeenCalled();
  });

  it.each([
    EmployeeStatus.TERMINATED,
    EmployeeStatus.DISMISSED,
    EmployeeStatus.RESIGNED,
  ])(
    'does not convert a %s employee to SUSPENDED',
    async (employeeStatus) => {
      const { service, tx } = build({
        letterType: LetterType.SUSPENSION,
        employeeStatus,
        request: approvedRequest(),
      });

      await expect(
        service.sendLetter(letterId, actingUserId, UserRole.HR_MANAGER),
      ).rejects.toThrow(new RegExp(employeeStatus));

      expect(tx.letter.updateMany).not.toHaveBeenCalled();
      expect(tx.employee.update).not.toHaveBeenCalled();
      expect(tx.inquiry.create).not.toHaveBeenCalled();
      expect(tx.suspensionRequest.updateMany).not.toHaveBeenCalled();
      expect(tx.notification.create).not.toHaveBeenCalled();
    },
  );

  it('reuses an existing open Inquiry instead of creating a duplicate', async () => {
    const { service, tx } = build({
      letterType: LetterType.SUSPENSION,
      employeeStatus: EmployeeStatus.ACTIVE,
      request: approvedRequest({
        disciplinaryAction: {
          id: actionId,
          type: DisciplinaryType.SUSPENSION,
          employeeId,
          status: DisciplinaryStatus.UNDER_INQUIRY,
          inquiry: {
            id: 'inq-existing',
            closedAt: null,
            outcome: null,
            finding: null,
            finalAction: null,
          },
        },
      }),
    });

    await service.sendLetter(letterId, actingUserId, UserRole.HR_MANAGER);

    expect(tx.inquiry.create).not.toHaveBeenCalled();
    expect(tx.inquiry.update).toHaveBeenCalledWith({
      where: { id: 'inq-existing' },
      data: expect.objectContaining({
        inquiryOfficerUserId: officerId,
        deadlineAt: expect.any(Date),
      }),
    });
    expect(tx.notification.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'INQUIRY_STARTED' }),
      }),
    );
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'LETTER_ISSUED' }),
      }),
    );
  });

  it('rejects issuance when the existing Inquiry is closed', async () => {
    const { service, tx } = build({
      letterType: LetterType.SUSPENSION,
      employeeStatus: EmployeeStatus.ACTIVE,
      request: approvedRequest({
        disciplinaryAction: {
          id: actionId,
          type: DisciplinaryType.SUSPENSION,
          employeeId,
          status: DisciplinaryStatus.UNDER_INQUIRY,
          inquiry: {
            id: 'inq-closed',
            closedAt: new Date('2026-07-01'),
            outcome: 'REINSTATED',
            finding: 'NOT_GUILTY',
            finalAction: 'REST',
          },
        },
      }),
    });

    await expect(
      service.sendLetter(letterId, actingUserId, UserRole.HR_MANAGER),
    ).rejects.toThrow(/already closed/);

    expect(tx.letter.updateMany).not.toHaveBeenCalled();
    expect(tx.inquiry.create).not.toHaveBeenCalled();
    expect(tx.inquiry.update).not.toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  it('does not repeat issuance side effects when a concurrent send already marked the letter SENT', async () => {
    const { service, tx, whatsappService } = build({
      letterType: LetterType.SUSPENSION,
      employeeStatus: EmployeeStatus.ACTIVE,
      request: approvedRequest(),
      letterUpdateManyCount: 0,
    });
    tx.letter.findUnique
      .mockResolvedValueOnce({
        ...draftLetter(LetterType.SUSPENSION),
        status: LetterStatus.DRAFT,
        employee: employeeEmbed,
        acknowledgement: null,
      })
      .mockResolvedValueOnce({
        ...draftLetter(LetterType.SUSPENSION, LetterStatus.SENT),
        employee: employeeEmbed,
        acknowledgement: null,
      });

    const result = await service.sendLetter(
      letterId,
      actingUserId,
      UserRole.HR_MANAGER,
    );

    expect(result.alreadySent).toBe(true);
    expect(tx.inquiry.create).not.toHaveBeenCalled();
    expect(tx.suspensionRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(whatsappService.deliverAfterLetterGenerated).not.toHaveBeenCalled();
  });

  it('snapshots Employee.currentBranchId at issue time, not a preparation-time value', async () => {
    const { service, tx } = build({
      letterType: LetterType.SUSPENSION,
      employeeStatus: EmployeeStatus.ON_LEAVE,
      currentBranchId: 'branch-now',
      request: approvedRequest(),
    });

    await service.sendLetter(letterId, actingUserId, UserRole.HR_MANAGER);

    expect(tx.employee.findUnique).toHaveBeenCalled();
    expect(tx.suspensionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          suspendedFromBranchId: 'branch-now',
        }),
      }),
    );
  });

  it('does not treat a DRAFT SUSPENSION letter as issued until sendLetter runs', async () => {
    const { tx } = build({
      letterType: LetterType.SUSPENSION,
      employeeStatus: EmployeeStatus.ACTIVE,
      request: approvedRequest(),
    });

    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(tx.letter.updateMany).not.toHaveBeenCalled();
    expect(tx.suspensionRequest.updateMany).not.toHaveBeenCalled();
  });

  it('notifies INQUIRY_RESOLVED once when a REINSTATEMENT final letter is sent', async () => {
    const { service, tx } = build({
      letterType: LetterType.REINSTATEMENT,
      employeeStatus: EmployeeStatus.ACTIVE,
      content: {
        inquiryId: 'inq-1',
        inquiryLetterKind: 'REINSTATEMENT',
      },
    });
    tx.inquiry.findUnique.mockResolvedValue({
      id: 'inq-1',
      finding: 'NOT_GUILTY',
      closedAt: new Date(),
    });

    await service.sendLetter(letterId, actingUserId, UserRole.HR_MANAGER);

    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'INQUIRY_RESOLVED',
          message: expect.stringContaining('inq-1'),
        }),
      }),
    );
  });

  it('does not notify INQUIRY_RESOLVED when only the FINE letter is sent', async () => {
    const { service, tx } = build({
      letterType: LetterType.FINE,
      employeeStatus: EmployeeStatus.ACTIVE,
      content: {
        inquiryId: 'inq-1',
        inquiryLetterKind: 'FINE',
      },
    });
    tx.inquiry.findUnique.mockResolvedValue({
      id: 'inq-1',
      finding: 'GUILTY',
      closedAt: new Date(),
    });

    await service.sendLetter(letterId, actingUserId, UserRole.HR_MANAGER);

    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'LETTER_ISSUED' }),
      }),
    );
  });

  it('does not duplicate INQUIRY_RESOLVED when send is retried on an already SENT letter', async () => {
    const { service, tx, whatsappService } = build({
      letterType: LetterType.REINSTATEMENT,
      letterStatus: LetterStatus.SENT,
      employeeStatus: EmployeeStatus.ACTIVE,
      content: {
        inquiryId: 'inq-1',
        inquiryLetterKind: 'REINSTATEMENT',
      },
    });

    const result = await service.sendLetter(
      letterId,
      actingUserId,
      UserRole.HR_MANAGER,
    );

    expect(result.alreadySent).toBe(true);
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(whatsappService.deliverAfterLetterGenerated).not.toHaveBeenCalled();
  });
});
