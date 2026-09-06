jest.mock('./pdf.helper', () => ({}));
jest.mock('../attendance/discipline.helper', () => ({
  ...jest.requireActual('../attendance/discipline.helper'),
  reverseAbsenceDeductionForDate: jest.fn(),
}));
import { reverseAbsenceDeductionForDate } from '../attendance/discipline.helper';
import { LettersService } from './letters.service';

it('generic fine reversal excludes Card aggregates even without discipline metadata', async () => {
  const tx: any = { $queryRaw: jest.fn(), payrollDeduction: {
    findMany: jest.fn(async ({where}) => {
      expect(where.OR).toEqual([{description:null},{NOT:{description:{startsWith:'Attendance Card:'}}}]);
      return [];
    }), delete: jest.fn(),
  }, payrollEntry: {update: jest.fn()} };
  const service: any = Object.create(LettersService.prototype);
  await service.tryUnwindFineDeduction(tx, {employeeId:'e',letterType:'FINE',variables:{},generatedAt:new Date('2026-08-20')});
  expect(tx.payrollDeduction.findMany).toHaveBeenCalledTimes(1);
  expect(tx.payrollDeduction.delete).not.toHaveBeenCalled();
  expect(tx.payrollEntry.update).not.toHaveBeenCalled();
});

it('reports only the committed absence reversal result after a transaction retry', async () => {
  jest.mocked(reverseAbsenceDeductionForDate)
    .mockResolvedValueOnce({ deductionReversed: true } as never)
    .mockResolvedValueOnce({ deductionReversed: false, blockedByPayrollStatus: false } as never);
  const letter = { id: 'letter-1', employeeId: 'e', status: 'SENT',
    letterType: 'EXPLANATION', variables: { incidentDate: '2026-08-20' } };
  const tx = {
    $queryRaw: jest.fn(),
    letter: { update: jest.fn().mockResolvedValue(letter) },
    disciplineEvent: { deleteMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  let attempt = 0;
  const service: any = Object.create(LettersService.prototype);
  service.findOne = jest.fn().mockResolvedValue(letter);
  service.prisma = { $transaction: jest.fn(async (work) => {
    const result = await work(tx);
    if (attempt++ === 0) throw { code: 'P2034' };
    return result;
  }) };

  const result = await service.reverseLetter('letter-1', { reason: 'Correction' }, 'manager-1');

  expect(service.prisma.$transaction).toHaveBeenCalledTimes(2);
  expect(result).toEqual(expect.objectContaining({
    fineUndone: false, fineSkippedReason: null, message: 'Letter reversed',
  }));
  expect(tx.auditLog.create).toHaveBeenLastCalledWith(expect.objectContaining({
    data: expect.objectContaining({ changes: {
      reason: 'Correction', fineUndone: false, fineSkippedReason: null,
    } }),
  }));
});

it('retains reversal of an unrelated manual fine with a null description', async () => {
  const tx:any = {$queryRaw:jest.fn(),payrollDeduction:{findMany:jest.fn(async ({where})=>{
    // SQL NOT LIKE alone excludes NULL; the explicit nullable branch must survive.
    if (!where.OR?.some(clause => clause.description === null)) return [];
    return [{id:'manual',amount:100,description:null,payrollEntry:{id:'p',status:'PENDING'}}];
  }),delete:jest.fn()},payrollEntry:{update:jest.fn()}};
  const service:any=Object.create(LettersService.prototype);
  expect(await service.tryUnwindFineDeduction(tx,{employeeId:'e',letterType:'FINE',variables:{},generatedAt:new Date('2026-08-20')})).toEqual({undone:true,skippedReason:null});
  expect(tx.payrollDeduction.delete).toHaveBeenCalledWith({where:{id:'manual'}});
  expect(tx.payrollEntry.update).toHaveBeenCalledWith({where:{id:'p'},data:{totalDeductions:{decrement:100},netStipend:{increment:100}}});
});
