jest.mock('../letters/pdf.helper',()=>({}));
jest.mock('../letters/letters.service',()=>({LettersService:class {}}));
jest.mock('./discipline.helper',()=>({applyMissingCheckoutDiscipline:jest.fn(),reconcileAttendanceFinancialConsequences:jest.fn()}));
import { AttendanceService } from './attendance.service';
import { ShiftMissingCheckoutScheduler } from './shift-missing-checkout.scheduler';
import { applyMissingCheckoutDiscipline } from './discipline.helper';
import { summarizeAttendanceLogs } from './attendance-summary.util';
const day=new Date('2026-08-14');
const at=(time:string)=>new Date('2026-08-14T'+time+':00+05:00');
function fixture(overrides:any={}) {
 const employee:any={id:'e',status:'ACTIVE',dutyStartTime:'08:00',dutyEndTime:'20:00',dutyTotalHours:12,shift:null};
 let row:any={id:'r',employeeId:'e',date:day,type:'REGULAR',status:'PRESENT',lateMinutes:0,overtimeMinutes:0,checkIn:at('08:00'),checkOut:null,sessionClosedAt:null,dutyStartTimeSnapshot:'08:00',dutyEndTimeSnapshot:'20:00',...overrides};
 const db:any={attendanceLog:{findFirst:jest.fn(async()=>({...row})),findUnique:jest.fn(async()=>({...row})),findMany:jest.fn(async()=>row.checkOut?[]:[{...row,employee}]),update:jest.fn(async({data})=>(row={...row,...data})),updateMany:jest.fn(async({where,data})=>{if(row.checkOut!==null)return {count:0};row={...row,...data};return {count:1};})},$transaction:async fn=>fn(db)};
 const service:any=Object.assign(Object.create(AttendanceService.prototype),{prisma:db,isLateExemptForSwap:jest.fn(async()=>false),findOpenRegularLog:jest.fn(async()=>({...row}))});
 return {db,service,employee,get:()=>row};
}
describe('duty windows and saved Card overtime',()=>{
 it.each(['07:00','06:30','08:15','08:16'])('check-in %s preserves saved OT and existing grace',async time=>{
  const {service,employee,get}=fixture({checkIn:null,status:'UNMARKED',overtimeMinutes:120});
  await service.biometricRegularCheckIn(employee,'b',at(time),day,false);
  expect(get().status).toBe(time==='08:16'?'LATE':'PRESENT');
  expect(get().overtimeMinutes).toBe(120);
 });
 it.each([
  ['08:00','19:45',0,'PRESENT'],['08:00','19:30',30,'LATE'],
  ['08:35','19:30',50,'LATE'],['09:45','19:30',120,'LATE'],
  ['09:46','19:30',121,'HALF_DAY'],['06:30','21:00',0,'PRESENT'],
 ])('check-in %s checkout %s gives combined %s (%s)',async(checkIn,checkOut,minutes,status)=>{
  const {service,employee,get}=fixture({checkIn:at(String(checkIn)),overtimeMinutes:120});
  await service.biometricRegularCheckout(employee,'b',at(String(checkOut)),day,false);
  expect(get().lateMinutes).toBe(minutes);expect(get().status).toBe(status);
  expect(get().overtimeMinutes).toBe(120);
  expect(summarizeAttendanceLogs([get()]).overtimeMinutes).toBe(120);
 });
 it('zero saved OT stays zero despite early arrival and late checkout',async()=>{
  const {service,employee,get}=fixture({checkIn:at('06:30')});
  await service.biometricRegularCheckout(employee,'b',at('21:00'),day,false);
  expect(get().overtimeMinutes).toBe(0);
 });
 it.each(['PRESENT','LATE','HALF_DAY'])('missing checkout closes at duty end and preserves %s without a financial change',async status=>{
  jest.useFakeTimers();jest.setSystemTime(at('20:30'));
  try {
   jest.mocked(applyMissingCheckoutDiscipline).mockClear();
   const {db,get}=fixture({status,lateMinutes:status==='HALF_DAY'?121:status==='LATE'?20:0,overtimeMinutes:120});
   const payroll:any={recomputePendingPayrollForAttendanceDate:jest.fn()};
   const scheduler=new ShiftMissingCheckoutScheduler(db,payroll);
   await scheduler.flagMissingCheckouts();await scheduler.flagMissingCheckouts();
   expect(get().checkOut).toEqual(at('20:00'));expect(get().status).toBe(status);expect(get().overtimeMinutes).toBe(120);
   expect(applyMissingCheckoutDiscipline).toHaveBeenCalledTimes(1);
   expect(applyMissingCheckoutDiscipline).toHaveBeenCalledWith(expect.anything(),'e',day,expect.objectContaining({warningOnly:true}));
  } finally {jest.useRealTimers();}
 });
});

describe('checkout boundary and saved OT edge cases',()=>{
 it.each(['07:00','06:30'])('%s check-in does not generate OT when saved value is zero',async time=>{
  const {service,employee,get}=fixture({checkIn:null,status:'UNMARKED'});
  await service.biometricRegularCheckIn(employee,'b',at(time),day,false);
  expect(get().status).toBe('PRESENT');expect(get().overtimeMinutes).toBe(0);
 });
 it('waits until exactly the thirty-minute deadline',async()=>{
  jest.useFakeTimers();jest.setSystemTime(new Date(at('20:30').getTime()-1));
  try {const {db,get}=fixture();const scheduler=new ShiftMissingCheckoutScheduler(db,{} as any);
   await scheduler.flagMissingCheckouts();expect(get().checkOut).toBeNull();
   jest.setSystemTime(at('20:30'));await scheduler.flagMissingCheckouts();expect(get().checkOut).toEqual(at('20:00'));
  } finally {jest.useRealTimers();}
 });
  it('uses snapshotted overnight duty for early departure',async()=>{
  const {service,employee,get}=fixture({checkIn:at('20:00'),dutyStartTimeSnapshot:'20:00',dutyEndTimeSnapshot:'08:00'});
  await service.biometricRegularCheckout(employee,'b',new Date('2026-08-15T07:30:00+05:00'),day,false);
  expect(get().status).toBe('LATE');expect(get().lateMinutes).toBe(30);
 });
});

describe('overtime punch ownership',()=>{
 it('overtime checkout closes the session without deriving minutes from check-in and checkout',async()=>{
  let row:any={id:'ot',employeeId:'e',date:day,type:'OVERTIME',status:'PRESENT',checkIn:at('20:00'),checkOut:null,overtimeMinutes:0};
  const db:any={attendanceLog:{update:jest.fn(async({data})=>(row={...row,...data}))}};
  const service:any=Object.assign(Object.create(AttendanceService.prototype),{findOpenOvertimeLog:jest.fn(async()=>({...row}))});

  await service.biometricOvertimeCheckOut({id:'e'},at('22:00'),day,db);

  expect(row.checkOut).toEqual(at('22:00'));
  expect(row.overtimeMinutes).toBe(0);
 });
});
