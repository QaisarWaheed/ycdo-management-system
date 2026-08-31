import {
  AppointmentLetterLanguage,
  EmployeeStatus,
  Gender,
  LetterStatus,
  LetterType,
  UserRole,
} from '@prisma/client';
import { APPOINTMENT_CHAIRMAN_ADMIN_NAME } from './appointment-signatory';
import { APPOINTMENT_DRAFT_WATERMARK_TEXT } from './appointment-watermark';

jest.mock('./pdf.helper', () => ({
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

jest.mock('../../config/cloudinary.config', () => ({
  isCloudinaryEnabled: () => false,
  uploadPdfToCloudinary: jest.fn(),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs') as typeof import('fs');
  return {
    ...actual,
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
  };
});

import { generatePdf } from './pdf.helper';
import { LettersService } from './letters.service';

describe('LettersService appointment Phase 3A', () => {
  const employeeId = 'emp-1';

  function mappingRow() {
    return {
      id: 'map-1',
      departmentId: 'dept-1',
      designationId: 'des-1',
      language: AppointmentLetterLanguage.EN,
      templateCode: 'APPT_MEDICAL_CLINICAL_EN',
      active: true,
    };
  }

  function build(opts?: { existingDraft?: boolean; existingSent?: boolean }) {
    const created: { status?: LetterStatus; letterType?: LetterType; templateCode?: string } = {};
    let claimedStatus: LetterStatus | undefined;
    const tx = {
      letter: {
        create: jest.fn().mockImplementation(async ({ data }: { data: { status: LetterStatus; letterType: LetterType; templateCode?: string } }) => {
          created.status = data.status;
          created.letterType = data.letterType;
          created.templateCode = data.templateCode;
          return { id: 'letter-1', ...data };
        }),
        update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'letter-1',
          employeeId,
          letterType: LetterType.APPOINTMENT,
          employee: { id: employeeId, fullName: 'Test', employeeCode: 'E-1', phone: '0300' },
          acknowledgement: null,
          ...data,
        })),
        updateMany: jest.fn().mockImplementation(async ({ data }: { data: { status?: LetterStatus } }) => {
          claimedStatus = data.status;
          return { count: 1 };
        }),
        findUnique: jest.fn().mockImplementation(async () => ({
          id: 'letter-1',
          employeeId,
          letterType: LetterType.APPOINTMENT,
          status: claimedStatus ?? LetterStatus.DRAFT,
          letterNo: '9/YCDO/2026',
          employee: {
            id: employeeId,
            fullName: 'Test',
            employeeCode: 'E-1',
            phone: '0300',
          },
          acknowledgement: null,
        })),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'hr-1' }) },
    };

    const draftLetter = {
      id: 'letter-1',
      employeeId,
      letterType: LetterType.APPOINTMENT,
      status: LetterStatus.DRAFT,
      letterNo: '9/YCDO/2026',
      templateCode: 'APPT_MEDICAL_CLINICAL_EN',
      content: { stipendAmount: '1000' },
      variables: { chairmanAdminName: APPOINTMENT_CHAIRMAN_ADMIN_NAME },
      employee: {
        id: employeeId,
        fullName: 'Test Employee',
        employeeCode: 'E-1',
        phone: '03001234567',
      },
      acknowledgement: null,
      replies: [],
    };

    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: employeeId,
          fullName: 'Test Employee',
          employeeCode: 'E-1',
          phone: '03001234567',
          cnic: '12345-1234567-1',
          gender: Gender.MALE,
          currentDesignation: 'MEDICAL OFFICER',
          currentDepartmentId: 'dept-1',
          dutyStartTime: '09:00',
          dutyEndTime: '17:00',
          dutyTotalHours: 8,
          monthlyAllowedLeaves: 2,
          currentBranch: { name: 'Main' },
          currentDepartment: { id: 'dept-1', name: 'OPD' },
          status: EmployeeStatus.PENDING_APPROVAL,
        }),
      },
      department: {
        findUnique: jest.fn().mockResolvedValue({ name: 'OPD' }),
      },
      designation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'des-1' }),
      },
      appointmentTemplateMapping: {
        findFirst: jest.fn().mockResolvedValue(mappingRow()),
      },
      letterTemplate: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tpl-1',
          code: 'APPT_MEDICAL_CLINICAL_EN',
          name: 'Fixture EN',
          requiredVars: [],
          bodyHtml:
            '<p>{{employeeName}} {{chairmanAdminName}} stipend {{stipendAmount}} {{serviceArea}} leaves {{monthlyAllowedLeaves}} short {{shortLeaveHours}} {{{departmentSpecificSops}}}</p>',
          bodyHtmlEn: null,
          version: 1,
        }),
      },
      letter: {
        findFirst: jest.fn().mockResolvedValue(
          opts?.existingDraft ? draftLetter : null,
        ),
        findUnique: jest.fn().mockResolvedValue(
          opts?.existingSent
            ? { ...draftLetter, status: LetterStatus.SENT }
            : draftLetter,
        ),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      suspensionRequest: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: 9n }]),
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };

    const whatsappService = {
      deliverAfterLetterGenerated: jest.fn().mockResolvedValue(undefined),
    };

    const service = new LettersService(
      prisma as never,
      { assertEmployeeAccess: jest.fn() } as never,
      whatsappService as never,
    );

    return { service, prisma, tx, whatsappService, created, draftLetter };
  }

  it('pre-approval preview creates no Letter row and includes watermark + signatory', async () => {
    const { service, prisma, tx } = build();
    const result = await service.previewAppointment(
      {
        fullName: 'Test Employee',
        cnic: '12345-1234567-1',
        phone: '03001234567',
        gender: 'MALE',
        currentDepartmentId: 'dept-1',
        currentDesignation: 'MEDICAL OFFICER',
        branchName: 'Main',
        dutyStartTime: '09:00',
        dutyEndTime: '17:00',
        extraFields: { stipendAmount: '1000', hoursPerDay: '8' },
      },
      'user-hr',
      UserRole.HR_MANAGER,
    );

    expect(tx.letter.create).not.toHaveBeenCalled();
    expect(prisma.letter.findFirst).not.toHaveBeenCalled();
    expect(result.previewHtml).toContain(APPOINTMENT_DRAFT_WATERMARK_TEXT);
    expect(result.variables.chairmanAdminName).toBe(
      APPOINTMENT_CHAIRMAN_ADMIN_NAME,
    );
    expect(result.mapping.templateCode).toBe('APPT_MEDICAL_CLINICAL_EN');
  });

  it('generateSystemLetter creates DRAFT without WhatsApp or employee notification', async () => {
    const { service, tx, whatsappService, created } = build();
    await service.generateSystemLetter(
      {
        employeeId,
        letterType: LetterType.APPOINTMENT,
        extraFields: { stipendAmount: '1000', hoursPerDay: '8', shiftName: 'General', capacity: 'Full Time' },
      },
      'SYSTEM',
    );
    expect(created.status).toBe(LetterStatus.DRAFT);
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(whatsappService.deliverAfterLetterGenerated).not.toHaveBeenCalled();
  });

  it('does not duplicate an existing Appointment DRAFT', async () => {
    const { service, tx } = build({ existingDraft: true });
    const result = await service.generateSystemLetter({
      employeeId,
      letterType: LetterType.APPOINTMENT,
      extraFields: {},
    });
    expect(result.letter.id).toBe('letter-1');
    expect(tx.letter.create).not.toHaveBeenCalled();
  });

  it('hides DRAFT from portal findAll', async () => {
    const { service, prisma } = build();
    await service.findAll({}, { id: 'u', role: UserRole.EMPLOYEE, portalOnly: true });
    expect(prisma.letter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [LetterStatus.SENT, LetterStatus.REVERSED] },
        }),
      }),
    );
  });

  it('allows editing a DRAFT Appointment and rejects SENT', async () => {
    const draft = build();
    await draft.service.updateLetter(
      'letter-1',
      { extraFields: { stipendAmount: '2000' } },
      'user-hr',
      UserRole.HR_MANAGER,
    );
    expect(draft.tx.letter.update).toHaveBeenCalled();

    const sent = build({ existingSent: true });
    await expect(
      sent.service.updateLetter(
        'letter-1',
        { extraFields: { stipendAmount: '2000' } },
        'user-hr',
        UserRole.HR_MANAGER,
      ),
    ).rejects.toThrow(/Only draft letters can be edited/);
  });

  it('Send removes watermark, notifies employee, WhatsApps once, and retries do not resend', async () => {
    const { service, tx, whatsappService, prisma } = build();
    jest
      .spyOn(service, 'getPdf')
      .mockResolvedValue({ buffer: Buffer.from('pdf'), filename: 'letter.pdf' });
    prisma.letter.findUnique.mockResolvedValue({
      id: 'letter-1',
      employeeId,
      letterType: LetterType.APPOINTMENT,
      status: LetterStatus.APPROVED,
      letterNo: '9/YCDO/2026',
      templateCode: 'APPT_MEDICAL_CLINICAL_EN',
      content: { stipendAmount: '1000' },
      variables: {},
      fileUrl: '/uploads/a.pdf',
      employee: {
        id: employeeId,
        fullName: 'Test Employee',
        employeeCode: 'E-1',
        phone: '03001234567',
      },
      acknowledgement: null,
      replies: [],
    });
    tx.letter.findUnique.mockResolvedValue({
      id: 'letter-1',
      employeeId,
      letterType: LetterType.APPOINTMENT,
      status: LetterStatus.APPROVED,
      letterNo: '9/YCDO/2026',
      templateCode: 'APPT_MEDICAL_CLINICAL_EN',
      content: { stipendAmount: '1000' },
      variables: {},
      fileUrl: '/uploads/a.pdf',
      employee: {
        id: employeeId,
        fullName: 'Test Employee',
        employeeCode: 'E-1',
        phone: '03001234567',
      },
      acknowledgement: null,
    });

    const first = await service.sendLetter(
      'letter-1',
      'user-hr',
      UserRole.HR_MANAGER,
    );
    expect(first.alreadySent).toBe(false);
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'LETTER_ISSUED' }),
      }),
    );
    expect(whatsappService.deliverAfterLetterGenerated).toHaveBeenCalledTimes(1);
    const pdfCalls = (generatePdf as jest.Mock).mock.calls;
    const sentHtmlArg = String(pdfCalls[pdfCalls.length - 1]?.[0] ?? '');
    expect(sentHtmlArg).toContain(APPOINTMENT_CHAIRMAN_ADMIN_NAME);
    expect(sentHtmlArg).not.toContain(APPOINTMENT_DRAFT_WATERMARK_TEXT);
    const sentVars = tx.letter.updateMany.mock.calls[0][0].data.variables as {
      chairmanAdminName?: string;
    };
    expect(sentVars.chairmanAdminName).toBe(APPOINTMENT_CHAIRMAN_ADMIN_NAME);

    prisma.letter.findUnique.mockResolvedValue({
      id: 'letter-1',
      employeeId,
      letterType: LetterType.APPOINTMENT,
      status: LetterStatus.SENT,
      employee: { id: employeeId },
      acknowledgement: null,
      replies: [],
    });
    const second = await service.sendLetter(
      'letter-1',
      'user-hr',
      UserRole.HR_MANAGER,
    );
    expect(second.alreadySent).toBe(true);
    expect(whatsappService.deliverAfterLetterGenerated).toHaveBeenCalledTimes(1);
  });

  it('manual generate uses mapping, creates DRAFT, and ignores templateCode bypass', async () => {
    const { service, created } = build();
    await service.generate(
      {
        employeeId,
        letterType: LetterType.APPOINTMENT,
        templateCode: 'SELECTION_LETTER',
        extraFields: {
          stipendAmount: '1000',
          hoursPerDay: '8',
          shiftName: 'General',
          capacity: 'Full Time',
        },
      },
      'user-hr',
      UserRole.HR_MANAGER,
    );
    expect(created.status).toBe(LetterStatus.DRAFT);
    expect(created.templateCode).toBe('APPT_MEDICAL_CLINICAL_EN');
  });

  it('does not mutate historical SENT Appointment rows when creating a new DRAFT', async () => {
    const { service, tx } = build();
    await service.generateSystemLetter({
      employeeId,
      letterType: LetterType.APPOINTMENT,
      extraFields: { stipendAmount: '1000' },
    });
    expect(tx.letter.create).toHaveBeenCalled();
    expect(tx.letter.update).not.toHaveBeenCalled();
  });

  it('rebuilds historical SENT SELECTION_LETTER from stored template without mapping', async () => {
    const { service, prisma } = build();
    prisma.letter.findUnique.mockResolvedValue({
      id: 'hist-1',
      employeeId,
      letterType: LetterType.APPOINTMENT,
      status: LetterStatus.SENT,
      letterNo: '2455/YCDO/2026',
      templateCode: 'SELECTION_LETTER',
      content: { stipendAmount: '1000' },
      variables: { employeeName: 'Legacy', letterNo: '2455/YCDO/2026' },
      fileUrl: '/uploads/legacy.pdf',
      employee: { id: employeeId, fullName: 'Legacy', employeeCode: 'E-1' },
      acknowledgement: null,
      replies: [],
    });
    prisma.letterTemplate.findFirst.mockResolvedValue({
      code: 'SELECTION_LETTER',
      bodyHtml: '<p>four Leaves are allowed {{employeeName}}</p>',
      bodyHtmlEn: null,
      version: 1,
    });
    await service.getPdf('hist-1', { id: 'hr', role: UserRole.HR_MANAGER });
    expect(prisma.appointmentTemplateMapping.findFirst).not.toHaveBeenCalled();
    const pdfCalls = (generatePdf as jest.Mock).mock.calls;
    const html = String(pdfCalls[pdfCalls.length - 1]?.[0] ?? '');
    expect(html).toContain('four Leaves are allowed Legacy');
    expect(html).not.toContain(APPOINTMENT_DRAFT_WATERMARK_TEXT);
  });

  it('rejects Send on a DRAFT Appointment until it is approved', async () => {
    const { service, whatsappService, tx } = build();
    await expect(
      service.sendLetter('letter-1', 'user-hr', UserRole.HR_MANAGER),
    ).rejects.toThrow(/must be approved before it can be sent/);
    expect(whatsappService.deliverAfterLetterGenerated).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('issues a DRAFT Appointment when the employee is already Active', async () => {
    const { service, prisma, tx, whatsappService } = build();
    prisma.employee.findUnique.mockResolvedValue({
      id: employeeId,
      fullName: 'Test Employee',
      employeeCode: 'E-1',
      phone: '03001234567',
      cnic: '12345-1234567-1',
      gender: Gender.MALE,
      currentDesignation: 'MEDICAL OFFICER',
      currentDepartmentId: 'dept-1',
      dutyStartTime: '09:00',
      dutyEndTime: '17:00',
      dutyTotalHours: 8,
      monthlyAllowedLeaves: 2,
      currentBranch: { name: 'Main' },
      currentDepartment: { id: 'dept-1', name: 'OPD' },
      status: EmployeeStatus.ACTIVE,
    });
    jest
      .spyOn(service, 'getPdf')
      .mockResolvedValue({ buffer: Buffer.from('pdf'), filename: 'letter.pdf' });

    await service.sendLetter('letter-1', 'user-hr', UserRole.HR_MANAGER);

    expect(tx.letter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: LetterStatus.SENT }),
      }),
    );
    expect(whatsappService.deliverAfterLetterGenerated).toHaveBeenCalled();
  });

  it('submit for approval keeps DRAFT watermark side-effects off', async () => {
    const { service, tx, whatsappService } = build();
    const result = await service.submitAppointmentForApproval(
      'letter-1',
      'user-hr',
      UserRole.HR_MANAGER,
    );
    expect(result.letter.status).toBe(LetterStatus.PENDING_APPROVAL);
    expect(whatsappService.deliverAfterLetterGenerated).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'LETTER_SUBMITTED_FOR_APPROVAL',
        }),
      }),
    );
  });

  it('approve moves PENDING_APPROVAL to APPROVED without WhatsApp or employee notify', async () => {
    const { service, prisma, tx, whatsappService, draftLetter } = build();
    prisma.letter.findUnique.mockResolvedValue({
      ...draftLetter,
      status: LetterStatus.PENDING_APPROVAL,
    });
    const result = await service.approveAppointmentLetter(
      'letter-1',
      'user-exec',
      UserRole.PRESIDENT,
    );
    expect(result.letter.status).toBe(LetterStatus.APPROVED);
    expect(whatsappService.deliverAfterLetterGenerated).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('reject returns PENDING_APPROVAL to editable DRAFT', async () => {
    const { service, prisma, draftLetter } = build();
    prisma.letter.findUnique.mockResolvedValue({
      ...draftLetter,
      status: LetterStatus.PENDING_APPROVAL,
    });
    const result = await service.rejectAppointmentLetter(
      'letter-1',
      'user-exec',
      UserRole.CHAIRMAN,
      'Fix stipend amount',
    );
    expect(result.letter.status).toBe(LetterStatus.DRAFT);
  });

  it('blocks HR from approving an appointment letter', async () => {
    const { service, prisma, draftLetter } = build();
    prisma.letter.findUnique.mockResolvedValue({
      ...draftLetter,
      status: LetterStatus.PENDING_APPROVAL,
    });
    await expect(
      service.approveAppointmentLetter(
        'letter-1',
        'user-hr',
        UserRole.HR_MANAGER,
      ),
    ).rejects.toThrow(/Only President, Founder, Chairman/);
  });

  it('updateLetter preview is the persisted watermarked draft, not unsaved caller state', async () => {
    const { service } = build();
    const result = await service.updateLetter(
      'letter-1',
      { extraFields: { stipendAmount: '2000' } },
      'user-hr',
      UserRole.HR_MANAGER,
    );
    expect(result.previewHtml).toContain('stipend 2000');
    expect(result.previewHtml).toContain(APPOINTMENT_DRAFT_WATERMARK_TEXT);
    expect(result.previewHtml).toContain('For HR Review Only');
  });

  it('reusing an open Appointment DRAFT ignores unsaved generate extraFields', async () => {
    const { service, tx } = build({ existingDraft: true });
    const result = await service.generateSystemLetter({
      employeeId,
      letterType: LetterType.APPOINTMENT,
      extraFields: { stipendAmount: 'UNSAVED-STIPEND-XYZ' },
    });
    expect(result.reusedExisting).toBe(true);
    expect(tx.letter.create).not.toHaveBeenCalled();
    expect(result.previewHtml).toContain('stipend 1000');
    expect(result.previewHtml).not.toContain('UNSAVED-STIPEND-XYZ');
    expect(result.previewHtml).toContain(APPOINTMENT_DRAFT_WATERMARK_TEXT);
  });

  it('getPdf watermarks PENDING_APPROVAL and APPROVED, and leaves SENT clean', async () => {
    const { service, prisma } = build();
    const base = {
      id: 'letter-1',
      employeeId,
      letterType: LetterType.APPOINTMENT,
      letterNo: '9/YCDO/2026',
      templateCode: 'APPT_MEDICAL_CLINICAL_EN',
      content: { stipendAmount: '1000' },
      variables: {
        employeeName: 'Test Employee',
        stipendAmount: '1000',
        letterNo: '9/YCDO/2026',
        chairmanAdminName: APPOINTMENT_CHAIRMAN_ADMIN_NAME,
      },
      fileUrl: '/uploads/a.pdf',
      employee: { id: employeeId, fullName: 'Test', employeeCode: 'E-1' },
      acknowledgement: null,
      replies: [],
    };

    prisma.letter.findUnique.mockResolvedValue({
      ...base,
      status: LetterStatus.PENDING_APPROVAL,
    });
    await service.getPdf('letter-1', { id: 'hr', role: UserRole.HR_MANAGER });
    let html = String(
      (generatePdf as jest.Mock).mock.calls[
        (generatePdf as jest.Mock).mock.calls.length - 1
      ]?.[0] ?? '',
    );
    expect(html).toContain(APPOINTMENT_DRAFT_WATERMARK_TEXT);

    prisma.letter.findUnique.mockResolvedValue({
      ...base,
      status: LetterStatus.APPROVED,
    });
    await service.getPdf('letter-1', { id: 'hr', role: UserRole.HR_MANAGER });
    html = String(
      (generatePdf as jest.Mock).mock.calls[
        (generatePdf as jest.Mock).mock.calls.length - 1
      ]?.[0] ?? '',
    );
    expect(html).toContain(APPOINTMENT_DRAFT_WATERMARK_TEXT);

    prisma.letter.findUnique.mockResolvedValue({
      ...base,
      status: LetterStatus.SENT,
    });
    await service.getPdf('letter-1', { id: 'hr', role: UserRole.HR_MANAGER });
    html = String(
      (generatePdf as jest.Mock).mock.calls[
        (generatePdf as jest.Mock).mock.calls.length - 1
      ]?.[0] ?? '',
    );
    expect(html).not.toContain(APPOINTMENT_DRAFT_WATERMARK_TEXT);
  });

  it('getPdf does not mark a DRAFT as SENT', async () => {
    const { service, prisma } = build();
    await service.getPdf('letter-1', { id: 'hr', role: UserRole.HR_MANAGER });
    for (const call of prisma.letter.update.mock.calls) {
      expect(call[0].data.status).toBeUndefined();
    }
  });

  it('concurrent Send claims APPROVED once and does not double-notify or WhatsApp', async () => {
    const { service, tx, whatsappService, prisma } = build();
    jest
      .spyOn(service, 'getPdf')
      .mockResolvedValue({ buffer: Buffer.from('pdf'), filename: 'letter.pdf' });
    const approved = {
      id: 'letter-1',
      employeeId,
      letterType: LetterType.APPOINTMENT,
      status: LetterStatus.APPROVED,
      letterNo: '9/YCDO/2026',
      templateCode: 'APPT_MEDICAL_CLINICAL_EN',
      content: { stipendAmount: '1000' },
      variables: {},
      fileUrl: '/uploads/a.pdf',
      employee: {
        id: employeeId,
        fullName: 'Test Employee',
        employeeCode: 'E-1',
        phone: '03001234567',
      },
      acknowledgement: null,
      replies: [],
    };
    const sent = { ...approved, status: LetterStatus.SENT };
    prisma.letter.findUnique.mockResolvedValue(approved);
    tx.letter.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    tx.letter.findUnique
      .mockResolvedValueOnce(approved)
      .mockResolvedValueOnce(sent)
      .mockResolvedValueOnce(approved)
      .mockResolvedValueOnce(sent);

    const first = await service.sendLetter(
      'letter-1',
      'user-hr',
      UserRole.HR_MANAGER,
    );
    const second = await service.sendLetter(
      'letter-1',
      'user-hr',
      UserRole.HR_MANAGER,
    );

    expect(first.alreadySent).toBe(false);
    expect(second.alreadySent).toBe(true);
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    expect(whatsappService.deliverAfterLetterGenerated).toHaveBeenCalledTimes(1);
  });

  it('stale approve cannot overwrite a newer status', async () => {
    const { service, prisma, tx, draftLetter } = build();
    prisma.letter.findUnique.mockResolvedValue({
      ...draftLetter,
      status: LetterStatus.PENDING_APPROVAL,
    });
    tx.letter.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.approveAppointmentLetter(
        'letter-1',
        'user-exec',
        UserRole.PRESIDENT,
      ),
    ).rejects.toThrow(/Only a pending appointment letter can be approved/);
  });

  it('stale return cannot overwrite SENT', async () => {
    const { service, prisma, tx, draftLetter } = build();
    prisma.letter.findUnique.mockResolvedValue({
      ...draftLetter,
      status: LetterStatus.APPROVED,
    });
    tx.letter.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.rejectAppointmentLetter(
        'letter-1',
        'user-exec',
        UserRole.FOUNDER,
      ),
    ).rejects.toThrow(/returned for changes/);
  });
});
