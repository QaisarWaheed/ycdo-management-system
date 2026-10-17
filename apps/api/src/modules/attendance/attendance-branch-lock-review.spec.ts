jest.mock('../letters/pdf.helper', () => ({}));
jest.mock('../letters/auto-letter.helper', () => ({
  issueAutoTemplatedLetter: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../letters/letters.service', () => ({ LettersService: class {} }));
jest.mock('../disciplinary/disciplinary.service', () => ({
  DisciplinaryService: class {},
}));

import { ConflictException } from '@nestjs/common';
import { EmployeeStatus, PunchReviewStatus } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import { PUNCH_REVIEW_REASON } from './device-punch-time.util';

const now = new Date('2026-10-19T09:00:00+05:00');

function makeHarness(device: unknown = null) {
  const employee = {
    id: 'emp-1',
    biometricId: '100',
    status: EmployeeStatus.ACTIVE,
    currentBranchId: 'branch-a',
    joiningDate: new Date('2020-01-01'),
    dutyStartTime: '09:00',
    dutyEndTime: '17:00',
    dutyTotalHours: 8,
    shift: null,
  };
  const branches: Record<string, unknown> = {
    'branch-a': { id: 'branch-a', name: 'Gulberg', address: '1 Main Rd' },
    'branch-b': { id: 'branch-b', name: 'Johar Town', address: '9 Canal' },
  };
  const prisma: any = {
    employee: { findUnique: jest.fn().mockResolvedValue(employee) },
    biometricDevice: {
      findUnique: jest.fn().mockResolvedValue(device),
      update: jest.fn(),
    },
    branch: {
      findUnique: jest.fn(async ({ where }: any) => branches[where.id] ?? null),
    },
    relieverRequest: { findMany: jest.fn().mockResolvedValue([]) },
    relieverSession: { findMany: jest.fn().mockResolvedValue([]) },
    mutualSwap: { findMany: jest.fn().mockResolvedValue([]) },
    processedDeviceEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    punchReview: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const payroll = {
    recomputePendingPayrollForAttendanceDate: jest
      .fn()
      .mockResolvedValue(undefined),
  };
  const service = new AttendanceService(
    prisma,
    {} as any,
    {} as any,
    payroll as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const processResolvedPunch = jest
    .fn()
    .mockResolvedValue({ type: 'CHECKIN', log: {} });
  (service as any).processResolvedPunch = processResolvedPunch;
  (service as any).maybeReconcilePunchConsequences = jest.fn();
  return { service, prisma, payroll, processResolvedPunch };
}

const scan = {
  biometricId: '100',
  deviceId: 'dev-1',
  serialNo: '55',
  deviceStatus: 'CHECKIN',
};

describe('rawScan branch lock + punch review', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });
  afterEach(() => jest.useRealTimers());

  it('stores the reason on the device event for a business reject', async () => {
    const h = makeHarness();
    h.processResolvedPunch.mockRejectedValue(
      new ConflictException(
        'Employee already checked in. Duplicate CHECKIN rejected.',
      ),
    );
    const res = await h.service.rawScan(scan);
    expect(res).toMatchObject({ accepted: false, idempotent: false });
    expect(h.prisma.processedDeviceEvent.update).toHaveBeenCalledWith({
      where: { deviceId_serialNo: { deviceId: 'dev-1', serialNo: '55' } },
      data: {
        rejectReason:
          'Employee already checked in. Duplicate CHECKIN rejected.',
      },
    });
  });

  it('rejects a punch from another branch device and records why', async () => {
    const h = makeHarness({
      id: 'd1',
      deviceId: 'dev-1',
      branchId: 'branch-b',
      clockOffsetSec: null,
      clockCandidateSec: null,
      clockCandidateAt: null,
    });
    const res = await h.service.rawScan(scan);
    const reason =
      'Punch from another branch device: Johar Town (employee branch Gulberg)';
    expect(res).toMatchObject({ accepted: false, reason });
    expect(h.prisma.processedDeviceEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ rejectReason: reason }),
    });
    expect(h.processResolvedPunch).not.toHaveBeenCalled();
    expect(h.prisma.punchReview.create).not.toHaveBeenCalled();
  });

  it('allows the other branch device on reliever duty there', async () => {
    const h = makeHarness({
      id: 'd1',
      deviceId: 'dev-1',
      branchId: 'branch-b',
      clockOffsetSec: null,
      clockCandidateSec: null,
      clockCandidateAt: null,
    });
    h.prisma.relieverRequest.findMany.mockResolvedValue([
      { leaveRecord: { employee: { currentBranch: { id: 'branch-b' } } } },
    ]);
    const res = await h.service.rawScan(scan);
    expect(res).toMatchObject({ accepted: true });
    expect(h.processResolvedPunch).toHaveBeenCalled();
  });

  it('puts an isolated punch on a changed clock on the HR review list', async () => {
    const h = makeHarness({
      id: 'd1',
      deviceId: 'dev-1',
      branchId: 'branch-a',
      clockOffsetSec: 0,
      clockCandidateSec: null,
      clockCandidateAt: null,
    });
    const deviceTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const res = await h.service.rawScan({
      ...scan,
      eventTime: deviceTime.toISOString(),
    });
    expect(res).toMatchObject({ accepted: false, reason: PUNCH_REVIEW_REASON });
    expect(h.prisma.punchReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deviceId: 'dev-1',
        serialNo: '55',
        employeeId: 'emp-1',
        punchType: 'CHECKIN',
        deviceTime,
        reason: PUNCH_REVIEW_REASON,
      }),
    });
    expect(h.processResolvedPunch).not.toHaveBeenCalled();
  });

  it('saves an offline dump on a known clock at its real time', async () => {
    const h = makeHarness({
      id: 'd1',
      deviceId: 'dev-1',
      branchId: 'branch-a',
      clockOffsetSec: 0,
      clockCandidateSec: null,
      clockCandidateAt: null,
    });
    h.prisma.processedDeviceEvent.count.mockResolvedValue(4);
    const deviceTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const res = await h.service.rawScan({
      ...scan,
      eventTime: deviceTime.toISOString(),
    });
    expect(res).toMatchObject({ accepted: true });
    expect(h.processResolvedPunch.mock.calls[0][3]).toEqual(deviceTime);
  });
});

