import { BadRequestException } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';

jest.mock('../letters/letters.service', () => ({
  LettersService: class LettersService {},
}));

jest.mock('../../config/cloudinary.config', () => ({
  cloudinary: {},
  isCloudinaryEnabled: () => false,
}));

import { EmployeesService } from './employees.service';

describe('EmployeesService.changeStatus', () => {
  function build(currentStatus: EmployeeStatus) {
    const prisma = {
      employee: {
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'emp-1',
            status: data.status,
            currentBranch: { name: 'HQ', address: null },
            currentDepartment: { name: 'OPD' },
          }),
        ),
      },
    };
    const service = new EmployeesService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'emp-1',
      status: currentStatus,
    } as never);
    return { service, prisma };
  }

  it('rejects manual ACTIVE → SUSPENDED and does not update the employee', async () => {
    const { service, prisma } = build(EmployeeStatus.ACTIVE);

    await expect(
      service.changeStatus('emp-1', {
        status: EmployeeStatus.SUSPENDED,
        reason: 'Manual suspend',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.changeStatus('emp-1', {
        status: EmployeeStatus.SUSPENDED,
        reason: 'Manual suspend',
      }),
    ).rejects.toThrow(/Open a Suspension case/i);

    expect(prisma.employee.update).not.toHaveBeenCalled();
  });

  it('allows an ordinary status change such as ACTIVE → ON_REST', async () => {
    const { service, prisma } = build(EmployeeStatus.ACTIVE);

    const result = await service.changeStatus('emp-1', {
      status: EmployeeStatus.ON_REST,
      reason: 'Rest day assignment',
    });

    expect(prisma.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'emp-1' },
        data: { status: EmployeeStatus.ON_REST },
      }),
    );
    expect(result.status).toBe(EmployeeStatus.ON_REST);
    expect(prisma.employee.update.mock.calls[0][0].data).toEqual({
      status: EmployeeStatus.ON_REST,
    });
  });

  it('rejects SUSPENDED → ACTIVE from Change Status', async () => {
    const { service, prisma } = build(EmployeeStatus.SUSPENDED);

    await expect(
      service.changeStatus('emp-1', {
        status: EmployeeStatus.ACTIVE,
        reason: 'Reinstated after review',
      }),
    ).rejects.toThrow(/inquiry finding/i);

    expect(prisma.employee.update).not.toHaveBeenCalled();
  });
});
