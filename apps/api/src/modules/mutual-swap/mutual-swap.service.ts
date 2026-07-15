import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  parseAttendanceDateTime,
  toPakistanDateOnly,
} from '../attendance/attendance-late.util';
import { CreateMutualSwapDto } from './mutual-swap.dto';

/** Normalize "09:00:00" / "09:00" → "09:00" for exact string match. */
function normalizeTime(time?: string | null): string {
  if (!time) return '';
  return time.trim().substring(0, 5);
}

@Injectable()
export class MutualSwapService {
  constructor(private prisma: PrismaService) {}

  private parseDateOnly(dateStr: string): Date {
    return toPakistanDateOnly(parseAttendanceDateTime(`${dateStr}T12:00:00`));
  }

  private parseShiftTime(time: string, dateStr: string): Date {
    const date = dateStr.includes('T') ? dateStr.split('T')[0]! : dateStr;
    return parseAttendanceDateTime(`${date}T${time}`);
  }

  async createSwap(dto: CreateMutualSwapDto, actingUserId: string) {
    if (dto.coveringEmployeeId === dto.coveredEmployeeId) {
      throw new BadRequestException(
        'Covering and covered employee must be different',
      );
    }

    const coveringEmployee = await this.prisma.employee.findUnique({
      where: { id: dto.coveringEmployeeId },
      include: { shift: true, currentBranch: true },
    });
    if (!coveringEmployee?.shiftId || !coveringEmployee.shift) {
      throw new BadRequestException('Covering employee has no shift assigned');
    }

    const coveredEmployee = await this.prisma.employee.findUnique({
      where: { id: dto.coveredEmployeeId },
      include: { shift: true, currentBranch: true },
    });
    if (!coveredEmployee?.shiftId || !coveredEmployee.shift) {
      throw new BadRequestException('Covered employee has no shift assigned');
    }

    if (
      coveringEmployee.currentDepartmentId !==
      coveredEmployee.currentDepartmentId
    ) {
      throw new BadRequestException(
        'Department mismatch. Both employees must be in the same department.',
      );
    }

    const coveringEnd = normalizeTime(coveringEmployee.shift?.endTime);
    const coveredStart = normalizeTime(coveredEmployee.shift?.startTime);

    if (coveringEnd !== coveredStart) {
      throw new BadRequestException(
        `Shifts must be consecutive. ${coveringEmployee.fullName}'s shift ends at ${coveringEnd} but ${coveredEmployee.fullName}'s shift starts at ${coveredStart}`,
      );
    }

    const dateOnly = this.parseDateOnly(dto.date);

    const existingSwap = await this.prisma.mutualSwap.findFirst({
      where: {
        date: dateOnly,
        status: 'ACTIVE',
        OR: [
          { coveringEmployeeId: dto.coveringEmployeeId },
          { coveredEmployeeId: dto.coveredEmployeeId },
          { coveringEmployeeId: dto.coveredEmployeeId },
          { coveredEmployeeId: dto.coveringEmployeeId },
        ],
      },
    });
    if (existingSwap) {
      throw new BadRequestException(
        'A swap already exists for one of these employees on this date',
      );
    }

    const coveredShift = coveredEmployee.shift;

    const overtimeStart = this.parseShiftTime(
      normalizeTime(coveredShift.startTime),
      dto.date,
    );
    let overtimeEnd = this.parseShiftTime(
      normalizeTime(coveredShift.endTime),
      dto.date,
    );
    if (overtimeEnd <= overtimeStart) {
      overtimeEnd = new Date(overtimeEnd);
      overtimeEnd.setDate(overtimeEnd.getDate() + 1);
    }
    const overtimeMinutes = Math.round(
      (overtimeEnd.getTime() - overtimeStart.getTime()) / 60000,
    );

    const swap = await this.prisma.$transaction(async (tx) => {
      const created = await tx.mutualSwap.create({
        data: {
          date: dateOnly,
          coveringEmployeeId: dto.coveringEmployeeId,
          coveredEmployeeId: dto.coveredEmployeeId,
          coveredShiftId: coveredEmployee.shiftId!,
          branchId: coveringEmployee.currentBranchId,
          note: dto.note,
          createdById: actingUserId,
          status: 'ACTIVE',
        },
        include: {
          coveringEmployee: {
            select: { fullName: true, employeeCode: true, shift: true },
          },
          coveredEmployee: {
            select: { fullName: true, employeeCode: true, shift: true },
          },
          coveredShift: true,
        },
      });

      const coveringLog = await tx.attendanceLog.findFirst({
        where: {
          employeeId: dto.coveringEmployeeId,
          date: dateOnly,
          type: 'REGULAR',
        },
      });

      if (coveringLog) {
        await tx.attendanceLog.update({
          where: { id: coveringLog.id },
          data: {
            overtimeMinutes,
            overtimePending: true,
            note: `Double duty - covering ${coveredEmployee.fullName}'s shift`,
          },
        });
      }

      await tx.attendanceLog.upsert({
        where: {
          employeeId_date_type: {
            employeeId: dto.coveringEmployeeId,
            date: dateOnly,
            type: 'OVERTIME',
          },
        },
        create: {
          employeeId: dto.coveringEmployeeId,
          branchId: coveringEmployee.currentBranchId,
          date: dateOnly,
          type: 'OVERTIME',
          checkIn: overtimeStart,
          checkOut: overtimeEnd,
          status: 'PRESENT',
          overtimeMinutes,
          overtimePending: true,
          source: 'MANUAL',
          note: `Mutual swap - covering ${coveredEmployee.fullName}`,
        },
        update: {
          checkIn: overtimeStart,
          checkOut: overtimeEnd,
          overtimeMinutes,
          overtimePending: true,
          note: `Mutual swap - covering ${coveredEmployee.fullName}`,
        },
      });

      await tx.attendanceLog.upsert({
        where: {
          employeeId_date_type: {
            employeeId: dto.coveredEmployeeId,
            date: dateOnly,
            type: 'REGULAR',
          },
        },
        create: {
          employeeId: dto.coveredEmployeeId,
          branchId: coveredEmployee.currentBranchId,
          date: dateOnly,
          type: 'REGULAR',
          status: 'SWAP_COVERED',
          source: 'MANUAL',
          note: `Mutual swap - covered by ${coveringEmployee.fullName}`,
        },
        update: {
          status: 'SWAP_COVERED',
          note: `Mutual swap - covered by ${coveringEmployee.fullName}`,
        },
      });

      return created;
    });

    return {
      swap,
      message: `Swap created. ${coveringEmployee.fullName} will cover ${coveredEmployee.fullName}'s shift. Overtime added automatically.`,
    };
  }

