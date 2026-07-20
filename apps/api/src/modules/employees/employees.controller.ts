import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Permission, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  ActiveShiftQueryDto,
  ChangeStatusDto,
  CreateEmployeeDto,
  EmployeeQueryDto,
  ToggleHideProfilePhotoDto,
  TransferDto,
  UpdateBranchDutyDto,
  UpdateEmployeeDto,
  UpdateEmployeeRolesDto,
} from './employees.dto';
import { EmployeesService } from './employees.service';
import { photoMulterConfig } from './photo.multer.config';
import { privatePhotoMulterConfig } from './private-photo.multer.config';
import { PermissionsService } from '../permissions/permissions.service';
import { ROLE_ASSIGNERS } from '../../common/user-roles.util';

/** Any system role can hit these routes; EMPLOYEES_EDIT permission is enforced. */
const EMPLOYEE_EDIT_ROLES = Object.values(UserRole);
const BIOMETRIC_REFERENCE_ROLES = Object.values(UserRole).filter(
  (role) => role !== UserRole.EMPLOYEE,
);

@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeesController {
  constructor(
    private employeesService: EmployeesService,
    private permissionsService: PermissionsService,
  ) {}

  @Post()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.ADMIN_MANAGER,
  )
  create(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() user: { id: string; role: UserRole; branchId?: string | null },
  ) {
    return this.employeesService.create(dto, user);
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.MEDICINE_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.PAYROLL_OFFICER,
    UserRole.CHAIRMAN,
    UserRole.FOUNDER,
    UserRole.IT_ADMIN,
  )
  findAll(
    @Query() query: EmployeeQueryDto,
    @CurrentUser()
    user: { id: string; role: UserRole; branchId?: string | null },
  ) {
    return this.employeesService.findAll(query, user);
  }

  @Get('stats')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.MEDICINE_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.PAYROLL_OFFICER,
    UserRole.CHAIRMAN,
    UserRole.FOUNDER,
    UserRole.IT_ADMIN,
  )
  getStats() {
    return this.employeesService.getStats();
  }

  @Get('filter-options')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.IT_ADMIN,
  )
  getFilterOptions() {
    return this.employeesService.getFilterOptions();
  }

  @Get('active-shift')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.MEDICINE_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  findActiveShift(
    @Query() query: ActiveShiftQueryDto,
    @CurrentUser()
    user: { id: string; role: UserRole; branchId?: string | null },
  ) {
    return this.employeesService.findActiveShiftEmployees(query, user);
  }

  @Post('backfill-users')
  @Roles(UserRole.SUPER_ADMIN)
  backfillUsers() {
    return this.employeesService.backfillUsers();
  }

  @Get('biometric-id-stats')
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  getBiometricIdStats() {
    return this.employeesService.getBiometricIdStats();
  }

  @Get('biometric-ids')
  @Roles(...BIOMETRIC_REFERENCE_ROLES)
  getBiometricIdReference(
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.employeesService.getBiometricIdReference(user);
  }

  @Post('generate-biometric-ids')
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  generateBiometricIds(@CurrentUser() user: { id: string }) {
    return this.employeesService.generateAllBiometricIds(user.id);
  }

  @Post('sync-duty-times')
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  syncDutyTimes() {
    return this.employeesService.syncDutyTimesFromShifts();
  }

  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.MEDICINE_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.IT_ADMIN,
    UserRole.PAYROLL_OFFICER,
    UserRole.CHAIRMAN,
    UserRole.FOUNDER,
    UserRole.EMPLOYEE,
  )
  findOne(
    @Param('id') id: string,
    @CurrentUser()
    user: {
      id: string;
      role: UserRole;
      roles?: UserRole[];
      employeeId?: string | null;
    },
  ) {
    const roles = user.roles?.length ? user.roles : [user.role];
    const portalOnly =
      roles.length === 1 && roles[0] === UserRole.EMPLOYEE;
    if (portalOnly && user.employeeId !== id) {
      throw new ForbiddenException('Access denied');
    }
    return this.employeesService.findOne(id, user);
  }

  @Get(':id/working-hours')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.HR_OPERATIONS_MANAGER,
    UserRole.ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
    UserRole.IT_ADMIN,
    UserRole.CHAIRMAN,
    UserRole.FOUNDER,
    UserRole.EMPLOYEE,
  )
  getWorkingHours(
    @Param('id') id: string,
    @CurrentUser() user: { role: UserRole; employeeId?: string | null },
  ) {
    if (user.role === UserRole.EMPLOYEE && user.employeeId !== id) {
      throw new ForbiddenException('Access denied');
    }
    return this.employeesService.getTotalWorkingHours(id);
  }

  @Patch(':id')
  @Roles(...EMPLOYEE_EDIT_ROLES)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser()
    user: { id: string; role: UserRole; employeeId?: string | null },
  ) {
    const canEditEmployees = await this.permissionsService.userHasPermission(
      user.id,
      user.role,
      Permission.EMPLOYEES_EDIT,
    );

    if (user.role === UserRole.EMPLOYEE && !canEditEmployees) {
      if (user.employeeId !== id) {
        throw new ForbiddenException('Access denied');
      }
      return this.employeesService.update(id, {
        phone: dto.phone,
        email: dto.email,
      });
    }

    if (!canEditEmployees) {
      throw new ForbiddenException(
        'You do not have permission to edit employee personal or job information',
      );
    }

    // Permission grant allows personal fields even for roles that are usually restricted
    return this.employeesService.update(id, dto);
  }

  @Post(':id/transfer')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER)
  transfer(@Param('id') id: string, @Body() dto: TransferDto) {
    return this.employeesService.transfer(id, dto);
  }

  @Patch(':id/status')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER)
  changeStatus(@Param('id') id: string, @Body() dto: ChangeStatusDto) {
    return this.employeesService.changeStatus(id, dto);
  }

  @Patch(':id/branch-duty')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.HR_MANAGER,
    UserRole.HR_ADMIN_MANAGER,
    UserRole.ADMIN_OFFICER,
  )
  updateBranchDuty(
    @Param('id') id: string,
    @Body() dto: UpdateBranchDutyDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.employeesService.updateBranchDuty(id, dto, user.id);
  }

  @Post(':id/photo')
  @UseInterceptors(FileInterceptor('photo', photoMulterConfig))
  @Roles(...EMPLOYEE_EDIT_ROLES)
  async uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    const canEditEmployees = await this.permissionsService.userHasPermission(
      user.id,
      user.role,
      Permission.EMPLOYEES_EDIT,
    );
    if (!canEditEmployees) {
      throw new ForbiddenException(
        'You do not have permission to update employee photos',
      );
    }
    if (!file) {
      throw new BadRequestException('No photo uploaded');
    }
    return this.employeesService.uploadPhoto(id, file);
  }

  @Post(':id/private-photo')
  @UseInterceptors(FileInterceptor('photo', privatePhotoMulterConfig))
  @Roles(...EMPLOYEE_EDIT_ROLES)
  uploadPrivatePhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { id: string },
  ) {
    if (!file) {
      throw new BadRequestException('No private photo uploaded');
    }
    return this.employeesService.uploadPrivatePhoto(id, file, user.id);
  }

  @Patch(':id/roles')
  @Roles(...ROLE_ASSIGNERS)
  updateEmployeeRoles(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeRolesDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.employeesService.updateEmployeeRoles(id, dto, user);
  }

  @Patch(':id/hide-photo')
  @Roles(...EMPLOYEE_EDIT_ROLES)
  toggleHideProfilePhoto(
    @Param('id') id: string,
    @Body() dto: ToggleHideProfilePhotoDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.employeesService.toggleHideProfilePhoto(
      id,
      dto.hide,
      user.id,
    );
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.IT_ADMIN)
  remove(@Param('id') id: string) {
    return this.employeesService.remove(id);
  }
}
