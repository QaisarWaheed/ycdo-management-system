import { PartialType } from '@nestjs/mapped-types';
import {
  ChangeType,
  EmployeeApproverTarget,
  EmployeeStatus,
  Gender,
  MaritalStatus,
  ProjectType,
  StaffType,
  UserRole,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBooleanString,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isValidDutyTotalHours } from '../../common/duty.util';

@ValidatorConstraint({ name: 'dutyTotalHours', async: false })
class DutyTotalHoursConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (value === undefined || value === null || value === '') return true;
    return isValidDutyTotalHours(Number(value));
  }

  defaultMessage() {
    return 'Duty hours must be between 0.5 and 24 in half-hour steps (e.g. 6.5)';
  }
}

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @IsNotEmpty()
  fatherName: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5}-\d{7}-\d{1}$/, {
    message: 'CNIC format: 12345-1234567-1',
  })
  cnic?: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsDateString()
  @IsNotEmpty()
  dateOfBirth: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsString()
  @IsNotEmpty()
  currentAddress: string;

  @IsDateString()
  @IsNotEmpty()
  joiningDate: string;

  @IsUUID()
  @IsNotEmpty()
  currentBranchId: string;

  @IsUUID()
  @IsNotEmpty()
  currentDepartmentId: string;

  @IsString()
  @IsNotEmpty()
  currentDesignation: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsIn(['Morning', 'Evening', 'Night', '24 Hours'])
  shiftName?: string;

  @IsOptional()
  @IsString()
  fatherContactNumber?: string;

  @IsOptional()
  @IsIn(['ALIVE', 'DECEASED'])
  fatherStatus?: string;

  @IsOptional()
  @IsString()
  guardianContact?: string;

  @IsString()
  @IsNotEmpty()
  emergencyContactName: string;

  @IsOptional()
  @IsString()
  emergencyRelation?: string;

  @IsString()
  @IsNotEmpty()
  emergencyContactNumber: string;

  @IsOptional()
  @IsString()
  spouseName?: string;

  @IsOptional()
  @IsString()
  spouseContactNumber?: string;

  @IsOptional()
  @IsEnum(MaritalStatus)
  maritalStatus?: MaritalStatus;

  @IsOptional()
  @IsString()
  caste?: string;

  @IsOptional()
  @IsString()
  domicile?: string;

  @IsOptional()
  @IsString()
  permanentAddress?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  tehsil?: string;

  @IsOptional()
  @IsString()
  policeStation?: string;

  @IsString()
  @IsNotEmpty()
  bloodGroup: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  basicStipend: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  allowances?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  reward?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  progressReward?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fuelAllowance?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  loanDeduction?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  advanceDeduction?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fineDeduction?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  healthDeduction?: number;

  @IsOptional()
  @IsEnum(StaffType)
  staffType?: StaffType;

  /** Reliever-only: no regular duty; excluded from auto-absent. */
  @IsOptional()
  @IsBoolean()
  relieverOnly?: boolean;

  /** Paid weekly rest weekdays: 0=Sunday … 6=Saturday. Empty = no weekly off. */
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weeklyOffWeekdays?: number[];

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time format must be HH:MM' })
  dutyStartTime?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time format must be HH:MM' })
  dutyEndTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Validate(DutyTotalHoursConstraint)
  dutyTotalHours?: number;

  /** Monthly paid leave days; omit/null = unlimited paid leave. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(31)
  monthlyAllowedLeaves?: number | null;

  @IsString()
  @IsNotEmpty()
  province: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsOptional()
  @IsString()
  permanentProvince?: string;

  @IsOptional()
  @IsString()
  permanentCity?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ADMIN_MANAGER'])
  userRole?: string;

  @IsOptional()
  @IsEnum(EmployeeApproverTarget)
  approverTarget?: EmployeeApproverTarget;

  @IsOptional()
  formSnapshot?: Record<string, unknown>;
}

export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}

export class ToggleHideProfilePhotoDto {
  @IsBoolean()
  hide: boolean;
}

export class ManagerScopeInputDto {
  /** Seeded projects use slug ids (e.g. project-hospital), not UUIDs. */
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsUUID()
  departmentId: string;

  @IsOptional()
  @IsUUID()
  designationId?: string | null;
}

export class UpdateEmployeeRolesDto {
  @IsOptional()
  @IsEnum(UserRole)
  primaryRole?: UserRole;

  /** Kept optional for API compatibility; writes are ignored to preserve existing grants. */
  @IsOptional()
  @IsArray()
  @IsEnum(UserRole, { each: true })
  additionalRoles?: UserRole[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManagerScopeInputDto)
  managerScopes?: ManagerScopeInputDto[];
}

export class ChangeStatusDto {
  @IsEnum(EmployeeStatus)
  @IsNotEmpty()
  status: EmployeeStatus;

  @IsString()
  @IsNotEmpty()
  reason: string;

  /** Optional. Exit/rest/dismiss: first non-working day. Active return: first paid day. Blank = today. */
  @IsOptional()
  @IsDateString()
  statusEffectiveFrom?: string;
}

export class TransferDto {
  @IsUUID()
  @IsNotEmpty()
  currentBranchId: string;

  @IsUUID()
  @IsNotEmpty()
  currentDepartmentId: string;

  @IsString()
  @IsNotEmpty()
  currentDesignation: string;

  @IsIn([ChangeType.TRANSFERRED, ChangeType.PROMOTED, ChangeType.DEMOTED])
  changeType: ChangeType;

  @IsString()
  @IsNotEmpty()
  changeReason: string;

  @IsDateString()
  @IsNotEmpty()
  effectiveDate: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time format must be HH:MM' })
  dutyStartTime?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time format must be HH:MM' })
  dutyEndTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Validate(DutyTotalHoursConstraint)
  dutyTotalHours?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(31)
  monthlyAllowedLeaves?: number | null;
}

export class EmployeeQueryDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsEnum(ProjectType)
  project?: ProjectType;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsString()
  shiftIds?: string;

  @IsOptional()
  @IsString()
  shiftName?: string;

  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  /** Comma-separated EmployeeStatus values, e.g. ACTIVE,ON_REST */
  @IsOptional()
  @IsString()
  statuses?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsEnum(MaritalStatus)
  maritalStatus?: MaritalStatus;

  @IsOptional()
  @IsBooleanString()
  widowOnly?: string;

  @IsOptional()
  @IsBooleanString()
  unassigned?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @IsOptional()
  @IsDateString()
  joinedFrom?: string;

  @IsOptional()
  @IsDateString()
  joinedTo?: string;

  @IsOptional()
  @IsBooleanString()
  count?: string;
}

export class UpdateBranchDutyDto {
  @IsOptional()
  @IsUUID()
  currentBranchId?: string;

  @IsOptional()
  @IsUUID()
  currentDepartmentId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time format must be HH:MM' })
  dutyStartTime?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time format must be HH:MM' })
  dutyEndTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Validate(DutyTotalHoursConstraint)
  dutyTotalHours?: number;

  /** Monthly paid leave days; null clears to unlimited. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(31)
  monthlyAllowedLeaves?: number | null;

  /** Reliever-only: no regular duty; excluded from auto-absent. */
  @IsOptional()
  @IsBoolean()
  relieverOnly?: boolean;

  /** Paid weekly rest weekdays: 0=Sunday … 6=Saturday. Empty = no weekly off. */
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weeklyOffWeekdays?: number[];
}

export class ActiveShiftQueryDto {
  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time format must be HH:MM' })
  time: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;
}