describe('applyPunchReview', () => {
  it('runs normal punch processing at the HR-entered time', async () => {
    const h = makeHarness();
    const deviceTime = new Date('2026-10-18T09:05:00+05:00');
    h.prisma.punchReview.findUnique.mockResolvedValue({
      id: 'r1',
      status: PunchReviewStatus.PENDING,
      employeeId: 'emp-1',
      punchType: 'CHECKIN',
      deviceTime,
    });
    await h.service.applyPunchReview(
      'r1',
      { time: '2026-10-18T09:10:00+05:00' },
      'hr-1',
    );
    const call = h.processResolvedPunch.mock.calls[0];
    expect(call[1]).toBe('branch-a');
    expect(call[2]).toBe('CHECKIN');
    expect(call[3]).toEqual(new Date('2026-10-18T09:10:00+05:00'));
    expect(h.prisma.punchReview.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1', status: PunchReviewStatus.PENDING },
        data: expect.objectContaining({
          status: PunchReviewStatus.APPLIED,
          resolvedById: 'hr-1',
        }),
      }),
    );
    expect(h.prisma.auditLog.create).toHaveBeenCalled();
    expect(
      h.payroll.recomputePendingPayrollForAttendanceDate,
    ).toHaveBeenCalledWith('emp-1', expect.any(Date));
  });

  it('refuses an already resolved review', async () => {
    const h = makeHarness();
    h.prisma.punchReview.findUnique.mockResolvedValue({
      id: 'r1',
      status: PunchReviewStatus.DISMISSED,
      employeeId: 'emp-1',
    });
    await expect(
      h.service.applyPunchReview('r1', {}, 'hr-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.processResolvedPunch).not.toHaveBeenCalled();
  });
});
