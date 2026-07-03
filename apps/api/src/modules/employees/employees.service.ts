import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChangeType,
  EmployeeStatus,
  LetterType,
  LeaveStatus,
  MaritalStatus,
  Prisma,
  StaffType,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { LettersService } from '../letters/letters.service';
import { parseTimeToMinutes } from '../attendance/attendance-late.util';
import { generateEmployeeCode } from './employee-code.helper';
import { getHierarchyPriority } from './employee-hierarchy';
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

@Injectable()
export class EmployeesService {
  constructor(
    private prisma: PrismaService,
    private lettersService: LettersService,
  ) {}

  async create(dto: CreateEmployeeDto) {
    this.validateCreateDto(dto);

    await this.ensureBranchExists(dto.currentBranchId);
    await this.ensureDepartmentInBranch(
      dto.currentDepartmentId,
      dto.currentBranchId,
    );

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
      await this.ensureShiftInBranch(dto.shiftId, dto.currentBranchId);
    }

    let resolvedShiftId = dto.shiftId;
    if (dto.shiftName) {
      resolvedShiftId = await this.resolveOrCreateShift(
        dto.shiftName,
        dto.currentBranchId,
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
      const created = await tx.employee.create({
        data: {
          ...employeeData,
          email: loginEmail,
          biometricId,
          staffType: dto.staffType ?? StaffType.NEW,
          shiftId: resolvedShiftId,
          employeeCode,
          joiningDate,
          dateOfBirth: new Date(dto.dateOfBirth),
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
      });

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

    if (result) {
      try {
        if (result.staffType !== StaffType.EXISTING) {
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

  private async createUserForEmployee(
    tx: Prisma.TransactionClient,
    params: { employeeId: string; employeeCode: string; email: string },
  ) {
    const hashedPassword = await bcrypt.hash(params.employeeCode, 10);

    const newUser = await tx.user.create({
      data: {
        email: params.email,
        password: hashedPassword,
        role: UserRole.EMPLOYEE,
        isActive: true,
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

  async findAll(filters: EmployeeFilters) {
    const where: Prisma.EmployeeWhereInput = {};

    if (filters.branchId) {
      where.currentBranchId = filters.branchId;
    }

    if (filters.departmentId) {
      where.currentDepartmentId = filters.departmentId;
    }

    if (filters.projectId) {
      where.currentBranch = { projectId: filters.projectId };
    }

    if (filters.shiftIds) {
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

    if (filters.search) {
      where.OR = [
        { fullName: { contains: filters.search, mode: 'insensitive' } },
        { employeeCode: { contains: filters.search, mode: 'insensitive' } },
        { cnic: { contains: filters.search, mode: 'insensitive' } },
      ];
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

    const employees = await this.prisma.employee.findMany({
      where,
      include: {
        currentBranch: { select: { name: true, address: true } },
        currentDepartment: { select: { name: true } },
        shift: { select: { id: true, name: true, startTime: true, endTime: true } },
      },
    });

    return employees.sort((a, b) => {
      const aPriority = getHierarchyPriority(a.currentDesignation);
      const bPriority = getHierarchyPriority(b.currentDesignation);
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.fullName.localeCompare(b.fullName);
    });
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
      designations: designationRows.map((row) => row.currentDesignation),
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
          select: { id: true, email: true, role: true, isActive: true },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee not found`);
    }

    return employee;
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    await this.findOne(id);

    if (dto.currentBranchId !== undefined || dto.currentDepartmentId !== undefined) {
      throw new BadRequestException(
        'Use the transfer endpoint to change branch or department',
      );
    }

    const data: Prisma.EmployeeUpdateInput = {};

    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.fatherName !== undefined) data.fatherName = dto.fatherName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.dateOfBirth !== undefined) {
      data.dateOfBirth = new Date(dto.dateOfBirth);
    }
    if (dto.joiningDate !== undefined) {
      data.joiningDate = new Date(dto.joiningDate);
    }
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.biometricId !== undefined) data.biometricId = dto.biometricId;
    if (dto.currentDesignation !== undefined) {
      data.currentDesignation = dto.currentDesignation;
    }
    if (dto.fatherContactNumber !== undefined) {
      data.fatherContactNumber = dto.fatherContactNumber;
    }
    if (dto.emergencyContactName !== undefined) {
      data.emergencyContactName = dto.emergencyContactName;
    }
    if (dto.emergencyContactNumber !== undefined) {
      data.emergencyContactNumber = dto.emergencyContactNumber;
    }
    if (dto.spouseName !== undefined) {
      data.spouseName = dto.spouseName;
    }
    if (dto.spouseContactNumber !== undefined) {
      data.spouseContactNumber = dto.spouseContactNumber;
    }
    if (dto.caste !== undefined) data.caste = dto.caste;
    if (dto.domicile !== undefined) data.domicile = dto.domicile;
    if (dto.currentAddress !== undefined) {
      data.currentAddress = dto.currentAddress;
    }
    if (dto.permanentAddress !== undefined) {
      data.permanentAddress = dto.permanentAddress;
    }
    if (dto.district !== undefined) data.district = dto.district;
    if (dto.tehsil !== undefined) data.tehsil = dto.tehsil;
    if (dto.policeStation !== undefined) {
      data.policeStation = dto.policeStation;
    }
    if (dto.bloodGroup !== undefined) data.bloodGroup = dto.bloodGroup;
    if (dto.dutyStartTime !== undefined) data.dutyStartTime = dto.dutyStartTime;
    if (dto.dutyEndTime !== undefined) data.dutyEndTime = dto.dutyEndTime;
    if (dto.province !== undefined) data.province = dto.province;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.permanentProvince !== undefined) {
      data.permanentProvince = dto.permanentProvince;
    }
    if (dto.permanentCity !== undefined) data.permanentCity = dto.permanentCity;

    if (dto.email) {
      const existingEmail = await this.prisma.employee.findFirst({
        where: { email: dto.email, NOT: { id } },
      });
      if (existingEmail) {
        throw new ConflictException('Employee with this email already exists');
      }
    }

    if (dto.biometricId) {
      const existingBiometric = await this.prisma.employee.findFirst({
        where: { biometricId: dto.biometricId, NOT: { id } },
      });
      if (existingBiometric) {
        throw new ConflictException(
          'Employee with this biometric ID already exists',
        );
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
    await this.ensureBranchExists(dto.currentBranchId);
    await this.ensureDepartmentInBranch(
      dto.currentDepartmentId,
      dto.currentBranchId,
    );

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

  private async ensureShiftInBranch(shiftId: string, branchId: string) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, branchId, isActive: true },
    });

    if (!shift) {
      throw new NotFoundException(
        `Shift with id ${shiftId} not found in branch`,
      );
    }
  }

  private async resolveOrCreateShift(
    shiftName: string,
    branchId: string,
  ): Promise<string> {
    const existing = await this.prisma.shift.findFirst({
      where: { name: shiftName, branchId, isActive: true },
    });

    if (existing) {
      return existing.id;
    }

    const startTime =
      shiftName === 'Morning'
        ? '08:00'
        : shiftName === 'Evening'
          ? '14:00'
          : shiftName === 'Night'
            ? '20:00'
            : shiftName === '24 Hours'
              ? '00:00'
              : '08:00';
    const endTime =
      shiftName === 'Morning'
        ? '14:00'
        : shiftName === 'Evening'
          ? '20:00'
          : shiftName === 'Night'
            ? '08:00'
            : shiftName === '24 Hours'
              ? '23:59'
              : '20:00';

    const created = await this.prisma.shift.create({
      data: {
        name: shiftName,
        branchId,
        startTime,
        endTime,
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

  private async ensureDepartmentInBranch(
    departmentId: string,
    branchId: string,
  ) {
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, branchId, isActive: true },
    });

    if (!department) {
      throw new NotFoundException(
        `Department with id ${departmentId} not found in branch`,
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
      await this.ensureDepartmentInBranch(
        dto.currentDepartmentId,
        targetBranchId,
      );
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

    const photoUrl = `/uploads/photos/${id}/${file.filename}`;

    return this.prisma.employee.update({
      where: { id },
      data: { photoUrl },
      select: {
        id: true,
        photoUrl: true,
      },
    });
  }

  async findActiveShiftEmployees(query: ActiveShiftQueryDto) {
    const today = new Date(query.date);
    today.setHours(0, 0, 0, 0);
    const [currentH, currentM] = query.time.split(':').map(Number);
    const currentMinutes = currentH * 60 + currentM;

    const employees = await this.prisma.employee.findMany({
      where: {
        status: {
          in: [
            EmployeeStatus.ACTIVE,
            EmployeeStatus.APPOINTED,
            EmployeeStatus.TRAINEE,
          ],
        },
        shiftId: { not: null },
        ...(query.branchId ? { currentBranchId: query.branchId } : {}),
        ...(query.departmentId
          ? { currentDepartmentId: query.departmentId }
          : {}),
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
        if (emp.attendanceLogs.length > 0) return false;
        if (!emp.shift) return false;

        const startMin = parseTimeToMinutes(emp.shift.startTime);
        const endMin = parseTimeToMinutes(emp.shift.endTime);
        const isOvernight = endMin < startMin;

        if (isOvernight) {
          return currentMinutes >= startMin || currentMinutes <= endMin;
        }

        return currentMinutes >= startMin && currentMinutes <= endMin;
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
      if (!dto.shiftName) {
        throw new BadRequestException('Shift is required');
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
