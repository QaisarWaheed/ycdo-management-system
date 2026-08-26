import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  DisciplinaryStatus,
  DisciplinaryType,
  EmployeeStatus,
  InquiryFinding,
  InquiryFinalAction,
  InquiryFinalDecisionStatus,
  InquiryOutcome,
  LetterType,
  SuspensionRequestStatus,
  UserRole,
} from '@prisma/client';

jest.mock('../letters/letters.service', () => ({
  LettersService: class LettersService {},
}));

jest.mock('../letters/pdf.helper', () => ({
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

import { InquiryDecisionService } from './inquiry-decision.service';

describe('InquiryDecisionService', () => {
  const inquiryId = 'inq-1';
  const actionId = 'action-1';
  const employeeId = 'emp-1';
  const officerId = 'user-officer';
  const hrId = 'user-hr';
  const approverId = 'user-approver';
  const fromBranch = 'branch-old';
  const toBranch = 'branch-new';

  function openInquiry(overrides: Record<string, unknown> = {}) {
    return {
      id: inquiryId,
      disciplinaryActionId: actionId,
      closedAt: null,
      outcome: null,
      finding: null,
      finalAction: null,
      finalDecisionStatus: null,
      inquiryOfficerUserId: officerId,
      destinationBranchId: null,
      fineAmount: null,
      appliedFineDeductionId: null,
      notes: null,
      disciplinaryAction: {
        id: actionId,
        type: DisciplinaryType.SUSPENSION,
        employeeId,
        reason: 'Misconduct',
        employee: {
          id: employeeId,
          currentBranchId: fromBranch,
          currentDepartmentId: 'dept-1',
          currentDesignation: 'Staff',
          currentBranch: { id: fromBranch, name: 'Old', abbreviation: 'O' },
          currentDepartment: { id: 'dept-1', name: 'OPD' },
        },
        suspensionRequest: {
          id: 'req-1',
          status: 'ISSUED',
          suspendedFromBranchId: fromBranch,
          suspendedFromBranch: { id: fromBranch, name: 'Old', abbreviation: 'O' },
        },
      },
      ...overrides,
    };
  }

  function build(inquiry = openInquiry()) {
    const tx = {
      inquiry: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(inquiry),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      employee: { update: jest.fn().mockResolvedValue({}) },
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      employmentHistory: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'hist-1' }),
      },
      disciplinaryAction: { update: jest.fn().mockResolvedValue({}) },
      suspensionRequest: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      notification: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      payrollEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      payrollDeduction: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    };

    const prisma = {
      inquiry: {
        findUnique: jest.fn().mockResolvedValue(inquiry),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: officerId,
          isActive: true,
          role: UserRole.EMPLOYEE,
          additionalRoles: [],
        }),
      },
      branch: {
        findUnique: jest.fn().mockResolvedValue({ id: toBranch, isActive: true }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      letter: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };

    const lettersService = {
      generate: jest.fn().mockResolvedValue({}),
      generateSystemLetter: jest
        .fn()
        .mockResolvedValue({ letter: { id: 'letter-1' } }),
    };
    const suspensionRequestService = {
      listEligibleApprovers: jest.fn().mockResolvedValue([{ id: approverId }]),
    };

    const service = new InquiryDecisionService(
      prisma as never,
      lettersService as never,
      suspensionRequestService as never,
    );
    return { service, prisma, tx, lettersService, suspensionRequestService };
  }

  it('lets the inquiry officer record a finding without changing employment', async () => {
    const { service, tx } = build();

    await service.recordFinding(inquiryId, InquiryFinding.NOT_GUILTY, officerId);

    expect(tx.inquiry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: inquiryId, finding: null }),
        data: expect.objectContaining({ finding: InquiryFinding.NOT_GUILTY }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'INQUIRY_FINDING_RECORDED' }),
      }),
    );
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(tx.disciplinaryAction.update).not.toHaveBeenCalled();
  });

  it('rejects a finding from someone who is not the inquiry officer', async () => {
    const { service, tx } = build();

    await expect(
      service.recordFinding(inquiryId, InquiryFinding.GUILTY, hrId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.inquiry.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an ordinary employee from recording a finding on an officer-less legacy inquiry', async () => {
    const { service, tx, prisma } = build(
      openInquiry({ inquiryOfficerUserId: null, inquiryOfficer: null }),
    );
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-employee',
      isActive: true,
      role: UserRole.EMPLOYEE,
      additionalRoles: [],
    });

    await expect(
      service.recordFinding(
        inquiryId,
        InquiryFinding.NOT_GUILTY,
        'user-employee',
        undefined,
        UserRole.EMPLOYEE,
        [UserRole.EMPLOYEE],
      ),
    ).rejects.toThrow(/Super Admin, HR Manager, or Admin Manager/);
    expect(tx.inquiry.updateMany).not.toHaveBeenCalled();
  });

  it('allows HR Manager to record a finding on an officer-less legacy inquiry', async () => {
    const { service, tx, prisma } = build(
      openInquiry({ inquiryOfficerUserId: null, inquiryOfficer: null }),
    );
    prisma.user.findUnique.mockResolvedValue({
      id: hrId,
      isActive: true,
      role: UserRole.HR_MANAGER,
      additionalRoles: [],
    });

    await service.recordFinding(
      inquiryId,
      InquiryFinding.NOT_GUILTY,
      hrId,
      undefined,
      UserRole.HR_MANAGER,
      [UserRole.HR_MANAGER],
    );

    expect(tx.inquiry.updateMany).toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  it('rejects HR Executive from recording a finding on an officer-less legacy inquiry', async () => {
    const { service, tx, prisma } = build(
      openInquiry({ inquiryOfficerUserId: null, inquiryOfficer: null }),
    );
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-exec',
      isActive: true,
      role: UserRole.HR_EXECUTIVE,
      additionalRoles: [],
    });

    await expect(
      service.recordFinding(
        inquiryId,
        InquiryFinding.GUILTY,
        'user-exec',
        undefined,
        UserRole.HR_EXECUTIVE,
        [UserRole.HR_EXECUTIVE],
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.inquiry.updateMany).not.toHaveBeenCalled();
  });

  it('does not close the inquiry or apply a final action when only a finding is recorded', async () => {
    const { service, tx } = build();
    await service.recordFinding(inquiryId, InquiryFinding.GUILTY, officerId);
    expect(tx.inquiry.updateMany.mock.calls[0][0].data.closedAt).toBeUndefined();
    expect(tx.inquiry.updateMany.mock.calls[0][0].data.finalAction).toBeUndefined();
  });

  it('rejects NOT_GUILTY submission without a different destination branch', async () => {
    const { service } = build(
      openInquiry({ finding: InquiryFinding.NOT_GUILTY }),
    );

    await expect(
      service.submitFinalDecision(
        inquiryId,
        { selectedApproverUserId: approverId, destinationBranchId: fromBranch },
        hrId,
        UserRole.HR_MANAGER,
      ),
    ).rejects.toThrow(/differ from the branch/i);
  });

  it('rejects GUILTY final-action controls before a finding exists', async () => {
    const { service } = build();
    await expect(
      service.submitFinalDecision(
        inquiryId,
        {
          selectedApproverUserId: approverId,
          finalAction: InquiryFinalAction.DISMISS,
        },
        hrId,
        UserRole.HR_MANAGER,
      ),
    ).rejects.toThrow(/finding/i);
  });

  it('applies DISMISS on approval without transfer or ACTIVE reinstatement', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.GUILTY,
      finalAction: InquiryFinalAction.DISMISS,
      finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      selectedFinalApproverUserId: approverId,
    });
    const { service, tx, prisma } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });

    await service.approve(inquiryId, approverId);

    expect(tx.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: EmployeeStatus.DISMISSED },
      }),
    );
    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
    expect(tx.employmentHistory.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'EMPLOYEE_DISMISSED' }),
      }),
    );
  });

  it('applies TERMINATE and disables login', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.GUILTY,
      finalAction: InquiryFinalAction.TERMINATE,
      finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      selectedFinalApproverUserId: approverId,
    });
    const { service, tx, prisma } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });

    await service.approve(inquiryId, approverId);

    expect(tx.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: EmployeeStatus.TERMINATED },
      }),
    );
    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });

  it('maps REST to existing EmployeeStatus.ON_REST', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.GUILTY,
      finalAction: InquiryFinalAction.REST,
      finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      selectedFinalApproverUserId: approverId,
    });
    const { service, tx, prisma } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });

    await service.approve(inquiryId, approverId);

    expect(tx.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: EmployeeStatus.ON_REST },
      }),
    );
    expect(tx.employmentHistory.create).not.toHaveBeenCalled();
  });

  it('reinstates NOT_GUILTY only after transferring to a different branch', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.NOT_GUILTY,
      finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      selectedFinalApproverUserId: approverId,
      destinationBranchId: toBranch,
    });
    const { service, tx, prisma } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });

    await service.approve(inquiryId, approverId);

    expect(tx.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentBranchId: toBranch } }),
    );
    expect(tx.employmentHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          branchId: toBranch,
          changeType: 'TRANSFERRED',
        }),
      }),
    );
    expect(tx.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: EmployeeStatus.ACTIVE },
      }),
    );
    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: true } }),
    );
  });

  it('refuses FINE_AND_REINSTATE when there is no PENDING payroll entry', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.GUILTY,
      finalAction: InquiryFinalAction.FINE_AND_REINSTATE,
      finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      selectedFinalApproverUserId: approverId,
      destinationBranchId: toBranch,
      fineAmount: 500,
    });
    const { service, tx, prisma } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });
    tx.payrollEntry.findMany.mockResolvedValue([]);

    await expect(service.approve(inquiryId, approverId)).rejects.toThrow(
      /no PENDING payroll entry/,
    );

    expect(tx.payrollDeduction.create).not.toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(tx.employmentHistory.create).not.toHaveBeenCalled();
  });

  it('posts DISCIPLINARY_FINE onto a PENDING payroll entry before reinstating', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.GUILTY,
      finalAction: InquiryFinalAction.FINE_AND_REINSTATE,
      finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      selectedFinalApproverUserId: approverId,
      destinationBranchId: toBranch,
      fineAmount: 500,
    });
    const { service, tx, prisma } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });
    tx.payrollEntry.findMany.mockResolvedValue([
      { id: 'pay-pending', month: 8, year: 2026, status: 'PENDING' },
    ]);
    tx.payrollDeduction.create.mockResolvedValue({ id: 'ded-1' });

    await service.approve(inquiryId, approverId);

    expect(tx.payrollDeduction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payrollEntryId: 'pay-pending',
          reason: 'DISCIPLINARY_FINE',
          amount: 500,
        }),
      }),
    );
    expect(tx.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: EmployeeStatus.ACTIVE },
      }),
    );
  });

  it('does not duplicate apply when the approval claim loses', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.GUILTY,
      finalAction: InquiryFinalAction.DISMISS,
      finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      selectedFinalApproverUserId: approverId,
    });
    const { service, tx, prisma } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });
    tx.inquiry.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.approve(inquiryId, approverId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  function expectClosed(
    tx: {
      disciplinaryAction: { update: jest.Mock };
      suspensionRequest: { updateMany: jest.Mock };
      auditLog: { create: jest.Mock };
    },
    actionStatus: DisciplinaryStatus,
  ) {
    expect(tx.disciplinaryAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: actionStatus,
          resolvedAt: expect.any(Date),
        }),
      }),
    );
    expect(tx.disciplinaryAction.update.mock.calls[0][0].data.status).not.toBe(
      DisciplinaryStatus.UNDER_INQUIRY,
    );
    expect(tx.suspensionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: SuspensionRequestStatus.ISSUED,
        }),
        data: { status: SuspensionRequestStatus.COMPLETED },
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'FINAL_ACTION_APPLIED' }),
      }),
    );
  }

  it('closes NOT_GUILTY with REINSTATEMENT draft letter once', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.NOT_GUILTY,
      finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      selectedFinalApproverUserId: approverId,
      destinationBranchId: toBranch,
    });
    const { service, tx, prisma, lettersService } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });

    await service.approve(inquiryId, approverId);

    expect(tx.inquiry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: InquiryOutcome.REINSTATED,
          closedAt: expect.any(Date),
        }),
      }),
    );
    expectClosed(tx, DisciplinaryStatus.RESOLVED);
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(lettersService.generate).not.toHaveBeenCalled();
    expect(lettersService.generateSystemLetter).toHaveBeenCalledTimes(1);
    expect(lettersService.generateSystemLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        letterType: LetterType.REINSTATEMENT,
        extraFields: expect.objectContaining({
          inquiryId,
          inquiryLetterKind: 'REINSTATEMENT',
        }),
      }),
      approverId,
    );
  });

  it('closes DISMISS with a TERMINATION draft letter and DISMISSED action', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.GUILTY,
      finalAction: InquiryFinalAction.DISMISS,
      finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      selectedFinalApproverUserId: approverId,
    });
    const { service, tx, prisma, lettersService } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });

    await service.approve(inquiryId, approverId);

    expect(tx.inquiry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: InquiryOutcome.DISMISSED }),
      }),
    );
    expectClosed(tx, DisciplinaryStatus.DISMISSED);
    expect(lettersService.generateSystemLetter).toHaveBeenCalledTimes(1);
    expect(lettersService.generateSystemLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        letterType: LetterType.TERMINATION,
        extraFields: expect.objectContaining({
          inquiryLetterKind: 'DISMISSAL',
        }),
      }),
      approverId,
    );
  });

  it('closes TERMINATE with a TERMINATION draft letter', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.GUILTY,
      finalAction: InquiryFinalAction.TERMINATE,
      finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      selectedFinalApproverUserId: approverId,
    });
    const { service, tx, prisma, lettersService } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });

    await service.approve(inquiryId, approverId);

    expect(tx.inquiry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: InquiryOutcome.TERMINATED }),
      }),
    );
    expectClosed(tx, DisciplinaryStatus.RESOLVED);
    expect(lettersService.generateSystemLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        letterType: LetterType.TERMINATION,
        extraFields: expect.objectContaining({
          inquiryLetterKind: 'TERMINATION',
        }),
      }),
      approverId,
    );
  });

  it('closes REST without generating a letter', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.GUILTY,
      finalAction: InquiryFinalAction.REST,
      finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      selectedFinalApproverUserId: approverId,
    });
    const { service, tx, prisma, lettersService } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });

    await service.approve(inquiryId, approverId);

    expect(tx.inquiry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: InquiryOutcome.REST }),
      }),
    );
    expectClosed(tx, DisciplinaryStatus.RESOLVED);
    expect(lettersService.generateSystemLetter).not.toHaveBeenCalled();
    expect(lettersService.generate).not.toHaveBeenCalled();
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'INQUIRY_RESOLVED',
          message: expect.stringContaining(inquiryId),
        }),
      }),
    );
  });

  it('closes FINE_AND_REINSTATE with FINE and REINSTATEMENT drafts once each', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.GUILTY,
      finalAction: InquiryFinalAction.FINE_AND_REINSTATE,
      finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      selectedFinalApproverUserId: approverId,
      destinationBranchId: toBranch,
      fineAmount: 500,
    });
    const { service, tx, prisma, lettersService } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });
    tx.payrollEntry.findMany.mockResolvedValue([
      { id: 'pay-pending', month: 8, year: 2026, status: 'PENDING' },
    ]);
    tx.payrollDeduction.create.mockResolvedValue({ id: 'ded-1' });

    await service.approve(inquiryId, approverId);

    expectClosed(tx, DisciplinaryStatus.RESOLVED);
    expect(lettersService.generateSystemLetter).toHaveBeenCalledTimes(2);
    expect(lettersService.generateSystemLetter).toHaveBeenCalledWith(
      expect.objectContaining({ letterType: LetterType.REINSTATEMENT }),
      approverId,
    );
    expect(lettersService.generateSystemLetter).toHaveBeenCalledWith(
      expect.objectContaining({ letterType: LetterType.FINE }),
      approverId,
    );
  });

  it('does not create duplicate final letters when they already exist for the inquiry', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.NOT_GUILTY,
      finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      selectedFinalApproverUserId: approverId,
      destinationBranchId: toBranch,
    });
    const { service, prisma, lettersService } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });
    prisma.letter.findFirst.mockResolvedValue({ id: 'existing-letter' });

    await service.approve(inquiryId, approverId);

    expect(lettersService.generateSystemLetter).not.toHaveBeenCalled();
  });

  it('does not create a second payroll fine when the inquiry deduction already exists', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.GUILTY,
      finalAction: InquiryFinalAction.FINE_AND_REINSTATE,
      finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      selectedFinalApproverUserId: approverId,
      destinationBranchId: toBranch,
      fineAmount: 500,
    });
    const { service, tx, prisma } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });
    tx.payrollEntry.findMany.mockResolvedValue([
      { id: 'pay-pending', month: 8, year: 2026, status: 'PENDING' },
    ]);
    tx.payrollDeduction.findFirst.mockResolvedValue({ id: 'ded-existing' });

    await service.approve(inquiryId, approverId);

    expect(tx.payrollDeduction.create).not.toHaveBeenCalled();
    expect(tx.payrollEntry.update).not.toHaveBeenCalled();
  });

  it('does not create a second transfer history row for the same inquiry', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.NOT_GUILTY,
      finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
      selectedFinalApproverUserId: approverId,
      destinationBranchId: toBranch,
    });
    const { service, tx, prisma } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });
    tx.employmentHistory.findFirst.mockResolvedValue({ id: 'hist-existing' });

    await service.approve(inquiryId, approverId);

    expect(tx.employmentHistory.create).not.toHaveBeenCalled();
  });

  it('allows a new final proposal after rejection', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.GUILTY,
      finalAction: InquiryFinalAction.DISMISS,
      finalDecisionStatus: InquiryFinalDecisionStatus.REJECTED,
      selectedFinalApproverUserId: approverId,
    });
    const { service, tx } = build(inquiry);

    await service.submitFinalDecision(
      inquiryId,
      {
        selectedApproverUserId: approverId,
        finalAction: InquiryFinalAction.TERMINATE,
      },
      hrId,
      UserRole.HR_MANAGER,
    );

    expect(tx.inquiry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          finalAction: InquiryFinalAction.TERMINATE,
          finalDecisionStatus: InquiryFinalDecisionStatus.PENDING_APPROVAL,
        }),
      }),
    );
  });

  it('rejects a second apply when the inquiry is already closed', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.GUILTY,
      finalAction: InquiryFinalAction.DISMISS,
      finalDecisionStatus: InquiryFinalDecisionStatus.APPLIED,
      closedAt: new Date(),
      outcome: InquiryOutcome.DISMISSED,
      selectedFinalApproverUserId: approverId,
    });
    const { service, tx, prisma } = build(inquiry);
    prisma.user.findUnique.mockResolvedValue({ id: approverId, isActive: true });

    await expect(service.approve(inquiryId, approverId)).rejects.toThrow(
      /already closed/,
    );
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(tx.suspensionRequest.updateMany).not.toHaveBeenCalled();
  });

  it('detects missing required final letters after apply', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.NOT_GUILTY,
      finalDecisionStatus: InquiryFinalDecisionStatus.APPLIED,
      closedAt: new Date(),
      outcome: InquiryOutcome.REINSTATED,
      destinationBranchId: toBranch,
    });
    const { service, prisma } = build(inquiry);
    prisma.letter.findMany.mockResolvedValue([]);

    const statuses = await service.listFinalLetterStatuses(inquiry as never);

    expect(statuses).toEqual([
      expect.objectContaining({
        inquiryLetterKind: 'REINSTATEMENT',
        status: 'MISSING',
      }),
    ]);
  });

  it('recovers only the missing final letter and does not reapply employment', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.GUILTY,
      finalAction: InquiryFinalAction.FINE_AND_REINSTATE,
      finalDecisionStatus: InquiryFinalDecisionStatus.APPLIED,
      closedAt: new Date(),
      outcome: InquiryOutcome.REINSTATED,
      destinationBranchId: toBranch,
      fineAmount: 500,
    });
    const { service, prisma, tx, lettersService } = build(inquiry);
    prisma.letter.findFirst.mockImplementation(async (args: {
      where: { letterType: string };
    }) =>
      args.where.letterType === 'FINE'
        ? { id: 'fine-existing' }
        : null,
    );
    prisma.letter.findMany
      .mockResolvedValueOnce([
        {
          id: 'fine-existing',
          letterType: LetterType.FINE,
          status: 'DRAFT',
          content: { inquiryId, inquiryLetterKind: 'FINE' },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'fine-existing',
          letterType: LetterType.FINE,
          status: 'DRAFT',
          content: { inquiryId, inquiryLetterKind: 'FINE' },
        },
        {
          id: 'rst-new',
          letterType: LetterType.REINSTATEMENT,
          status: 'DRAFT',
          content: { inquiryId, inquiryLetterKind: 'REINSTATEMENT' },
        },
      ]);

    const result = await service.generateMissingFinalLetters(
      inquiryId,
      hrId,
      UserRole.HR_MANAGER,
    );

    expect(lettersService.generateSystemLetter).toHaveBeenCalledTimes(1);
    expect(lettersService.generateSystemLetter).toHaveBeenCalledWith(
      expect.objectContaining({ letterType: LetterType.REINSTATEMENT }),
      hrId,
    );
    expect(result.generated).toEqual(['REINSTATEMENT']);
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(tx.payrollDeduction.create).not.toHaveBeenCalled();
    expect(tx.employmentHistory.create).not.toHaveBeenCalled();
    expect(tx.suspensionRequest.updateMany).not.toHaveBeenCalled();
  });

  it('is idempotent when all required final letters already exist', async () => {
    const inquiry = openInquiry({
      finding: InquiryFinding.NOT_GUILTY,
      finalDecisionStatus: InquiryFinalDecisionStatus.APPLIED,
      closedAt: new Date(),
      outcome: InquiryOutcome.REINSTATED,
      destinationBranchId: toBranch,
    });
    const { service, prisma, lettersService } = build(inquiry);
    prisma.letter.findFirst.mockResolvedValue({ id: 'existing' });
    prisma.letter.findMany.mockResolvedValue([
      {
        id: 'existing',
        letterType: LetterType.REINSTATEMENT,
        status: 'DRAFT',
        content: { inquiryId, inquiryLetterKind: 'REINSTATEMENT' },
      },
    ]);

    const result = await service.generateMissingFinalLetters(
      inquiryId,
      hrId,
      UserRole.HR_MANAGER,
    );

    expect(lettersService.generateSystemLetter).not.toHaveBeenCalled();
    expect(result.generated).toEqual([]);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
