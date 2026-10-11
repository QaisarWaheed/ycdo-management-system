import { UserRole } from '@prisma/client';

jest.mock('../letters/pdf.helper', () => ({ generatePdf: jest.fn() }));

import { PayrollController } from './payroll.controller';

describe('payroll history access', () => {
  const service = {
    getEmployeePayrollHistory: jest.fn().mockResolvedValue([]),
  };
  const controller = Object.assign(Object.create(PayrollController.prototype), {
    payrollService: service,
  }) as PayrollController;

  it('an employee reads only their own history', async () => {
    await expect(
      controller.getEmployeePayrollHistory('e1', {
        role: UserRole.EMPLOYEE,
        employeeId: 'e1',
      }),
    ).resolves.toEqual([]);
    expect(() =>
      controller.getEmployeePayrollHistory('e2', {
        role: UserRole.EMPLOYEE,
        employeeId: 'e1',
      }),
    ).toThrow('only view your own payroll history');
  });

  it('executives can read any employee history', async () => {
    await expect(
      controller.getEmployeePayrollHistory('e2', { role: UserRole.FOUNDER }),
    ).resolves.toEqual([]);
    expect(service.getEmployeePayrollHistory).toHaveBeenLastCalledWith('e2');
  });
});
