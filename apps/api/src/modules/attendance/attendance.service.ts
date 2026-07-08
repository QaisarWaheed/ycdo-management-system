import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceSource,
  AttendanceStatus,
  EmployeeStatus,
  Gender,
  Prisma,
  ProjectType,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ApproveOvertimeDto,
  AttendanceQueryDto,
  BiometricPushDto,
  ManualAttendanceDto,
  MarkAbsenteesDto,
  PortalCheckDto,
  RelieverSessionsQueryDto,
  UpdateAttendanceDto,
} from './attendance.dto';
import {
  computeBiometricLateMinutes,
  computeBiometricOvertimeMinutes,
  determineBiometricCheckInStatus,
  toPakistanDateOnly,
} from './attendance-biometric.util';
import { applyDisciplineRules } from './discipline.helper';
import {
  computeLateMinutesFromCheckIn,
  resolveDutyStartTime,
} from './attendance-late.util';
import { haversineMeters } from './geo.helper';
import { getHierarchyPriority } from '../employees/employee-hierarchy';

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

    const device = dto.deviceId
      ? await this.prisma.biometricDevice.findUnique({
          where: { deviceId: dto.deviceId },
        })
      : null;

    const branchId = device?.branchId ?? employee.currentBranchId;
    const checkTime = new Date(dto.timestamp);
    const dateOnly = toPakistanDateOnly(checkTime);

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
      const lateMinutes = computeBiometricLateMinutes(checkTime, employee);
      let status = determineBiometricCheckInStatus(
        lateMinutes,
        employee,
        0,
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
        }

        const created = await tx.attendanceLog.create({
          data: {
            employeeId: employee.id,
            branchId,
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
      const sessionMinutes = Math.round(
        (checkTime.getTime() - existing.checkIn!.getTime()) / 60000,
      );
      const overtimeMinutes = computeBiometricOvertimeMinutes(
        existing.checkIn!,
        checkTime,
        employee,
      );

      const lateMinutes = existing.lateMinutes ?? 0;
      let status = existing.status;
      const derivedStatus = determineBiometricCheckInStatus(
        lateMinutes,
        employee,
        sessionMinutes,
      );
      if (derivedStatus === AttendanceStatus.HALF_DAY) {
        status = AttendanceStatus.HALF_DAY;
      }

      return this.prisma.attendanceLog.update({
        where: { id: existing.id },
        data: {
          checkOut: checkTime,
          overtimeMinutes,
          status,
        },
      });
    }

    const relieverSession = await this.prisma.relieverSession.create({
      data: {
        employeeId: employee.id,
        branchId,
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
      const dutyStart = resolveDutyStartTime(employee);
      const computedLate = dutyStart
        ? computeLateMinutesFromCheckIn(checkIn, dutyStart)
        : this.determineCheckInStatus(checkIn, employee.shift).lateMinutes;

      if (typeof dto.lateMinutes === 'number' && dto.lateMinutes > 0) {
        lateMinutes = dto.lateMinutes;
      } else {
        lateMinutes = computedLate;
      }

      const derived = this.determineCheckInStatus(checkIn, employee.shift);
      if (
        status === AttendanceStatus.PRESENT &&
        derived.status === AttendanceStatus.LATE
      ) {
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

  async updateAttendance(
    id: string,
    dto: UpdateAttendanceDto,
    actingUser: { id: string; role: UserRole },
  ) {
    const log = await this.prisma.attendanceLog.findUnique({
      where: { id },
      include: {
        employee: {
          select: { fullName: true, employeeCode: true },
        },
        branch: { select: { name: true, address: true } },
      },
    });

    if (!log) {
      throw new NotFoundException(`Attendance log with id ${id} not found`);
    }

    if (
      dto.overtimeMinutes !== undefined &&
      actingUser.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only Super Admin can update overtime minutes',
      );
    }

    const previous = {
      status: log.status,
      checkIn: log.checkIn,
      checkOut: log.checkOut,
      lateMinutes: log.lateMinutes,
      overtimeMinutes: log.overtimeMinutes,
      note: log.note,
    };

    const data: Prisma.AttendanceLogUpdateInput = {};

    if (dto.status !== undefined) {
      data.status = dto.status;
    }
    if (dto.checkIn !== undefined) {
      data.checkIn = dto.checkIn ? new Date(dto.checkIn) : null;
    }
    if (dto.checkOut !== undefined) {
      data.checkOut = dto.checkOut ? new Date(dto.checkOut) : null;
    }
    if (dto.lateMinutes !== undefined) {
      data.lateMinutes = dto.lateMinutes;
    }
    if (dto.note !== undefined) {
      data.note = dto.note;
    }
    if (
      dto.overtimeMinutes !== undefined &&
      actingUser.role === UserRole.SUPER_ADMIN
    ) {
      data.overtimeMinutes = dto.overtimeMinutes;
      data.overtimePending = false;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.attendanceLog.update({
        where: { id },
        data,
        include: {
          employee: {
            select: { fullName: true, employeeCode: true },
          },
          branch: { select: { name: true, address: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUser.id,
          action: 'ATTENDANCE_UPDATED',
          entity: 'AttendanceLog',
          entityId: id,
          changes: {
            previous,
            updated: {
              status: result.status,
              checkIn: result.checkIn,
              checkOut: result.checkOut,
              lateMinutes: result.lateMinutes,
              overtimeMinutes: result.overtimeMinutes,
              note: result.note,
            },
          },
        },
      });

      return result;
    });

    return updated;
  }

  private buildEmployeeFilterWhere(query: {
    projectId?: string;
    project?: ProjectType;
    departmentId?: string;
    shiftId?: string;
    shiftIds?: string;
    employeeStatus?: EmployeeStatus;
    gender?: Gender;
    designation?: string;
    district?: string;
    bloodGroup?: string;
    search?: string;
  }): Prisma.EmployeeWhereInput | undefined {
    const employeeWhere: Prisma.EmployeeWhereInput = {};

    if (query.departmentId) {
      employeeWhere.currentDepartmentId = query.departmentId;
    }

    if (query.projectId) {
      employeeWhere.currentBranch = {
        ...(employeeWhere.currentBranch as Prisma.BranchWhereInput | undefined),
        projectId: query.projectId,
      };
    }

    if (query.project) {
      employeeWhere.currentBranch = {
        ...(employeeWhere.currentBranch as Prisma.BranchWhereInput | undefined),
        project: { type: query.project },
      };
    }

    if (query.shiftIds) {
      const ids = query.shiftIds.split(',').filter(Boolean);
      if (ids.length > 0) {
        employeeWhere.shiftId = { in: ids };
      }
    } else if (query.shiftId) {
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

    if (query.bloodGroup) {
      employeeWhere.bloodGroup = query.bloodGroup;
    }

    if (query.search) {
      employeeWhere.OR = [
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { employeeCode: { contains: query.search, mode: 'insensitive' } },
        { cnic: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return Object.keys(employeeWhere).length > 0 ? employeeWhere : undefined;
  }

  async findAll(query: AttendanceQueryDto) {
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

    const logs = await this.prisma.attendanceLog.findMany({
      where,
      include: {
        employee: {
          select: {
            fullName: true,
            employeeCode: true,
            phone: true,
            currentDesignation: true,
            dutyStartTime: true,
            currentBranch: { select: { name: true, address: true } },
            currentDepartment: { select: { name: true } },
            shift: { select: { startTime: true } },
          },
        },
        branch: { select: { name: true, address: true } },
      },
      orderBy: { date: 'desc' },
    });

    return logs.sort((a, b) => {
      const aPriority = getHierarchyPriority(
        a.employee?.currentDesignation ?? '',
      );
      const bPriority = getHierarchyPriority(
        b.employee?.currentDesignation ?? '',
      );
      if (aPriority !== bPriority) return aPriority - bPriority;
      return (a.employee?.fullName ?? '').localeCompare(
        b.employee?.fullName ?? '',
      );
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
          select: { fullName: true, employeeCode: true },
        },
        branch: { select: { name: true, address: true } },
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

  async portalCheckIn(employeeId: string, lat: number, lng: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        shift: true,
        currentBranch: { include: { location: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id ${employeeId} not found`);
    }

    const branchLocation = employee.currentBranch.location;
    if (!branchLocation) {
      throw new BadRequestException(
        'Branch location not configured. Contact HR to enable portal check-in.',
      );
    }

    const distance = haversineMeters(
      lat,
      lng,
      branchLocation.latitude,
      branchLocation.longitude,
    );

    if (distance > branchLocation.radius) {
      throw new BadRequestException(
        `You must be within ${branchLocation.radius}m of your branch. Current distance: ${Math.round(distance)}m`,
      );
    }

    const checkTime = new Date();
    const dateOnly = this.toDateOnly(checkTime);

    const existing = await this.prisma.attendanceLog.findUnique({
      where: {
        employeeId_date: { employeeId, date: dateOnly },
      },
    });

    if (existing?.checkIn) {
      throw new BadRequestException('Already checked in today');
    }

    let { status, lateMinutes } = this.determineCheckInStatus(
      checkTime,
      employee.shift,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.portalAttendance.create({
        data: {
          employeeId,
          type: 'CHECK_IN',
          latitude: lat,
          longitude: lng,
          timestamp: checkTime,
          verified: true,
        },
      });

      const effectiveStatus = await applyDisciplineRules(
        tx,
        employeeId,
        status,
        dateOnly,
        { lateMinutes },
      );

      if (effectiveStatus === AttendanceStatus.HALF_DAY) {
        status = AttendanceStatus.HALF_DAY;
      }

      await tx.attendanceLog.upsert({
        where: {
          employeeId_date: { employeeId, date: dateOnly },
        },
        create: {
          employeeId,
          branchId: employee.currentBranchId,
          date: dateOnly,
          checkIn: checkTime,
          status,
          lateMinutes,
          source: AttendanceSource.MANUAL,
          note: 'Portal check-in',
        },
        update: {
          checkIn: checkTime,
          status,
          lateMinutes,
          source: AttendanceSource.MANUAL,
          note: 'Portal check-in',
        },
      });
    });

    if (employee.biometricId) {
      await this.biometricPush({
        biometricId: employee.biometricId,
        timestamp: checkTime.toISOString(),
      }).catch(() => undefined);
    }

    return {
      success: true,
      distance: Math.round(distance),
      message: 'Check-in recorded',
    };
  }

  async portalCheckOut(employeeId: string, lat: number, lng: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        shift: true,
        currentBranch: { include: { location: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id ${employeeId} not found`);
    }

    const branchLocation = employee.currentBranch.location;
    if (!branchLocation) {
      throw new BadRequestException(
        'Branch location not configured. Contact HR to enable portal check-in.',
      );
    }

    const distance = haversineMeters(
      lat,
      lng,
      branchLocation.latitude,
      branchLocation.longitude,
    );

    if (distance > branchLocation.radius) {
      throw new BadRequestException(
        `You must be within ${branchLocation.radius}m of your branch. Current distance: ${Math.round(distance)}m`,
      );
    }

    const checkTime = new Date();
    const dateOnly = this.toDateOnly(checkTime);

    const existing = await this.prisma.attendanceLog.findUnique({
      where: {
        employeeId_date: { employeeId, date: dateOnly },
      },
    });

    if (!existing?.checkIn) {
      throw new BadRequestException('Must check in before checking out');
    }

    if (existing.checkOut) {
      throw new BadRequestException('Already checked out today');
    }

    const overtimeMinutes = this.calculateOvertimeMinutes(
      checkTime,
      employee.shift,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.portalAttendance.create({
        data: {
          employeeId,
          type: 'CHECK_OUT',
          latitude: lat,
          longitude: lng,
          timestamp: checkTime,
          verified: true,
        },
      });

      await tx.attendanceLog.update({
        where: { id: existing.id },
        data: { checkOut: checkTime, overtimeMinutes },
      });
    });

    const hoursWorked =
      Math.round(
        ((checkTime.getTime() - existing.checkIn!.getTime()) / 3600000) * 100,
      ) / 100;

    return { success: true, hoursWorked, distance: Math.round(distance) };
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
      return {
        status: AttendanceStatus.HALF_DAY,
        lateMinutes: checkInMinutes - (defaultStart + 15),
      };
    }

    const startMinutes = this.parseTimeToMinutes(shift.startTime);
    const endMinutes = this.parseTimeToMinutes(shift.endTime);
    const midpoint = Math.floor((startMinutes + endMinutes) / 2);
    const graceEnd = startMinutes + 15;

    if (checkInMinutes <= graceEnd) {
      return { status: AttendanceStatus.PRESENT, lateMinutes: 0 };
    }

    const lateMinutes = checkInMinutes - graceEnd;

    if (checkInMinutes <= midpoint) {
      return {
        status: AttendanceStatus.LATE,
        lateMinutes,
      };
    }

    return { status: AttendanceStatus.HALF_DAY, lateMinutes };
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
