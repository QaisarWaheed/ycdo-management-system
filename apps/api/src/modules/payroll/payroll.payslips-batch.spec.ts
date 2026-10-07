jest.mock('exceljs', () => ({ __esModule: true, default: class ExcelJS {} }), {
  virtual: true,
});

import { PayrollService } from './payroll.service';

describe('PayrollService.getPayslips', () => {
  it('builds payslips one at a time so pending recomputes never overlap (P2034)', async () => {
    const service = new PayrollService({} as never, {} as never);
    let running = 0;
    let maxRunning = 0;
    jest
      .spyOn(service, 'getEntryWithAllowances')
      .mockImplementation(async (entryId: string) => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return { slip: { entryId } } as never;
      });

    const result = await service.getPayslips({
      entryIds: ['a', 'b', 'c', 'b', 'd', 'e'],
    } as never);

    expect(maxRunning).toBe(1);
    expect(result.map((r) => r.entryId)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
