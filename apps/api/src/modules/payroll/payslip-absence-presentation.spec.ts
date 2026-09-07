import { PayrollService } from './payroll.service';
import { loadAttendanceCard } from '../attendance/attendance-card.util';
import { calculateCardSalary, CARD_ABSENCE_DESCRIPTION } from './attendance-card-salary.util';
jest.mock('../attendance/attendance-card.util', () => ({ loadAttendanceCard: jest.fn() }));
jest.mock('../attendance/discipline.helper', () => ({}));

describe('payslip Card absence presentation', () => {
  it.each([
    { absent: 1, ua: 0, basic: 31000, expected: [['ABSENCE', 1000]] },
    { absent: 0, ua: 1, basic: 31000, expected: [['UNINFORMED ABSENCE', 1000]] },
    { absent: 1, ua: 2, basic: 31000, expected: [['ABSENCE', 1000], ['UNINFORMED ABSENCE', 2000]] },
    { absent: 1, ua: 2, basic: 30000, expected: [['ABSENCE', 967.74], ['UNINFORMED ABSENCE', 1935.49]] },
  ])('Absent=$absent, UA=$ua, Basic=$basic preserves settled pay', async ({absent,ua,basic,expected}) => {
    const card = {calendarDays:31,present:31-absent-ua,absent,uninformedAbsent:ua,late:0,halfDay:0,shortLeave:0,holiday:0,swapCovered:0,onLeave:0,paidLeaveDays:0,unpaidLeaveDays:0,unmarked:0,additionalWorkingDays:0,overtimeHours:0,missingDates:[],days:[],paidLeaveDateKeys:[],risks:[]};
    jest.mocked(loadAttendanceCard).mockResolvedValue(card as any);
    const salary = calculateCardSalary(card,basic,8);
    const employee = {id:'e',fullName:'Example',employeeCode:'E',dutyTotalHours:8};
    const pkg = {id:'s',employeeId:'e',basicStipend:basic,effectiveFrom:new Date('2026-08-01'),effectiveTo:null,employee};
    const entry = {id:'p',stipendRecordId:'s',stipendRecord:pkg,month:8,year:2026,status:'PROCESSED',basicStipend:salary.earnedBasic,totalAllowances:0,totalDeductions:salary.absencePenalty,netStipend:salary.attendanceSalary,allowances:[],deductions:[{reason:'UNINFORMED_ABSENCE',description:CARD_ABSENCE_DESCRIPTION,amount:salary.absencePenalty}]};
    const original = JSON.stringify(entry);
    const db:any = {payrollEntry:{findUnique:jest.fn(async()=>entry),findMany:jest.fn(async()=>[entry]),update:jest.fn()}};
    const service:any = new PayrollService(db,{} as any);
    service.computeHourlyBreakdown=jest.fn(async()=>({}));
    service.attachPayrollAttendanceReport=jest.fn(async rows=>rows);
    const {slip}=await service.getEntryWithAllowances('p');
    expect(slip.deductionItems.map(d=>[d.reason,d.amount])).toEqual(expected);
    for(const item of slip.deductionItems) expect(item.description).toMatch(/additional absence penalty.*unpaid.*earned stipend/i);
    expect(slip.deductionItems.reduce((sum,d)=>sum+d.amount,0)).toBeCloseTo(salary.absencePenalty,2);
    expect(slip.deductionsTotal).toBe(salary.absencePenalty);
    expect(slip.netPay).toBe(salary.attendanceSalary);
    expect(slip.totalAmount).toBe(salary.attendanceSalary);
    expect(slip.earnings.stipend).toBe(salary.earnedBasic);
    expect(JSON.stringify(entry)).toBe(original);
    expect(db.payrollEntry.update).not.toHaveBeenCalled();
  });
});
