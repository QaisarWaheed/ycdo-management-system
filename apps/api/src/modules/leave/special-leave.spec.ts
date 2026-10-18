import { ForbiddenException } from '@nestjs/common';
import { LeaveStatus, LeaveType, UserRole } from '@prisma/client';
import { SpecialLeaveService } from './special-leave.service';

const HR_OPS = { id: 'ops', roles: [UserRole.HR_OPERATIONS_MANAGER] };
const CHAIRMAN = { id: 'ch', roles: [UserRole.CHAIRMAN] };

function setup(status: LeaveStatus) {
  const leave = {
    id: 'l1',
    employeeId: 'e1',
    leaveType: LeaveType.SPECIAL,
    status,
    payPercent: 50,
    startDate: new Date(Date.UTC(2026, 9, 5)),
    endDate: new Date(Date.UTC(2026, 9, 9)),
    employee: { fullName: 'A' },
    specialLeaveType: { name: 'Maternity' },
  };
  const tx = {
    leaveApproval: { create: jest.fn() },
    leaveRecord: { update: jest.fn(({ data }) => ({ ...leave, ...data })) },
    notification: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = {
    leaveRecord: { findUnique: jest.fn().mockResolvedValue(leave) },
    $transaction: jest.fn((fn) => fn(tx)),
  };
  const leaveService = {
    markLeaveAttendance: jest.fn(),
    recomputePendingPayrollForLeave: jest.fn(),
  };
  const service = new SpecialLeaveService(prisma as never, leaveService as never);
  return { service, leaveService, tx };
}

describe('special leave (HR Operations → Chairman)', () => {
  it('HR Operations approval is not final: goes to Chairman, no attendance yet', async () => {
    const { service, leaveService } = setup(LeaveStatus.HR_PENDING);
    const r = await service.decide('l1', true, HR_OPS);
    expect(r.status).toBe(LeaveStatus.CHAIRMAN_PENDING);
    expect(leaveService.markLeaveAttendance).not.toHaveBeenCalled();
  });

  it('Chairman final approval marks attendance and recomputes payroll', async () => {
    const { service, leaveService } = setup(LeaveStatus.CHAIRMAN_PENDING);
    const r = await service.decide('l1', true, CHAIRMAN);
    expect(r.status).toBe(LeaveStatus.APPROVED);
    expect(leaveService.markLeaveAttendance).toHaveBeenCalled();
    expect(leaveService.recomputePendingPayrollForLeave).toHaveBeenCalled();
  });

  it('wrong stage reviewer is refused; reject is final', async () => {
    const pending = setup(LeaveStatus.HR_PENDING);
    await expect(pending.service.decide('l1', true, CHAIRMAN)).rejects.toBeInstanceOf(ForbiddenException);
    const atChair = setup(LeaveStatus.CHAIRMAN_PENDING);
    await expect(atChair.service.decide('l1', true, HR_OPS)).rejects.toBeInstanceOf(ForbiddenException);
    const r = await pending.service.decide('l1', false, HR_OPS, 'no');
    expect(r.status).toBe(LeaveStatus.REJECTED);
    expect(pending.leaveService.markLeaveAttendance).not.toHaveBeenCalled();
  });
});
