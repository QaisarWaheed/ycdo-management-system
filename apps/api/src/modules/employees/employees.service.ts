import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChangeType, EmployeeStatus, LetterType, Prisma, StaffType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LettersService } from '../letters/letters.service';
import { generateEmployeeCode } from './employee-code.helper';
import {
  ChangeStatusDto,
  CreateEmployeeDto,
  EmployeeQueryDto,
  TransferDto,
  UpdateEmployeeDto,
} from './employees.dto';

export type EmployeeFilters = EmployeeQueryDto;

const HIERARCHY_ORDER: Record<string, number> = {
  Management: 1,
  Admin: 2,
  Medical: 3,
  Nursing: 4,
  'Allied Health': 5,
  IT: 6,
  Finance: 7,
  VTI: 8,
  Support: 9,
};

@Injectable()
export class EmployeesService {
  constructor(
    private prisma: PrismaService,
    private lettersService: LettersService,
  ) {}

  async create(dto: CreateEmployeeDto) {
    await this.ensureBranchExists(dto.currentBranchId);
    await this.ensureDepartmentInBranch(
      dto.currentDepartmentId,
      dto.currentBranchId,
    );

    const existingCnic = await this.prisma.employee.findUnique({
      where: { cnic: dto.cnic },
    });
    if (existingCnic) {
      throw new ConflictException('Employee with this CNIC already exists');
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

    const employeeCode = await generateEmployeeCode(this.prisma);
    const joiningDate = new Date(dto.joiningDate);
    const { basicStipend, ...employeeData } = dto;

    const employee = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({
        data: {
          ...employeeData,
          staffType: dto.staffType ?? StaffType.NEW,
          shiftId: dto.shiftId,
          employeeCode,
          joiningDate,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
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
          effectiveFrom: joiningDate,
        },
      });

      return created;
    });

    const result = await this.prisma.employee.findUnique({
      where: { id: employee.id },
      include: {
        currentBranch: { select: { name: true } },
        currentDepartment: { select: { name: true } },
        shift: true,
      },
    });

    if (result) {
      try {
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
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        console.error('Auto-letter generation failed:', message);
      }
    }

    return result;
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

    if (filters.shiftId) {
      where.shiftId = filters.shiftId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.gender) {
      where.gender = filters.gender;
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
        { firstName: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } },
        { employeeCode: { contains: filters.search, mode: 'insensitive' } },
        { cnic: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [employees, designations] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: {
          currentBranch: { select: { name: true } },
          currentDepartment: { select: { name: true } },
          shift: { select: { id: true, name: true } },
        },
      }),
      this.prisma.designation.findMany({
        where: { isActive: true },
        select: { title: true, category: true },
      }),
    ]);

    const categoryByTitle = new Map(
      designations.map((d) => [d.title.toLowerCase(), d.category]),
    );

    const getCategory = (title: string) =>
      categoryByTitle.get(title.toLowerCase()) ?? 'Other';

    return employees.sort((a, b) => {
      const aPriority = HIERARCHY_ORDER[getCategory(a.currentDesignation)] ?? 99;
      const bPriority = HIERARCHY_ORDER[getCategory(b.currentDesignation)] ?? 99;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.firstName.localeCompare(b.firstName);
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
            branch: { select: { name: true } },
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

    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.fatherName !== undefined) data.fatherName = dto.fatherName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.dateOfBirth !== undefined) {
      data.dateOfBirth = new Date(dto.dateOfBirth);
    }
    if (dto.address !== undefined) data.address = dto.address;
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
        currentBranch: { select: { name: true } },
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
        currentBranch: { select: { name: true } },
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
        currentBranch: { select: { name: true } },
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
}
