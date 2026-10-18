import { applyLetterFine, letterFine } from './letter-fine.util';
import { CUSTOM_LETTER_TEMPLATE } from './custom-letter.template';
import { renderLetterHtml } from './letter-templates.helper';

const letter: any = { id: 'l1', employeeId: 'e', letterType: 'FINE',
  letterNo: '12/YCDO/2026', generatedAt: new Date('2026-10-15T10:00:00Z'),
  variables: { fineAmount: '200/-', finePreset: 'UNIFORM', deductionMonth: 'اکتوبر 2026' } };

describe('letter fines', () => {
  it('keeps the amount, selected month, reference and cause', () => {
    expect(letterFine(letter)).toMatchObject({ amount: 200, month: 10, year: 2026, reason: 'DISCIPLINARY_FINE', fineReason: 'NO_UNIFORM',
      description: 'Letter fine [l1] 12/YCDO/2026 — UNIFORM' });
    expect(letterFine({ ...letter, variables: { fineAmount: 'Rs. 1,250.50', deductionMonth: 'November 2026', fineReason: 'Custom fine' } }))
      .toMatchObject({ amount: 1250.5, month: 11, year: 2026, fineReason: null });
    expect(letterFine({ ...letter, letterType: 'EXPLANATION_FINE', variables: { payrollFineAmount: '500', payrollFineMonth: '2026-12' } }))
      .toMatchObject({ amount: 500, month: 12, year: 2026 });
  });
  it.each([
    { disciplineCategory: 'EARLY_CHECKOUT', fineAmount: '1000' },
    { disciplineCategory: 'MISSING_CHECKOUT', fineAmount: '1000' },
    { inquiryId: 'case', fineAmount: '1000' },
    { finePreset: 'ABSENT', fineAmount: '1000' },
    { finePreset: 'LATE_DEDUCTION', fineAmount: '1000' },
    { reversed: true, fineAmount: '500' },
    // Attendance-generated fine (missing checkout / late): owned by the attendance Card.
    { fineAmount: 'Rs. 1774.19', deductionMonth: 'August 2026', incidentDate: '2026-08-16', fineReason: 'checkout' },
    // Older attendance letter without incidentDate.
    { fineAmount: 'Rs. 2580.65', deductionMonth: 'August 2026', fineReason: 'اس ماہ چیک آؤٹ نہ کرنے کی 9 ویں خلاف ورزی کی بنا پر یک روزہ تنخواہ کی کٹوتی۔' },
    { fineAmount: '-1' }, { fineAmount: 'NaN' }, { fineAmount: '0' },
    { fineAmount: '9999999999' }, { fineAmount: '500', deductionMonth: 'unknown month' },
  ])('does not create invalid or duplicate policy charges: %j', variables => {
    expect(letterFine({ ...letter, variables })).toBeNull();
  });
  function db(entries: any[] = [{ id: 'p', status: 'PENDING' }]) {
    let deduction: any = null;
    const tx: any = { $queryRaw: jest.fn(), payrollEntry: { findMany: jest.fn(async () => entries), update: jest.fn() },
      payrollDeduction: { findFirst: jest.fn(async () => deduction), create: jest.fn(async ({ data }) => (deduction = data)) } };
    return tx;
  }
  it('charges a sent letter once even on retry', async () => {
    const tx = db();
    await applyLetterFine(tx, letter); await applyLetterFine(tx, letter);
    expect(tx.payrollDeduction.create).toHaveBeenCalledTimes(1);
    expect(tx.payrollDeduction.create.mock.calls[0][0].data).toMatchObject({ reason: 'DISCIPLINARY_FINE', fineReason: 'NO_UNIFORM' });
    expect(tx.payrollEntry.update).toHaveBeenCalledWith({ where: { id: 'p' }, data: {
      totalDeductions: { increment: 200 }, netStipend: { decrement: 200 },
    } });
  });
  it.each(['VERIFIED', 'PROCESSED', 'PAID'])('Req 18: a %s fine month moves the fine to the next open month', async status => {
    const tx = db();
    tx.payrollEntry.findMany = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'p10', status, month: 10, year: 2026 }])
      .mockResolvedValueOnce([{ id: 'p11', status: 'PENDING', month: 11, year: 2026 }]);
    await applyLetterFine(tx, letter);
    expect(tx.payrollDeduction.create.mock.calls[0][0].data).toMatchObject({
      payrollEntryId: 'p11',
      description: expect.stringContaining('(fine for 10/2026)'),
    });
  });
  it('rejects a fine with no usable numeric amount instead of issuing it without a deduction', async () => {
    const tx = db();
    await expect(applyLetterFine(tx, { ...letter, variables: { fineAmount: 'salary deduction' } })).rejects.toThrow('numeric');
    expect(tx.payrollDeduction.create).not.toHaveBeenCalled();
  });
  it('retains the letter as the source when payroll does not exist yet', async () => {
    const tx = db([]); await applyLetterFine(tx, letter);
    expect(tx.payrollDeduction.create).not.toHaveBeenCalled();
  });
});

it('custom content preserves lines and escapes HTML', () => {
  const html = renderLetterHtml(CUSTOM_LETTER_TEMPLATE.bodyHtml, {
    subject: 'Custom subject', letterBody: 'First line\n<script>alert(1)</script>',
  });
  expect(html).toContain('Custom subject');
  expect(html).toContain('First line\n&lt;script&gt;');
  expect(html).not.toContain('<script>');
});
