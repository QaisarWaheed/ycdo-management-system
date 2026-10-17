import { SuspensionPeriodEndScheduler } from './suspension-period-end.scheduler';

describe('SuspensionPeriodEndScheduler (Point 25)', () => {
  function build() {
    const request = {
      id: 'sr-1',
      periodEnd: new Date('2026-10-15T00:00:00Z'),
      periodEndAlertedAt: null as Date | null,
      employee: { fullName: 'Ali Khan', employeeCode: 'YC-001' },
    };
    const tx = {
      suspensionRequest: {
        updateMany: jest.fn(async () => {
          if (request.periodEndAlertedAt) return { count: 0 };
          request.periodEndAlertedAt = new Date();
          return { count: 1 };
        }),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { employeeId: 'hr-1' },
            { employeeId: 'hr-2' },
            { employeeId: 'hr-1' },
          ]),
      },
      notification: { create: jest.fn() },
    };
    const prisma = {
      suspensionRequest: {
        findMany: jest.fn(async () =>
          request.periodEndAlertedAt ? [] : [request],
        ),
      },
      $transaction: jest.fn(async (work: (c: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    return {
      scheduler: new SuspensionPeriodEndScheduler(prisma as never),
      prisma,
      tx,
    };
  }

  it('alerts HR once per ended suspension', async () => {
    const { scheduler, prisma, tx } = build();
    const now = new Date('2026-10-18T05:00:00Z');
    expect(await scheduler.alertEndedSuspensions(now)).toEqual({ alerted: 1 });
    expect(await scheduler.alertEndedSuspensions(now)).toEqual({ alerted: 0 });

    expect(tx.notification.create).toHaveBeenCalledTimes(2); // hr-1, hr-2 (deduped)
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: {
        employeeId: 'hr-1',
        type: 'SUSPENSION_PERIOD_ENDED',
        message:
          'Suspension period ended for Ali Khan (YC-001) on 2026-10-15: reinstate or extend',
      },
    });
    expect(prisma.suspensionRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ISSUED',
          periodEndAlertedAt: null,
          periodEnd: { lt: new Date('2026-10-18T00:00:00Z') },
          employee: { status: 'SUSPENDED' },
        }),
      }),
    );
  });

  it('skips when another run already claimed it', async () => {
    const { scheduler, tx } = build();
    tx.suspensionRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await scheduler.alertEndedSuspensions()).toEqual({ alerted: 0 });
    expect(tx.notification.create).not.toHaveBeenCalled();
  });
});
