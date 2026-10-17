import { ForbiddenException } from '@nestjs/common';
import {
  AttendanceStatus,
  EmployeeStatus,
  ExtraTimeStatus,
  UserRole,
} from '@prisma/client';

jest.mock('../payroll/payroll.service', () => ({
  PayrollService: class PayrollService {},
}));
jest.mock('../letters/letters.service', () => ({
  LettersService: class LettersService {},
}));
jest.mock('../letters/pdf.helper', () => ({
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

import { AdditionalWorkingDaysService } from './additional-working-days.service';
import { summarizeAttendanceLogs } from '../attendance/attendance-summary.util';
import { loadAttendanceCard } from '../attendance/attendance-card.util';
import { hrEnteredOvertimeFields } from '../attendance/attendance.service';

const HR_OPS = { id: 'ops', roles: [UserRole.HR_OPERATIONS_MANAGER] };
const CHAIRMAN = { id: 'chair', roles: [UserRole.CHAIRMAN] };

function setup(day: { status: ExtraTimeStatus; addedById?: string }) {
  const prisma = {
    employee: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'emp-1', status: EmployeeStatus.ACTIVE }),
    },
    additionalWorkingDay: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'awd-1',
        employeeId: 'emp-1',
        date: new Date(Date.UTC(2026, 9, 5)),
        addedById: 'hr',
        relieverSessionId: null,
        ...day,
      }),
      create: jest.fn().mockResolvedValue({ id: 'awd-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    attendanceLog: { findUnique: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const recompute = jest.fn().mockResolvedValue(undefined);
  const service = new AdditionalWorkingDaysService(
    prisma as never,
    {
      recomputePendingPayrollForAttendanceDate: recompute,
    } as never,
  );
  return { prisma, recompute, service };
}

describe('Point 20 extra time approval', () => {
  it('HR create leaves the day PENDING and does not touch salary', async () => {
    const { prisma, recompute, service } = setup({
      status: ExtraTimeStatus.PENDING,
    });
    await service.create({ employeeId: 'emp-1', date: '2026-10-05' }, 'hr');
    expect(
      prisma.additionalWorkingDay.create.mock.calls[0][0].data,
    ).not.toHaveProperty('status');
    expect(recompute).not.toHaveBeenCalled();
  });

  it('reliever-session days are created APPROVED', async () => {
    const { prisma, service } = setup({ status: ExtraTimeStatus.PENDING });
    prisma.additionalWorkingDay.findUnique.mockResolvedValue(null);
    await service.upsertFromRelieverSession({
      relieverSessionId: 's',
      employeeId: 'emp-1',
      date: new Date(Date.UTC(2026, 9, 5)),
      addedById: 'hr',
    });
    expect(
      prisma.additionalWorkingDay.create.mock.calls[0][0].data.status,
    ).toBe(ExtraTimeStatus.APPROVED);
  });

  it('HR Operations reject sends the day to the Chairman (ESCALATED)', async () => {
    const { prisma, recompute, service } = setup({
      status: ExtraTimeStatus.PENDING,
    });
    await expect(
      service.reviewExtraTime('day', 'awd-1', false, HR_OPS, 'not needed'),
    ).resolves.toMatchObject({ status: ExtraTimeStatus.ESCALATED });
    expect(
      prisma.additionalWorkingDay.update.mock.calls[0][0].data,
    ).toMatchObject({
      status: ExtraTimeStatus.ESCALATED,
      reviewedById: 'ops',
      reviewNote: 'not needed',
      escalatedAt: expect.any(Date),
    });
    expect(prisma.auditLog.create).toHaveBeenCalled();
    expect(recompute).toHaveBeenCalledWith('emp-1', expect.any(Date));
  });

  it('the person who entered it cannot approve, Super Admin included', async () => {
    const { prisma, service } = setup({
      status: ExtraTimeStatus.PENDING,
      addedById: 'boss',
    });
    await expect(
      service.reviewExtraTime('day', 'awd-1', true, {
        id: 'boss',
        roles: [UserRole.SUPER_ADMIN],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.additionalWorkingDay.update).not.toHaveBeenCalled();
  });

  it('HR Operations cannot decide an escalated entry; Chairman reject is final', async () => {
    const { prisma, service } = setup({ status: ExtraTimeStatus.ESCALATED });
    await expect(
      service.reviewExtraTime('day', 'awd-1', true, HR_OPS),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.reviewExtraTime('day', 'awd-1', false, CHAIRMAN),
    ).resolves.toMatchObject({ status: ExtraTimeStatus.REJECTED });
    expect(
      prisma.additionalWorkingDay.update.mock.calls[0][0].data.status,
    ).toBe(ExtraTimeStatus.REJECTED);
  });

  it('Chairman cannot decide a PENDING entry (HR Operations first)', async () => {
    const { service } = setup({ status: ExtraTimeStatus.PENDING });
    await expect(
      service.reviewExtraTime('day', 'awd-1', true, CHAIRMAN),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approving overtime marks it approved and no longer pending', async () => {
    const { prisma, service } = setup({ status: ExtraTimeStatus.PENDING });
    prisma.attendanceLog.findUnique.mockResolvedValue({
      id: 'log-1',
      employeeId: 'emp-1',
      date: new Date(Date.UTC(2026, 9, 5)),
      overtimeStatus: ExtraTimeStatus.PENDING,
      overtimeRequestedById: 'hr',
    });
    await service.reviewExtraTime('overtime', 'log-1', true, HR_OPS);
    expect(prisma.attendanceLog.update.mock.calls[0][0].data).toMatchObject({
      overtimeStatus: ExtraTimeStatus.APPROVED,
      overtimePending: false,
      overtimeApprovedBy: 'ops',
    });
  });

  it('pays overtime only when status is null (legacy) or APPROVED', () => {
    const log = (
      overtimeMinutes: number,
      overtimeStatus: ExtraTimeStatus | null,
    ) => ({
      status: AttendanceStatus.PRESENT,
      overtimeMinutes,
      lateMinutes: 0,
      overtimeStatus,
    });
    const summary = summarizeAttendanceLogs([
      log(60, null),
      log(30, ExtraTimeStatus.APPROVED),
      log(120, ExtraTimeStatus.PENDING),
      log(120, ExtraTimeStatus.ESCALATED),
      log(120, ExtraTimeStatus.REJECTED),
    ]);
    expect(summary.overtimeMinutes).toBe(90);
  });

  it('Attendance Card counts only APPROVED additional working days', async () => {
    const db = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          joiningDate: new Date('2026-08-01'),
          status: EmployeeStatus.ACTIVE,
          statusEffectiveFrom: null,
          monthlyAllowedLeaves: null,
        }),
      },
      attendanceLog: { findMany: jest.fn().mockResolvedValue([]) },
      additionalWorkingDay: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await loadAttendanceCard(db as never, 'e', 8, 2026);
    expect(db.additionalWorkingDay.findMany.mock.calls[0][0].where.status).toBe(
      ExtraTimeStatus.APPROVED,
    );
  });

  it('HR-entered overtime goes PENDING (unpaid); setting 0 clears the review', () => {
    expect(hrEnteredOvertimeFields(90, 'hr')).toMatchObject({
      overtimePending: true,
      overtimeStatus: ExtraTimeStatus.PENDING,
      overtimeRequestedById: 'hr',
    });
    expect(hrEnteredOvertimeFields(0, 'hr')).toMatchObject({
      overtimePending: false,
      overtimeStatus: null,
      overtimeRequestedById: null,
    });
  });
});
