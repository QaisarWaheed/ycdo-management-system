import { ForbiddenException } from '@nestjs/common';
import { AttendanceStatus, EmployeeStatus, InquirySuspendStatus, UserRole } from '@prisma/client';
import { InquirySuspensionService, uninformedAbsenceRun } from './inquiry-suspension.service';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const UA = AttendanceStatus.UNINFORMED_ABSENT;

describe('Req 10: consecutive uninformed absences', () => {
  // 2026-10-17 is a Saturday, 18 Sunday (weekly off = 0).
  it('skips weekly offs and holidays, stops at any worked day', () => {
    const logs = [
      { date: d('2026-10-16'), status: AttendanceStatus.PRESENT },
      { date: d('2026-10-17'), status: UA },
      { date: d('2026-10-19'), status: UA },
      { date: d('2026-10-20'), status: AttendanceStatus.HOLIDAY },
      { date: d('2026-10-21'), status: UA },
    ];
    const run = uninformedAbsenceRun(logs, d('2026-10-21'), [0]);
    expect(run.map((x) => x.toISOString().slice(0, 10))).toEqual(['2026-10-21', '2026-10-19', '2026-10-17']);
  });

  it('informed absence or leave breaks the run', () => {
    const logs = [
      { date: d('2026-10-19'), status: UA },
      { date: d('2026-10-20'), status: AttendanceStatus.ABSENT },
      { date: d('2026-10-21'), status: UA },
    ];
    expect(uninformedAbsenceRun(logs, d('2026-10-21'), [0])).toHaveLength(1);
  });
});

describe('Req 9: suspend from an inquiry', () => {
  function setup(suspendStatus: InquirySuspendStatus | null = null) {
    const inquiry = {
      id: 'i1',
      closedAt: null,
      suspendStatus,
      suspendApproverUserId: 'chair',
      suspendFrom: d('2026-10-20'),
      suspendReason: 'Misconduct',
      suspendRequestedById: 'hr',
      disciplinaryActionId: 'a1',
      disciplinaryAction: {
        employee: { id: 'e1', fullName: 'A', employeeCode: 'C1', status: EmployeeStatus.ACTIVE },
      },
    };
    const tx = {
      inquiry: { update: jest.fn() },
      employee: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'e1', fullName: 'A', employeeCode: 'C1' }),
      },
      disciplinaryAction: { update: jest.fn() },
      notification: { create: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      ...tx,
      inquiry: {
        findUnique: jest.fn().mockResolvedValue(inquiry),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'chair',
          isActive: true,
          role: UserRole.CHAIRMAN,
          additionalRoles: [],
          employeeId: 'ce',
        }),
      },
      letter: { update: jest.fn() },
      $transaction: jest.fn((fn) => fn(tx)),
    };
    const letters = { generateSystemLetter: jest.fn().mockResolvedValue({ letter: { id: 'L1' } }) };
    return { service: new InquirySuspensionService(prisma as never, letters as never), tx, letters };
  }

  it('HR asks; nothing changes until the executive approves', async () => {
    const { service, tx } = setup();
    const r = await service.request(
      'i1',
      { suspendFrom: '2026-10-20', reason: 'Misconduct', approverUserId: 'chair' },
      { id: 'hr', roles: [UserRole.HR_OPERATIONS_MANAGER] },
    );
    expect(r.status).toBe(InquirySuspendStatus.PENDING_APPROVAL);
    expect(tx.employee.updateMany).not.toHaveBeenCalled();
  });

  it('executive approval suspends from the chosen date and issues the notice', async () => {
    const { service, tx, letters } = setup(InquirySuspendStatus.PENDING_APPROVAL);
    const r = await service.decide('i1', true, { id: 'chair', roles: [UserRole.CHAIRMAN] });
    expect(r.status).toBe(InquirySuspendStatus.APPROVED);
    expect(tx.employee.updateMany.mock.calls[0][0].data).toMatchObject({
      status: EmployeeStatus.SUSPENDED,
      statusEffectiveFrom: d('2026-10-20'),
    });
    expect(letters.generateSystemLetter).toHaveBeenCalled();
  });

  it('another executive cannot decide someone else’s request', async () => {
    const { service } = setup(InquirySuspendStatus.PENDING_APPROVAL);
    await expect(
      service.decide('i1', true, { id: 'founder', roles: [UserRole.FOUNDER] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
