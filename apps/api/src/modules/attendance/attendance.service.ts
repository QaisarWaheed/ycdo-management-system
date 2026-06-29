import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceSource,
  AttendanceStatus,
  EmployeeStatus,
  Gender,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ApproveOvertimeDto,
  AttendanceQueryDto,
  BiometricPushDto,
  ManualAttendanceDto,
  MarkAbsenteesDto,
  RelieverSessionsQueryDto,
} from './attendance.dto';
import { applyDisciplineRules } from './discipline.helper';

const OVERTIME_GRACE_MINUTES = 60;

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  async biometricPush(dto: BiometricPushDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { biometricId: dto.biometricId },
      include: { shift: true },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with biometric ID ${dto.biometricId} not found`,
      );
    }

    if (
      employee.status !== EmployeeStatus.ACTIVE &&
      employee.status !== EmployeeStatus.TRAINEE
    ) {
      throw new BadRequestException('Employee is not active');
    }

    const checkTime = new Date(dto.timestamp);
    const dateOnly = this.toDateOnly(checkTime);

    const openRelieverSession = await this.prisma.relieverSession.findFirst({
      where: {
        employeeId: employee.id,
        date: dateOnly,
        checkOut: null,
      },
    });

    if (openRelieverSession) {
      const totalMinutes = Math.round(
        (checkTime.getTime() - openRelieverSession.checkIn.getTime()) / 60000,
      );

      const relieverSession = await this.prisma.relieverSession.update({
        where: { id: openRelieverSession.id },
        data: {
          checkOut: checkTime,
          totalMinutes,
        },
      });

      return { type: 'RELIEVER_CHECKOUT', relieverSession };
    }

    const existing = await this.prisma.attendanceLog.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: dateOnly,
        },
      },
    });

    if (!existing) {
      let { status, lateMinutes } = this.determineCheckInStatus(
        checkTime,
        employee.shift,
      );

      const log = await this.prisma.$transaction(async (tx) => {
        const effectiveStatus = await applyDisciplineRules(
          tx,
          employee.id,
          status,
          dateOnly,
          { lateMinutes },
        );

        if (effectiveStatus === AttendanceStatus.HALF_DAY) {
          status = AttendanceStatus.HALF_DAY;
          lateMinutes = 0;
        }

        const created = await tx.attendanceLog.create({
          data: {
            employeeId: employee.id,
            branchId: employee.currentBranchId,
            date: dateOnly,
            checkIn: checkTime,
            status,
            lateMinutes,
            source: AttendanceSource.BIOMETRIC,
          },
        });

        return { log: created };
      });

      return log.log;
    }

    if (!existing.checkOut) {
      const overtimeMinutes = this.calculateOvertimeMinutes(
        checkTime,
        employee.shift,
      );

      return this.prisma.attendanceLog.update({
        where: { id: existing.id },
        data: {
          checkOut: checkTime,
          overtimeMinutes,
        },
      });
    }

    const relieverSession = await this.prisma.relieverSession.create({
      data: {
        employeeId: employee.id,
        branchId: employee.currentBranchId,
        date: dateOnly,
        checkIn: checkTime,
      },
    });

    return { type: 'RELIEVER_CHECKIN', relieverSession };
  }

  async markManual(
    dto: ManualAttendanceDto,
    actingUser: { id: string; role: UserRole },
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: { shift: true },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    if (
      employee.status !== EmployeeStatus.ACTIVE &&
      employee.status !== EmployeeStatus.APPOINTED
    ) {
      throw new BadRequestException('Employee is not active');
    }

    const dateOnly = this.toDateOnly(new Date(dto.date));
    const checkIn = dto.checkIn ? new Date(dto.checkIn) : undefined;
    const checkOut = dto.checkOut ? new Date(dto.checkOut) : undefined;

    let status = dto.status;
    let lateMinutes = dto.lateMinutes ?? 0;

    if (
      checkIn &&
      (status === AttendanceStatus.PRESENT ||
        status === AttendanceStatus.LATE ||
        status === AttendanceStatus.HALF_DAY)
    ) {
      const derived = this.determineCheckInStatus(checkIn, employee.shift);
      lateMinutes = dto.lateMinutes ?? derived.lateMinutes;
      if (status === AttendanceStatus.PRESENT && derived.status === AttendanceStatus.LATE) {
        status = AttendanceStatus.LATE;
      }
    }

    let calculatedOvertime = dto.overtimeMinutes ?? 0;
    if (checkOut) {
      calculatedOvertime = this.calculateOvertimeMinutes(
        checkOut,
        employee.shift,
      );
    }

    const isSuperAdmin = actingUser.role === UserRole.SUPER_ADMIN;
    const overtimeMinutes = isSuperAdmin
      ? (dto.overtimeMinutes ?? calculatedOvertime)
      : 0;
    const overtimePending =
      !isSuperAdmin && calculatedOvertime > 0;

    const result = await this.prisma.$transaction(async (tx) => {
      let effectiveStatus = status;

      if (
        status === AttendanceStatus.LATE ||
        status === AttendanceStatus.ABSENT ||
        status === AttendanceStatus.UNINFORMED_ABSENT
      ) {
        effectiveStatus = await applyDisciplineRules(
          tx,
          dto.employeeId,
          status,
          dateOnly,
          { lateMinutes },
        );
      }

      if (effectiveStatus === AttendanceStatus.HALF_DAY) {
        status = AttendanceStatus.HALF_DAY;
        lateMinutes = 0;
      }

      const attendanceLog = await tx.attendanceLog.upsert({
        where: {
          employeeId_date: {
            employeeId: dto.employeeId,
            date: dateOnly,
          },
        },
        create: {
          employeeId: dto.employeeId,
          branchId: employee.currentBranchId,
          date: dateOnly,
          checkIn,
          checkOut,
          status,
          lateMinutes,
          overtimeMinutes,
          overtimePending,
          source: AttendanceSource.MANUAL,
          note: dto.note,
        },
        update: {
          checkIn,
          checkOut,
          status,
          lateMinutes,
          overtimeMinutes,
          overtimePending,
          source: AttendanceSource.MANUAL,
          note: dto.note,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUser.id,
          action: 'MANUAL_ATTENDANCE',
          entity: 'AttendanceLog',
          entityId: attendanceLog.id,
        },
      });

      return attendanceLog;
    });

    return result;
  }

  async approveOvertime(
    id: string,
    dto: ApproveOvertimeDto,
    actingUserId: string,
  ) {
    const log = await this.prisma.attendanceLog.findUnique({ where: { id } });

    if (!log) {
      throw new NotFoundException(`Attendance log with id ${id} not found`);
    }

    return this.prisma.attendanceLog.update({
      where: { id },
      data: {
        overtimeMinutes: dto.overtimeMinutes,
        overtimePending: false,
        overtimeApprovedBy: actingUserId,
        overtimeApprovedAt: new Date(),
      },
    });
  }

  private buildEmployeeFilterWhere(query: {
    projectId?: string;
    departmentId?: string;
    shiftId?: string;
    employeeStatus?: EmployeeStatus;
    gender?: Gender;
    designation?: string;
    district?: string;
  }): Prisma.EmployeeWhereInput | undefined {
    const employeeWhere: Prisma.EmployeeWhereInput = {};

    if (query.departmentId) {
      employeeWhere.currentDepartmentId = query.departmentId;
    }

    if (query.projectId) {
      employeeWhere.currentBranch = { projectId: query.projectId };
    }

    if (query.shiftId) {
      employeeWhere.shiftId = query.shiftId;
    }

    if (query.employeeStatus) {
      employeeWhere.status = query.employeeStatus;
    }

    if (query.gender) {
      employeeWhere.gender = query.gender;
    }

    if (query.designation) {
      employeeWhere.currentDesignation = {
        equals: query.designation,
        mode: 'insensitive',
      };
    }

    if (query.district) {
      employeeWhere.district = {
        equals: query.district,
        mode: 'insensitive',
      };
    }

    return Object.keys(employeeWhere).length > 0 ? employeeWhere : undefined;
  }

  findAll(query: AttendanceQueryDto) {
    const where: Prisma.AttendanceLogWhereInput = {};

    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }

    if (query.branchId) {
      where.branchId = query.branchId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.month && query.year) {
      const start = new Date(query.year, query.month - 1, 1);
      const end = new Date(query.year, query.month, 0);
      where.date = { gte: start, lte: end };
    } else if (query.startDate && query.endDate) {
      where.date = {
        gte: this.toDateOnly(new Date(query.startDate)),
        lte: this.toDateOnly(new Date(query.endDate)),
      };
    }

    const employeeWhere = this.buildEmployeeFilterWhere(query);
    if (employeeWhere) {
      where.employee = employeeWhere;
    }

    return this.prisma.attendanceLog.findMany({
      where,
      include: {
        employee: {
          select: { firstName: true, lastName: true, employeeCode: true },
        },
        branch: { select: { name: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  findAllRelieverSessions(query: RelieverSessionsQueryDto) {
    const where: Prisma.RelieverSessionWhereInput = {};

    if (query.branchId) {
      where.branchId = query.branchId;
    }

    if (query.startDate && query.endDate) {
      where.date = {
        gte: this.toDateOnly(new Date(query.startDate)),
        lte: this.toDateOnly(new Date(query.endDate)),
      };
    } else if (query.startDate) {
      where.date = this.toDateOnly(new Date(query.startDate));
    }

    const employeeWhere = this.buildEmployeeFilterWhere(query);
    if (employeeWhere) {
      where.employee = employeeWhere;
    }

    return this.prisma.relieverSession.findMany({
      where,
      include: {
        employee: {
          select: { firstName: true, lastName: true, employeeCode: true },
        },
        branch: { select: { name: true } },
      },
      orderBy: { checkIn: 'desc' },
    });
  }

  async getEmployeeSummary(employeeId: string, month: number, year: number) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);

    const logs = await this.prisma.attendanceLog.findMany({
      where: {
        employeeId,
        date: { gte: start, lte: end },
      },
    });

    const countByStatus = (status: AttendanceStatus) =>
      logs.filter((log) => log.status === status).length;

    return {
      totalDays: logs.length,
      present: countByStatus(AttendanceStatus.PRESENT),
      absent: countByStatus(AttendanceStatus.ABSENT),
      late: countByStatus(AttendanceStatus.LATE),
      halfDay: countByStatus(AttendanceStatus.HALF_DAY),
      onLeave: countByStatus(AttendanceStatus.ON_LEAVE),
      uninformedAbsent: countByStatus(AttendanceStatus.UNINFORMED_ABSENT),
      overtimeMinutes: logs.reduce((sum, log) => sum + log.overtimeMinutes, 0),
      totalLateMinutes: logs.reduce((sum, log) => sum + log.lateMinutes, 0),
    };
  }

  async markAbsentees(date: string) {
    const dateOnly = this.toDateOnly(new Date(date));

    const activeEmployees = await this.prisma.employee.findMany({
      where: { status: EmployeeStatus.ACTIVE },
      select: { id: true, currentBranchId: true },
    });

    const existingLogs = await this.prisma.attendanceLog.findMany({
      where: { date: dateOnly },
      select: { employeeId: true },
    });

    const loggedEmployeeIds = new Set(existingLogs.map((log) => log.employeeId));

    const absentEmployees = activeEmployees.filter(
      (emp) => !loggedEmployeeIds.has(emp.id),
    );

    if (absentEmployees.length === 0) {
      return { count: 0 };
    }

    await this.prisma.attendanceLog.createMany({
      data: absentEmployees.map((emp) => ({
        employeeId: emp.id,
        branchId: emp.currentBranchId,
        date: dateOnly,
        status: AttendanceStatus.ABSENT,
        source: AttendanceSource.MANUAL,
        note: 'Auto-marked absent',
      })),
    });

    return { count: absentEmployees.length };
  }

  async getRelieverSessions(employeeId: string, month: number, year: number) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);

    const sessions = await this.prisma.relieverSession.findMany({
      where: {
        employeeId,
        date: { gte: start, lte: end },
      },
      orderBy: { checkIn: 'desc' },
    });

    const totalMinutes = sessions.reduce(
      (sum, session) => sum + session.totalMinutes,
      0,
    );

    return {
      sessions,
      totalMinutes,
      totalHours: Math.round((totalMinutes / 60) * 100) / 100,
    };
  }

  async getActiveTimer(employeeId: string) {
    const dateOnly = this.toDateOnly(new Date());

    const attendanceLog = await this.prisma.attendanceLog.findUnique({
      where: {
        employeeId_date: {
          employeeId,
          date: dateOnly,
        },
      },
    });

    const openRelieverSession = await this.prisma.relieverSession.findFirst({
      where: {
        employeeId,
        date: dateOnly,
        checkOut: null,
      },
    });

    const checkedIn = !!attendanceLog?.checkIn;
    const hasCheckOut = !!attendanceLog?.checkOut;

    return {
      primaryShift: {
        checkedIn,
        checkIn: attendanceLog?.checkIn ?? null,
        checkOut: attendanceLog?.checkOut ?? null,
        isActive: checkedIn && !hasCheckOut,
      },
      reliever: {
        isActive: !!openRelieverSession,
        checkIn: openRelieverSession?.checkIn ?? null,
        session: openRelieverSession,
      },
    };
  }

  private determineCheckInStatus(
    checkIn: Date,
    shift: { startTime: string; endTime: string } | null,
  ): {
    status: AttendanceStatus;
    lateMinutes: number;
  } {
    const checkInMinutes = checkIn.getHours() * 60 + checkIn.getMinutes();

    if (!shift) {
      const defaultStart = 9 * 60;
      const defaultMidpoint = 13 * 60;
      if (checkInMinutes <= defaultStart + 15) {
        return { status: AttendanceStatus.PRESENT, lateMinutes: 0 };
      }
      if (checkInMinutes <= defaultMidpoint) {
        return {
          status: AttendanceStatus.LATE,
          lateMinutes: checkInMinutes - (defaultStart + 15),
        };
      }
      return { status: AttendanceStatus.HALF_DAY, lateMinutes: 0 };
    }

    const startMinutes = this.parseTimeToMinutes(shift.startTime);
    const endMinutes = this.parseTimeToMinutes(shift.endTime);
    const midpoint = Math.floor((startMinutes + endMinutes) / 2);
    const graceEnd = startMinutes + 15;

    if (checkInMinutes <= graceEnd) {
      return { status: AttendanceStatus.PRESENT, lateMinutes: 0 };
    }

    if (checkInMinutes <= midpoint) {
      return {
        status: AttendanceStatus.LATE,
        lateMinutes: checkInMinutes - graceEnd,
      };
    }

    return { status: AttendanceStatus.HALF_DAY, lateMinutes: 0 };
  }

  private calculateOvertimeMinutes(
    checkOut: Date,
    shift: { endTime: string } | null,
  ): number {
    const checkOutMinutes = checkOut.getHours() * 60 + checkOut.getMinutes();
    const endMinutes = shift
      ? this.parseTimeToMinutes(shift.endTime)
      : 18 * 60;
    const overtimeThreshold = endMinutes + OVERTIME_GRACE_MINUTES;

    if (checkOutMinutes > overtimeThreshold) {
      return checkOutMinutes - overtimeThreshold;
    }

    return 0;
  }

  private parseTimeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private toDateOnly(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }
}
