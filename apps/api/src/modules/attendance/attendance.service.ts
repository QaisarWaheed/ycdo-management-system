import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceLogType,
  AttendanceSource,
  AttendanceStatus,
  EmployeeStatus,
  Gender,
  LeaveStatus,
  Permission,
  Prisma,
  ProjectType,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import {
  ApproveOvertimeDto,
  AttendanceQueryDto,
  BiometricPushDto,
  ImportAttendanceDto,
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
  is24HourShift,
  toPakistanDateOnly,
} from './attendance-biometric.util';
import { applyDisciplineRules } from './discipline.helper';
import {
  parseAttendanceDateTime,
  resolveDutyStartTime,
  toPakistanMinutesOfDay,
} from './attendance-late.util';
import {
  calculateLateMinutesFromCheckIn,
  getShiftAttendanceDate,
  isWithinAttendanceMarkingGrace,
  minutesSinceShiftStart,
  parseTimeToMinutes,
  statusFromLateMinutes,
} from './shift-time.util';
import { haversineMeters } from './geo.helper';
import { BRANCH_LABEL_SELECT } from '../../common/branch-select.util';
import { getHierarchyPriority } from '../../common/hierarchy.util';
import { enforceBranchScope } from '../../common/branch-scope.util';
import {
  assertEmployeeInMedicineScope,
  isMedicineManagerRole,
  medicineEmployeeWhere,
} from '../../common/medicine-scope.util';

