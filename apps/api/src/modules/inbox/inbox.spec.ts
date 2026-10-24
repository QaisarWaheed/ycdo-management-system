import { ExtraTimeStatus, UserRole } from '@prisma/client';
import { InboxService } from './inbox.service';

const day = (status: ExtraTimeStatus, addedById = 'hr1') => ({
  id: 'd1',
  date: new Date('2026-10-20T00:00:00Z'),
  createdAt: new Date('2026-10-20T09:15:00Z'),
  note: 'Covered night duty',
  status,
  addedById,
  addedBy: { email: 'hr.muneeba@ycdo.org' },
  employee: {
    id: 'e1',
    fullName: 'Test',
    employeeCode: 'YCDO-1',
    currentBranch: { name: 'Central' },
  },
});

function setup(
  days: unknown[],
  audits: unknown[] = [],
  changes: unknown[] = [],
) {
  const prisma = {
    employeeChangeRequest: { findMany: jest.fn().mockResolvedValue(changes) },
    additionalWorkingDay: { findMany: jest.fn().mockResolvedValue(days) },
    attendanceLog: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { findMany: jest.fn().mockResolvedValue(audits) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { service: new InboxService(prisma as never), prisma };
}

describe('Inbox (extra time)', () => {
  it('HR sees what it sent and where it is now, with the trail', async () => {
    const { service } = setup(
      [day(ExtraTimeStatus.ESCALATED)],
      [
        {
          entityId: 'd1',
          action: 'EXTRA_TIME_ESCALATED',
          userId: 'ops1',
          createdAt: new Date('2026-10-21T06:00:00Z'),
          changes: { note: 'Checked roster' },
          user: { email: 'hr.operations@ycdo.org' },
        },
      ],
    );
    const { items } = await service.list(
      { id: 'hr1', roles: [UserRole.HR_EXECUTIVE] },
      'sent',
    );
    expect(items[0]).toMatchObject({
      step: 'With Chairman',
      canDecide: false,
      requestedBy: 'hr.muneeba@ycdo.org',
    });
    expect(items[0].trail.map((t) => t.text)).toEqual([
      'Extra day entered',
      'HR Operations approved; sent to the Chairman',
      'Waiting: With Chairman',
    ]);
    expect(items[0].trail[1].note).toBe('Checked roster');
  });

  it('HR Operations sees pending items to decide, never its own entries', async () => {
    const { service, prisma } = setup([day(ExtraTimeStatus.PENDING)]);
    const { items } = await service.list(
      { id: 'ops1', roles: [UserRole.HR_OPERATIONS_MANAGER] },
      'todo',
    );
    expect(items[0].canDecide).toBe(true);
    expect(
      prisma.additionalWorkingDay.findMany.mock.calls[0][0].where,
    ).toMatchObject({
      status: { in: [ExtraTimeStatus.PENDING] },
      NOT: { addedById: 'ops1' },
    });
  });

  it('HR Operations sees a pending working-hours request it can decide', async () => {
    const { service, prisma } = setup(
      [],
      [],
      [
        {
          id: 'c1',
          kind: 'WORKING_HOURS',
          status: 'PENDING',
          summary:
            'Working hours 09:00 AM - 05:00 PM (8h) → 12:00 AM - 11:59 PM (24h) from 2026-10-24',
          payload: { effectiveDate: '2026-10-24' },
          requestedById: 'hr1',
          requestedAt: new Date('2026-10-24T15:01:00Z'),
          decidedById: null,
          decidedAt: null,
          decisionNote: null,
          employee: {
            id: 'e1',
            fullName: 'Saif',
            employeeCode: 'YCDO-2026-0366',
            currentBranch: null,
          },
        },
      ],
    );
    prisma.user.findMany.mockResolvedValue([
      { id: 'hr1', email: 'hr.urooj@ycdo.org' },
    ]);
    const { items } = await service.list(
      { id: 'ops1', roles: [UserRole.HR_OPERATIONS_MANAGER] },
      'todo',
    );
    const change = items.find((i) => i.kind === 'change')!;
    expect(change).toMatchObject({
      type: 'WORKING_HOURS',
      canDecide: true,
      date: '2026-10-24',
      step: 'With HR Operations',
    });
    expect(change.trail.map((t) => t.text)).toEqual([
      'Working hours requested (draft letter in Letters)',
      'Waiting: With HR Operations',
    ]);
  });

  it('a login with nothing to approve has an empty To do', async () => {
    const { service, prisma } = setup([day(ExtraTimeStatus.PENDING)]);
    const { items } = await service.list(
      { id: 'fin1', roles: [UserRole.PAYROLL_OFFICER] },
      'todo',
    );
    expect(items).toEqual([]);
    expect(prisma.additionalWorkingDay.findMany).not.toHaveBeenCalled();
  });
});
