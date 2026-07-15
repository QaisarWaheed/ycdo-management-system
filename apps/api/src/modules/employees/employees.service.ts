import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizeDesignationName } from '../../common/org-structure';
import { inferShiftNameFromDuty } from '../../common/shift-inference.util';
import {
  ChangeType,
  EmployeeOnboardingStatus,
  EmployeeStatus,
  LetterType,
  LeaveStatus,
  MaritalStatus,
  Prisma,
  StaffType,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import {
  cloudinary,
  isCloudinaryEnabled,
} from '../../config/cloudinary.config';
import { LettersService } from '../letters/letters.service';
import {
  isWithinDutyWindow,
  resolveDutyEndTime,
  resolveDutyStartTime,
  toPakistanMinutesOfDay,
} from '../attendance/attendance-late.util';
import { generateEmployeeCode } from './employee-code.helper';
import { getHierarchyPriority } from '../../common/hierarchy.util';
import { enforceBranchScope } from '../../common/branch-scope.util';
import type { BranchScopedUser } from '../../common/branch-scope.util';
import {
  isMedicineManagerRole,
  medicineEmployeeWhere,
} from '../../common/medicine-scope.util';
import {
  ActiveShiftQueryDto,
  ChangeStatusDto,
  CreateEmployeeDto,
  EmployeeQueryDto,
  TransferDto,
  UpdateBranchDutyDto,
  UpdateEmployeeDto,
} from './employees.dto';

export type EmployeeFilters = EmployeeQueryDto;

type ActingUser = {
  id: string;
  role: UserRole | string;
  branchId?: string | null;
};

@Injectable()
export class EmployeesService {
  constructor(
    private prisma: PrismaService,
    private lettersService: LettersService,
  ) {}

  async create(dto: CreateEmployeeDto, actingUser?: ActingUser) {
    this.validateCreateDto(dto);
    dto.currentDesignation = normalizeDesignationName(dto.currentDesignation);

    await this.ensureBranchExists(dto.currentBranchId);
    await this.ensureDepartmentExists(dto.currentDepartmentId);

    if (dto.cnic) {
      const existingCnic = await this.prisma.employee.findUnique({
        where: { cnic: dto.cnic },
      });
      if (existingCnic) {
        throw new ConflictException('Employee with this CNIC already exists');
      }
    }

    if (dto.email) {
      const existingEmail = await this.prisma.employee.findUnique({
        where: { email: dto.email },
      });
      if (existingEmail) {
        throw new ConflictException('Employee with this email already exists');
      }
    }

    if (dto.biometricId) {
      const existingBiometric = await this.prisma.employee.findUnique({
        where: { biometricId: dto.biometricId },
      });
      if (existingBiometric) {
        throw new ConflictException(
          'Employee with this biometric ID already exists',
        );
      }
    }

    if (dto.shiftId) {
      await this.ensureShiftExists(dto.shiftId);
    }

    let resolvedShiftId = dto.shiftId;
    if (!resolvedShiftId && dto.dutyStartTime) {
      resolvedShiftId = await this.assignShiftFromDuty(
        dto.dutyStartTime,
        dto.dutyEndTime,
        dto.dutyTotalHours,
      );
    }

    const employeeCode = await generateEmployeeCode(this.prisma);
    const biometricId = dto.biometricId ?? (await this.generateBiometricId());
    const joiningDate = new Date(dto.joiningDate);
    const {
      basicStipend,
      allowances,
      reward,
      progressReward,
      fuelAllowance,
      loanDeduction,
      advanceDeduction,
      fineDeduction,
      healthDeduction,
      shiftName: _shiftName,
      approverTarget: _approverTarget,
      formSnapshot: _formSnapshot,
      userRole: _userRole,
      staffType: _staffType,
      ...employeeData
    } = dto;
    const lumpsumTotal = this.calculateLumpsumTotal({
      basicStipend,
      allowances,
      reward,
      progressReward,
      fuelAllowance,
      loanDeduction,
      advanceDeduction,
      fineDeduction,
      healthDeduction,
    });
    const loginEmail =
      dto.email || `${employeeCode.toLowerCase()}@ycdo.org`;

    const existingUserEmail = await this.prisma.user.findUnique({
      where: { email: loginEmail },
    });
    if (existingUserEmail) {
      throw new ConflictException(
        'A user account with this email already exists',
      );
    }

    const employee = await this.prisma.$transaction(async (tx) => {
      const staffType = dto.staffType ?? StaffType.NEW;
      const pendingApproval =
        staffType === StaffType.NEW && Boolean(dto.approverTarget);
      const created = await tx.employee.create({
        data: {
          ...employeeData,
          email: loginEmail,
          biometricId,
          staffType,
          shiftId: resolvedShiftId,
          employeeCode,
          joiningDate,
          dateOfBirth: new Date(dto.dateOfBirth),
          status: pendingApproval
            ? EmployeeStatus.PENDING_APPROVAL
            : EmployeeStatus.ACTIVE,
        },
      });

      await tx.employmentHistory.create({
        data: {
          employeeId: created.id,
          branchId: dto.currentBranchId,
          departmentId: dto.currentDepartmentId,
          designation: dto.currentDesignation,
          changeType: ChangeType.JOINED,
          effectiveDate: joiningDate,
        },
      });

      await tx.stipendRecord.create({
        data: {
          employeeId: created.id,
          basicStipend,
          allowances: allowances ?? 0,
          reward: reward ?? 0,
          progressReward: progressReward ?? 0,
          fuelAllowance: fuelAllowance ?? 0,
          loanDeduction: loanDeduction ?? 0,
          advanceDeduction: advanceDeduction ?? 0,
          fineDeduction: fineDeduction ?? 0,
          healthDeduction: healthDeduction ?? 0,
          lumpsumTotal,
          effectiveFrom: joiningDate,
        },
      });

      await this.createUserForEmployee(tx, {
        employeeId: created.id,
        employeeCode,
        email: loginEmail,
        designation: dto.currentDesignation,
        branchId: dto.currentBranchId,
        userRole: dto.userRole,
        isActive: !pendingApproval,
      });

      if (pendingApproval && dto.approverTarget && actingUser) {
        await tx.employeeOnboardingApproval.create({
          data: {
            employeeId: created.id,
            submittedById: actingUser.id,
            approverTarget: dto.approverTarget,
            status: EmployeeOnboardingStatus.PENDING,
            formSnapshot: (dto.formSnapshot ?? {
              ...dto,
              employeeCode: created.employeeCode,
            }) as Prisma.InputJsonValue,
          },
        });
      }

      return created;
    });

    const result = await this.prisma.employee.findUnique({
      where: { id: employee.id },
      include: {
        currentBranch: { select: { name: true, address: true } },
        currentDepartment: { select: { name: true } },
        shift: true,
      },
    });

    if (result && actingUser) {
      await this.prisma.auditLog.create({
        data: {
          userId: actingUser.id,
          action: 'EMPLOYEE_CREATED',
          entity: 'Employee',
          entityId: result.id,
          changes: { fullName: result.fullName },
        },
      });
    }

    if (result) {
      try {
        if (
          result.staffType !== StaffType.EXISTING &&
          result.status === EmployeeStatus.ACTIVE
        ) {
          await this.lettersService.generate(
            {
              employeeId: result.id,
              letterType: LetterType.ADVICE,
              extraFields: {
                adviceReason: 'Training / Joining Notification',
                adviceDetails: `Welcome to YCDO. This letter serves as your training and joining notification. Joining Date: ${this.formatDate(result.joiningDate)}. Designation: ${result.currentDesignation}. Department: ${result.currentDepartment.name}. Branch: ${result.currentBranch.name}. Basic Stipend: PKR ${dto.basicStipend}. Working Hours: 9:00 AM - 5:00 PM. Probation Period: 3 months.`,
                joiningDate: this.formatDate(result.joiningDate),
                designation: result.currentDesignation,
                department: result.currentDepartment.name,
                branch: result.currentBranch.name,
                basicStipend: dto.basicStipend,
                workingHours: '9:00 AM - 5:00 PM',
                probationPeriod: '3 months',
              },
            },
            'SYSTEM',
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        console.error('Auto-letter generation failed:', message);
      }
    }

    return result;
  }

  async backfillUsers() {
    const employees = await this.prisma.employee.findMany({
      where: { user: null },
      select: {
        id: true,
        employeeCode: true,
        email: true,
      },
    });

    let created = 0;

    for (const employee of employees) {
      const loginEmail =
        employee.email || `${employee.employeeCode.toLowerCase()}@ycdo.org`;

      const existingUser = await this.prisma.user.findUnique({
        where: { email: loginEmail },
      });
      if (existingUser) {
        continue;
      }

      await this.prisma.$transaction(async (tx) => {
        if (!employee.email) {
          await tx.employee.update({
            where: { id: employee.id },
            data: { email: loginEmail },
          });
        }

        await this.createUserForEmployee(tx, {
          employeeId: employee.id,
          employeeCode: employee.employeeCode,
          email: loginEmail,
        });
      });

      created++;
    }

    return { created };
  }

  private isAdminManagerRole(
    designation: string,
    userRole?: string,
  ): boolean {
    if (userRole === 'ADMIN_MANAGER') return true;
    return designation === 'Admin Manager';
  }

  private async createUserForEmployee(
    tx: Prisma.TransactionClient,
    params: {
      employeeId: string;
      employeeCode: string;
      email: string;
      designation?: string;
      branchId?: string;
      userRole?: string;
      isActive?: boolean;
    },
  ) {
    const hashedPassword = await bcrypt.hash(params.employeeCode, 10);
    const isAdminManager = this.isAdminManagerRole(
      params.designation ?? '',
      params.userRole,
    );

    const newUser = await tx.user.create({
      data: {
        email: params.email,
        password: hashedPassword,
        role: isAdminManager ? UserRole.ADMIN_MANAGER : UserRole.EMPLOYEE,
        branchId: isAdminManager ? params.branchId : undefined,
        isActive: params.isActive ?? true,
        employeeId: params.employeeId,
      },
    });

    await tx.userPassword.upsert({
      where: { userId: newUser.id },
      update: { plainText: params.employeeCode },
      create: { userId: newUser.id, plainText: params.employeeCode },
    });

    return newUser;
  }

  private formatDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  async findAll(filters: EmployeeFilters, actingUser?: ActingUser) {
    enforceBranchScope(filters, actingUser);

    const where: Prisma.EmployeeWhereInput = {};
    const andConditions: Prisma.EmployeeWhereInput[] = [];

    if (isMedicineManagerRole(actingUser?.role)) {
      andConditions.push(medicineEmployeeWhere());
    }

    if (filters.branchId) {
      where.currentBranchId = filters.branchId;
    }

    if (filters.departmentId) {
      where.currentDepartmentId = filters.departmentId;
    }

    if (filters.projectId) {
      where.currentBranch = {
        ...(where.currentBranch as Prisma.BranchWhereInput | undefined),
        projectId: filters.projectId,
      };
    }

    if (filters.project) {
      where.currentBranch = {
        ...(where.currentBranch as Prisma.BranchWhereInput | undefined),
        project: { type: filters.project },
      };
    }

    if (filters.shiftName) {
      where.shift = {
        name: filters.shiftName,
        isActive: true,
      };
    } else if (filters.shiftIds) {
      const ids = filters.shiftIds.split(',').filter(Boolean);
      if (ids.length > 0) {
        where.shiftId = { in: ids };
      }
    } else if (filters.shiftId) {
      where.shiftId = filters.shiftId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.gender) {
      where.gender = filters.gender;
    }

    if (filters.widowOnly === 'true') {
      where.maritalStatus = MaritalStatus.WIDOW;
      where.gender = 'FEMALE';
    } else if (filters.maritalStatus) {
      where.maritalStatus = filters.maritalStatus;
    }

    if (filters.unassigned === 'true') {
      andConditions.push({
        OR: [{ currentDepartmentId: null }, { currentDesignation: null }],
      });
    }

    if (filters.designation) {
      where.currentDesignation = {
        equals: filters.designation,
        mode: 'insensitive',
      };
    }

    if (filters.district) {
      where.district = {
        equals: filters.district,
        mode: 'insensitive',
      };
    }

    if (filters.bloodGroup) {
      where.bloodGroup = filters.bloodGroup;
    }

    if (filters.search) {
      andConditions.push({
        OR: [
          { fullName: { contains: filters.search, mode: 'insensitive' } },
          {
            employeeCode: { contains: filters.search, mode: 'insensitive' },
          },
          { cnic: { contains: filters.search, mode: 'insensitive' } },
          {
            currentBranch: {
              name: { contains: filters.search, mode: 'insensitive' },
            },
          },
        ],
      });
    }

    if (filters.joinedFrom || filters.joinedTo) {
      where.joiningDate = {};
      if (filters.joinedFrom) {
        where.joiningDate.gte = new Date(filters.joinedFrom);
      }
      if (filters.joinedTo) {
        where.joiningDate.lte = new Date(filters.joinedTo);
      }
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    if (filters.count === 'true') {
      const count = await this.prisma.employee.count({ where });
      return { count };
    }

    const employees = await this.prisma.employee.findMany({
      where,
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
        currentDesignation: true,
        status: true,
        joiningDate: true,
        dutyStartTime: true,
        dutyEndTime: true,
        currentBranch: {
          select: {
            id: true,
            name: true,
            address: true,
            abbreviation: true,
            projectId: true,
            project: { select: { id: true, name: true, type: true } },
          },
        },
        currentDepartment: { select: { name: true } },
        shift: {
          select: { id: true, name: true, startTime: true, endTime: true },
        },
      },
    });

    return employees.sort((a, b) => {
      const aPriority = getHierarchyPriority(a.currentDesignation);
      const bPriority = getHierarchyPriority(b.currentDesignation);
      if (aPriority !== bPriority) return aPriority - bPriority;
      return (a.fullName ?? '').localeCompare(b.fullName ?? '');
    });
  }

  async getStats() {
    const total = await this.prisma.employee.count();

    const byStatus = await this.prisma.employee.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const unassigned = await this.prisma.employee.count({
      where: {
        OR: [{ currentDepartmentId: null }, { currentDesignation: null }],
      },
    });

    const employees = await this.prisma.employee.findMany({
      select: {
        currentBranch: {
          select: {
            project: { select: { id: true, name: true, type: true } },
          },
        },
      },
    });

    const projectCounts = new Map<
      string,
      { project: string; projectId: string | null; count: number }
    >();

    for (const employee of employees) {
      const project = employee.currentBranch?.project;
      const key = project?.id ?? 'unassigned';
      const existing = projectCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        projectCounts.set(key, {
          project: project?.name ?? 'Unassigned',
          projectId: project?.id ?? null,
          count: 1,
        });
      }
    }

    return {
      total,
      unassigned,
      byStatus: byStatus.map((row) => ({
        status: row.status,
        count: row._count._all,
      })),
      byProject: [...projectCounts.values()].sort((a, b) =>
        a.project.localeCompare(b.project),
      ),
    };
  }

  async getFilterOptions() {
    const [designationRows, districtRows] = await Promise.all([
      this.prisma.employee.findMany({
        select: { currentDesignation: true },
        distinct: ['currentDesignation'],
        orderBy: { currentDesignation: 'asc' },
      }),
      this.prisma.employee.findMany({
        where: { district: { not: null } },
        select: { district: true },
        distinct: ['district'],
        orderBy: { district: 'asc' },
      }),
    ]);

    return {
      designations: designationRows
        .map((row) => row.currentDesignation)
        .filter((value): value is string => !!value),
      districts: districtRows
        .map((row) => row.district)
        .filter((value): value is string => !!value),
    };
  }

  async findOne(id: string) {
    const isEmployeeCode = id.startsWith('YCDO-');
    const employee = await this.prisma.employee.findUnique({
      where: isEmployeeCode ? { employeeCode: id } : { id },
      include: {
        currentBranch: true,
        currentDepartment: true,
        shift: true,
        stipendRecords: {
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        employmentHistory: {
          orderBy: { createdAt: 'desc' },
          include: {
            branch: { select: { name: true, address: true } },
            department: { select: { name: true } },
          },
        },
        documents: true,
        academicQualifications: {
          orderBy: [{ qualType: 'asc' }, { createdAt: 'asc' }],
        },
        previousEmployments: {
          orderBy: { createdAt: 'desc' },
        },
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            branchId: true,
            branch: { select: { name: true, address: true } },
            passwordRecord: { select: { plainText: true } },
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee not found`);
    }

    return employee;
  }

  async update(
    id: string,
    dto: UpdateEmployeeDto,
  ) {
    await this.findOne(id);

    const sanitizedDto = dto;

    if (sanitizedDto.currentBranchId !== undefined || sanitizedDto.currentDepartmentId !== undefined) {
      throw new BadRequestException(
        'Use the transfer endpoint to change branch or department',
      );
    }

    const data: Prisma.EmployeeUpdateInput = {};

    if (sanitizedDto.fullName !== undefined) data.fullName = sanitizedDto.fullName;
    if (sanitizedDto.fatherName !== undefined) data.fatherName = sanitizedDto.fatherName;
    if (sanitizedDto.phone !== undefined) data.phone = sanitizedDto.phone;
    if (sanitizedDto.email !== undefined) data.email = sanitizedDto.email;
    if (sanitizedDto.dateOfBirth !== undefined) {
      data.dateOfBirth = new Date(sanitizedDto.dateOfBirth);
    }
    if (sanitizedDto.joiningDate !== undefined) {
      data.joiningDate = new Date(sanitizedDto.joiningDate);
    }
    if (sanitizedDto.gender !== undefined) data.gender = sanitizedDto.gender;
    if (sanitizedDto.biometricId !== undefined) data.biometricId = sanitizedDto.biometricId;
    if (sanitizedDto.currentDesignation !== undefined) {
      data.currentDesignation = normalizeDesignationName(
        sanitizedDto.currentDesignation,
      );
    }
    if (sanitizedDto.fatherContactNumber !== undefined) {
      data.fatherContactNumber = sanitizedDto.fatherContactNumber;
    }
    if (sanitizedDto.emergencyContactName !== undefined) {
      data.emergencyContactName = sanitizedDto.emergencyContactName;
    }
    if (sanitizedDto.emergencyContactNumber !== undefined) {
      data.emergencyContactNumber = sanitizedDto.emergencyContactNumber;
    }
    if (sanitizedDto.spouseName !== undefined) {
      data.spouseName = sanitizedDto.spouseName;
    }
    if (sanitizedDto.spouseContactNumber !== undefined) {
      data.spouseContactNumber = sanitizedDto.spouseContactNumber;
    }
    if (sanitizedDto.caste !== undefined) data.caste = sanitizedDto.caste;
    if (sanitizedDto.domicile !== undefined) data.domicile = sanitizedDto.domicile;
    if (sanitizedDto.currentAddress !== undefined) {
      data.currentAddress = sanitizedDto.currentAddress;
    }
    if (sanitizedDto.permanentAddress !== undefined) {
      data.permanentAddress = sanitizedDto.permanentAddress;
    }
    if (sanitizedDto.district !== undefined) data.district = sanitizedDto.district;
    if (sanitizedDto.tehsil !== undefined) data.tehsil = sanitizedDto.tehsil;
    if (sanitizedDto.policeStation !== undefined) {
      data.policeStation = sanitizedDto.policeStation;
    }
    if (sanitizedDto.bloodGroup !== undefined) data.bloodGroup = sanitizedDto.bloodGroup;
    if (sanitizedDto.dutyStartTime !== undefined) data.dutyStartTime = sanitizedDto.dutyStartTime;
    if (sanitizedDto.dutyEndTime !== undefined) data.dutyEndTime = sanitizedDto.dutyEndTime;
    if (sanitizedDto.province !== undefined) data.province = sanitizedDto.province;
    if (sanitizedDto.city !== undefined) data.city = sanitizedDto.city;
    if (sanitizedDto.permanentProvince !== undefined) {
      data.permanentProvince = sanitizedDto.permanentProvince;
    }
    if (sanitizedDto.permanentCity !== undefined) data.permanentCity = sanitizedDto.permanentCity;

    if (sanitizedDto.email) {
      const existingEmail = await this.prisma.employee.findFirst({
        where: { email: sanitizedDto.email, NOT: { id } },
      });
      if (existingEmail) {
        throw new ConflictException('Employee with this email already exists');
      }
    }

    if (sanitizedDto.cnic !== undefined) {
      if (sanitizedDto.cnic) {
        const existingCnic = await this.prisma.employee.findFirst({
          where: { cnic: sanitizedDto.cnic, NOT: { id } },
        });
        if (existingCnic) {
          throw new ConflictException('Employee with this CNIC already exists');
        }
      }
      data.cnic = sanitizedDto.cnic || null;
    }

    if (sanitizedDto.biometricId) {
      const existingBiometric = await this.prisma.employee.findFirst({
        where: { biometricId: sanitizedDto.biometricId, NOT: { id } },
      });
      if (existingBiometric) {
        throw new ConflictException(
          'Employee with this biometric ID already exists',
        );
      }
    }

    if (
      sanitizedDto.dutyStartTime !== undefined ||
      sanitizedDto.dutyEndTime !== undefined ||
      sanitizedDto.dutyTotalHours !== undefined
    ) {
      const employee = await this.findOne(id);
      const shiftId = await this.assignShiftFromDuty(
        sanitizedDto.dutyStartTime ?? employee.dutyStartTime,
        sanitizedDto.dutyEndTime ?? employee.dutyEndTime,
        sanitizedDto.dutyTotalHours ?? employee.dutyTotalHours,
      );
      if (shiftId) {
        data.shift = { connect: { id: shiftId } };
      }
    }

    return this.prisma.employee.update({
      where: { id },
      data,
      include: {
        currentBranch: { select: { name: true, address: true } },
        currentDepartment: { select: { name: true } },
      },
    });
  }

  async transfer(id: string, dto: TransferDto) {
    const employee = await this.findOne(id);
    dto.currentDesignation = normalizeDesignationName(dto.currentDesignation);
    await this.ensureBranchExists(dto.currentBranchId);
    await this.ensureDepartmentExists(dto.currentDepartmentId);

    const effectiveDate = new Date(dto.effectiveDate);

    await this.prisma.$transaction(async (tx) => {
      const openHistory = await tx.employmentHistory.findFirst({
        where: { employeeId: id, endDate: null },
        orderBy: { effectiveDate: 'desc' },
      });

      if (openHistory) {
        await tx.employmentHistory.update({
          where: { id: openHistory.id },
          data: { endDate: effectiveDate },
        });
      }

      await tx.employee.update({
        where: { id },
        data: {
          currentBranchId: dto.currentBranchId,
          currentDepartmentId: dto.currentDepartmentId,
          currentDesignation: dto.currentDesignation,
        },
      });

      await tx.employmentHistory.create({
        data: {
          employeeId: id,
          branchId: dto.currentBranchId,
          departmentId: dto.currentDepartmentId,
          designation: dto.currentDesignation,
          changeType: dto.changeType,
          changeReason: dto.changeReason,
          effectiveDate,
        },
      });
    });

    return this.prisma.employee.findUnique({
      where: { id: employee.id },
      include: {
        currentBranch: { select: { name: true, address: true } },
        currentDepartment: { select: { name: true } },
        employmentHistory: {
          orderBy: { createdAt: 'desc' },
          take: 2,
        },
      },
    });
  }

  async changeStatus(id: string, dto: ChangeStatusDto) {
    const employee = await this.findOne(id);

    if (employee.status === EmployeeStatus.DISMISSED) {
      throw new BadRequestException(
        'This employee has been dismissed and cannot change status. Dismissed employees are permanently barred from rejoining.',
      );
    }

    if (
      employee.status === EmployeeStatus.TRAINEE &&
      dto.status === EmployeeStatus.ACTIVE
    ) {
      const appointmentLetter = await this.prisma.letter.findFirst({
        where: {
          employeeId: id,
          letterType: LetterType.APPOINTMENT,
        },
      });

      if (!appointmentLetter) {
        throw new BadRequestException({
          code: 'APPOINTMENT_LETTER_REQUIRED',
          message:
            'An appointment letter must be generated before activating a trainee employee.',
        });
      }
    }

    return this.prisma.employee.update({
      where: { id },
      data: { status: dto.status },
      include: {
        currentBranch: { select: { name: true, address: true } },
        currentDepartment: { select: { name: true } },
      },
    });
  }

  private async ensureShiftExists(shiftId: string) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, isActive: true },
    });

    if (!shift) {
      throw new NotFoundException(`Shift with id ${shiftId} not found`);
    }
  }

  private async assignShiftFromDuty(
    dutyStartTime?: string | null,
    dutyEndTime?: string | null,
    dutyTotalHours?: number | null,
  ): Promise<string | undefined> {
    const shiftName = inferShiftNameFromDuty(
      dutyStartTime,
      dutyEndTime,
      dutyTotalHours,
    );
    if (!shiftName || !dutyStartTime) {
      return undefined;
    }

    const { startTime, endTime } = this.defaultShiftTimes(
      shiftName,
      dutyStartTime,
      dutyEndTime,
      dutyTotalHours,
    );

    return this.resolveOrCreateShift(shiftName, startTime, endTime);
  }

  private defaultShiftTimes(
    shiftName: string,
    dutyStartTime: string,
    dutyEndTime?: string | null,
    dutyTotalHours?: number | null,
  ) {
    if (dutyTotalHours === 24 || shiftName === '24 Hours') {
      return { startTime: '00:00', endTime: '23:59' };
    }

    return {
      startTime: dutyStartTime,
      endTime: dutyEndTime ?? this.fallbackEndTime(shiftName),
    };
  }

  private fallbackEndTime(shiftName: string): string {
    switch (shiftName) {
      case 'Morning':
        return '14:00';
      case 'Evening':
        return '20:00';
      case 'Night':
        return '08:00';
      case '24 Hours':
        return '23:59';
      default:
        return '20:00';
    }
  }

  private async resolveOrCreateShift(
    shiftName: string,
    startTime: string,
    endTime: string,
  ): Promise<string> {
    const existing = await this.prisma.shift.findFirst({
      where: {
        name: shiftName,
        startTime,
        endTime,
        isActive: true,
      },
    });

    if (existing) {
      return existing.id;
    }

    const created = await this.prisma.shift.create({
      data: {
        name: shiftName,
        startTime,
        endTime,
        branchId: null,
      },
    });

    return created.id;
  }

  private async ensureBranchExists(branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, isActive: true },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with id ${branchId} not found`);
    }
  }

  private async ensureDepartmentExists(departmentId: string) {
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, isActive: true, isDeleted: false },
    });

    if (!department) {
      throw new NotFoundException(
        `Department with id ${departmentId} not found`,
      );
    }
  }

  async getTotalWorkingHours(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id ${employeeId} not found`);
    }

    const logs = await this.prisma.attendanceLog.findMany({
      where: {
        employeeId,
        checkIn: { not: null },
        checkOut: { not: null },
      },
      select: { checkIn: true, checkOut: true, date: true },
    });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    let totalMinutes = 0;
    let thisMonthMinutes = 0;
    const daysWithHours = new Set<string>();

    for (const log of logs) {
      if (!log.checkIn || !log.checkOut) continue;
      const minutes = Math.round(
        (log.checkOut.getTime() - log.checkIn.getTime()) / 60000,
      );
      totalMinutes += minutes;
      daysWithHours.add(log.date.toISOString().split('T')[0]);

      if (log.date >= monthStart && log.date <= monthEnd) {
        thisMonthMinutes += minutes;
      }
    }

    const totalDays = daysWithHours.size;
    const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
    const thisMonthHours = Math.round((thisMonthMinutes / 60) * 100) / 100;
    const averageDailyHours =
      totalDays > 0
        ? Math.round((totalHours / totalDays) * 100) / 100
        : 0;

    return {
      totalMinutes,
      totalHours,
      totalDays,
      thisMonthMinutes,
      thisMonthHours,
      averageDailyHours,
    };
  }

  async updateBranchDuty(
    id: string,
    dto: UpdateBranchDutyDto,
    actingUserId: string,
  ) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });

    if (!employee) {
      throw new NotFoundException(`Employee with id ${id} not found`);
    }

    const branchChanged =
      dto.currentBranchId !== undefined &&
      dto.currentBranchId !== employee.currentBranchId;

    const targetBranchId = dto.currentBranchId ?? employee.currentBranchId;

    if (dto.currentBranchId) {
      await this.ensureBranchExists(dto.currentBranchId);
    }

    if (dto.currentDepartmentId) {
      await this.ensureDepartmentExists(dto.currentDepartmentId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (branchChanged && dto.currentBranchId) {
        await tx.employmentHistory.create({
          data: {
            employeeId: id,
            branchId: dto.currentBranchId,
            departmentId:
              dto.currentDepartmentId ?? employee.currentDepartmentId,
            designation: employee.currentDesignation,
            changeType: ChangeType.TRANSFERRED,
            effectiveDate: new Date(),
          },
        });
      }

      const data: Prisma.EmployeeUpdateInput = {};

      if (dto.currentBranchId !== undefined) {
        data.currentBranch = { connect: { id: dto.currentBranchId } };
      }
      if (dto.currentDepartmentId !== undefined) {
        data.currentDepartment = { connect: { id: dto.currentDepartmentId } };
      }
      if (dto.dutyStartTime !== undefined) {
        data.dutyStartTime = dto.dutyStartTime;
      }
      if (dto.dutyEndTime !== undefined) {
        data.dutyEndTime = dto.dutyEndTime;
      }
      if (dto.dutyTotalHours !== undefined) {
        data.dutyTotalHours = dto.dutyTotalHours;
      }

      const nextStart = dto.dutyStartTime ?? employee.dutyStartTime;
      const nextEnd = dto.dutyEndTime ?? employee.dutyEndTime;
      const nextHours = dto.dutyTotalHours ?? employee.dutyTotalHours;
      if (
        dto.dutyStartTime !== undefined ||
        dto.dutyEndTime !== undefined ||
        dto.dutyTotalHours !== undefined
      ) {
        const shiftId = await this.assignShiftFromDuty(
          nextStart,
          nextEnd,
          nextHours,
        );
        if (shiftId) {
          data.shift = { connect: { id: shiftId } };
        }
      }

      const result = await tx.employee.update({
        where: { id },
        data,
        include: {
          currentBranch: { select: { name: true, address: true } },
          currentDepartment: { select: { name: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'UPDATE_BRANCH_DUTY',
          entity: 'Employee',
          entityId: id,
        },
      });

      return result;
    });

    return updated;
  }

  async uploadPhoto(id: string, file: Express.Multer.File) {
    await this.findOne(id);

    const photoUrl = isCloudinaryEnabled()
      ? await this.uploadPhotoToCloudinary(id, file)
      : `/uploads/photos/${id}/${file.filename}`;

    const updated = await this.prisma.employee.update({
      where: { id },
      data: { photoUrl },
      select: {
        id: true,
        photoUrl: true,
      },
    });

    await this.prisma.faceSyncJob.create({
      data: {
        employeeId: id,
        photoUrl,
        status: 'PENDING',
      },
    });

    return updated;
  }

  private async uploadPhotoToCloudinary(
    employeeId: string,
    file: Express.Multer.File,
  ): Promise<string> {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const tempFile = path.join(os.tmpdir(), `${employeeId}-${Date.now()}${ext}`);

    try {
      if (file.buffer?.length) {
        fs.writeFileSync(tempFile, file.buffer);
      } else if (file.path) {
        fs.copyFileSync(file.path, tempFile);
      } else {
        throw new BadRequestException('No photo data');
      }

      const result = await cloudinary.uploader.upload(tempFile, {
        folder: 'ycdo-hrms/employees',
        public_id: employeeId,
        overwrite: true,
        resource_type: 'image',
        transformation: [
          { width: 800, height: 800, crop: 'limit' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      });

      return result.secure_url;
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }

      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
  }

  async findActiveShiftEmployees(
    query: ActiveShiftQueryDto,
    actingUser?: BranchScopedUser,
  ) {
    const scopedQuery = { ...query }
    enforceBranchScope(scopedQuery, actingUser)

    const today = new Date(scopedQuery.date);
    today.setHours(0, 0, 0, 0);
    const currentMinutes = toPakistanMinutesOfDay(new Date());

    const andConditions: Prisma.EmployeeWhereInput[] = [];
    if (isMedicineManagerRole(actingUser?.role)) {
      andConditions.push(medicineEmployeeWhere());
    }

    const employees = await this.prisma.employee.findMany({
      where: {
        status: {
          in: [
            EmployeeStatus.ACTIVE,
            EmployeeStatus.APPOINTED,
            EmployeeStatus.TRAINEE,
          ],
        },
        ...(scopedQuery.branchId ? { currentBranchId: scopedQuery.branchId } : {}),
        ...(scopedQuery.departmentId
          ? { currentDepartmentId: scopedQuery.departmentId }
          : {}),
        ...(andConditions.length ? { AND: andConditions } : {}),
      },
      include: {
        shift: true,
        currentBranch: { select: { name: true, address: true } },
        currentDepartment: { select: { name: true } },
        attendanceLogs: { where: { date: today }, take: 1 },
        leaveRecords: {
          where: {
            status: LeaveStatus.APPROVED,
            startDate: { lte: today },
            endDate: { gte: today },
          },
        },
      },
    });

    return employees
      .filter((emp) => {
        if (emp.leaveRecords.length > 0) return false;

        const log = emp.attendanceLogs[0];
        if (log?.checkIn) return false;

        const dutyStart = resolveDutyStartTime(emp);
        const dutyEnd = resolveDutyEndTime(emp);
        if (!dutyStart || !dutyEnd) return false;

        return isWithinDutyWindow(currentMinutes, dutyStart, dutyEnd);
      })
      .map(({ attendanceLogs: _a, leaveRecords: _l, ...emp }) => emp);
  }

  private async generateBiometricId(): Promise<string> {
    const lastEmployee = await this.prisma.employee.findFirst({
      orderBy: { createdAt: 'desc' },
      where: { biometricId: { not: null } },
    });
    const lastNum = lastEmployee?.biometricId
      ? parseInt(lastEmployee.biometricId.replace('BIO', ''), 10)
      : 0;
    return `BIO${String(lastNum + 1).padStart(4, '0')}`;
  }

  private calculateLumpsumTotal(params: {
    basicStipend: number;
    allowances?: number;
    reward?: number;
    progressReward?: number;
    fuelAllowance?: number;
    loanDeduction?: number;
    advanceDeduction?: number;
    fineDeduction?: number;
    healthDeduction?: number;
  }): number {
    return (
      (params.basicStipend || 0) +
      (params.allowances || 0) +
      (params.reward || 0) +
      (params.progressReward || 0) +
      (params.fuelAllowance || 0) -
      (params.loanDeduction || 0) -
      (params.advanceDeduction || 0) -
      (params.fineDeduction || 0) -
      (params.healthDeduction || 0)
    );
  }

  async remove(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      select: { id: true, fullName: true, employeeCode: true },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id ${id} not found`);
    }

    await this.prisma.$transaction(async (tx) => {
      const leaveIds = (
        await tx.leaveRecord.findMany({
          where: { employeeId: id },
          select: { id: true },
        })
      ).map((row) => row.id);

      if (leaveIds.length > 0) {
        await tx.leaveApproval.deleteMany({
          where: { leaveId: { in: leaveIds } },
        });
        await tx.relieverRequest.deleteMany({
          where: { leaveRecordId: { in: leaveIds } },
        });
      }

      await tx.relieverRequest.deleteMany({
        where: {
          OR: [{ requestedById: id }, { relieverId: id }],
        },
      });

      await tx.leaveRecord.deleteMany({ where: { employeeId: id } });

      const letterIds = (
        await tx.letter.findMany({
          where: { employeeId: id },
          select: { id: true },
        })
      ).map((row) => row.id);

      if (letterIds.length > 0) {
        await tx.allegationAcknowledgement.deleteMany({
          where: { letterId: { in: letterIds } },
        });
        await tx.letterReply.deleteMany({
          where: { letterId: { in: letterIds } },
        });
      }

      await tx.letterReply.deleteMany({ where: { employeeId: id } });
      await tx.allegationAcknowledgement.deleteMany({
        where: { employeeId: id },
      });
      await tx.letter.deleteMany({ where: { employeeId: id } });

      const disciplinaryIds = (
        await tx.disciplinaryAction.findMany({
          where: { employeeId: id },
          select: { id: true },
        })
      ).map((row) => row.id);

      if (disciplinaryIds.length > 0) {
        await tx.inquiry.deleteMany({
          where: { disciplinaryActionId: { in: disciplinaryIds } },
        });
      }

      await tx.disciplinaryAction.deleteMany({ where: { employeeId: id } });

      const stipendIds = (
        await tx.stipendRecord.findMany({
          where: { employeeId: id },
          select: { id: true },
        })
      ).map((row) => row.id);

      const payrollIds =
        stipendIds.length > 0
          ? (
              await tx.payrollEntry.findMany({
                where: { stipendRecordId: { in: stipendIds } },
                select: { id: true },
              })
            ).map((row) => row.id)
          : [];

      if (payrollIds.length > 0) {
        await tx.payrollDeduction.deleteMany({
          where: { payrollEntryId: { in: payrollIds } },
        });
        await tx.allowance.deleteMany({
          where: { payrollEntryId: { in: payrollIds } },
        });
        await tx.stipendReceipt.deleteMany({
          where: { payrollEntryId: { in: payrollIds } },
        });
        await tx.payrollEntry.deleteMany({
          where: { id: { in: payrollIds } },
        });
      }

      await tx.stipendReceipt.deleteMany({ where: { employeeId: id } });
      await tx.stipendRecord.deleteMany({ where: { employeeId: id } });
      await tx.portalAttendance.deleteMany({ where: { employeeId: id } });
      await tx.advanceLoanRequest.deleteMany({ where: { employeeId: id } });
      await tx.incentive.deleteMany({ where: { employeeId: id } });
      await tx.relieverSession.deleteMany({ where: { employeeId: id } });
      await tx.notification.deleteMany({ where: { employeeId: id } });
      await tx.attendanceLog.deleteMany({ where: { employeeId: id } });
      await tx.employeeDocument.deleteMany({ where: { employeeId: id } });
      await tx.academicQualification.deleteMany({ where: { employeeId: id } });
      await tx.previousEmployment.deleteMany({ where: { employeeId: id } });
      await tx.branchChangeRequest.deleteMany({ where: { employeeId: id } });
      await tx.employmentHistory.deleteMany({ where: { employeeId: id } });

      const user = await tx.user.findUnique({
        where: { employeeId: id },
        select: { id: true },
      });

      if (user) {
        await tx.leaveApproval.deleteMany({ where: { actionBy: user.id } });
        await tx.notificationBroadcast.deleteMany({
          where: { createdById: user.id },
        });
        await tx.incentive.deleteMany({ where: { addedBy: user.id } });
        await tx.auditLog.deleteMany({ where: { userId: user.id } });
        await tx.userPassword.deleteMany({ where: { userId: user.id } });
        await tx.user.delete({ where: { id: user.id } });
      }

      await tx.employee.delete({ where: { id } });
    });

    return {
      success: true,
      message: `Employee ${employee.employeeCode} (${employee.fullName}) deleted permanently`,
    };
  }

  private validateCreateDto(dto: CreateEmployeeDto) {
    const isExisting = dto.staffType === StaffType.EXISTING;

    if (isExisting) {
      if (!dto.fatherStatus) {
        throw new BadRequestException('Father status is required');
      }
      if (!dto.maritalStatus) {
        throw new BadRequestException('Marital status is required');
      }
      if (!dto.emergencyRelation) {
        throw new BadRequestException('Emergency relation is required');
      }
      if (!dto.cnic) {
        throw new BadRequestException('CNIC is required');
      }
      if (!dto.dutyStartTime || !dto.dutyEndTime) {
        throw new BadRequestException('Duty hours are required');
      }
      if (dto.fatherStatus === 'ALIVE' && !dto.fatherContactNumber) {
        throw new BadRequestException('Father contact number is required');
      }
      if (dto.fatherStatus === 'DECEASED' && !dto.guardianContact) {
        throw new BadRequestException('Guardian contact is required');
      }
      if (dto.maritalStatus === MaritalStatus.MARRIED) {
        if (!dto.spouseName?.trim()) {
          throw new BadRequestException('Spouse name is required');
        }
        if (!dto.spouseContactNumber) {
          throw new BadRequestException('Spouse contact number is required');
        }
      }
      return;
    }

    if (!dto.cnic) {
      throw new BadRequestException('CNIC is required');
    }
    if (!dto.fatherContactNumber) {
      throw new BadRequestException('Father contact number is required');
    }
    if (!dto.domicile) {
      throw new BadRequestException('Domicile is required');
    }
    if (!dto.permanentAddress) {
      throw new BadRequestException('Permanent address is required');
    }
    if (!dto.district) {
      throw new BadRequestException('District is required');
    }
    if (!dto.tehsil) {
      throw new BadRequestException('Tehsil is required');
    }
    if (!dto.policeStation) {
      throw new BadRequestException('Police station is required');
    }
    if (!dto.permanentProvince) {
      throw new BadRequestException('Permanent province is required');
    }
    if (!dto.permanentCity) {
      throw new BadRequestException('Permanent city is required');
    }
  }
}
