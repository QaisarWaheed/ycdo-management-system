import {
  BadRequestException,
  ConflictException,
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
  RelieverRequestStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScopeService } from '../permissions/access-scope.service';
import { PermissionsService } from '../permissions/permissions.service';
import {
  ApproveOvertimeDto,
  AttendanceQueryDto,
  BiometricPushDto,
  ImportAttendanceDto,
  ManualAttendanceDto,
  MarkAbsenteesDto,
  PortalCheckDto,
  RawScanDto,
  RelieverCheckInDto,
  RelieverCheckOutDto,
  RelieverSessionsQueryDto,
  UpdateAttendanceDto,
} from './attendance.dto';
import {
  computeBiometricLateMinutes,
  computeBiometricOvertimeMinutes,
  computePreDutyOvertimeMinutes,
  determineBiometricCheckInStatus,
  is24HourShift,
  isOvernightShift,
  toPakistanDateOnly,
} from './attendance-biometric.util';
import { mapDeviceStatusToPunchType } from './device-status.util';
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
import { buildEffectiveRoles } from '../../common/user-roles.util';
import {
  assertEmployeeInMedicineScope,
  isMedicineManagerRole,
  medicineEmployeeWhere,
} from '../../common/medicine-scope.util';
import {
  DUTY_FILTER_GRACE_MINUTES,
  getDutyWindow,
  isOnDutyAt,
} from '../../common/duty.util';

const OVERTIME_GRACE_MINUTES = 60;
const AUTO_UNMARKED_NOTE = 'Auto-marked unmarked at shift start';
const FULL_ATTENDANCE_EDIT_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.IT_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_EXECUTIVE,
];

/** Branch admins may mark check-in/out once; only HR/IT may modify afterwards. */
const ATTENDANCE_MARK_ONLY_ROLES: UserRole[] = [
  UserRole.ADMIN_MANAGER,
  UserRole.ADMIN_OFFICER,
  UserRole.MEDICINE_MANAGER,
];

