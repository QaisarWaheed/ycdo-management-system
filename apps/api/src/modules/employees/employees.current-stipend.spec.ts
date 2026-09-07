import { EmployeesService } from './employees.service';
jest.mock('../letters/letters.service',()=>({LettersService:class {}}));
jest.mock('../face-sync/face-sync.service',()=>({FaceSyncService:class {}}));
describe('employee current package',()=>{
  it.each([true,false])('ignores the later closed package (open exists: %s)',async hasOpen=>{
    const closed={id:'closed',effectiveFrom:new Date('2026-08-12'),effectiveTo:new Date('2026-08-01'),fuelAllowance:5000};
    const open={id:'open',effectiveFrom:new Date('2026-08-01'),effectiveTo:null,fuelAllowance:0};
    const db={employee:{findUnique:jest.fn(async({include})=>({id:'e',stipendRecords:include.stipendRecords.where?.effectiveTo===null?(hasOpen?[open]:[]):[closed]}))}};
    const service:any=Object.assign(Object.create(EmployeesService.prototype),{prisma:db,filterEmployeeForRole:(e)=>e,faceSyncService:{getBiometricRegistrationSummary:async()=>null}});
    const result=await service.findOne('e');
    expect(result.stipendRecords).toEqual(hasOpen?[open]:[]);
  });
});
