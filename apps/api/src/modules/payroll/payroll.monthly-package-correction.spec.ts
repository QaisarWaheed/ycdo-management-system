import { PayrollService } from './payroll.service';
jest.mock('../attendance/discipline.helper',()=>({}));
const fields=['basicStipend','allowances','fuelAllowance','reward','progressReward','loanDeduction','advanceDeduction','fineDeduction','healthDeduction'];
function fixture(start='2026-07-01') {
  const original:any={id:'old',employeeId:'e',basicStipend:30000,...Object.fromEntries(fields.filter(k=>k!=='basicStipend').map(k=>[k,1000])),effectiveFrom:new Date(start),effectiveTo:null};
  const records=[original];
  const db:any={employee:{findUnique:jest.fn(async()=>({id:'e',status:'ACTIVE',stipendRecords:records.filter(r=>r.effectiveTo===null)}))},stipendRecord:{findMany:jest.fn(async()=>records),update:jest.fn(async({where,data})=>Object.assign(records.find(r=>r.id===where.id),data)),updateMany:jest.fn(),create:jest.fn(async({data})=>{const r={id:'new',effectiveTo:null,...data};records.push(r);return r;})},auditLog:{create:jest.fn()},payrollEntry:{updateMany:jest.fn(),findMany:jest.fn(async()=>[{month:7,year:2026},{month:8,year:2026}])},$transaction:async fn=>fn(db)};
  const service:any=new PayrollService(db,{} as any);service.transactionBound=true;
  service.createOrGetEntry=jest.fn(async()=>({})); service.recomputeEmployeeMonth=jest.fn(async()=>[]);
  return {service,db,records,original};
}
describe('undated package corrections preserve previous months',()=>{
  beforeEach(()=>{jest.useFakeTimers();jest.setSystemTime(new Date('2026-08-15T10:00:00Z'));});
  afterEach(()=>jest.useRealTimers());
  it.each(fields.flatMap(field=>[0,5000].filter(value=>field!=='basicStipend'||value>0).map(value=>({field,value}))))('versions $field=$value from August 1 and preserves July',async({field,value})=>{
    const {service,db,records,original}=fixture(); const previous={...original};
    const result=await service.updateActiveStipend({employeeId:'e',basicStipend:30000,[field]:value},'hr');
    expect(db.stipendRecord.create).toHaveBeenCalledTimes(1);
    expect(result.effectiveFrom).toEqual(new Date('2026-08-01'));
    expect(result[field]).toBe(value);
    for(const key of fields) expect(original[key]).toBe(previous[key]);
    expect(original.effectiveFrom).toEqual(previous.effectiveFrom);
    expect(original.effectiveTo).toEqual(new Date('2026-08-01'));
    expect(service.recomputeEmployeeMonth).toHaveBeenCalledWith(expect.objectContaining({employeeId:'e',month:8,year:2026}));
    expect(db.payrollEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:{stipendRecordId:'new'}}));
    expect(service.createOrGetEntry).not.toHaveBeenCalledWith(expect.objectContaining({month:7}));
    expect(service.recomputeEmployeeMonth).not.toHaveBeenCalledWith(expect.objectContaining({month:7}));
    await service.updateActiveStipend({employeeId:'e',basicStipend:30000,[field]:value},'hr');
    expect(records).toHaveLength(2);
  });
  it('does not pull a future open package into August on an undated edit',async()=>{
    const {service,db}=fixture('2026-09-01');
    await expect(service.updateActiveStipend({employeeId:'e',basicStipend:30000},'hr')).rejects.toThrow(/future/i);
    expect(db.stipendRecord.update).not.toHaveBeenCalled();expect(db.stipendRecord.create).not.toHaveBeenCalled();
  });
  it('uses the Pakistan current month at the UTC boundary',async()=>{
    jest.setSystemTime(new Date('2026-07-31T20:00:00Z'));
    const {service}=fixture();const result=await service.updateActiveStipend({employeeId:'e',basicStipend:30000},'hr');
    expect(result.effectiveFrom).toEqual(new Date('2026-08-01'));
  });
});
