import { PayrollService } from './payroll.service';
import { loadAttendanceCard } from '../attendance/attendance-card.util';
jest.mock('../attendance/attendance-card.util', () => ({ loadAttendanceCard: jest.fn() }));
jest.mock('../attendance/discipline.helper', () => ({ repairLateDisciplineForPayrollMonth: jest.fn() }));
const card = { calendarDays: 31, present: 27, absent: 1, uninformedAbsent: 0, late: 3, halfDay: 0, shortLeave: 0, onLeave: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, holiday: 0, swapCovered: 0, unmarked: 0, additionalWorkingDays: 1, overtimeHours: 8, missingDates: [], days: [], paidLeaveDateKeys: [], risks: [] };
function setup(status = 'PENDING') {
  let deductions = [{id:'old', reason:'UNINFORMED_ABSENCE',description:'Absent without approved leave (2 days stipend)',amount:2000}, {id:'fine', reason:'DISCIPLINARY_FINE',description:'Inquiry fine — case',amount:100}];
  let allowances = [{id:'old-ot',type:'OVERTIME',amount:9999}];
  let entry: any = {id:'entry',status,basicStipend:31000,totalDeductions:2100,totalAllowances:9999,netStipend:38899};
  const view = () => ({...entry,deductions,allowances});
  const prisma:any = {
    payrollEntry: {findFirst:jest.fn(async()=>null),findUnique:jest.fn(async()=>view()),findUniqueOrThrow:jest.fn(async()=>view()),update:jest.fn(async({data})=>{entry={...entry,...data};return view();})},
    payrollDeduction:{deleteMany:jest.fn(async({where})=>{deductions=deductions.filter(d=>!where.id.in.includes(d.id));}),create:jest.fn(async({data})=>{const row={id:'d'+deductions.length,...data};deductions.push(row);return row;})},
    allowance:{deleteMany:jest.fn(async({where})=>{allowances=allowances.filter(a=>!where.id.in.includes(a.id));}),create:jest.fn(async({data})=>{const row={id:'a'+allowances.length,...data};allowances.push(row);return row;})},
  };
  const svc:any=new PayrollService(prisma,{} as any);
  const run=()=>svc.upsertPayrollEntryForStipendSegment({id:'sr',basicStipend:31000,effectiveFrom:new Date('2026-08-01'),effectiveTo:null},{employeeId:'e',month:8,year:2026},{dutyTotalHours:8},undefined,[],true);
  return {run,prisma,view};
}
describe('Card is the only attendance financial owner',()=>{
  beforeEach(()=>jest.mocked(loadAttendanceCard).mockResolvedValue(card as any));
  it.each([null,new Date('2026-09-01')])('monthly preview uses the package-bearing record when requested through a closed segment (%s)',async effectiveTo=>{
    const employee={fullName:'Employee',employeeCode:'E',dutyTotalHours:8};
    const old={id:'old',employeeId:'e',basicStipend:20000,effectiveFrom:new Date('2026-08-01'),effectiveTo:new Date('2026-08-15'),employee};
    const latest={...old,id:'latest',basicStipend:31000,effectiveFrom:new Date('2026-08-15'),effectiveTo};
    const entry=(id,stipendRecord,basicStipend)=>({id,stipendRecordId:stipendRecord.id,stipendRecord,month:8,year:2026,status:'PROCESSED',basicStipend,totalAllowances:0,totalDeductions:0,netStipend:basicStipend,deductions:[],allowances:[]});
    const requested=entry('p-old',old,0), owner=entry('p-latest',latest,31000);
    const svc:any=new PayrollService({payrollEntry:{findUnique:jest.fn(async()=>requested),findMany:jest.fn(async()=>[requested,owner])}} as any,{} as any);
    svc.computeHourlyBreakdown=jest.fn(async()=>({}));svc.buildPayslipSlipData=jest.fn(()=>({}));svc.attachPayrollAttendanceReport=jest.fn(async rows=>rows);
    await svc.getEntryWithAllowances('p-old');
    expect(svc.computeHourlyBreakdown).toHaveBeenCalledWith('e',8,2026,expect.objectContaining({applyContractualPackage:true,stipendRecord:expect.objectContaining({id:'latest'})}));
    expect(svc.buildPayslipSlipData).toHaveBeenCalledWith(expect.objectContaining({stipendRecord:expect.objectContaining({id:'latest'}),entry:expect.objectContaining({netStipend:31000})}));
  });
  it('preserves package additions, employment proration and fixed deductions once',async()=>{
    const svc:any=new PayrollService({} as any,{} as any);
    const context={attendanceCard:card,stipendRecord:{basicStipend:31000,allowances:3100,reward:310,progressReward:310,fuelAllowance:310,loanDeduction:100,advanceDeduction:200,fineDeduction:300,healthDeduction:400,effectiveFrom:new Date('2026-08-20'),effectiveTo:null},employee:{dutyTotalHours:8,joiningDate:new Date('2026-08-16')},existingDeductions:[],existingAllowances:[{type:'OTHER',amount:50}],applyContractualPackage:true};
    const owner=await svc.computeHourlyBreakdown('e',8,2026,context);
    expect(owner.fixedAllowances).toBe(2080); // 4030 x 16/31, independent of package start.
    expect(owner.fixedPackageDeductions).toBe(1000);
    expect(owner.extraAllowances).toBe(2050);
    const closed=await svc.computeHourlyBreakdown('e',8,2026,{...context,applyContractualPackage:false});
    expect(closed.payrollBasicStipend).toBe(0); expect(closed.fixedAllowances).toBe(0); expect(closed.fixedPackageDeductions).toBe(0); expect(closed.extraAllowances).toBe(50);
  });
  it('replaces legacy attendance amounts once, preserves fixed manual fine, and is repeatable',async()=>{
    const {run,view}=setup(); await run(); const a=view();
    // 30 paid days - 1 extra absence DR - 1 late DR + AWD + 8 OT hours - manual fine.
    expect(a.netStipend).toBe(29900);
    expect(a.deductions.find(d=>d.id==='fine')).toBeDefined();
    expect(a.deductions).toHaveLength(3);
    expect(a.allowances).toHaveLength(2);
    await run(); expect(view().netStipend).toBe(29900); expect(view().deductions).toHaveLength(3); expect(view().allowances).toHaveLength(2);
  });
  it.each(['PAID','PROCESSED'])('does not rewrite %s',async status=>{const {run,prisma}=setup(status);await run();expect(prisma.payrollEntry.update).not.toHaveBeenCalled();});
  it('rejects recomputation alongside a frozen sibling before financial writes',async()=>{
    const {run,prisma}=setup(); prisma.payrollEntry.findFirst.mockResolvedValue({id:'frozen',status:'PAID'});
    await expect(run()).rejects.toThrow('FROZEN_PAYROLL_SEGMENT'); expect(prisma.payrollDeduction.deleteMany).not.toHaveBeenCalled();
  });
  it('refuses unresolved historical dates before changing any money',async()=>{jest.mocked(loadAttendanceCard).mockResolvedValue({...card,missingDates:['2026-08-05']} as any);const {run,prisma}=setup();await expect(run()).rejects.toThrow('INCOMPLETE_ATTENDANCE_CARD');expect(prisma.payrollDeduction.deleteMany).not.toHaveBeenCalled();});
});
