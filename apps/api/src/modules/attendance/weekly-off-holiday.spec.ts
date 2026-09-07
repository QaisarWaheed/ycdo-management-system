jest.mock('../letters/pdf.helper',()=>({}));
jest.mock('../letters/letters.service',()=>({LettersService:class {}}));
import { ShiftAbsentScheduler } from './shift-absent.scheduler';
import { AttendanceService } from './attendance.service';
import { loadAttendanceCard } from './attendance-card.util';
jest.mock('./discipline.helper',()=>({}));
function fixture() {
  const employee:any={id:'e',status:'ACTIVE',joiningDate:new Date('2020-01-01'),currentBranchId:'b',weeklyOffWeekdays:[0],dutyStartTime:'09:00',dutyEndTime:'17:00',relieverOnly:false,monthlyAllowedLeaves:2};
  const rows:any[]=[];
  const db:any={
    employee:{findMany:jest.fn(async()=>[employee]),findUnique:jest.fn(async()=>employee)},
    attendanceLog:{
      createMany:jest.fn(async({data})=>{let count=0;for(const row of Array.isArray(data)?data:[data])if(!rows.some(r=>r.employeeId===row.employeeId&&+r.date===+row.date&&r.type===row.type)){rows.push({...row});count++;}return {count};}),
      findUnique:jest.fn(async({where})=>rows.find(r=>+r.date===+where.employeeId_date_type.date)||null),
      findMany:jest.fn(async()=>rows),
    },
    additionalWorkingDay:{findMany:jest.fn(async()=>[])},
    leaveRecord:{findMany:jest.fn(async()=>[])},
  };
  const scheduler:any=new ShiftAbsentScheduler(db,{} as any);
  scheduler.normalizeLegacyAutoMarkedAbsent=jest.fn();
  return {db,employee,rows,scheduler};
}
describe('Weekly Off final attendance materialization',()=>{
  beforeEach(()=>{jest.useFakeTimers();jest.setSystemTime(new Date('2026-08-30T12:00:00Z'));});
  afterEach(()=>jest.useRealTimers());
  it('scheduler creates Sunday HOLIDAY and reconciles only elapsed current-month Sundays, idempotently',async()=>{
    const {scheduler,rows,db}=fixture();
    await scheduler.markShiftStartAbsent();await scheduler.markShiftStartAbsent();
    expect(rows.map(r=>r.date.toISOString().slice(0,10))).toEqual(['2026-08-02','2026-08-09','2026-08-16','2026-08-23','2026-08-30']);
    expect(rows.every(r=>r.status==='HOLIDAY'&&r.type==='REGULAR')).toBe(true);
    expect(db.attendanceLog.createMany).toHaveBeenCalledWith(expect.objectContaining({skipDuplicates:true}));
  });
  it('Card counts stored Holidays and has no missing Weekly Off dates',async()=>{
    const {scheduler,rows,db}=fixture();
    for(let day=1;day<=31;day++){const date=new Date(Date.UTC(2026,7,day));if(date.getUTCDay()!==0)rows.push({employeeId:'e',date,type:'REGULAR',status:'PRESENT',overtimeMinutes:0});}
    await scheduler.markShiftStartAbsent();
    const card=await loadAttendanceCard(db,'e',8,2026);
    expect(card.holiday).toBe(5);expect(card.missingDates).toEqual([]);
  });
  it('day-list materialization creates HOLIDAY before duty starts',async()=>{
    const {db,rows}=fixture();
    const service:any=Object.assign(Object.create(AttendanceService.prototype),{prisma:db,purgePrematureUnmarkedForDate:jest.fn()});
    await service.ensureUnmarkedForActiveShiftsOnDate(new Date('2026-08-30'));
    expect(rows).toHaveLength(1);expect(rows[0].status).toBe('HOLIDAY');
  });
  it('does not replace existing final rows or punch evidence',async()=>{
    const {scheduler,rows}=fixture();
    const row={employeeId:'e',date:new Date('2026-08-30'),type:'REGULAR',status:'HOLIDAY',checkIn:new Date('2026-08-30T04:00Z'),checkOut:new Date('2026-08-30T12:00Z')};
    rows.push(row);await scheduler.markShiftStartAbsent();expect(rows.find(r=>+r.date===+row.date)).toEqual(row);
    expect(rows.filter(r=>+r.date===+row.date)).toHaveLength(1);
  });
  it('does not create pre-joining or future/previous-month Holidays',async()=>{
    const {scheduler,employee,rows}=fixture();employee.joiningDate=new Date('2026-08-20');
    await scheduler.markShiftStartAbsent();
    expect(rows.map(r=>r.date.toISOString().slice(0,10))).toEqual(['2026-08-23','2026-08-30']);
  });
  it('normal working-day shift start remains UNMARKED',async()=>{
    jest.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    const {scheduler,rows}=fixture();await scheduler.markShiftStartAbsent();
    expect(rows.find(r=>r.date.getUTCDate()===31)?.status).toBe('UNMARKED');
  });
});

describe('Weekly Off reconciliation boundaries',()=>{
  beforeEach(()=>{jest.useFakeTimers();jest.setSystemTime(new Date('2026-08-30T12:00:00Z'));});
  afterEach(()=>jest.useRealTimers());
  it('concurrent scheduler runs retain one regular row per date',async()=>{
    const {scheduler,rows}=fixture();
    await Promise.all([scheduler.markShiftStartAbsent(),scheduler.markShiftStartAbsent()]);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map(r=>+r.date)).size).toBe(5);
  });
  it.each([24,null])('creates Weekly Off Holiday with duty hours %s and no shift clock',async hours=>{
    const {scheduler,employee,rows}=fixture();employee.dutyStartTime=null;employee.dutyEndTime=null;employee.dutyTotalHours=hours;
    await scheduler.markShiftStartAbsent();expect(rows).toHaveLength(5);expect(rows.every(r=>r.status==='HOLIDAY')).toBe(true);
  });
  it('viewing a previous month does not backfill Weekly Off dates',async()=>{
    const {db,rows}=fixture();
    const service:any=Object.assign(Object.create(AttendanceService.prototype),{prisma:db});
    await service.ensureUnmarkedForActiveShiftsOnDate(new Date('2026-07-26'));
    expect(rows).toHaveLength(0);
  });
  it('does not overwrite an existing HR final status',async()=>{
    const {scheduler,rows}=fixture();
    rows.push({employeeId:'e',date:new Date('2026-08-30'),type:'REGULAR',status:'PRESENT'});
    await scheduler.markShiftStartAbsent();expect(rows.find(r=>r.date.getUTCDate()===30).status).toBe('PRESENT');
  });
});