const ATTENDANCE_ALREADY_MARKED_MESSAGE =
  'Attendance already marked and cannot be modified. Please contact HR to update attendance.';

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private permissionsService: PermissionsService,
    private accessScopeService: AccessScopeService,
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

    if (!dto.punchType) {
      throw new BadRequestException(
        'punchType is required (CHECKIN, CHECKOUT, OVERTIME_CHECKIN, OVERTIME_CHECKOUT, or AUTO)',
      );
    }

    const device = dto.deviceId
      ? await this.prisma.biometricDevice.findUnique({
          where: { deviceId: dto.deviceId },
        })
      : null;

    // The employee's posting is the source of truth for which branch a log
    // belongs to. The device only tells us where the punch physically happened,
    // and a mis-registered or shared device used to stamp logs with a branch
    // that disagreed with the employee's profile.
    const branchId = employee.currentBranchId ?? device?.branchId ?? null;
    // Always use API/server time in Pakistan — ignore device/agent clock (often wrong TZ).
    const checkTime = new Date();
    const dateOnly = toPakistanDateOnly(checkTime);
    const twentyFourHour = is24HourShift(employee);

    return this.processResolvedPunch(
      employee,
      branchId,
      dto.punchType,
      checkTime,
      dateOnly,
      twentyFourHour,
    );
  }

  /**
   * POST /attendance/raw-scan — thin-agent contract. The agent forwards the
   * device's raw event verbatim; no status mapping, dedup, or CHECKIN/
   * CHECKOUT guessing happens on the agent side, all of it happens here.
   *
   * Runs in parallel with biometricPush()/POST /attendance/biometric-push,
   * which is unchanged and keeps working for branches still on the old
   * agent. Both endpoints ultimately call the same processResolvedPunch(),
   * so attendance business rules cannot drift between them.
   */
  async rawScan(dto: RawScanDto) {
    // Cheap idempotency pre-check before touching anything else. A replayed
    // delivery of an already-handled event short-circuits here.
    const existingEvent = await this.prisma.processedDeviceEvent.findUnique({
      where: {
        deviceId_serialNo: { deviceId: dto.deviceId, serialNo: dto.serialNo },
      },
    });
    if (existingEvent) {
      return { idempotent: true as const };
    }

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

    const device = await this.prisma.biometricDevice.findUnique({
      where: { deviceId: dto.deviceId },
    });
    const branchId = employee.currentBranchId ?? device?.branchId ?? null;
    const checkTime = new Date();
    const dateOnly = toPakistanDateOnly(checkTime);
    const twentyFourHour = is24HourShift(employee);

    // Devices are in T&A Manual mode and already report CHECKIN/CHECKOUT —
    // use that. AUTO is only a fallback for a status we can't map.
    const resolvedStatus = mapDeviceStatusToPunchType(dto.deviceStatus);
    const punchType:
      | 'CHECKIN'
      | 'CHECKOUT'
      | 'OVERTIME_CHECKIN'
      | 'OVERTIME_CHECKOUT'
      | 'AUTO' = resolvedStatus ?? 'AUTO';

    return this.prisma.$transaction(async (tx) => {
      // Claim the idempotency slot in the SAME transaction as the attendance
      // write below. If the write throws, this rolls back too, so a genuine
      // retry after a failure is reprocessed rather than silently dropped.
      try {
        await tx.processedDeviceEvent.create({
          data: {
            deviceId: dto.deviceId,
            serialNo: dto.serialNo,
            biometricId: dto.biometricId,
            employeeId: employee.id,
            punchType,
            rawStatus: dto.deviceStatus,
          },
        });
      } catch (err: unknown) {
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === 'P2002'
        ) {
          // Lost a race to a concurrent delivery of the identical event.
          return { idempotent: true as const };
        }
        throw err;
      }

      const result = await this.processResolvedPunch(
        employee,
        branchId,
        punchType,
        checkTime,
        dateOnly,
        twentyFourHour,
        tx,
      );

      return { idempotent: false as const, ...result };
    });
  }

  /**
   * Shared AUTO-resolution + duplicate guards + dispatch for both
   * biometricPush() and rawScan(). Behavior is byte-for-byte what
   * biometricPush() did inline before this method existed — extracted so
   * both endpoints can never drift apart on attendance business rules.
   */
  private async processResolvedPunch(
    employee: {
      id: string;
      dutyStartTime?: string | null;
      dutyEndTime?: string | null;
      shift: { startTime: string; endTime: string } | null;
    },
    branchId: string | null,
    initialPunchType:
      | 'CHECKIN'
      | 'CHECKOUT'
      | 'OVERTIME_CHECKIN'
      | 'OVERTIME_CHECKOUT'
      | 'AUTO',
    checkTime: Date,
    dateOnly: Date,
    twentyFourHour: boolean,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    let punchType = initialPunchType;

    // AUTO: no usable status — open REGULAR session → checkout, else check-in.
    // A still-open session from *yesterday* only counts here for a genuine
    // overnight shift (e.g. 20:00-04:00). For a non-overnight shift, an
    // unclosed prior-day session is stale/abandoned, not "the same shift
    // continuing" — it must not make today's fresh punch resolve to a
    // checkout against yesterday's row.
    if (punchType === 'AUTO') {
      const openRegular = twentyFourHour
        ? null
        : await this.findOpenRegularLogForAuto(employee, dateOnly);
      punchType = openRegular ? 'CHECKOUT' : 'CHECKIN';
    }

    // Hard guards — never silently convert an explicit punch type.
    // Duplicate-CHECKIN detection is scoped to TODAY only. It must never
    // consult yesterday's record: an unclosed prior-day session (missed
    // checkout, or a still-open overnight session) is not a duplicate of a
    // fresh check-in today, and must not block it.
    if (punchType === 'CHECKIN') {
      const openRegularToday = await this.findOpenRegularLogForDate(
        employee.id,
        dateOnly,
      );
      if (openRegularToday?.checkIn) {
        if (openRegularToday.status === AttendanceStatus.UNMARKED) {
          // checkIn is set but status was never finalized — fix it and
          // report success instead of rejecting as a duplicate.
          const log = await this.reconcileUnmarkedCheckIn(
            db,
            employee,
            openRegularToday,
            twentyFourHour,
          );
          return { type: 'CHECKIN' as const, log, reconciled: true };
        }
        throw new ConflictException(
          'Employee already checked in. Duplicate CHECKIN rejected.',
        );
      }
    }

    if (punchType === 'CHECKOUT' && !twentyFourHour) {
      const openRegular = await this.findOpenRegularLog(employee.id, dateOnly);
      if (!openRegular) {
        throw new BadRequestException(
          'No open check-in found for this employee today.',
        );
      }
    }

    if (punchType === 'OVERTIME_CHECKIN') {
      await this.assertRegularShiftCompletedForOvertime(
        employee.id,
        dateOnly,
      );
      const existingOt = await this.findOvertimeLogForDate(
        employee.id,
        dateOnly,
      );
      if (existingOt?.checkIn) {
        throw new ConflictException(
          'Employee already has an overtime check-in today.',
        );
      }
    }

    if (punchType === 'OVERTIME_CHECKOUT') {
      const openOt = await this.findOpenOvertimeLog(employee.id, dateOnly);
      if (!openOt) {
        throw new BadRequestException(
          'No open overtime check-in found for this employee today.',
        );
      }
    }

    if (punchType === 'CHECKOUT') {
      return this.biometricRegularCheckout(
        employee,
        branchId,
        checkTime,
        dateOnly,
        twentyFourHour,
        db,
      );
    }

    if (punchType === 'OVERTIME_CHECKIN') {
      return this.biometricOvertimeCheckIn(
        employee,
        branchId,
        checkTime,
        dateOnly,
        AttendanceSource.BIOMETRIC,
        db,
      );
    }

    if (punchType === 'OVERTIME_CHECKOUT') {
      return this.biometricOvertimeCheckOut(employee, checkTime, dateOnly, db);
    }

    // CHECKIN
    return this.biometricRegularCheckIn(
      employee,
      branchId,
      checkTime,
      dateOnly,
      twentyFourHour,
      db,
    );
  }

  /**
   * Runs fn against `db`. If `db` is the top-level PrismaService, opens a
   * fresh transaction around it (identical to the old inline
   * `this.prisma.$transaction(...)` calls). If `db` is already an active
   * transaction client (passed down from an outer caller, e.g. rawScan),
   * runs fn directly against it instead of nesting a second transaction —
   * Prisma does not support nested $transaction calls on a TransactionClient.
   */
  private runInTx<T>(
    db: PrismaService | Prisma.TransactionClient,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if ('$transaction' in db) {
      return db.$transaction(fn);
    }
    return fn(db);
  }

  /**
   * Self-heal a row that has checkIn set but was never finalized to a real
   * status. Should not occur via any current write path (every path that
   * sets checkIn also sets status in the same write) — this is a defensive
   * safety net for legacy/corrupted rows. Recomputes status from the row's
   * own already-stored checkIn time; does not re-run discipline rules
   * (deductions/letters), since this repairs a data-hygiene issue, it does
   * not represent a new attendance event.
   */
  private async reconcileUnmarkedCheckIn(
    db: PrismaService | Prisma.TransactionClient,
    employee: {
      dutyStartTime?: string | null;
      dutyEndTime?: string | null;
      shift: { startTime: string; endTime: string } | null;
    },
    existing: { id: string; checkIn: Date | null },
    twentyFourHour: boolean,
  ) {
    const checkIn = existing.checkIn;
    const lateMinutes = twentyFourHour
      ? 0
      : computeBiometricLateMinutes(checkIn, employee);
    const status = twentyFourHour
      ? AttendanceStatus.PRESENT
      : determineBiometricCheckInStatus(lateMinutes, employee, 0);

    return db.attendanceLog.update({
      where: { id: existing.id },
      data: { status, lateMinutes },
    });
  }

  private async biometricRegularCheckIn(
    employee: {
      id: string;
      dutyStartTime?: string | null;
      dutyEndTime?: string | null;
      shift: { startTime: string; endTime: string } | null;
    },
    branchId: string | null,
    checkTime: Date,
    dateOnly: Date,
    twentyFourHour: boolean,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const lateMinutes = twentyFourHour
      ? 0
      : computeBiometricLateMinutes(checkTime, employee);
    // An early arrival past the threshold already earns overtime at check-in.
    const preDutyOvertimeMinutes = twentyFourHour
      ? 0
      : computePreDutyOvertimeMinutes(checkTime, employee);
    let status = twentyFourHour
      ? AttendanceStatus.PRESENT
      : determineBiometricCheckInStatus(lateMinutes, employee, 0);

    const anyExisting = await this.prisma.attendanceLog.findFirst({
      where: {
        employeeId: employee.id,
        date: dateOnly,
        type: AttendanceLogType.REGULAR,
      },
    });

    if (anyExisting) {
      if (anyExisting.checkIn) {
        if (anyExisting.status === AttendanceStatus.UNMARKED) {
          // checkIn is set but status was never finalized — fix it and
          // report success instead of rejecting as a duplicate. This did
          // not create a new check-in; it repaired an incomplete one.
          const log = await this.reconcileUnmarkedCheckIn(
            db,
            employee,
            anyExisting,
            twentyFourHour,
          );
          return { type: 'CHECKIN' as const, log, reconciled: true };
        }
        throw new ConflictException(
          'Employee already checked in. Duplicate CHECKIN rejected.',
        );
      }

      const log = await this.runInTx(db, async (tx) => {
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

        // If this row was already auto-escalated to UNINFORMED_ABSENT before
        // this punch arrived, the employee did eventually show up — the
        // check-in must still be recorded and the status must reflect the
        // real arrival (handled below via applyDisciplineRules/status).
        // What must NOT happen silently is losing the fact that this day
        // was flagged uninformed-absent and already carries a stipend
        // deduction for it (applyUninformedAbsentDeduction, discipline.helper.ts)
        // — that deduction is a separate, already-committed PayrollDeduction
        // row and is deliberately left untouched here (no automatic
        // reconciliation in this phase); this note is the minimum-safe way
        // to keep that history visible on the record itself.
        const wasUninformedAbsent =
          anyExisting.status === AttendanceStatus.UNINFORMED_ABSENT;

        return tx.attendanceLog.update({
          where: { id: anyExisting.id },
          data: {
            checkIn: checkTime,
            status,
            source: AttendanceSource.BIOMETRIC,
            lateMinutes,
            overtimeMinutes: preDutyOvertimeMinutes,
            overtimePending: preDutyOvertimeMinutes > 0,
            note: twentyFourHour
              ? '24-hour shift check-in'
              : wasUninformedAbsent
                ? 'Checked in after being auto-marked Uninformed Absent (existing deduction not reversed)'
                : anyExisting.note,
          },
        });
      });

      return { type: 'CHECKIN' as const, log };
    }

    const log = await this.runInTx(db, async (tx) => {
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
          overtimeMinutes: preDutyOvertimeMinutes,
          overtimePending: preDutyOvertimeMinutes > 0,
          source: AttendanceSource.BIOMETRIC,
          note: twentyFourHour ? '24-hour shift check-in' : undefined,
        },
      });
    });

    return { type: 'CHECKIN' as const, log };
  }

  private async biometricRegularCheckout(
    employee: {
      id: string;
      dutyStartTime?: string | null;
      dutyEndTime?: string | null;
      shift: { startTime: string; endTime: string } | null;
    },
    _branchId: string | null,
    checkTime: Date,
    dateOnly: Date,
    twentyFourHour: boolean,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    if (twentyFourHour) {
      return {
        type: 'CHECKOUT_IGNORED' as const,
        message: '24-hour shift - checkout not required',
      };
    }

    const openRegular = await this.findOpenRegularLog(employee.id, dateOnly);

    if (!openRegular) {
      throw new BadRequestException(
        'No open check-in found for this employee today.',
      );
    }

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

    const log = await db.attendanceLog.update({
      where: { id: openRegular.id },
      data: {
        checkOut: checkTime,
        overtimeMinutes,
        overtimePending: overtimeMinutes > 0 && !openRegular.overtimeApprovedAt,
        status,
      },
    });

    return { type: 'CHECKOUT' as const, log };
  }

  private async biometricOvertimeCheckIn(
    employee: { id: string },
    branchId: string | null,
    checkTime: Date,
    dateOnly: Date,
    source: AttendanceSource = AttendanceSource.BIOMETRIC,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    await this.assertRegularShiftCompletedForOvertime(employee.id, dateOnly);

    const existingOt = await this.findOvertimeLogForDate(
      employee.id,
      dateOnly,
    );
    if (existingOt?.checkIn) {
      throw new ConflictException(
        'Employee already has an overtime check-in today.',
      );
    }

    if (!branchId) {
      throw new BadRequestException(
        'Employee has no branch assignment for overtime check-in',
      );
    }

    const log = await db.attendanceLog.create({
      data: {
        employeeId: employee.id,
        branchId,
        date: dateOnly,
        type: AttendanceLogType.OVERTIME,
        checkIn: checkTime,
        status: AttendanceStatus.PRESENT,
        source,
      },
    });

    // Clear unread OT prompts once they start overtime.
    await db.notification.updateMany({
      where: {
        employeeId: employee.id,
        type: 'OVERTIME_CHECKIN_PROMPT',
        isRead: false,
      },
      data: { isRead: true },
    });

    return { type: 'OVERTIME_CHECKIN' as const, log };
  }

  private async biometricOvertimeCheckOut(
    employee: { id: string },
    checkTime: Date,
    dateOnly: Date,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const open = await this.findOpenOvertimeLog(employee.id, dateOnly);

    if (!open?.checkIn) {
      throw new BadRequestException(
        'No open overtime check-in found for this employee today.',
      );
    }

    const overtimeMinutes = Math.round(
      (checkTime.getTime() - open.checkIn.getTime()) / 60000,
    );

    const log = await db.attendanceLog.update({
      where: { id: open.id },
      data: {
        checkOut: checkTime,
        overtimeMinutes,
      },
    });

    return { type: 'OVERTIME_CHECKOUT' as const, log };
  }

  /**
   * Portal overtime punch — same rules as biometric OT, MANUAL source.
   */
  async recordOvertimePunch(
    employeeId: string,
    punchType: 'OVERTIME_CHECKIN' | 'OVERTIME_CHECKOUT',
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, currentBranchId: true, status: true },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id ${employeeId} not found`);
    }

    if (
      employee.status !== EmployeeStatus.ACTIVE &&
      employee.status !== EmployeeStatus.TRAINEE
    ) {
      throw new BadRequestException('Employee is not active');
    }

    const checkTime = new Date();
    const dateOnly = toPakistanDateOnly(checkTime);

    if (punchType === 'OVERTIME_CHECKIN') {
      return this.biometricOvertimeCheckIn(
        employee,
        employee.currentBranchId,
        checkTime,
        dateOnly,
        AttendanceSource.MANUAL,
      );
    }

    return this.biometricOvertimeCheckOut(employee, checkTime, dateOnly);
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

    if (this.isAttendanceMarkOnlyRole(actingUser.role)) {
      const existing = await this.prisma.attendanceLog.findUnique({
        where: {
          employeeId_date_type: {
            employeeId: dto.employeeId,
            date: dateOnly,
            type: AttendanceLogType.REGULAR,
          },
        },
      });

      if (existing?.checkIn) {
        throw new ForbiddenException(ATTENDANCE_ALREADY_MARKED_MESSAGE);
      }

      if (
        existing &&
        existing.status !== AttendanceStatus.UNMARKED &&
        !existing.checkIn
      ) {
        throw new ForbiddenException(ATTENDANCE_ALREADY_MARKED_MESSAGE);
      }
    }

    const checkIn = dto.checkIn ? parseAttendanceDateTime(dto.checkIn) : undefined;
    const checkOut = dto.checkOut ? parseAttendanceDateTime(dto.checkOut) : undefined;

    let status = dto.status;
    let lateMinutes = dto.lateMinutes ?? 0;

    if (checkIn) {
      if (is24HourShift(employee)) {
        // 24-hour staff are never late / half-day from check-in time.
        lateMinutes = 0;
        if (
          !dto.status ||
          dto.status === AttendanceStatus.LATE ||
          dto.status === AttendanceStatus.HALF_DAY ||
          dto.status === AttendanceStatus.PRESENT
        ) {
          status = AttendanceStatus.PRESENT;
        }
      } else {
        const dutyStart = resolveDutyStartTime(employee);
        // No dutyStartTime configured: match the biometric path
        // (computeBiometricLateMinutes), which treats this as lateMinutes=0
        // rather than falling back to the shift-midpoint formula used only
        // by the dormant Portal check-in — the same check-in time must not
        // classify differently depending on which path recorded it.
        const computedLate = dutyStart
          ? calculateLateMinutesFromCheckIn(checkIn, dutyStart)
          : 0;

        if (typeof dto.lateMinutes === 'number' && dto.lateMinutes > 0) {
          lateMinutes = dto.lateMinutes;
        } else {
          lateMinutes = computedLate;
        }

        status = statusFromLateMinutes(lateMinutes);
      }
    }

    const preDutyOvertime =
      checkIn && !is24HourShift(employee)
        ? computePreDutyOvertimeMinutes(checkIn, employee)
        : 0;

    let calculatedOvertime = dto.overtimeMinutes ?? preDutyOvertime;
    if (checkOut) {
      calculatedOvertime =
        preDutyOvertime + this.calculateOvertimeMinutes(checkOut, employee);
    }

    const isSuperAdmin = actingUser.role === UserRole.SUPER_ADMIN;
    const overtimeMinutes = isSuperAdmin
      ? (dto.overtimeMinutes ?? calculatedOvertime)
      : 0;
    const overtimePending =
      !isSuperAdmin && calculatedOvertime > 0;

    const result = await this.prisma.$transaction(async (tx) => {
      let effectiveStatus = status;

      // HALF_DAY included: markManual can compute HALF_DAY directly from
      // lateMinutes (statusFromLateMinutes) without ever passing through
      // LATE first — without this, a manually-entered arrival that
      // classifies straight to HALF_DAY skipped late-occurrence discipline
      // entirely, unlike the biometric path (which always starts at LATE
      // and lets applyDisciplineRules itself escalate to HALF_DAY).
      if (
        status === AttendanceStatus.LATE ||
        status === AttendanceStatus.HALF_DAY ||
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
    const canEdit =
      await this.accessScopeService.userHasPermissionOrScopedCapability(
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
            id: true,
            fullName: true,
            employeeCode: true,
            dutyStartTime: true,
            dutyEndTime: true,
            dutyTotalHours: true,
            currentDesignation: true,
            currentDepartment: { select: { name: true } },
            shift: { select: { name: true, startTime: true, endTime: true } },
          },
        },
        branch: { select: BRANCH_LABEL_SELECT },
      },
    });

    if (!log) {
      throw new NotFoundException(`Attendance log with id ${id} not found`);
    }

    await this.accessScopeService.assertEmployeeAccess(
      actingUser.id,
      actingUser.role,
      Permission.ATTENDANCE_EDIT,
      log.employeeId,
    );

    if (isMedicineManagerRole(actingUser.role)) {
      if (!assertEmployeeInMedicineScope(log.employee)) {
        throw new ForbiddenException(
          'You can only update attendance for Medicine Management System staff',
        );
      }
    }

    if (this.isAttendanceMarkOnlyRole(actingUser.role)) {
      const isFirstCheckoutOnly =
        dto.checkOut != null &&
        !log.checkOut &&
        !!log.checkIn &&
        dto.checkIn === undefined &&
        dto.status === undefined &&
        dto.lateMinutes === undefined &&
        dto.note === undefined &&
        dto.overtimeMinutes === undefined;

      if (!isFirstCheckoutOnly) {
        throw new ForbiddenException(ATTENDANCE_ALREADY_MARKED_MESSAGE);
      }
    }

    if (
      dto.overtimeMinutes !== undefined &&
      !FULL_ATTENDANCE_EDIT_ROLES.includes(actingUser.role)
    ) {
      throw new ForbiddenException(
        'Only HR, IT, or Super Admin can update overtime minutes',
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
    if (dto.checkIn === null) {
      // A checkout without a check-in is invalid; clear the full session.
      data.checkOut = null;
      data.lateMinutes = 0;
      data.overtimeMinutes = 0;
      data.overtimePending = false;
    } else if (dto.checkOut === null) {
      data.overtimeMinutes = 0;
      data.overtimePending = false;
    }

    const effectiveCheckIn =
      dto.checkIn !== undefined
        ? dto.checkIn
          ? parseAttendanceDateTime(dto.checkIn)
          : null
        : log.checkIn;

    if (dto.status === undefined && effectiveCheckIn) {
      if (is24HourShift(log.employee)) {
        data.status = AttendanceStatus.PRESENT;
        data.lateMinutes = 0;
      } else {
        const dutyStart = resolveDutyStartTime(log.employee);
        // Previously: no dutyStartTime meant this branch set nothing at
        // all, silently leaving status/lateMinutes at their old (possibly
        // stale, e.g. still UNMARKED) values even though checkIn changed.
        // Match the biometric/markManual treatment instead: lateMinutes=0.
        const lateMinutes = dutyStart
          ? calculateLateMinutesFromCheckIn(effectiveCheckIn, dutyStart)
          : 0;
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
      FULL_ATTENDANCE_EDIT_ROLES.includes(actingUser.role)
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
    const andConditions: Prisma.EmployeeWhereInput[] = [];

    const departmentDesignationWhere =
      this.accessScopeService.employeeMatchesDepartmentDesignationFilter({
        departmentId: query.departmentId,
        designation: query.designation,
      });
    if (departmentDesignationWhere) {
      andConditions.push(departmentDesignationWhere);
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
      andConditions.push({
        OR: [
          { fullName: { contains: query.search, mode: 'insensitive' } },
          { employeeCode: { contains: query.search, mode: 'insensitive' } },
          { cnic: { contains: query.search, mode: 'insensitive' } },
          {
            currentBranch: {
              name: { contains: query.search, mode: 'insensitive' },
            },
          },
        ],
      });
    }

    if (andConditions.length > 0) {
      employeeWhere.AND = andConditions;
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
    actingUser?: {
      id?: string;
      role: UserRole | string;
      branchId?: string | null;
    },
  ) {
    enforceBranchScope(query, actingUser);

    const { search, ...filterQuery } = query;
    let employeeWhere = this.buildEmployeeFilterWhere(filterQuery) ?? {};

    // Scope by the employee's current posting rather than the branch stamped on
    // the log, so the branch here always matches the employee's profile.
    if (query.branchId) {
      employeeWhere.currentBranchId = query.branchId;
    }

    // Active and on-leave staff remain attendance-eligible. Suspended,
    // terminated, resigned, dismissed, and other statuses stay hidden.
    // The UI's default ACTIVE selection intentionally includes ON_LEAVE here.
    if (
      !query.employeeId &&
      (!filterQuery.employeeStatus ||
        filterQuery.employeeStatus === EmployeeStatus.ACTIVE)
    ) {
      employeeWhere.status = {
        in: [EmployeeStatus.ACTIVE, EmployeeStatus.ON_LEAVE],
      };
    }

    if (actingUser?.id) {
      employeeWhere =
        await this.accessScopeService.narrowEmployeeWhereForActor(
          actingUser.id,
          actingUser.role as UserRole,
          employeeWhere,
        );
    }
    const medicineWhere = isMedicineManagerRole(actingUser?.role)
      ? medicineEmployeeWhere()
      : undefined;

    const hasEmployeeFilter = Object.keys(employeeWhere).length > 0;
    const scopedEmployeeWhere: Prisma.EmployeeWhereInput | undefined =
      hasEmployeeFilter && medicineWhere
        ? { AND: [employeeWhere, medicineWhere] }
        : hasEmployeeFilter
          ? employeeWhere
          : medicineWhere;

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
            relieverOnly: true,
            currentBranch: { select: BRANCH_LABEL_SELECT },
            currentDepartment: { select: { name: true } },
            shift: {
              select: { name: true, startTime: true, endTime: true },
            },
            user: {
              select: {
                role: true,
                additionalRoles: { select: { role: true } },
              },
            },
          },
        },
        branch: { select: BRANCH_LABEL_SELECT },
      },
      orderBy: { date: 'desc' },
    });

    const mapped = logs
      .map((log) => ({
        ...log,
        // Historical rows may carry a stale branch (e.g. stamped from the
        // biometric device). The employee's posting wins.
        branch: log.employee?.currentBranch ?? log.branch,
        employee: log.employee
          ? {
              ...log.employee,
              // Display times always from employee duty fields (shift name only).
              shift: log.employee.shift
                ? {
                    name: log.employee.shift.name,
                    startTime:
                      log.employee.dutyStartTime ?? log.employee.shift.startTime,
                    endTime:
                      log.employee.dutyEndTime ?? log.employee.shift.endTime,
                  }
                : log.employee.shift,
              user: log.employee.user
                ? {
                    role: log.employee.user.role,
                    additionalRoles: log.employee.user.additionalRoles.map(
                      (entry) => entry.role,
                    ),
                    roles: buildEffectiveRoles(
                      log.employee.user.role,
                      log.employee.user.additionalRoles,
                    ),
                  }
                : null,
            }
          : log.employee,
      }))
      .sort((a, b) => {
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

    const dutyFilter = this.resolveDutyFilter(query);
    if (dutyFilter === 'all') {
      return mapped;
    }

    const minutesOfDay = toPakistanMinutesOfDay(new Date());
    return mapped.filter((log) => {
      const emp = log.employee;
      if (!emp) return true;
      if (emp.relieverOnly) return true;
      const win = getDutyWindow(emp);
      if (!win) return true;
      return isOnDutyAt(win, minutesOfDay, DUTY_FILTER_GRACE_MINUTES);
    });
  }

  private isAttendanceMarkOnlyRole(role: UserRole): boolean {
    return ATTENDANCE_MARK_ONLY_ROLES.includes(role);
  }

  private resolveDutyFilter(query: AttendanceQueryDto): 'onDutyNow' | 'all' {
    const requested = query.dutyFilter ?? 'onDutyNow';
    if (requested === 'all') return 'all';

    // Only meaningful for a single day that is today (PKT).
    const isSingleDay =
      !!query.startDate &&
      !!query.endDate &&
      query.startDate === query.endDate;
    if (!isSingleDay) return 'all';

    const pkToday = toPakistanDateOnly(new Date());
    const requestedDate = this.toDateOnly(new Date(query.startDate!));
    if (requestedDate.getTime() !== pkToday.getTime()) return 'all';

    return 'onDutyNow';
  }

  /**
   * Lists assigned relievers for the date (from accepted/HR-assigned RelieverRequest
   * on APPROVED leave covering that day), merged with any RelieverSession punches.
   */
  async findAllRelieverSessions(query: RelieverSessionsQueryDto) {
    const dateStr = query.startDate ?? query.endDate;
    if (!dateStr) {
      throw new BadRequestException('startDate is required');
    }
    const dateOnly = this.toDateOnly(new Date(dateStr));
    const employeeWhere = this.buildEmployeeFilterWhere(query);

    const leaves = await this.prisma.leaveRecord.findMany({
      where: {
        status: LeaveStatus.APPROVED,
        startDate: { lte: dateOnly },
        endDate: { gte: dateOnly },
        relieverRequest: {
          status: {
            in: [
              RelieverRequestStatus.ACCEPTED,
              RelieverRequestStatus.HR_ASSIGNED,
            ],
          },
          reliever: {
            ...(employeeWhere ?? {}),
            ...(query.branchId ? { currentBranchId: query.branchId } : {}),
          },
        },
      },
      include: {
        employee: {
          select: { id: true, fullName: true, employeeCode: true },
        },
        relieverRequest: {
          include: {
            reliever: {
              select: {
                id: true,
                fullName: true,
                employeeCode: true,
                currentBranchId: true,
                currentBranch: { select: BRANCH_LABEL_SELECT },
              },
            },
          },
        },
      },
      orderBy: { startDate: 'asc' },
    });

    const relieverIds = [
      ...new Set(
        leaves
          .map((l) => l.relieverRequest?.relieverId)
          .filter((id): id is string => !!id),
      ),
    ];

    const sessions =
      relieverIds.length === 0
        ? []
        : await this.prisma.relieverSession.findMany({
            where: {
              employeeId: { in: relieverIds },
              date: dateOnly,
            },
            orderBy: { checkIn: 'desc' },
          });

    const sessionByReliever = new Map<string, (typeof sessions)[number]>();
    for (const session of sessions) {
      if (!sessionByReliever.has(session.employeeId)) {
        sessionByReliever.set(session.employeeId, session);
      }
    }

    return leaves
      .filter((leave) => leave.relieverRequest?.reliever)
      .map((leave) => {
        const request = leave.relieverRequest!;
        const reliever = request.reliever;
        const session = sessionByReliever.get(reliever.id) ?? null;
        return {
          id: session?.id ?? null,
          employeeId: reliever.id,
          branchId: session?.branchId ?? reliever.currentBranchId,
          date: dateOnly,
          checkIn: session?.checkIn ?? null,
          checkOut: session?.checkOut ?? null,
          totalMinutes: session?.totalMinutes ?? 0,
          employee: {
            id: reliever.id,
            fullName: reliever.fullName,
            employeeCode: reliever.employeeCode,
          },
          branch: reliever.currentBranch,
          coveringEmployee: leave.employee,
          leaveRecordId: leave.id,
          relieverRequestId: request.id,
          relieverRequestStatus: request.status,
          sessionStatus: !session
            ? 'NOT_STARTED'
            : session.checkOut
              ? 'COMPLETED'
              : 'ACTIVE',
        };
      });
  }

  async relieverCheckIn(dto: RelieverCheckInDto) {
    const dateOnly = this.toDateOnly(new Date(dto.date));
    const checkTime = dto.checkIn
      ? parseAttendanceDateTime(dto.checkIn)
      : new Date();

    const assignment = await this.findRelieverAssignment(
      dto.employeeId,
      dateOnly,
    );
    if (!assignment) {
      throw new BadRequestException(
        'Employee is not an assigned reliever for this date',
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, currentBranchId: true, status: true },
    });
    if (!employee) {
      throw new NotFoundException(`Employee with id ${dto.employeeId} not found`);
    }
    if (
      employee.status !== EmployeeStatus.ACTIVE &&
      employee.status !== EmployeeStatus.APPOINTED &&
      employee.status !== EmployeeStatus.TRAINEE
    ) {
      throw new BadRequestException('Reliever employee is not active');
    }

    const openSession = await this.prisma.relieverSession.findFirst({
      where: {
        employeeId: dto.employeeId,
        date: dateOnly,
        checkOut: null,
      },
    });
    if (openSession) {
      throw new ConflictException('Reliever already has an open session for this date');
    }

    const completed = await this.prisma.relieverSession.findFirst({
      where: {
        employeeId: dto.employeeId,
        date: dateOnly,
        checkOut: { not: null },
      },
    });
    if (completed) {
      throw new ConflictException(
        'Reliever already completed Extra Duty for this date',
      );
    }

    return this.prisma.relieverSession.create({
      data: {
        employeeId: dto.employeeId,
        branchId: employee.currentBranchId,
        date: dateOnly,
        checkIn: checkTime,
      },
      include: {
        employee: {
          select: { id: true, fullName: true, employeeCode: true },
        },
        branch: { select: BRANCH_LABEL_SELECT },
      },
    });
  }

  async relieverCheckOut(dto: RelieverCheckOutDto) {
    const session = await this.prisma.relieverSession.findUnique({
      where: { id: dto.sessionId },
    });
    if (!session) {
      throw new NotFoundException(`Reliever session ${dto.sessionId} not found`);
    }
    if (!session.checkIn) {
      throw new BadRequestException('Session has no check-in');
    }
    if (session.checkOut) {
      throw new ConflictException('Session already checked out');
    }

    const checkOut = dto.checkOut
      ? parseAttendanceDateTime(dto.checkOut)
      : new Date();
    if (checkOut.getTime() < session.checkIn.getTime()) {
      throw new BadRequestException('Check-out must be after check-in');
    }

    const totalMinutes = Math.max(
      0,
      Math.round((checkOut.getTime() - session.checkIn.getTime()) / 60000),
    );

    // Payroll derives reliever extra pay directly from RelieverSession rows
    // (see PayrollService.upsertRelieverAllowanceRow) — actual non-overlapping
    // minutes, not a flat AdditionalWorkingDay full-day rate. Recorded here
    // only as the session's own checkOut/totalMinutes; no separate payroll
    // side-effect is created at checkout time, so there is exactly one place
    // (payroll generation/refresh) that ever computes the paid amount.
    const updated = await this.prisma.relieverSession.update({
      where: { id: session.id },
      data: { checkOut, totalMinutes },
      include: {
        employee: {
          select: { id: true, fullName: true, employeeCode: true },
        },
        branch: { select: BRANCH_LABEL_SELECT },
      },
    });

    return updated;
  }

  private async findRelieverAssignment(employeeId: string, dateOnly: Date) {
    return this.prisma.relieverRequest.findFirst({
      where: {
        relieverId: employeeId,
        status: {
          in: [
            RelieverRequestStatus.ACCEPTED,
            RelieverRequestStatus.HR_ASSIGNED,
          ],
        },
        leaveRecord: {
          status: LeaveStatus.APPROVED,
          startDate: { lte: dateOnly },
          endDate: { gte: dateOnly },
        },
      },
      select: { id: true, leaveRecordId: true },
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
      where: {
        status: EmployeeStatus.ACTIVE,
        relieverOnly: false,
        shiftId: { not: null },
      },
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

    const overtimeLog = await this.prisma.attendanceLog.findUnique({
      where: {
        employeeId_date_type: {
          employeeId,
          date: dateOnly,
          type: AttendanceLogType.OVERTIME,
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

    const otPrompt = await this.prisma.notification.findFirst({
      where: {
        employeeId,
        type: 'OVERTIME_CHECKIN_PROMPT',
        isRead: false,
        createdAt: { gte: dateOnly },
      },
      select: { id: true },
    });

    const checkedIn = !!attendanceLog?.checkIn;
    const hasCheckOut = !!attendanceLog?.checkOut;
    const otCheckedIn = !!overtimeLog?.checkIn;
    const otCheckedOut = !!overtimeLog?.checkOut;

    return {
      primaryShift: {
        checkedIn,
        checkIn: attendanceLog?.checkIn ?? null,
        checkOut: attendanceLog?.checkOut ?? null,
        isActive: checkedIn && !hasCheckOut,
      },
      overtime: {
        checkedIn: otCheckedIn,
        checkIn: overtimeLog?.checkIn ?? null,
        checkOut: overtimeLog?.checkOut ?? null,
        isActive: otCheckedIn && !otCheckedOut,
        /** Show portal OT check-in when regular is done and OT not started. */
        canCheckIn: checkedIn && hasCheckOut && !otCheckedIn,
        canCheckOut: otCheckedIn && !otCheckedOut,
        promptPending: !!otPrompt,
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

    let status: AttendanceStatus;
    let lateMinutes: number;
    if (is24HourShift(employee)) {
      status = AttendanceStatus.PRESENT;
      lateMinutes = 0;
    } else {
      ({ status, lateMinutes } = this.determineCheckInStatus(
        checkTime,
        employee.shift,
      ));
    }

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

    const overtimeMinutes =
      computePreDutyOvertimeMinutes(existing.checkIn, employee) +
      this.calculateOvertimeMinutes(checkTime, employee);

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

  /**
   * Overtime after duty end. Duty times on the employee are the source of
   * truth; the shift record is only a fallback template.
   */
  private calculateOvertimeMinutes(
    checkOut: Date,
    employee: {
      dutyEndTime?: string | null;
      shift?: { endTime: string } | null;
    } | null,
  ): number {
    const checkOutMinutes = toPakistanMinutesOfDay(checkOut);
    const dutyEnd =
      employee?.dutyEndTime?.trim() || employee?.shift?.endTime || null;
    const endMinutes = dutyEnd
      ? this.parseTimeToMinutes(dutyEnd)
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
  /**
   * Open (checked-in, not checked-out) REGULAR log for exactly one date.
   *
   * `excludeClosed` additionally requires `sessionClosedAt` to be null —
   * i.e. the session has not been internally closed by the missing-checkout
   * process (Phase 4B). Callers resolving CHECKOUT or AUTO punches against a
   * *prior* session must pass true, so a session already disciplined as a
   * missing checkout is never mistaken for still-open backend state.
   * Duplicate-CHECKIN detection for *today* deliberately keeps the default
   * (false): a same-day row must still be found and rejected as a duplicate
   * regardless of closure, since a second check-in would otherwise silently
   * overwrite an already-disciplined row via the upsert.
   */
  private findOpenRegularLogForDate(
    employeeId: string,
    dateOnly: Date,
    excludeClosed = false,
  ) {
    return this.prisma.attendanceLog.findFirst({
      where: {
        employeeId,
        date: dateOnly,
        type: AttendanceLogType.REGULAR,
        checkIn: { not: null },
        checkOut: null,
        ...(excludeClosed ? { sessionClosedAt: null } : {}),
      },
    });
  }

  /**
   * Open-session lookup for CHECKOUT: today, falling back to yesterday so an
   * overnight shift's checkout after midnight can still find its check-in.
   * Not for duplicate-CHECKIN detection — see findOpenRegularLogForDate and
   * findOpenRegularLogForAuto for that.
   *
   * Excludes internally-closed sessions (Phase 4B) on both today's and
   * yesterday's row: a checkout arriving after the missing-checkout process
   * has already closed and disciplined a session must not silently reopen
   * and complete it — see biometricRegularCheckout's caller, which then
   * rejects with the existing "no open check-in found" error.
   */
  private async findOpenRegularLog(employeeId: string, dateOnly: Date) {
    const todayOpen = await this.findOpenRegularLogForDate(
      employeeId,
      dateOnly,
      true,
    );
    if (todayOpen) return todayOpen;
    return this.findOpenRegularLogForDate(
      employeeId,
      this.pakistanYesterday(dateOnly),
      true,
    );
  }

  /**
   * Open-session lookup for AUTO punch resolution only. Today's open session
   * always counts. Yesterday's open session counts only for a genuine
   * overnight shift — otherwise it is a stale, abandoned prior-day session
   * and must not cause today's AUTO punch to resolve to a checkout against
   * it (that would leave today unmarked and silently close yesterday's row
   * with a bogus multi-hour duration).
   *
   * Excludes internally-closed sessions (Phase 4B) on both today's and
   * yesterday's row, so a stale missing-checkout session — already
   * disciplined and closed — never causes an AUTO punch to resolve to
   * CHECKOUT; it always resolves to a fresh CHECKIN instead.
   */
  private async findOpenRegularLogForAuto(
    employee: {
      id: string;
      dutyStartTime?: string | null;
      dutyEndTime?: string | null;
    },
    dateOnly: Date,
  ) {
    const todayOpen = await this.findOpenRegularLogForDate(
      employee.id,
      dateOnly,
      true,
    );
    if (todayOpen) return todayOpen;

    const overnight = isOvernightShift(
      employee.dutyStartTime ?? null,
      employee.dutyEndTime ?? null,
    );
    if (!overnight) return null;

    return this.findOpenRegularLogForDate(
      employee.id,
      this.pakistanYesterday(dateOnly),
      true,
    );
  }

  private findOvertimeLogForDate(employeeId: string, dateOnly: Date) {
    return this.prisma.attendanceLog.findFirst({
      where: {
        employeeId,
        date: dateOnly,
        type: AttendanceLogType.OVERTIME,
      },
    });
  }

  private findOpenOvertimeLog(employeeId: string, dateOnly: Date) {
    return this.prisma.attendanceLog
      .findFirst({
        where: {
          employeeId,
          date: dateOnly,
          type: AttendanceLogType.OVERTIME,
          checkIn: { not: null },
          checkOut: null,
        },
        orderBy: { checkIn: 'desc' },
      })
      .then(async (todayOpen) => {
        if (todayOpen) return todayOpen;
        return this.prisma.attendanceLog.findFirst({
          where: {
            employeeId,
            date: this.pakistanYesterday(dateOnly),
            type: AttendanceLogType.OVERTIME,
            checkIn: { not: null },
            checkOut: null,
          },
          orderBy: { checkIn: 'desc' },
        });
      });
  }

  private async assertRegularShiftCompletedForOvertime(
    employeeId: string,
    dateOnly: Date,
  ) {
    const regularToday = await this.prisma.attendanceLog.findFirst({
      where: {
        employeeId,
        date: dateOnly,
        type: AttendanceLogType.REGULAR,
        checkIn: { not: null },
        checkOut: { not: null },
      },
    });

    if (regularToday) return;

    const regularYesterday = await this.prisma.attendanceLog.findFirst({
      where: {
        employeeId,
        date: this.pakistanYesterday(dateOnly),
        type: AttendanceLogType.REGULAR,
        checkIn: { not: null },
        checkOut: { not: null },
      },
    });

    if (!regularYesterday) {
      throw new BadRequestException(
        'Regular shift must be completed before overtime check-in.',
      );
    }
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
