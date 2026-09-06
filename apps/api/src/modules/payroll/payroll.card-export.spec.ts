import { PayrollService } from './payroll.service';

jest.mock('../attendance/discipline.helper', () => ({}));
jest.mock('exceljs', () => ({ __esModule: true, default: { Workbook: class {
  addWorksheet = jest.fn(() => ({}));
  xlsx = { writeBuffer: jest.fn(async () => Buffer.from('workbook')) };
} } }));

describe('Card salary branch Excel', () => {
  it.each([1, 2])('uses the monthly live Card slip once for %i payroll segments', async segments => {
    const employee = { id: 'employee', fullName: 'Employee', employeeCode: 'E1' };
    const entries = Array.from({ length: segments }, (_, i) => ({
      id: `entry-${i}`, month: 8, year: 2026, status: 'PROCESSED',
      stipendRecord: { employeeId: employee.id, employee },
    }));
    const prisma: any = {
      branch: { findUnique: jest.fn(async () => ({ id: 'branch', name: 'Branch' })) },
      payrollEntry: { findMany: jest.fn(async () => entries) },
      attendanceLog: { findMany: jest.fn(() => { throw new Error('Excel must not independently derive attendance'); }) },
    };
    const service: any = new PayrollService(prisma, {} as any);
    // Includes the Card's paid SWAP_COVERED day and current monthly package.
    const slip = { employeeName: 'Employee', employeeId: 'E1', presence: 31, netPay: 31000 };
    service.getEntryWithAllowances = jest.fn(async () => ({ slip, stipendRecord: { employee } }));
    service.writePayslipSheet = jest.fn();
    await service.generateBranchPayrollReport('branch', 8, 2026);
    expect(service.getEntryWithAllowances).toHaveBeenCalledTimes(1);
    expect(service.writePayslipSheet).toHaveBeenCalledTimes(1);
    expect(service.writePayslipSheet.mock.calls[0][1]).toBe(slip);
    expect(prisma.attendanceLog.findMany).not.toHaveBeenCalled();
  });
});
