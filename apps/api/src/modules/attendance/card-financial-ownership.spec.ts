import { applyDisciplineDeductionOnLetterSend } from './discipline.helper';
jest.mock('../letters/pdf.helper',()=>({generatePdf:jest.fn()}));
describe('Card ownership preserves letters without a second attendance charge',()=>{
  it.each(['LATE','MISSING_CHECKOUT'])('sending %s letter cannot independently change salary',async category=>{
    const tx:any={stipendRecord:{findFirst:jest.fn(async()=>({id:'s',basicStipend:31000}))},$queryRaw:jest.fn(),payrollEntry:{findUnique:jest.fn(async()=>({id:'p',status:'PENDING'})),update:jest.fn()},payrollDeduction:{findFirst:jest.fn(async()=>null),create:jest.fn()}};
    await applyDisciplineDeductionOnLetterSend(tx,{employeeId:'e',letterType:'FINE',variables:{disciplineCategory:category,incidentDate:'2026-08-15',monthlyLateOccurrence:3,monthlyMissingCheckoutOccurrence:3}});
    expect(tx.payrollDeduction.create).not.toHaveBeenCalled();expect(tx.payrollEntry.update).not.toHaveBeenCalled();
  });
});
