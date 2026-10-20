import { ForbiddenException } from '@nestjs/common';
import { EmployeeChangeKind, EmployeeChangeStatus, LetterType, UserRole } from '@prisma/client';
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

  it('working hours are approved by HR Operations; executives are refused', async () => {
    const refused = setup(EmployeeChangeKind.WORKING_HOURS);
    await expect(refused.service.decide('r1', true, undefined, FOUNDER)).rejects.toBeInstanceOf(ForbiddenException);
    const ok = setup(EmployeeChangeKind.WORKING_HOURS);
    await ok.service.decide('r1', true, undefined, OPS);
    expect(ok.employees.updateBranchDuty).toHaveBeenCalledWith(
      'e1',
      { dutyStartTime: '08:00', dutyEndTime: '16:00', dutyTotalHours: 8 },
      'ops',
    );
  });

  it('rejection changes nothing on the employee', async () => {
    const { service, employees } = setup(EmployeeChangeKind.TRANSFER);
    await service.decide('r1', false, 'no', OPS);
    expect(employees.transfer).not.toHaveBeenCalled();
  });

  it('same branch: department / designation change gets its own letter, not a transfer letter', async () => {
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'e1',
          currentBranchId: 'b1',
          currentDepartmentId: 'd1',
          currentDesignation: 'Nurse',
          currentBranch: { name: 'Hassan Abad' },
          currentDepartment: { name: 'OPD' },
        }),
      },
      branch: { findUnique: jest.fn().mockResolvedValue({ id: 'b1', name: 'Hassan Abad' }) },
      department: { findUnique: jest.fn().mockResolvedValue({ id: 'd2', name: 'Emergency' }) },
    };
    const letters = { generate: jest.fn().mockResolvedValue({ letter: { id: 'l1' } }) };
    const service = new EmployeeChangeRequestService(prisma as never, {} as never, letters as never);
    jest.spyOn(service as never, 'assertNoOpen').mockResolvedValue(undefined as never);
    const create = jest.spyOn(service as never, 'create').mockResolvedValue({} as never);
    const dto = {
      employeeId: 'e1',
      currentBranchId: 'b1',
      currentDepartmentId: 'd2',
      currentDesignation: 'Charge Nurse',
      changeReason: 'need',
      effectiveDate: '2026-11-01',
    };
    await service.requestTransfer(dto, OPS);
    expect(letters.generate.mock.calls[0][0]).toMatchObject({
      letterType: LetterType.CUSTOM,
      extraFields: { subject: 'Change of Department / Designation' },
    });
    expect(create.mock.calls[0][3]).toBe(
      'Department / designation OPD / Nurse → Emergency / Charge Nurse from 2026-11-01',
    );
    prisma.department.findUnique.mockResolvedValue({ id: 'd1', name: 'OPD' });
    await expect(
      service.requestTransfer({ ...dto, currentDepartmentId: 'd1', currentDesignation: 'nurse' }, OPS),
    ).rejects.toThrow('Nothing changes');
  });
});
