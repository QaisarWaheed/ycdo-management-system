import { LetterStatus } from '@prisma/client';
import { FineAuditService } from './fine-audit.service';

const emp = { fullName: 'A', employeeCode: 'C1' };
const fineLetter = (id: string, status: LetterStatus, amount = '200') => ({
  id,
  employeeId: 'e1',
  letterType: 'FINE',
  status,
  letterNo: `N-${id}`,
  generatedAt: new Date('2026-10-15T10:00:00Z'),
  variables: { fineAmount: amount, finePreset: 'UNIFORM', deductionMonth: '2026-10' },
  employee: emp,
});
const deduction = (id: string, letterId: string, amount: number) => ({
  id,
  amount,
  description: `Letter fine [${letterId}] x`,
  payrollEntry: { month: 10, year: 2026, status: 'PENDING', stipendRecord: { employeeId: 'e1', employee: emp } },
});

describe('Req 18 fine audit', () => {
  it('finds missing, reversed-but-deducted, orphan and wrong-amount fines', async () => {
    const prisma = {
      letter: {
        findMany: jest.fn().mockResolvedValue([
          fineLetter('ok', LetterStatus.SENT),
          fineLetter('missing', LetterStatus.SENT),
          fineLetter('rev', LetterStatus.REVERSED),
          fineLetter('wrong', LetterStatus.SENT, '500'),
        ]),
      },
      payrollDeduction: {
        findMany: jest.fn().mockResolvedValue([
          deduction('d-ok', 'ok', 200),
          deduction('d-rev', 'rev', 200),
          deduction('d-wrong', 'wrong', 200),
          deduction('d-orphan', 'deleted-letter', 300),
        ]),
      },
      payrollEntry: { count: jest.fn().mockResolvedValue(1) },
    };
    const { issues } = await new FineAuditService(prisma as never).audit();
    const kinds = issues.map((i) => `${i.kind}:${i.letterId}`).sort();
    expect(kinds).toEqual([
      'AMOUNT_MISMATCH:wrong',
      'MISSING_DEDUCTION:missing',
      'REVERSED_STILL_DEDUCTED:deleted-letter',
      'REVERSED_STILL_DEDUCTED:rev',
    ]);
  });
});
