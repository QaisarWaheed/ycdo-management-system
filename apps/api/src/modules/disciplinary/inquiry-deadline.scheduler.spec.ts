import { UserRole } from '@prisma/client';
import { InquiryDeadlineScheduler } from './inquiry-deadline.scheduler';

describe('InquiryDeadlineScheduler', () => {
  const now = new Date('2026-08-26T10:00:00.000Z');
  const inquiryId = 'inq-1';
  const actionId = 'action-1';
  const employeeId = 'emp-1';
  const officerUserId = 'user-officer';
  const officerEmployeeId = 'emp-officer';
  const hrUserId = 'user-hr';
  const hrEmployeeId = 'emp-hr';

  function openInquiry(overrides: Record<string, unknown> = {}) {
    return {
      id: inquiryId,
      disciplinaryActionId: actionId,
      deadlineAt: new Date('2026-08-26T20:00:00.000Z'),
      closedAt: null,
      outcome: null,
      finding: null,
      finalAction: null,
      inquiryOfficerUserId: officerUserId,
      deadlineReminderSentAt: null,
      overdueNotificationSentAt: null,
      inquiryOfficer: {
        id: officerUserId,
        email: 'officer@ycdo.test',
        employeeId: officerEmployeeId,
        employee: { fullName: 'Inquiry Officer' },
      },
      disciplinaryAction: {
        id: actionId,
        employeeId,
        employee: { fullName: 'Test Employee' },
      },
      ...overrides,
    };
  }

  function build(opts: {
    upcoming?: ReturnType<typeof openInquiry>[];
    overdue?: ReturnType<typeof openInquiry>[];
    claimCount?: number;
    hrUsers?: Array<{
      id: string;
      employeeId: string | null;
      role: UserRole;
      isActive: boolean;
    }>;
  }) {
    const tx = {
      inquiry: {
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: opts.claimCount ?? 1 }),
        update: jest.fn(),
      },
      user: {
        findMany: jest.fn().mockResolvedValue(
          opts.hrUsers ?? [
            {
              id: hrUserId,
              employeeId: hrEmployeeId,
              role: UserRole.HR_MANAGER,
              isActive: true,
            },
          ],
        ),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      notification: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      employee: { update: jest.fn() },
      disciplinaryAction: { update: jest.fn() },
      suspensionRequest: { update: jest.fn(), updateMany: jest.fn() },
    };

    let findManyCalls = 0;
    const prisma = {
      inquiry: {
        findMany: jest.fn().mockImplementation(async () => {
          findManyCalls += 1;
          return findManyCalls === 1
            ? (opts.upcoming ?? [])
            : (opts.overdue ?? []);
        }),
        update: jest.fn(),
      },
      user: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      employee: { update: jest.fn() },
      disciplinaryAction: { update: jest.fn() },
      suspensionRequest: { update: jest.fn() },
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) =>
        fn(tx),
      ),
    };

    const scheduler = new InquiryDeadlineScheduler(prisma as never);
    return { scheduler, prisma, tx };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('emits a one-time upcoming reminder within 24 hours', async () => {
    const inquiry = openInquiry();
    const { scheduler, prisma, tx } = build({ upcoming: [inquiry] });

    await scheduler.checkInquiryDeadlines();

    expect(prisma.inquiry.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          closedAt: null,
          outcome: null,
          deadlineReminderSentAt: null,
          deadlineAt: {
            gt: now,
            lte: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
        }),
      }),
    );
    expect(tx.inquiry.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: inquiryId,
        closedAt: null,
        outcome: null,
        deadlineReminderSentAt: null,
      }),
      data: { deadlineReminderSentAt: now },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'INQUIRY_DEADLINE_REMINDER',
          entity: 'Inquiry',
          entityId: inquiryId,
          changes: expect.objectContaining({
            disciplinaryActionId: actionId,
            employeeId,
            inquiryOfficerUserId: officerUserId,
            kind: 'reminder',
          }),
        }),
      }),
    );
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employeeId: officerEmployeeId,
          type: 'INQUIRY_DEADLINE_REMINDER',
          message: expect.stringContaining('Inquiry deadline approaching'),
        }),
      }),
    );
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employeeId: hrEmployeeId,
          type: 'INQUIRY_DEADLINE_REMINDER',
        }),
      }),
    );
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.disciplinaryAction.update).not.toHaveBeenCalled();
    expect(tx.suspensionRequest.update).not.toHaveBeenCalled();
    expect(tx.inquiry.update).not.toHaveBeenCalled();
  });

  it('does not emit a reminder when the deadline is more than 24 hours away', async () => {
    const { scheduler, tx } = build({ upcoming: [], overdue: [] });

    await scheduler.checkInquiryDeadlines();

    expect(tx.inquiry.updateMany).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  it('emits a one-time overdue alert for an open past-deadline inquiry', async () => {
    const inquiry = openInquiry({
      deadlineAt: new Date('2026-08-26T08:00:00.000Z'),
    });
    const { scheduler, prisma, tx } = build({ overdue: [inquiry] });

    await scheduler.checkInquiryDeadlines();

    expect(prisma.inquiry.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          closedAt: null,
          outcome: null,
          overdueNotificationSentAt: null,
          deadlineAt: { lte: now },
        }),
      }),
    );
    expect(tx.inquiry.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: inquiryId,
        overdueNotificationSentAt: null,
      }),
      data: { overdueNotificationSentAt: now },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'INQUIRY_DEADLINE_OVERDUE',
        }),
      }),
    );
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'INQUIRY_DEADLINE_OVERDUE',
          message: expect.stringContaining('Inquiry overdue — HR action required'),
        }),
      }),
    );
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(tx.disciplinaryAction.update).not.toHaveBeenCalled();
    expect(tx.inquiry.update).not.toHaveBeenCalled();
  });

  it('can emit an upcoming reminder and later an independent overdue alert', async () => {
    const upcoming = openInquiry();
    const first = build({ upcoming: [upcoming] });
    await first.scheduler.checkInquiryDeadlines();
    expect(first.tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(first.tx.inquiry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { deadlineReminderSentAt: now },
      }),
    );

    const overdue = openInquiry({
      deadlineAt: new Date('2026-08-26T08:00:00.000Z'),
      deadlineReminderSentAt: now,
    });
    const second = build({ overdue: [overdue] });
    await second.scheduler.checkInquiryDeadlines();
    expect(second.tx.inquiry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { overdueNotificationSentAt: now },
      }),
    );
    expect(second.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'INQUIRY_DEADLINE_OVERDUE' }),
      }),
    );
  });

  it('does not duplicate a reminder when the scheduler runs twice in the same state', async () => {
    const inquiry = openInquiry();
    const first = build({ upcoming: [inquiry], claimCount: 1 });
    await first.scheduler.checkInquiryDeadlines();
    expect(first.tx.notification.create).toHaveBeenCalled();
    expect(first.tx.auditLog.create).toHaveBeenCalledTimes(1);

    const second = build({ upcoming: [inquiry], claimCount: 0 });
    await second.scheduler.checkInquiryDeadlines();
    expect(second.tx.notification.create).not.toHaveBeenCalled();
    expect(second.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not duplicate an overdue alert when the claim loses the race', async () => {
    const inquiry = openInquiry({
      deadlineAt: new Date('2026-08-26T08:00:00.000Z'),
    });
    const { scheduler, tx } = build({ overdue: [inquiry], claimCount: 0 });

    await scheduler.checkInquiryDeadlines();

    expect(tx.inquiry.updateMany).toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not alert a closed inquiry', async () => {
    const { scheduler, tx } = build({ upcoming: [], overdue: [] });

    await scheduler.checkInquiryDeadlines();

    expect(tx.inquiry.updateMany).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('still notifies HR for a legacy inquiry with no officer and does not throw', async () => {
    const inquiry = openInquiry({
      inquiryOfficerUserId: null,
      inquiryOfficer: null,
      deadlineAt: new Date('2026-08-26T08:00:00.000Z'),
    });
    const { scheduler, tx } = build({ overdue: [inquiry] });

    await expect(scheduler.checkInquiryDeadlines()).resolves.toBeUndefined();

    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ employeeId: hrEmployeeId }),
      }),
    );
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
  });

  it('does not crash or skip the marker when the officer has no employeeId', async () => {
    const inquiry = openInquiry({
      inquiryOfficer: {
        id: officerUserId,
        email: 'officer@ycdo.test',
        employeeId: null,
        employee: null,
      },
    });
    const { scheduler, tx } = build({ upcoming: [inquiry] });

    await expect(scheduler.checkInquiryDeadlines()).resolves.toBeUndefined();

    expect(tx.inquiry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { deadlineReminderSentAt: now },
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ employeeId: hrEmployeeId }),
      }),
    );
  });

  it('does not mutate employment or inquiry resolution fields', async () => {
    const inquiry = openInquiry({
      deadlineAt: new Date('2026-08-26T08:00:00.000Z'),
    });
    const { scheduler, tx, prisma } = build({ overdue: [inquiry] });

    await scheduler.checkInquiryDeadlines();

    const markerData = tx.inquiry.updateMany.mock.calls[0][0].data;
    expect(Object.keys(markerData)).toEqual(['overdueNotificationSentAt']);
    expect(tx.employee.update).not.toHaveBeenCalled();
    expect(prisma.employee.update).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.disciplinaryAction.update).not.toHaveBeenCalled();
    expect(tx.suspensionRequest.update).not.toHaveBeenCalled();
    expect(tx.suspensionRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.inquiry.update).not.toHaveBeenCalled();
  });
});