  async getEligibleCoveringEmployees(coveredEmployeeId: string, _date?: string) {
    const coveredEmployee = await this.prisma.employee.findUnique({
      where: { id: coveredEmployeeId },
      include: { shift: true },
    });
    if (!coveredEmployee?.shift) {
      throw new BadRequestException('Covered employee has no shift assigned');
    }

    const coveredStartTime = normalizeTime(coveredEmployee.shift?.startTime);

    const allEmployees = await this.prisma.employee.findMany({
      where: {
        currentBranchId: coveredEmployee.currentBranchId,
        status: { in: ['ACTIVE', 'APPOINTED'] },
        id: { not: coveredEmployeeId },
        shiftId: { not: null },
      },
      include: { shift: true },
    });

    return allEmployees.filter((emp) => {
      if (!emp.shift) return false;
      const empEndTime = normalizeTime(emp.shift.endTime);
      const sameDept =
        emp.currentDepartmentId === coveredEmployee.currentDepartmentId;
      return empEndTime === coveredStartTime && sameDept;
    });
  }

  async getSwaps(filters: {
    branchId?: string;
    date?: string;
    employeeId?: string;
  }) {
    return this.prisma.mutualSwap.findMany({
      where: {
        ...(filters.branchId && { branchId: filters.branchId }),
        ...(filters.date && { date: this.parseDateOnly(filters.date) }),
        ...(filters.employeeId && {
          OR: [
            { coveringEmployeeId: filters.employeeId },
            { coveredEmployeeId: filters.employeeId },
          ],
        }),
      },
      include: {
        coveringEmployee: {
          select: {
            fullName: true,
            employeeCode: true,
            shift: true,
          },
        },
        coveredEmployee: {
          select: {
            fullName: true,
            employeeCode: true,
            shift: true,
          },
        },
        coveredShift: true,
        createdBy: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancelSwap(id: string, _actingUserId: string) {
    const swap = await this.prisma.mutualSwap.findUnique({
      where: { id },
      include: {
        coveringEmployee: { select: { fullName: true } },
        coveredEmployee: { select: { fullName: true } },
      },
    });
    if (!swap) {
      throw new NotFoundException('Swap not found');
    }
    if (swap.status === 'CANCELLED') {
      throw new BadRequestException('Already cancelled');
    }

    await this.prisma.$transaction([
      this.prisma.mutualSwap.update({
        where: { id },
        data: { status: 'CANCELLED' },
      }),
      this.prisma.attendanceLog.deleteMany({
        where: {
          employeeId: swap.coveringEmployeeId,
          date: swap.date,
          type: 'OVERTIME',
        },
      }),
      this.prisma.attendanceLog.updateMany({
        where: {
          employeeId: swap.coveringEmployeeId,
          date: swap.date,
          type: 'REGULAR',
        },
        data: {
          overtimeMinutes: 0,
          overtimePending: false,
        },
      }),
      this.prisma.attendanceLog.updateMany({
        where: {
          employeeId: swap.coveredEmployeeId,
          date: swap.date,
          type: 'REGULAR',
          status: 'SWAP_COVERED',
        },
        data: { status: 'UNMARKED', note: null },
      }),
    ]);

    return { message: 'Swap cancelled and attendance reversed' };
  }
}
