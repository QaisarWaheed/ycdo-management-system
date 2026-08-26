import { LetterType, UserRole } from '@prisma/client';
import { ShowCauseScheduler } from './show-cause.scheduler';

describe('ShowCauseScheduler.checkShowCauseDeadlines', () => {
  const now = new Date('2026-08-26T10:00:00.000Z');
  const employeeId = 'emp-1';
  const letterId = 'letter-sc-1';
  const hrEmployeeId = 'hr-emp-1';

  const overdueLetter = {
    id: letterId,
    employeeId,
    letterType: LetterType.SHOW_CAUSE,
    isReplied: false,
    autoEscalated: false,
    replyDeadline: new Date('2026-08-26T08:00:00.000Z'),
    fileUrl: '/uploads/letters/sc.pdf',
    employee: {
      id: employeeId,
      fullName: 'Test Employee',
      status: 'ACTIVE',
    },
  };

  function build(overdueLetters: typeof overdueLetter[]) {
    const tx = {
      letter: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      disciplinaryAction: { create: jest.fn().mockResolvedValue({}) },
      employee: { update: jest.fn().mockResolvedValue({}) },
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'user-hr',
            role: UserRole.HR_MANAGER,
            isActive: true,
            employeeId: hrEmployeeId,
          },
        ]),
      },
      notification: { create: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      letter: {
        findMany: jest.fn().mockResolvedValue(overdueLetters),
      },
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) =>
        fn(tx),
      ),
    };

    const scheduler = new ShowCauseScheduler(prisma as never);
    return { scheduler, prisma, tx };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('detects overdue SHOW_CAUSE, marks autoEscalated, notifies HR, and does not suspend', async () => {
    const { scheduler, prisma, tx } = build([overdueLetter]);

    await scheduler.checkShowCauseDeadlines();

    expect(prisma.letter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          letterType: LetterType.SHOW_CAUSE,
          isReplied: false,
          autoEscalated: false,
          replyDeadline: { lt: now },
        }),
      }),
    );
    expect(tx.letter.updateMany).toHaveBeenCalledWith({
      where: {
        id: letterId,
        autoEscalated: false,
        isReplied: false,
        letterType: LetterType.SHOW_CAUSE,
      },
      data: { autoEscalated: true },
    });
    expect(tx.disciplinaryAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId,
        type: 'SUSPENSION',
        status: 'OPEN',
      }),
    });
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: hrEmployeeId,
        type: 'SHOW_CAUSE_ESCALATED',
        message: expect.stringContaining('HR action required'),
      }),
    });
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  it('leaves non-overdue SHOW_CAUSE letters untouched', async () => {
    const { scheduler, tx } = build([]);

    await scheduler.checkShowCauseDeadlines();

    expect(tx.letter.updateMany).not.toHaveBeenCalled();
    expect(tx.disciplinaryAction.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  it('does not reprocess a letter already marked autoEscalated', async () => {
    const { scheduler, prisma, tx } = build([]);

    await scheduler.checkShowCauseDeadlines();
    await scheduler.checkShowCauseDeadlines();

    expect(prisma.letter.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.letter.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ autoEscalated: false }),
      }),
    );
    expect(tx.disciplinaryAction.create).not.toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  it('does not duplicate side effects when the same overdue letter is not returned again', async () => {
    const first = build([overdueLetter]);
    await first.scheduler.checkShowCauseDeadlines();
    expect(first.tx.letter.updateMany).toHaveBeenCalledTimes(1);
    expect(first.tx.disciplinaryAction.create).toHaveBeenCalledTimes(1);
    expect(first.tx.notification.create).toHaveBeenCalledTimes(1);

    const second = build([]);
    await second.scheduler.checkShowCauseDeadlines();
    expect(second.tx.letter.updateMany).not.toHaveBeenCalled();
    expect(second.tx.disciplinaryAction.create).not.toHaveBeenCalled();
    expect(second.tx.notification.create).not.toHaveBeenCalled();
    expect(second.tx.employee.update).not.toHaveBeenCalled();
  });

  it('does not escalate when the atomic autoEscalated claim is lost', async () => {
    const { scheduler, tx } = build([overdueLetter]);
    tx.letter.updateMany.mockResolvedValue({ count: 0 });

    await scheduler.checkShowCauseDeadlines();

    expect(tx.letter.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.disciplinaryAction.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  it('concurrent scheduler runs create only one escalation action', async () => {
    let claimed = false;
    const first = build([overdueLetter]);
    first.tx.letter.updateMany.mockImplementation(async () => {
      if (claimed) return { count: 0 };
      claimed = true;
      return { count: 1 };
    });
    first.prisma.$transaction.mockImplementation(
      async (fn: (client: typeof first.tx) => unknown) => fn(first.tx),
    );

    await Promise.all([
      first.scheduler.checkShowCauseDeadlines(),
      first.scheduler.checkShowCauseDeadlines(),
    ]);

    expect(first.tx.disciplinaryAction.create).toHaveBeenCalledTimes(1);
    expect(first.tx.notification.create).toHaveBeenCalledTimes(1);
    expect(first.tx.employee.update).not.toHaveBeenCalled();
  });
});