const OVERTIME_GRACE_MINUTES = 60;
const AUTO_UNMARKED_NOTE = 'Auto-marked unmarked at shift start';

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private permissionsService: PermissionsService,
  ) {}

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
    // Agent sends PKT wall-clock time; naive ISO strings are parsed as +05:00
    // so the stored UTC value is correct regardless of server timezone.
    const checkTime = parseAttendanceDateTime(dto.timestamp);
    const dateOnly = toPakistanDateOnly(checkTime);
    const twentyFourHour = is24HourShift(employee);

    let punchType = dto.punchType;

    if (!punchType) {
      if (twentyFourHour) {
        const todayLog = await this.prisma.attendanceLog.findFirst({
          where: {
            employeeId: employee.id,
            date: dateOnly,
            type: AttendanceLogType.REGULAR,
          },
        });
        punchType = todayLog?.checkIn ? 'CHECKOUT' : 'CHECKIN';
      } else {
        const openRegular = await this.findOpenRegularLog(
          employee.id,
          dateOnly,
        );

        if (openRegular) {
          punchType = 'CHECKOUT';
        } else {
          const todayLog = await this.prisma.attendanceLog.findFirst({
            where: {
              employeeId: employee.id,
              date: dateOnly,
              type: AttendanceLogType.REGULAR,
            },
          });

          if (!todayLog?.checkIn) {
            punchType = 'CHECKIN';
          } else {
            punchType = 'OVERTIME_CHECKIN';
          }
        }
      }
    }

    const isCheckout =
      punchType === 'CHECKOUT' || punchType === 'OVERTIME_CHECKIN';

    if (isCheckout) {
      if (twentyFourHour) {
        return {
          type: 'CHECKOUT_IGNORED',
          message: '24-hour shift - checkout not required',
        };
      }

      const openRegular = await this.findOpenRegularLog(
        employee.id,
        dateOnly,
      );

      if (openRegular) {
        const sessionMinutes = Math.round(
          (checkTime.getTime() - openRegular.checkIn!.getTime()) / 60000,
        );
        const overtimeMinutes = computeBiometricOvertimeMinutes(
          openRegular.checkIn!,
          checkTime,
          employee,
        );

        const lateMinutes = openRegular.lateMinutes ?? 0;
        let status = openRegular.status;
        const derivedStatus = determineBiometricCheckInStatus(
          lateMinutes,
          employee,
          sessionMinutes,
        );
        if (derivedStatus === AttendanceStatus.HALF_DAY) {
          status = AttendanceStatus.HALF_DAY;
        }

        const log = await this.prisma.attendanceLog.update({
          where: { id: openRegular.id },
          data: {
            checkOut: checkTime,
            overtimeMinutes,
            status,
          },
        });

        return { type: 'CHECKOUT', log };
      }

      const todayRegular = await this.prisma.attendanceLog.findFirst({
        where: {
          employeeId: employee.id,
          date: dateOnly,
          type: AttendanceLogType.REGULAR,
        },
      });

      if (!todayRegular?.checkIn) {
        throw new BadRequestException('No check-in found for today');
      }

      if (todayRegular.checkOut) {
        const openOvertimeLog = await this.prisma.attendanceLog.findFirst({
          where: {
            employeeId: employee.id,
            date: dateOnly,
            type: AttendanceLogType.OVERTIME,
            checkOut: null,
          },
        });

        if (openOvertimeLog) {
          const overtimeMinutes = Math.round(
            (checkTime.getTime() - openOvertimeLog.checkIn!.getTime()) / 60000,
          );

          const log = await this.prisma.attendanceLog.update({
            where: { id: openOvertimeLog.id },
            data: {
              checkOut: checkTime,
              overtimeMinutes,
            },
          });

          return { type: 'OVERTIME_CHECKOUT', log };
        }

        const log = await this.prisma.attendanceLog.create({
          data: {
            employeeId: employee.id,
            branchId,
            date: dateOnly,
            type: AttendanceLogType.OVERTIME,
            checkIn: checkTime,
            status: AttendanceStatus.PRESENT,
            source: AttendanceSource.BIOMETRIC,
          },
        });

        return { type: 'OVERTIME_CHECKIN', log };
      }

      throw new BadRequestException('No open check-in found to check out');
    }

    const lateMinutes = twentyFourHour
      ? 0
      : computeBiometricLateMinutes(checkTime, employee);
    let status = twentyFourHour
      ? AttendanceStatus.PRESENT
      : determineBiometricCheckInStatus(lateMinutes, employee, 0);

    // Any REGULAR row for today (scheduler/import may have created one first)
    const anyExisting = await this.prisma.attendanceLog.findFirst({
      where: {
        employeeId: employee.id,
        date: dateOnly,
        type: AttendanceLogType.REGULAR,
      },
    });

    if (anyExisting) {
      if (anyExisting.checkIn) {
        throw new BadRequestException('Already checked in for today');
      }

      const log = await this.prisma.$transaction(async (tx) => {
        if (!twentyFourHour) {
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
        }

        return tx.attendanceLog.update({
          where: { id: anyExisting.id },
          data: {
            checkIn: checkTime,
            status,
            source: AttendanceSource.BIOMETRIC,
            lateMinutes,
            note: twentyFourHour
              ? '24-hour shift check-in'
              : anyExisting.note,
          },
        });
      });

      return { type: 'CHECKIN', log };
    }

    const log = await this.prisma.$transaction(async (tx) => {
      if (!twentyFourHour) {
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
      }

      return tx.attendanceLog.create({
        data: {
          employeeId: employee.id,
          branchId,
          date: dateOnly,
          type: AttendanceLogType.REGULAR,
          checkIn: checkTime,
          status,
          lateMinutes,
          source: AttendanceSource.BIOMETRIC,
          note: twentyFourHour ? '24-hour shift check-in' : undefined,
        },
      });
    });

    return { type: 'CHECKIN', log };
  }

  async markManual(
    dto: ManualAttendanceDto,
    actingUser: { id: string; role: UserRole },
  ) {
    const canMark = await this.permissionsService.userHasPermission(
      actingUser.id,
      actingUser.role,
      Permission.ATTENDANCE_MARK,
    );
    if (!canMark) {
      throw new ForbiddenException(
        'You do not have permission to mark attendance',
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: {
        shift: true,
        currentDepartment: { select: { name: true } },
      },
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

    if (isMedicineManagerRole(actingUser.role)) {
      if (!assertEmployeeInMedicineScope(employee)) {
        throw new ForbiddenException(
          'You can only mark attendance for Medicine Management System staff',
        );
      }
    }

    if (
      actingUser.role === UserRole.ADMIN_MANAGER ||
      isMedicineManagerRole(actingUser.role)
    ) {
      const dutyStart =
        resolveDutyStartTime(employee) ?? '08:00';
      if (!isWithinAttendanceMarkingGrace(new Date(), dutyStart)) {
        throw new ForbiddenException(
          'Attendance can only be marked within the grace period. ' +
            'Please contact HR to mark attendance after grace time.',
        );
      }
    }

    const dateOnly = toPakistanDateOnly(
      new Date(`${dto.date}T00:00:00+05:00`),
    );
    const checkIn = dto.checkIn ? parseAttendanceDateTime(dto.checkIn) : undefined;
    const checkOut = dto.checkOut ? parseAttendanceDateTime(dto.checkOut) : undefined;

    let status = dto.status;
    let lateMinutes = dto.lateMinutes ?? 0;

    if (checkIn) {
      const dutyStart = resolveDutyStartTime(employee);
      const computedLate = dutyStart
        ? calculateLateMinutesFromCheckIn(checkIn, dutyStart)
        : this.determineCheckInStatus(checkIn, employee.shift).lateMinutes;

      if (typeof dto.lateMinutes === 'number' && dto.lateMinutes > 0) {
        lateMinutes = dto.lateMinutes;
      } else {
        lateMinutes = computedLate;
      }

      status = statusFromLateMinutes(lateMinutes);
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
          employeeId_date_type: {
            employeeId: dto.employeeId,
            date: dateOnly,
            type: AttendanceLogType.REGULAR,
          },
        },
        create: {
          employeeId: dto.employeeId,
          branchId: employee.currentBranchId,
          date: dateOnly,
          type: AttendanceLogType.REGULAR,
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
          action: 'ATTENDANCE_MARKED',
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
    const canEdit = await this.permissionsService.userHasPermission(
      actingUser.id,
      actingUser.role,
      Permission.ATTENDANCE_EDIT,
    );
    if (!canEdit) {
      throw new ForbiddenException(
        'You do not have permission to edit attendance',
      );
    }

    const log = await this.prisma.attendanceLog.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            fullName: true,
            employeeCode: true,
            dutyStartTime: true,
            currentDesignation: true,
            currentDepartment: { select: { name: true } },
            shift: { select: { startTime: true } },
          },
        },
        branch: { select: BRANCH_LABEL_SELECT },
      },
    });

    if (!log) {
      throw new NotFoundException(`Attendance log with id ${id} not found`);
    }

    if (isMedicineManagerRole(actingUser.role)) {
      if (!assertEmployeeInMedicineScope(log.employee)) {
        throw new ForbiddenException(
          'You can only update attendance for Medicine Management System staff',
        );
      }
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
      data.checkIn = dto.checkIn ? parseAttendanceDateTime(dto.checkIn) : null;
    }
    if (dto.checkOut !== undefined) {
      data.checkOut = dto.checkOut ? parseAttendanceDateTime(dto.checkOut) : null;
    }

    const effectiveCheckIn =
      dto.checkIn !== undefined
        ? dto.checkIn
          ? parseAttendanceDateTime(dto.checkIn)
          : null
        : log.checkIn;

    if (dto.status === undefined && effectiveCheckIn) {
      const dutyStart = resolveDutyStartTime(log.employee);
      if (dutyStart) {
        const lateMinutes = calculateLateMinutesFromCheckIn(
          effectiveCheckIn,
          dutyStart,
        );
        data.status = statusFromLateMinutes(lateMinutes);
        data.lateMinutes = lateMinutes;
      }
    }

    if (dto.checkIn && log.note?.toLowerCase().includes('auto-marked')) {
      data.note = dto.note ?? '';
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
      let updateData = { ...data };

      if (
        effectiveCheckIn &&
        updateData.status &&
        (updateData.status === AttendanceStatus.LATE ||
          updateData.status === AttendanceStatus.HALF_DAY)
      ) {
        updateData.status = await applyDisciplineRules(
          tx,
          log.employeeId,
          updateData.status as AttendanceStatus,
          log.date,
          { lateMinutes: (updateData.lateMinutes as number | undefined) ?? 0 },
        );
      }

      const result = await tx.attendanceLog.update({
        where: { id },
        data: updateData,
        include: {
          employee: {
            select: { fullName: true, employeeCode: true },
          },
          branch: { select: BRANCH_LABEL_SELECT },
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
    shiftName?: string;
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

    if (query.shiftName) {
      employeeWhere.shift = {
        name: query.shiftName,
        isActive: true,
      };
    } else if (query.shiftIds) {
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
        {
          currentBranch: {
            name: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }

    return Object.keys(employeeWhere).length > 0 ? employeeWhere : undefined;
  }

  private referenceTimeForCalendarDate(dateOnly: Date, isToday: boolean): Date {
    if (isToday) {
      return new Date();
    }

    const y = dateOnly.getUTCFullYear();
    const mo = String(dateOnly.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateOnly.getUTCDate()).padStart(2, '0');
    return new Date(`${y}-${mo}-${d}T23:59:00+05:00`);
  }

  private async ensureUnmarkedForActiveShiftsOnDate(
    dateOnly: Date,
    employeeWhere?: Prisma.EmployeeWhereInput,
  ): Promise<void> {
    const pkToday = toPakistanDateOnly(new Date());
    if (dateOnly.getTime() > pkToday.getTime()) {
      return;
    }

    const isToday = dateOnly.getTime() === pkToday.getTime();
    const referenceTime = this.referenceTimeForCalendarDate(dateOnly, isToday);
    const nowMinutes = isToday ? toPakistanMinutesOfDay(new Date()) : 1440;

    const shifts = await this.prisma.shift.findMany({
      where: { isActive: true },
    });

    for (const shift of shifts) {
      const attendanceDate = getShiftAttendanceDate(
        referenceTime,
        shift.startTime,
      );
      if (attendanceDate.getTime() !== dateOnly.getTime()) {
        continue;
      }

      if (isToday) {
        const shiftStartMinutes = parseTimeToMinutes(shift.startTime);
        if (minutesSinceShiftStart(nowMinutes, shiftStartMinutes) < 0) {
          continue;
        }
      }

      await this.ensureUnmarkedLogsForShift(
        shift.id,
        dateOnly,
        employeeWhere,
      );
    }
  }

  private async ensureUnmarkedLogsForShift(
    shiftId: string,
    date: Date,
    employeeWhere?: Prisma.EmployeeWhereInput,
  ): Promise<void> {
    const employees = await this.prisma.employee.findMany({
      where: {
        shiftId,
        status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.APPOINTED] },
        ...(employeeWhere ?? {}),
      },
      select: {
        id: true,
        currentBranchId: true,
      },
    });

    for (const employee of employees) {
      const onLeave = await this.prisma.leaveRecord.findFirst({
        where: {
          employeeId: employee.id,
          status: LeaveStatus.APPROVED,
          startDate: { lte: date },
          endDate: { gte: date },
        },
        select: { id: true },
      });
      if (onLeave) {
        continue;
      }

      const existing = await this.prisma.attendanceLog.findUnique({
        where: {
          employeeId_date_type: {
            employeeId: employee.id,
            date,
            type: AttendanceLogType.REGULAR,
          },
        },
      });

      if (!existing) {
        await this.prisma.attendanceLog.create({
          data: {
            employeeId: employee.id,
            branchId: employee.currentBranchId,
            date,
            type: AttendanceLogType.REGULAR,
            status: AttendanceStatus.UNMARKED,
            source: AttendanceSource.MANUAL,
            note: AUTO_UNMARKED_NOTE,
          },
        });
      }
    }
  }

  async findAll(
    query: AttendanceQueryDto,
    actingUser?: { role: UserRole | string; branchId?: string | null },
  ) {
    enforceBranchScope(query, actingUser);

    const { search, ...filterQuery } = query;
    const employeeWhere = this.buildEmployeeFilterWhere(filterQuery);
    const medicineWhere = isMedicineManagerRole(actingUser?.role)
      ? medicineEmployeeWhere()
      : undefined;

    const scopedEmployeeWhere: Prisma.EmployeeWhereInput | undefined =
      employeeWhere && medicineWhere
        ? { AND: [employeeWhere, medicineWhere] }
        : employeeWhere ?? medicineWhere;

    const isSingleDay =
      !!query.startDate &&
      !!query.endDate &&
      query.startDate === query.endDate;

    const shouldEnsureUnmarked =
      isSingleDay &&
      (!query.status || query.status === AttendanceStatus.UNMARKED);

    if (shouldEnsureUnmarked) {
      await this.ensureUnmarkedForActiveShiftsOnDate(
        this.toDateOnly(new Date(query.startDate!)),
        scopedEmployeeWhere,
      );
    }

    const where: Prisma.AttendanceLogWhereInput = {
      type: AttendanceLogType.REGULAR,
    };

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

    if (scopedEmployeeWhere) {
      where.employee = scopedEmployeeWhere;
    }

    if (search) {
      const searchFilter: Prisma.AttendanceLogWhereInput = {
        OR: [
          {
            employee: {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { employeeCode: { contains: search, mode: 'insensitive' } },
                { cnic: { contains: search, mode: 'insensitive' } },
                {
                  currentBranch: {
                    name: { contains: search, mode: 'insensitive' },
                  },
                },
              ],
            },
          },
          { branch: { name: { contains: search, mode: 'insensitive' } } },
        ],
      };
      where.AND = where.AND
        ? Array.isArray(where.AND)
          ? [...where.AND, searchFilter]
          : [where.AND, searchFilter]
        : [searchFilter];
    }

    const logs = await this.prisma.attendanceLog.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            cnic: true,
            phone: true,
            currentDesignation: true,
            currentDepartmentId: true,
            dutyStartTime: true,
            dutyEndTime: true,
            currentBranch: { select: BRANCH_LABEL_SELECT },
            currentDepartment: { select: { name: true } },
            shift: {
              select: { name: true, startTime: true, endTime: true },
            },
          },
        },
        branch: { select: BRANCH_LABEL_SELECT },
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
          select: { id: true, fullName: true, employeeCode: true },
        },
        branch: { select: BRANCH_LABEL_SELECT },
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
      unmarked: countByStatus(AttendanceStatus.UNMARKED),
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
      where: { date: dateOnly, type: AttendanceLogType.REGULAR },
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
        status: AttendanceStatus.UNMARKED,
        source: AttendanceSource.MANUAL,
        note: 'Auto-marked unmarked',
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
        employeeId_date_type: {
          employeeId,
          date: dateOnly,
          type: AttendanceLogType.REGULAR,
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
        employeeId_date_type: {
          employeeId,
          date: dateOnly,
          type: AttendanceLogType.REGULAR,
        },
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
          employeeId_date_type: {
            employeeId,
            date: dateOnly,
            type: AttendanceLogType.REGULAR,
          },
        },
        create: {
          employeeId,
          branchId: employee.currentBranchId,
          date: dateOnly,
          type: AttendanceLogType.REGULAR,
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
        employeeId_date_type: {
          employeeId,
          date: dateOnly,
          type: AttendanceLogType.REGULAR,
        },
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
    const checkInMinutes = toPakistanMinutesOfDay(checkIn);

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
    const checkOutMinutes = toPakistanMinutesOfDay(checkOut);
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

  /** Pakistan calendar date one day before `dateOnly` (UTC date parts). */
  private pakistanYesterday(dateOnly: Date): Date {
    const yesterday = new Date(dateOnly);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return yesterday;
  }

  /**
   * Open REGULAR session for checkout: today's log first, then yesterday
   * (night shift check-in before midnight, checkout after).
   */
  private findOpenRegularLog(employeeId: string, dateOnly: Date) {
    return this.prisma.attendanceLog
      .findFirst({
        where: {
          employeeId,
          date: dateOnly,
          type: AttendanceLogType.REGULAR,
          checkIn: { not: null },
          checkOut: null,
        },
      })
      .then((todayOpen) => {
        if (todayOpen) return todayOpen;
        return this.prisma.attendanceLog.findFirst({
          where: {
            employeeId,
            date: this.pakistanYesterday(dateOnly),
            type: AttendanceLogType.REGULAR,
            checkIn: { not: null },
            checkOut: null,
          },
        });
      });
  }

  async importRecord(
    dto: ImportAttendanceDto,
    actingUserId: string,
  ) {
    const dateOnly = toPakistanDateOnly(
      new Date(`${dto.date}T00:00:00+05:00`),
    );
    const type = dto.type ?? AttendanceLogType.REGULAR;

    const existing = await this.prisma.attendanceLog.findFirst({
      where: { employeeId: dto.employeeId, date: dateOnly, type },
    });

    if (existing) {
      return this.prisma.attendanceLog.update({
        where: { id: existing.id },
        data: {
          checkIn: dto.checkIn
            ? parseAttendanceDateTime(dto.checkIn)
            : existing.checkIn,
          checkOut: dto.checkOut
            ? parseAttendanceDateTime(dto.checkOut)
            : existing.checkOut,
          status: dto.status,
          note: dto.note,
          source: AttendanceSource.MANUAL,
        },
      });
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { currentBranchId: true },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    if (!employee.currentBranchId) {
      throw new BadRequestException(
        'Employee has no branch assignment for attendance import',
      );
    }

    return this.prisma.attendanceLog.create({
      data: {
        employeeId: dto.employeeId,
        branchId: employee.currentBranchId,
        date: dateOnly,
        type,
        checkIn: dto.checkIn ? parseAttendanceDateTime(dto.checkIn) : null,
        checkOut: dto.checkOut ? parseAttendanceDateTime(dto.checkOut) : null,
        status: dto.status,
        source: AttendanceSource.MANUAL,
        note: dto.note,
      },
    });
  }
}
