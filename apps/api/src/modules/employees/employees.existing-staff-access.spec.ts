import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { EmployeesController } from './employees.controller';
import { PermissionsService } from '../permissions/permissions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@prisma/client';
import { EmployeesService } from './employees.service';
jest.mock('../letters/letters.service',()=>({LettersService:class {}}));
jest.mock('../face-sync/face-sync.service',()=>({FaceSyncService:class {}}));
jest.mock('./employee-code.helper',()=>({generateEmployeeCode:jest.fn(async()=>'E-1')}));

function setup() {
  let employee:any;
  const create=jest.fn(async({data})=>(employee={id:'e',...data}));
  const db:any={employee:{create,findUnique:jest.fn(async()=>employee)},user:{findUnique:jest.fn(async()=>null)},employmentHistory:{create:jest.fn()},stipendRecord:{create:jest.fn()},auditLog:{create:jest.fn()}};
  db.$transaction=async fn=>fn(db);
  const service:any=Object.assign(Object.create(EmployeesService.prototype),{prisma:db,lettersService:{generateSystemLetter:jest.fn()},validateCreateDto:jest.fn(),ensureBranchExists:jest.fn(),ensureDepartmentExists:jest.fn(),createUserForEmployee:jest.fn(),autoAssignBiometricId:jest.fn()});
  return {service,create};
}
const dto=(staffType:any)=>({staffType,fullName:'Test',joiningDate:'2026-08-01',dateOfBirth:'2000-01-01',basicStipend:10000,currentDesignation:'Staff'});
describe('Existing Staff authorization',()=>{
  it.each(Object.values(UserRole).filter(role=>role!==UserRole.SUPER_ADMIN))('%s cannot create Existing Staff even with employee-create access',async role=>{
    const {service,create}=setup();
    await expect(service.create(dto('EXISTING'),{id:'u',role})).rejects.toMatchObject({status:403});
    expect(create).not.toHaveBeenCalled();
    expect(service.validateCreateDto).not.toHaveBeenCalled();
  });
  it('rejects a missing actor',async()=>{
    const {service,create}=setup();
    await expect(service.create(dto('EXISTING'))).rejects.toMatchObject({status:403});
    expect(create).not.toHaveBeenCalled();
  });
  it.each([{role:UserRole.SUPER_ADMIN},{role:UserRole.HR_EXECUTIVE,roles:[UserRole.HR_EXECUTIVE,UserRole.SUPER_ADMIN]}])('Super Admin creates Existing Staff (%j)',async actor=>{
    const {service,create}=setup();
    expect((await service.create(dto('EXISTING'),{id:'u',...actor})).staffType).toBe('EXISTING');
    expect(create).toHaveBeenCalledTimes(1);
  });
  it.each(['NEW','INTERNEE',undefined])('HR Executive still creates %s',async staffType=>{
    const {service,create}=setup();
    expect((await service.create(dto(staffType),{id:'u',role:UserRole.HR_EXECUTIVE})).staffType).toBe(staffType??'NEW');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('POST /employees Existing Staff authorization',()=>{
  it.each([
    {role:UserRole.HR_EXECUTIVE,staffType:'EXISTING',status:403},
    {role:UserRole.SUPER_ADMIN,staffType:'EXISTING',status:201},
    {role:UserRole.HR_EXECUTIVE,staffType:'NEW',status:201},
    {role:UserRole.HR_EXECUTIVE,staffType:'INTERNEE',status:201},
  ])('$role + $staffType returns HTTP $status',async({role,staffType,status})=>{
    const {service,create}=setup();
    const permissions:any={userHasPermission:jest.fn(async()=>true),getUserEffectiveRoles:jest.fn(async()=>[role])};
    const module=await Test.createTestingModule({controllers:[EmployeesController],providers:[
      {provide:EmployeesService,useValue:service},{provide:PermissionsService,useValue:permissions}
    ]}).overrideGuard(JwtAuthGuard).useValue({canActivate(ctx){ctx.switchToHttp().getRequest().user={id:'u',role};return true;}})
      .overrideGuard(RolesGuard).useValue(new RolesGuard(new Reflector(),permissions,{} as any)).compile();
    const app=module.createNestApplication();
    await app.init();
    try {
      const response=await request(app.getHttpServer()).post('/employees').send(dto(staffType)).expect(status);
      if(status===403){expect(response.body.message).toBe('Only Super Admin can add Existing Staff');expect(create).not.toHaveBeenCalled();}
      else {expect(response.body.staffType).toBe(staffType);expect(create).toHaveBeenCalledTimes(1);}
    } finally { await app.close(); }
  });
});
