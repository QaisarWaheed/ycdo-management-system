import { PayrollService } from './payroll.service';
jest.mock('../attendance/discipline.helper', () => ({}));
const components = ['allowances','fuelAllowance','reward','progressReward','loanDeduction','advanceDeduction','fineDeduction','healthDeduction'];
function setup(overrides: any = {}, history?: any[]) {
  const active = { id:'active', employeeId:'e', basicStipend:30000, effectiveFrom:new Date('2026-08-01'), effectiveTo:null, ...Object.fromEntries(components.map((k,i)=>[k,100*(i+1)])), ...overrides };
  const records = history ?? [active];
  const db: any = {
    employee:{findUnique:jest.fn(async()=>({id:'e',stipendRecords:records.filter(r=>r.effectiveTo===null)}))},
    stipendRecord:{findMany:jest.fn(async()=>records),updateMany:jest.fn(),update:jest.fn(async({data})=>({...active,...data})),create:jest.fn(async({data})=>({id:'new',...data}))},
    payrollEntry:{updateMany:jest.fn(),findMany:jest.fn(async()=>[])},auditLog:{create:jest.fn()},notification:{create:jest.fn()},
    $transaction:async fn=>fn(db),
  };
  const service:any=new PayrollService(db,{} as any); service.transactionBound=true;
  return {service,db,active};
}
describe('stipend package integrity',()=>{
  it.each(['updateActiveStipend','salaryIncrement'])('%s preserves every omitted component',async method=>{
    const {service,db,active}=setup();
    const result=await service[method]({employeeId:'e',basicStipend:31000,effectiveFrom: method==='salaryIncrement'?'2026-09-01':undefined,reason:'test'},'hr');
    for(const key of components) expect(result[key]).toBe(active[key]);
    expect(result.lumpsumTotal).toBe(31000+100+200+300+400-500-600-700-800);
    expect(db.auditLog.create).toHaveBeenCalled();
  });
  it.each(components.flatMap(field=>['updateActiveStipend','salaryIncrement'].map(method=>({field,method}))))('$method honors explicit zero for $field and preserves the rest',async({field,method})=>{
    const {service,active}=setup();const result=await service[method]({employeeId:'e',basicStipend:30000,[field]:0,effectiveFrom:method==='salaryIncrement'?'2026-09-01':undefined,reason:'test'},'hr');
    for(const key of components) expect(result[key]).toBe(key===field?0:active[key]);
  });
  it.each(['updateActiveStipend','salaryIncrement'])('%s refuses multiple open packages',async method=>{
    const a={id:'a',effectiveFrom:new Date('2026-01-01'),effectiveTo:null,basicStipend:30000};
    const {service,db}=setup({},[a,{...a,id:'b'}]);
    await expect(service[method]({employeeId:'e',basicStipend:30000,effectiveFrom:'2026-09-01',reason:'test'},'hr')).rejects.toThrow(/multiple open/i);
    expect(db.stipendRecord.update).not.toHaveBeenCalled();expect(db.stipendRecord.create).not.toHaveBeenCalled();
  });
  it('rejects an increment that would close the current package before its start',async()=>{
    const {service,db}=setup();
    await expect(service.salaryIncrement({employeeId:'e',basicStipend:31000,effectiveFrom:'2026-07-01',reason:'test'},'hr')).rejects.toThrow(/timeline/i);
    expect(db.stipendRecord.update).not.toHaveBeenCalled();expect(db.stipendRecord.create).not.toHaveBeenCalled();
  });
  it('rejects a date correction that reverses the preceding package',async()=>{
    const active={id:'active',basicStipend:30000,effectiveFrom:new Date('2026-08-28'),effectiveTo:null};
    const prior={id:'prior',basicStipend:30000,effectiveFrom:new Date('2026-08-12'),effectiveTo:new Date('2026-08-28')};
    const {service,db}=setup({},[prior,active]);
    await expect(service.updateActiveStipend({employeeId:'e',basicStipend:30000,effectiveFrom:'2026-08-01'},'hr')).rejects.toThrow(/timeline/i);
    expect(db.stipendRecord.updateMany).not.toHaveBeenCalled();expect(db.stipendRecord.update).not.toHaveBeenCalled();
  });
  it('rejects overlaps with a package outside the preceding seam',async()=>{
    const active={id:'active',basicStipend:30000,effectiveFrom:new Date('2026-09-01'),effectiveTo:null};
    const prior={id:'prior',basicStipend:30000,effectiveFrom:new Date('2026-07-01'),effectiveTo:new Date('2026-08-20')};
    const {service,db}=setup({},[prior,active]);
    await expect(service.updateActiveStipend({employeeId:'e',basicStipend:30000,effectiveFrom:'2026-08-01'},'hr')).rejects.toThrow(/overlap/i);
    expect(db.stipendRecord.updateMany).not.toHaveBeenCalled();
  });
  it('allows a valid preceding seam adjustment',async()=>{
    const active={id:'active',basicStipend:30000,effectiveFrom:new Date('2026-08-28'),effectiveTo:null};
    const prior={id:'prior',basicStipend:30000,effectiveFrom:new Date('2026-01-01'),effectiveTo:new Date('2026-08-28')};
    const {service,db}=setup({},[prior,active]);
    await service.updateActiveStipend({employeeId:'e',basicStipend:30000,effectiveFrom:'2026-08-01'},'hr');
    expect(db.stipendRecord.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:{effectiveTo:new Date('2026-08-01')}}));
  });
});
