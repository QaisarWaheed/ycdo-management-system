import { ForbiddenException } from '@nestjs/common';
import { EmployeeChangeKind, EmployeeChangeStatus, UserRole } from '@prisma/client';
import { EmployeeChangeRequestService } from './employee-change-request.service';

function setup(kind: EmployeeChangeKind) {
  const prisma = {
    employeeChangeRequest: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'r1',
        employeeId: 'e1',
        kind,
        status: EmployeeChangeStatus.PENDING,
        requestedById: 'hr',
        summary: 's',
        payload: {
          currentBranchId: 'b2',
          currentDepartmentId: 'd2',
          currentDesignation: 'Nurse',
          changeReason: 'need',
          effectiveDate: '2026-11-01',
          dutyStartTime: '08:00',
          dutyEndTime: '16:00',
          dutyTotalHours: 8,
        },
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
    notification: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const employees = { transfer: jest.fn(), updateBranchDuty: jest.fn() };
  const service = new EmployeeChangeRequestService(prisma as never, employees as never, {} as never);
  return { service, employees };
}
const OPS = { id: 'ops', role: UserRole.HR_OPERATIONS_MANAGER, roles: [UserRole.HR_OPERATIONS_MANAGER] };
const FOUNDER = { id: 'f', role: UserRole.FOUNDER, roles: [UserRole.FOUNDER] };

describe('Req 16 / 17 change requests', () => {
  it('HR Operations approval applies the transfer', async () => {
    const { service, employees } = setup(EmployeeChangeKind.TRANSFER);
    await service.decide('r1', true, undefined, OPS);
    expect(employees.transfer).toHaveBeenCalledWith('e1', expect.objectContaining({ currentBranchId: 'b2' }));
  });

  it('working hours need an executive; HR Operations is refused', async () => {
    const refused = setup(EmployeeChangeKind.WORKING_HOURS);
    await expect(refused.service.decide('r1', true, undefined, OPS)).rejects.toBeInstanceOf(ForbiddenException);
    const ok = setup(EmployeeChangeKind.WORKING_HOURS);
    await ok.service.decide('r1', true, undefined, FOUNDER);
    expect(ok.employees.updateBranchDuty).toHaveBeenCalledWith(
      'e1',
      { dutyStartTime: '08:00', dutyEndTime: '16:00', dutyTotalHours: 8 },
      'f',
    );
  });

  it('rejection changes nothing on the employee', async () => {
    const { service, employees } = setup(EmployeeChangeKind.TRANSFER);
    await service.decide('r1', false, 'no', OPS);
    expect(employees.transfer).not.toHaveBeenCalled();
  });
});
