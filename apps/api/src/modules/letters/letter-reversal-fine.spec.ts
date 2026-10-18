import { DeductionType, LetterType, PayrollStatus } from '@prisma/client';
import { LettersService } from './letters.service';

function tx(entryStatus: PayrollStatus) {
  return {
    $queryRaw: jest.fn(),
    payrollDeduction: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'd1',
          amount: 200,
          reason: DeductionType.DISCIPLINARY_FINE,
          description: 'Letter fine [L1] uniform',
          payrollEntry: { id: 'p10', status: entryStatus, totalDeductions: 200, netStipend: 29800 },
        },
      ]),
      delete: jest.fn(),
    },
    payrollEntry: {
      update: jest.fn().mockResolvedValue({ netStipend: 30000 }),
      findUnique: jest.fn().mockResolvedValue({ month: 10, year: 2026 }),
      findMany: jest.fn().mockResolvedValue([{ id: 'p11', month: 11, year: 2026 }]),
    },
    payrollChangeLog: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    allowance: { create: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { create: jest.fn() },
  };
}
const unwind = (t: ReturnType<typeof tx>) =>
  (Object.create(LettersService.prototype) as { tryUnwindFineDeduction: (...a: unknown[]) => Promise<{ undone: boolean }> })
    .tryUnwindFineDeduction(
      t,
      { id: 'L1', employeeId: 'e1', letterType: LetterType.FINE, variables: {}, generatedAt: new Date() },
      'it-user',
    );

describe('Req 19: IT reverses a fine letter', () => {
  it('processed slip: the fine row is removed (no reversal line), net goes back up, audit kept', async () => {
    const t = tx(PayrollStatus.PROCESSED);
    const r = await unwind(t);
    expect(r.undone).toBe(true);
    expect(t.payrollDeduction.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
    expect(t.payrollEntry.update.mock.calls[0][0].data).toEqual({
      totalDeductions: { decrement: 200 },
      netStipend: { increment: 200 },
    });
    expect(t.auditLog.create.mock.calls[0][0].data.action).toBe('FINE_REMOVED_BY_LETTER_REVERSAL');
    expect(t.allowance.create).not.toHaveBeenCalled();
  });

  it('paid slip stays as paid; the amount is refunded on the next open month', async () => {
    const t = tx(PayrollStatus.PAID);
    await unwind(t);
    expect(t.payrollDeduction.delete).not.toHaveBeenCalled();
    expect(t.allowance.create.mock.calls[0][0].data).toMatchObject({ payrollEntryId: 'p11', amount: 200 });
  });
});
