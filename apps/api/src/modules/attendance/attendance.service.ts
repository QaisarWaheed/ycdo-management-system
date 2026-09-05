import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceLogType,
  AttendanceSource,
  AttendanceStatus,
  DisciplinaryStatus,
  DisciplinaryType,
  EmployeeStatus,
  Gender,
  LeaveStatus,
  LeaveType,
  LetterType,
  Permission,
  Prisma,
  ProjectType,
  RelieverRequestStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScopeService } from '../permissions/access-scope.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PayrollService } from '../payroll/payroll.service';
import { LettersService } from '../letters/letters.service';
import { summarizeAttendanceLogs } from './attendance-summary.util';
import { DisciplinaryService } from '../disciplinary/disciplinary.service';
import { SuspensionRequestService } from '../disciplinary/suspension-request.service';
import { InquiryOpeningService } from '../disciplinary/inquiry-opening.service';
import { AdditionalWorkingDaysService } from '../additional-working-days/additional-working-days.service';
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
  UpdateRelieverSessionDto,
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
import {
  CHECKOUT_TOO_SOON_REASON,
  devicePunchRejectReason,
  isCheckoutTooSoon,
  resolveRawScanPunchTime,
} from './device-punch-time.util';
import {
  applyDisciplineRules,
  reconcileAttendanceFinancialConsequences,
} from './discipline.helper';
import {
  countShortLeaveOccurrencesThisMonth,
  evaluateShortLeaveDeviation,
  MONTHLY_SHORT_LEAVE_LIMIT,
  reconcileShortLeaveAttendance,
} from './short-leave.util';
import {
  parseAttendanceDateTime,
  resolveDutyStartTime,
  toPakistanMinutesOfDay,
} from './attendance-late.util';
import {
  AUTO_UNMARKED_NOTE,
  calendarDatesForAttendanceMonth,
  isPreJoinAttendanceDate,
  MONTH_CALENDAR_UNMARKED_NOTE,
  pakistanMonthDateRange,
  pakistanVisibleAttendanceEnd,
  pakistanYearMonthFromDate,
  PRE_JOIN_UNMARKED_NOTE,
} from './attendance-calendar.util';
import { isWeeklyOffDate } from './weekly-off.util';
import {
  calculateLateMinutesFromCheckIn,
  DEFAULT_DUTY_START,
  getShiftAttendanceDate,
  hasDutyStartedForAttendanceDate,
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
  resolveAttendanceDutyTimes,
} from '../../common/duty.util';
import { buildSuspensionWatchlist } from './suspension-watchlist';
import { issueDueSuspensionEligibilityNotices } from './suspension-eligibility-notice';
import { issueNearSuspensionWarnings } from './near-suspension-warning';
import {
  ATTENDANCE_ELIGIBLE_STATUSES,
  assertEmployeeEligibleForAttendanceRecord,
  assertEmployeeEligibleForBiometricAttendance,
  assertEmployeeEligibleForManualAttendance,
  assertEmployeeEligibleForRelieverAttendance,
  type EmployeeAttendanceContext,
} from './attendance-eligibility.util';
import {
  isSchedulerAttendanceEligible,
  schedulerAttendanceCandidateWhere,
} from '../employees/status-effective.util';

const OVERTIME_GRACE_MINUTES = 60;
const FULL_ATTENDANCE_EDIT_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.IT_ADMIN,
  UserRole.HR_MANAGER,
  UserRole.HR_ADMIN_MANAGER,
  UserRole.HR_OPERATIONS_MANAGER,
  UserRole.HR_EXECUTIVE,
];

const ACTIVE_LEAVE_STATUSES: LeaveStatus[] = [
  LeaveStatus.PENDING,
  LeaveStatus.BRANCH_APPROVED,
  LeaveStatus.DEPT_APPROVED,
  LeaveStatus.RELIEVER_PENDING,
  LeaveStatus.RELIEVER_CONFIRMED,
  LeaveStatus.HR_PENDING,
  LeaveStatus.APPROVED,
  LeaveStatus.PENDING_APPROVAL,
];

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private prisma: PrismaService,
    private permissionsService: PermissionsService,
    private accessScopeService: AccessScopeService,
    private payrollService: PayrollService,
    private lettersService: LettersService,
    private disciplinaryService: DisciplinaryService,
    private suspensionRequestService: SuspensionRequestService,
    private inquiryOpeningService: InquiryOpeningService,
    private additionalWorkingDaysService: AdditionalWorkingDaysService,
  ) {}

  private employeeAttendanceContext(employee: {
    status: EmployeeStatus;
    statusEffectiveFrom?: Date | null;
    joiningDate?: Date | null;
  }): EmployeeAttendanceContext {
    return {
      status: employee.status,
      statusEffectiveFrom: employee.statusEffectiveFrom ?? null,
      joiningDate: employee.joiningDate,
    };
  }

  /**
   * Fires the centralized PENDING-payroll recompute hook (see
   * PayrollService.recomputePendingPayrollForAttendanceDate) for a
   * resolved biometric punch — but only when it actually wrote a
   * REGULAR-log status/checkIn/checkOut change ('CHECKIN'/'CHECKOUT').
   * 'OVERTIME_CHECKIN'/'OVERTIME_CHECKOUT'/'CHECKOUT_IGNORED' never touch
   * the payroll-relevant REGULAR log, so recomputing for those would be
   * pure wasted work — see the audit distinguishing OT-path writes from
   * REGULAR-log writes in computeHourlyBreakdown. Always called AFTER the
   * punch's own transaction has already resolved, never from inside it.
   */
  private async maybeRecomputePayrollForPunchResult(
    employeeId: string,
    dateOnly: Date,
    result: { type: string },
  ): Promise<void> {
    if (result.type === 'CHECKIN' || result.type === 'CHECKOUT') {
      await this.payrollService.recomputePendingPayrollForAttendanceDate(
        employeeId,
        dateOnly,
      );
    }
  }

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

    assertEmployeeEligibleForBiometricAttendance(
      employee.status,
      this.employeeAttendanceContext(employee),
    );

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
    // Live stream has no trustworthy device clock (TZ skew), so punch time is
    // API now. If an agent *did* send a timestamp, still refuse hours-old
    // reconnect dumps so they cannot stamp the whole branch at receive time.
    if (dto.timestamp) {
      const dumpReason = devicePunchRejectReason(
        resolveRawScanPunchTime({ timestamp: dto.timestamp }).verdict,
      );
      if (dumpReason) {
        throw new BadRequestException(dumpReason);
      }
    }
    const checkTime = new Date();
    const twentyFourHour = is24HourShift(employee);
    // Night shifts: a punch after midnight still belongs to yesterday's
    // duty day (e.g. 01:00 against 20:00–08:00 → prior calendar date).
    const dateOnly = this.resolvePunchAttendanceDate(
      checkTime,
      employee,
      twentyFourHour,
    );

    const result = await this.processResolvedPunch(
      employee,
      branchId,
      dto.punchType,
      checkTime,
      dateOnly,
      twentyFourHour,
    );
    await this.maybeReconcilePunchConsequences(
      employee.id,
      dateOnly,
      result,
      employee.dutyStartTime,
    );
    await this.maybeRecomputePayrollForPunchResult(employee.id, dateOnly, result);
    return result;
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
      return {
        ok: true as const,
        accepted: false as const,
        idempotent: true as const,
        reason: 'DEVICE_EVENT_ALREADY_PROCESSED',
      };
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

    assertEmployeeEligibleForBiometricAttendance(
      employee.status,
      this.employeeAttendanceContext(employee),
    );

    const device = await this.prisma.biometricDevice.findUnique({
      where: { deviceId: dto.deviceId },
    });
    const branchId = employee.currentBranchId ?? device?.branchId ?? null;
    const punchClock = resolveRawScanPunchTime({
      eventTime: dto.eventTime,
      timestamp: dto.timestamp,
    });
    const staleReason = devicePunchRejectReason(punchClock.verdict);
    if (staleReason) {
      return this.claimRawScanAndReject(dto, staleReason, employee.id);
    }
    const checkTime = punchClock.checkTime;
    const twentyFourHour = is24HourShift(employee);
    const dateOnly = this.resolvePunchAttendanceDate(
      checkTime,
      employee,
      twentyFourHour,
    );

    // Devices are in T&A Manual mode and already report CHECKIN/CHECKOUT —
    // use that. AUTO is only a fallback for a status we can't map.
    const resolvedStatus = mapDeviceStatusToPunchType(dto.deviceStatus);
    const punchType:
      | 'CHECKIN'
      | 'CHECKOUT'
      | 'OVERTIME_CHECKIN'
      | 'OVERTIME_CHECKOUT'
      | 'AUTO' = resolvedStatus ?? 'AUTO';

    const txResult = await this.prisma.$transaction(async (tx) => {
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
          return {
            ok: true as const,
            accepted: false as const,
            idempotent: true as const,
            reason: 'DEVICE_EVENT_ALREADY_PROCESSED',
          };
        }
        throw err;
      }

      try {
        const result = await this.processResolvedPunch(
          employee,
          branchId,
          punchType,
          checkTime,
          dateOnly,
          twentyFourHour,
          tx,
        );

        return {
          ok: true as const,
          accepted: true as const,
          idempotent: false as const,
          reason: 'ACCEPTED',
          ...result,
        };
      } catch (err: unknown) {
        // Business-rule rejects: keep the device-event claim (no infinite
        // retries) and return 200-shaped soft reject so the gateway marks
        // REJECTED_BY_HRMS with a clear reason instead of a transport error.
        if (
          err instanceof ConflictException ||
          err instanceof BadRequestException
        ) {
          const response = err.getResponse();
          const message =
            typeof response === 'string'
              ? response
              : Array.isArray(
                    (response as { message?: string | string[] }).message,
                  )
                ? (response as { message: string[] }).message.join(', ')
                : String(
                    (response as { message?: string }).message ??
                      err.message ??
                      'HRMS_REJECTED',
                  );
          return {
            ok: true as const,
            accepted: false as const,
            idempotent: false as const,
            reason: message,
          };
        }
        throw err;
      }
    });

    // Fires only after the transaction above has fully committed — never
    // from inside it — and only for a genuinely accepted attendance write.
    if (txResult.accepted === true && txResult.idempotent === false) {
      await this.maybeReconcilePunchConsequences(
        employee.id,
        dateOnly,
        txResult,
        employee.dutyStartTime,
      );
      await this.maybeRecomputePayrollForPunchResult(
        employee.id,
        dateOnly,
        txResult,
      );
    }

    return txResult;
  }

  /**
   * Consume a device event we will not apply (stale reconnect dump, etc.)
   * so the gateway marks it REJECTED and does not retry it into attendance.
   */
  private async claimRawScanAndReject(
    dto: RawScanDto,
    reason: string,
    employeeId?: string | null,
  ) {
    try {
      await this.prisma.processedDeviceEvent.create({
        data: {
          deviceId: dto.deviceId,
          serialNo: dto.serialNo,
          biometricId: dto.biometricId,
          employeeId: employeeId ?? null,
          punchType: mapDeviceStatusToPunchType(dto.deviceStatus),
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
        return {
          ok: true as const,
          accepted: false as const,
          idempotent: true as const,
          reason: 'DEVICE_EVENT_ALREADY_PROCESSED',
        };
      }
      throw err;
    }

    return {
      ok: true as const,
      accepted: false as const,
      idempotent: false as const,
      reason,
    };
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
        : await this.findOpenRegularLogForAuto(employee, dateOnly, db);
      punchType = openRegular ? 'CHECKOUT' : 'CHECKIN';
    }

    // Hard guards — never silently convert an explicit punch type.
    if (punchType === 'CHECKIN') {
      const openRegular = twentyFourHour
        ? await this.findOpenRegularLogForDate(employee.id, dateOnly, false, db)
        : await this.findOpenRegularSessionBlockingCheckIn(
            employee,
            dateOnly,
            db,
          );

      if (openRegular?.checkIn) {
        const sameDay = openRegular.date.getTime() === dateOnly.getTime();
        if (
          sameDay &&
          openRegular.status === AttendanceStatus.UNMARKED
        ) {
          // checkIn is set but status was never finalized — fix it and
          // report success instead of rejecting as a duplicate.
          const swapExempt = await this.isLateExemptForSwap(
            db,
            employee.id,
            dateOnly,
            openRegular.status,
          );
          const log = await this.reconcileUnmarkedCheckIn(
            db,
            employee.id,
            employee,
            openRegular,
            twentyFourHour,
            swapExempt,
          );
          return { type: 'CHECKIN' as const, log, reconciled: true };
        }
        throw new ConflictException(
          sameDay
            ? 'Employee already checked in. Duplicate CHECKIN rejected.'
            : 'Previous shift session is still open. Check out before checking in again.',
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

  private async isLateExemptForSwap(
    db: PrismaService | Prisma.TransactionClient,
    employeeId: string,
    date: Date,
    existingStatus?: AttendanceStatus | null,
  ): Promise<boolean> {
    if (existingStatus === AttendanceStatus.SWAP_COVERED) return true;
    const swap = await db.mutualSwap.findFirst({
      where: {
        date,
        status: 'ACTIVE',
        OR: [
          { coveringEmployeeId: employeeId },
          { coveredEmployeeId: employeeId },
        ],
      },
      select: { id: true },
    });
    return !!swap;
  }

  /**
   * Self-heal a row that has checkIn set but was never finalized to a real
   * status. Should not occur via any current write path (every path that
   * sets checkIn also sets status in the same write) — this is a defensive
   * safety net for legacy/corrupted rows. Recomputes status from the row's
   * own already-stored checkIn time and runs the same late-discipline +
   * financial reconciliation as a normal biometric check-in, because the
   * first time this row becomes LATE/HALF_DAY is still a genuine lateness
   * event even though the punch timestamp was stored earlier.
   */
  private async reconcileUnmarkedCheckIn(
    db: PrismaService | Prisma.TransactionClient,
    employeeId: string,
    employee: {
      dutyStartTime?: string | null;
      dutyEndTime?: string | null;
      shift: { startTime: string; endTime: string } | null;
    },
    existing: {
      id: string;
      date: Date;
      checkIn: Date | null;
      checkOut?: Date | null;
      status: AttendanceStatus;
      lateMinutes: number;
      note?: string | null;
    },
    twentyFourHour: boolean,
    swapExempt = false,
  ) {
    const checkIn = existing.checkIn;
    if (!checkIn) {
      throw new BadRequestException(
        'Cannot reconcile unmarked check-in without a stored checkIn time',
      );
    }

    let lateMinutes =
      twentyFourHour || swapExempt
        ? 0
        : computeBiometricLateMinutes(checkIn, employee);
    let status =
      twentyFourHour || swapExempt
        ? existing.status === AttendanceStatus.SWAP_COVERED
          ? AttendanceStatus.SWAP_COVERED
          : AttendanceStatus.PRESENT
        : this.statusForBiometricCheckIn(lateMinutes, employee);

    return this.runInTx(db, async (tx) => {
      return tx.attendanceLog.update({
        where: { id: existing.id },
        data: { status, lateMinutes },
      });
    });
  }

  /**
   * Biometric/portal check-in status. Late > 120 minutes is HALF_DAY
   * (final payroll/attendance policy).
   */
  private statusForBiometricCheckIn(
    lateMinutes: number,
    employee: { dutyStartTime?: string | null },
  ): AttendanceStatus {
    const status = determineBiometricCheckInStatus(lateMinutes, employee, 0);
    if (status === AttendanceStatus.LATE && lateMinutes > 120) {
      return AttendanceStatus.HALF_DAY;
    }
    return status;
  }

  /**
   * Attendance side-effects (late discipline, UA reversal, etc.) run in a
   * SEPARATE transaction after the punch has already committed. Failures
   * here must never undo a stored check-in.
   */
  private async runConsequenceReconcile(
    employeeId: string,
    date: Date,
    before: {
      status: AttendanceStatus;
      lateMinutes: number;
      checkIn: Date | null;
      checkOut?: Date | null;
      note?: string | null;
    } | null,
    after: {
      status: AttendanceStatus;
      lateMinutes: number;
      checkIn: Date | null;
      checkOut?: Date | null;
      note?: string | null;
    },
    dutyStartTimeSnapshot?: string | null,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await reconcileAttendanceFinancialConsequences(tx, {
          employeeId,
          date,
          before,
          after,
          dutyStartTimeSnapshot: dutyStartTimeSnapshot ?? null,
        });
      });
    } catch (err) {
      this.logger.error(
        `Attendance consequence reconcile failed for employee=${employeeId} date=${date.toISOString().slice(0, 10)} — check-in/out kept`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async maybeReconcilePunchConsequences(
    employeeId: string,
    dateOnly: Date,
    result: {
      type: string;
      needsConsequenceReconcile?: boolean;
      before?: {
        status: AttendanceStatus;
        lateMinutes: number;
        checkIn: Date | null;
        checkOut?: Date | null;
        note?: string | null;
      } | null;
      log?: {
        date?: Date;
        status: AttendanceStatus;
        lateMinutes: number;
        checkIn: Date | null;
        checkOut?: Date | null;
        note?: string | null;
        dutyStartTimeSnapshot?: string | null;
      };
    },
    dutyStartTimeSnapshot?: string | null,
  ): Promise<void> {
    if (!result.needsConsequenceReconcile || !result.log) return;
    await this.runConsequenceReconcile(
      employeeId,
      result.log.date ?? dateOnly,
      result.before ?? null,
      result.log,
      dutyStartTimeSnapshot ?? result.log.dutyStartTimeSnapshot ?? null,
    );
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
    const anyExisting = await db.attendanceLog.findFirst({
      where: {
        employeeId: employee.id,
        date: dateOnly,
        type: AttendanceLogType.REGULAR,
      },
    });

    const swapExempt = await this.isLateExemptForSwap(
      db,
      employee.id,
      dateOnly,
      anyExisting?.status,
    );
    const lateMinutesRaw = twentyFourHour
      ? 0
      : computeBiometricLateMinutes(checkTime, employee);
    const lateMinutes = swapExempt ? 0 : lateMinutesRaw;
    const preDutyOvertimeMinutes = twentyFourHour
      ? 0
      : computePreDutyOvertimeMinutes(checkTime, employee);
    const status = twentyFourHour
      ? AttendanceStatus.PRESENT
      : swapExempt
        ? anyExisting?.status === AttendanceStatus.SWAP_COVERED
          ? AttendanceStatus.SWAP_COVERED
          : AttendanceStatus.PRESENT
        : this.statusForBiometricCheckIn(lateMinutes, employee);

    if (anyExisting) {
      if (anyExisting.checkIn) {
        if (anyExisting.status === AttendanceStatus.UNMARKED) {
          // checkIn is set but status was never finalized — fix it and
          // report success instead of rejecting as a duplicate. This did
          // not create a new check-in; it repaired an incomplete one.
          const log = await this.reconcileUnmarkedCheckIn(
            db,
            employee.id,
            employee,
            anyExisting,
            twentyFourHour,
            swapExempt,
          );
          return {
            type: 'CHECKIN' as const,
            log,
            reconciled: true,
            needsConsequenceReconcile: true as const,
            before: anyExisting,
          };
        }
        throw new ConflictException(
          'Employee already checked in. Duplicate CHECKIN rejected.',
        );
      }

      // Write check-in FIRST in this transaction. Late discipline / letters /
      // payroll side-effects run AFTER commit (see runConsequenceReconcile)
      // so a LATE-path failure can never roll back the punch — which is why
      // on-time (PRESENT) punches succeeded while after-grace (LATE) ones
      // vanished when discipline ran before the write in the same TX.
      const wasUninformedAbsent =
        anyExisting.status === AttendanceStatus.UNINFORMED_ABSENT;

      const log = await this.runInTx(db, async (tx) => {
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
                ? 'Checked in after being auto-marked Uninformed Absent'
                : anyExisting.note,
          },
        });
      });

      return {
        type: 'CHECKIN' as const,
        log,
        needsConsequenceReconcile: true as const,
        before: anyExisting,
      };
    }

    const log = await this.runInTx(db, async (tx) => {
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
          dutyStartTimeSnapshot: employee.dutyStartTime ?? null,
          dutyEndTimeSnapshot: employee.dutyEndTime ?? null,
        },
      });
    });

    return {
      type: 'CHECKIN' as const,
      log,
      needsConsequenceReconcile: true as const,
      before: null,
    };
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

    if (isCheckoutTooSoon(openRegular.checkIn, checkTime)) {
      throw new BadRequestException(CHECKOUT_TOO_SOON_REASON);
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

    const log = await this.runInTx(db, async (tx) => {
      return tx.attendanceLog.update({
        where: { id: openRegular.id },
        data: {
          checkOut: checkTime,
          overtimeMinutes,
          overtimePending: overtimeMinutes > 0 && !openRegular.overtimeApprovedAt,
          status,
          sessionClosedAt: null,
        },
      });
    });

    return {
      type: 'CHECKOUT' as const,
      log,
      needsConsequenceReconcile: true as const,
      before: openRegular,
    };
  }

  private async biometricOvertimeCheckIn(
    employee: {
      id: string;
      dutyStartTime?: string | null;
      dutyEndTime?: string | null;
    },
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
        dutyStartTimeSnapshot: employee.dutyStartTime ?? null,
        dutyEndTimeSnapshot: employee.dutyEndTime ?? null,
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
      select: {
        id: true,
        currentBranchId: true,
        status: true,
        dutyStartTime: true,
        dutyEndTime: true,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id ${employeeId} not found`);
    }

    assertEmployeeEligibleForBiometricAttendance(
      employee.status,
      this.employeeAttendanceContext(employee),
    );

    const checkTime = new Date();
    const twentyFourHour = is24HourShift(employee);
    const dateOnly = this.resolvePunchAttendanceDate(
      checkTime,
      employee,
      twentyFourHour,
    );

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

    assertEmployeeEligibleForManualAttendance(
      employee.status,
      this.employeeAttendanceContext(employee),
    );

    if (isMedicineManagerRole(actingUser.role)) {
      if (!assertEmployeeInMedicineScope(employee)) {
        throw new ForbiddenException(
          'You can only mark attendance for Medicine Management System staff',
        );
      }
    }

    const dateOnly = toPakistanDateOnly(
      new Date(`${dto.date}T00:00:00+05:00`),
    );

    // Fetched unconditionally (not just for mark-only roles) — this is also
    // the source for that date's own duty snapshot below, so re-marking an
    // EXISTING row (HR correcting an old check-in) resolves lateness
    // against the duty that actually applied on that date, not today's
    // employee duty.
    const existing = await this.prisma.attendanceLog.findUnique({
      where: {
        employeeId_date_type: {
          employeeId: dto.employeeId,
          date: dateOnly,
          type: AttendanceLogType.REGULAR,
        },
      },
    });

    const checkIn = dto.checkIn ? parseAttendanceDateTime(dto.checkIn) : undefined;
    const checkOut = dto.checkOut ? parseAttendanceDateTime(dto.checkOut) : undefined;

    let status = dto.status;
    let lateMinutes = dto.lateMinutes ?? 0;

    if (checkIn) {
      if (is24HourShift(employee)) {
        // 24-hour staff are never late / half-day from check-in time.
        lateMinutes = 0;
      } else {
        // existing's own snapshot (this exact date's duty) wins when this
        // is a re-mark of an already-existing row; current employee duty
        // is only used for a genuinely new row or a legacy row with no
        // snapshot to fall back on.
        const dutyStart = resolveAttendanceDutyTimes(
          existing,
          employee,
        ).dutyStartTime;
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

    if (
      is24HourShift(employee) &&
      (status === AttendanceStatus.LATE || status === AttendanceStatus.HALF_DAY)
    ) {
      lateMinutes = 0;
      status = AttendanceStatus.PRESENT;
    }

    const swapExempt = await this.isLateExemptForSwap(
      this.prisma,
      dto.employeeId,
      dateOnly,
      existing?.status ?? status,
    );
    if (
      swapExempt ||
      status === AttendanceStatus.SWAP_COVERED
    ) {
      lateMinutes = 0;
      if (status === AttendanceStatus.LATE || status === AttendanceStatus.HALF_DAY) {
        status = AttendanceStatus.PRESENT;
      }
      if (existing?.status === AttendanceStatus.SWAP_COVERED) {
        status = AttendanceStatus.SWAP_COVERED;
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
      // ABSENT/UNINFORMED_ABSENT are deliberately NOT dispatched here
      // (pre-write) — unlike LATE/HALF_DAY, applyDisciplineRules never
      // upgrades their status (no HALF_DAY-style escalation), so applying
      // their consequence has no ordering dependency on the write below.
      // Owning it in reconcileAttendanceFinancialConsequences instead
      // (post-write, below) makes it symmetric with reversal and — unlike
      // this pre-write dispatch, which fired unconditionally on every
      // re-mark regardless of `existing` — only applies when the row is
      // genuinely newly entering the absence family, closing a duplicate-
      // deduction risk on a redundant re-mark of an already-ABSENT day.
      if (
        status === AttendanceStatus.LATE ||
        status === AttendanceStatus.HALF_DAY
      ) {
        effectiveStatus = await applyDisciplineRules(
          tx,
          dto.employeeId,
          status,
          dateOnly,
          {
            lateMinutes,
            // Letter wording uses this date's own duty when re-marking an
            // existing row — see resolveAttendanceDutyTimes above.
            dutyStartTimeSnapshot: resolveAttendanceDutyTimes(
              existing,
              employee,
            ).dutyStartTime,
          },
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
          dutyStartTimeSnapshot: employee.dutyStartTime ?? null,
          dutyEndTimeSnapshot: employee.dutyEndTime ?? null,
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

      // Centralized reconciliation covers both directions: reversing a
      // LATE/ABSENT_FAMILY consequence the row is moving OUT of, and
      // applying a NEW ABSENT_FAMILY consequence when a row is moving INTO
      // it (including the create path, where `existing` is null — see
      // reconcileAttendanceFinancialConsequences' doc comment). Idempotent,
      // same-transaction, employee/date scoped.
      await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: dto.employeeId,
        date: dateOnly,
        before: existing,
        after: attendanceLog,
        dutyStartTimeSnapshot: resolveAttendanceDutyTimes(existing, employee)
          .dutyStartTime,
      });

      return attendanceLog;
    });

    // Fires only after the transaction above has committed — markManual
    // always writes a payroll-relevant status (never a bare UNMARKED
    // create), so this is unconditional. See
    // PayrollService.recomputePendingPayrollForAttendanceDate.
    await this.payrollService.recomputePendingPayrollForAttendanceDate(
      dto.employeeId,
      dateOnly,
    );

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
            status: true,
            currentBranchId: true,
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

    assertEmployeeEligibleForAttendanceRecord(
      log.employee.status,
      this.employeeAttendanceContext(log.employee),
      log.date,
    );

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

    // SHORT_LEAVE is never written directly here — it goes through the
    // LeaveRecord-backed quota/duration/reconciliation path below (shared
    // with the Portal Short Leave flow), which decides for itself whether
    // and how to write the status.
    if (
      dto.status !== undefined &&
      dto.status !== AttendanceStatus.SHORT_LEAVE
    ) {
      data.status = dto.status;
      if (dto.status === AttendanceStatus.SWAP_COVERED) {
        data.lateMinutes = 0;
      }
      if (
        dto.status === AttendanceStatus.ON_LEAVE &&
        dto.checkIn === undefined &&
        dto.checkOut === undefined
      ) {
        data.checkIn = null;
        data.checkOut = null;
        data.lateMinutes = 0;
        data.overtimeMinutes = 0;
        data.overtimePending = false;
      }
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
    const effectiveCheckOut =
      dto.checkOut !== undefined
        ? dto.checkOut
          ? parseAttendanceDateTime(dto.checkOut)
          : null
        : log.checkOut;

    // HR "emergency" flow: retroactively reclassifying this row's real
    // checkIn/checkOut as Short Leave. Validated up front (fast fail, never
    // against HR-supplied lateMinutes — that must not be usable to suppress
    // a real violation) so an obviously-invalid attempt never creates a
    // LeaveRecord at all. The actual quota check, LeaveRecord creation, and
    // attendance reconciliation happen inside the transaction below,
    // through the same reconcileShortLeaveAttendance() path the Portal
    // Short Leave flow uses — the two flows converge on identical treatment
    // and share one monthly quota (see short-leave.util.ts).
    if (dto.status === AttendanceStatus.SHORT_LEAVE) {
      // Same date's own duty this row's reconcileShortLeaveAttendance call
      // (inside the transaction below) will use — validating up front
      // against log.employee's CURRENT duty while the actual reconciliation
      // uses the snapshot would let this fast-fail check disagree with the
      // real decision for a historical date whose duty has since changed.
      const dayDuty = resolveAttendanceDutyTimes(log, log.employee);
      const evaluation = evaluateShortLeaveDeviation(
        {
          ...log.employee,
          dutyStartTime: dayDuty.dutyStartTime,
          dutyEndTime: dayDuty.dutyEndTime,
        },
        log.date,
        effectiveCheckIn,
        effectiveCheckOut,
      );
      if (evaluation.valid === false) {
        throw new BadRequestException(evaluation.reason);
      }
    }

    // Auto-recompute status/lateMinutes ONLY when checkIn is genuinely,
    // explicitly being changed in THIS request (dto.checkIn !== undefined).
    // Previously this ran whenever the row already had a checkIn at all
    // (effectiveCheckIn falls back to log.checkIn) — meaning an unrelated
    // edit (note, overtime, anything not touching status/checkIn) would
    // silently recompute and overwrite an already-settled historical
    // status using the employee's CURRENT duty. That is exactly the
    // production bug this fix closes: a duty change must never retroactively
    // alter a previously-settled attendance record as a side effect of an
    // unrelated edit.
    if (
      dto.status === undefined &&
      dto.checkIn !== undefined &&
      effectiveCheckIn
    ) {
      const swapExempt = await this.isLateExemptForSwap(
        this.prisma,
        log.employeeId,
        log.date,
        log.status,
      );
      if (is24HourShift(log.employee) || swapExempt || log.status === AttendanceStatus.SWAP_COVERED) {
        data.status =
          log.status === AttendanceStatus.SWAP_COVERED
            ? AttendanceStatus.SWAP_COVERED
            : AttendanceStatus.PRESENT;
        data.lateMinutes = 0;
      } else {
        // The duty that applied when this record actually happened —
        // AttendanceLog's own snapshot when present, current employee duty
        // only as a last resort for legacy rows with no snapshot (there is
        // no reliable historical source for those — see the audit).
        const dutyStart = resolveAttendanceDutyTimes(
          log,
          log.employee,
        ).dutyStartTime;
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

    // HR status override can leave status=LATE while lateMinutes > 120;
    // the auto-recompute path already writes HALF_DAY via statusFromLateMinutes.
    // Discipline (letters, fines, half-day deduction) is applied once post-write
    // by reconcileAttendanceFinancialConsequences — not pre-write here. Running
    // applyDisciplineRules before AND after the write duplicated side-effects
    // and could abort the transaction (500) while leaving the row unchanged.
    if (
      data.status === AttendanceStatus.LATE &&
      ((data.lateMinutes as number | undefined) ?? 0) > 120
    ) {
      data.status = AttendanceStatus.HALF_DAY;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updateData = { ...data };
      let shortLeaveDecision: 'APPROVED' | 'PENDING_APPROVAL' | undefined;

      if (dto.status === AttendanceStatus.SHORT_LEAVE) {
        // Unified monthly quota shared with the Portal Short Leave flow —
        // counted from LeaveRecord (every Short Leave, either flow, is now
        // represented as one), read live under this transaction to avoid a
        // race between two concurrent Short Leave saves for the same
        // employee/month.
        const occurrencesThisMonth = await countShortLeaveOccurrencesThisMonth(
          tx,
          log.employeeId,
          log.date,
        );
        const withinQuota =
          occurrencesThisMonth + 1 <= MONTHLY_SHORT_LEAVE_LIMIT;

        await tx.leaveRecord.create({
          data: {
            employeeId: log.employeeId,
            leaveType: LeaveType.SHORT_LEAVE,
            startDate: log.date,
            endDate: log.date,
            totalDays: 0,
            reason: dto.note || 'HR emergency short leave',
            status: withinQuota
              ? LeaveStatus.APPROVED
              : LeaveStatus.PENDING_APPROVAL,
            currentStage: null,
            approvedBy: withinQuota ? actingUser.id : null,
          },
        });

        if (withinQuota) {
          // Duration/side already validated above; this performs the
          // actual attendance write (status=SHORT_LEAVE, full-day payroll
          // credit at read time) and reverses late discipline when
          // applicable — the exact same reconciliation the Portal flow
          // uses, so both converge on identical treatment.
          await reconcileShortLeaveAttendance(
            tx,
            log.employeeId,
            log.date,
            log.employee,
          );
          shortLeaveDecision = 'APPROVED';
        } else {
          // Quota exceeded: this attendance row is left completely
          // untouched (no status change, no discipline reversal) until HR
          // separately decides the quota exception via
          // LeaveService.decideQuotaException.
          shortLeaveDecision = 'PENDING_APPROVAL';
        }
      } else if (dto.status === AttendanceStatus.ON_LEAVE) {
        const overlappingApproved = await tx.leaveRecord.findFirst({
          where: {
            employeeId: log.employeeId,
            leaveType: { not: LeaveType.SHORT_LEAVE },
            status: LeaveStatus.APPROVED,
            startDate: { lte: log.date },
            endDate: { gte: log.date },
          },
          select: { id: true },
        });
        if (!overlappingApproved) {
          const overlappingPending = await tx.leaveRecord.findFirst({
            where: {
              employeeId: log.employeeId,
              leaveType: { not: LeaveType.SHORT_LEAVE },
              status: LeaveStatus.PENDING_APPROVAL,
              startDate: { lte: log.date },
              endDate: { gte: log.date },
            },
            select: { id: true },
          });
          if (overlappingPending) {
            throw new ConflictException(
              'This date already has a pending leave request. Approve or reject it before marking On Leave.',
            );
          }
          const reason = dto.note?.trim();
          await tx.leaveRecord.create({
            data: {
              employeeId: log.employeeId,
              leaveType: LeaveType.REGULAR,
              startDate: log.date,
              endDate: log.date,
              totalDays: 1,
              reason:
                reason && reason.length >= 3
                  ? reason
                  : 'Marked on leave from attendance',
              status: LeaveStatus.APPROVED,
              currentStage: null,
              approvedBy: actingUser.id,
            },
          });
        }
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
            shortLeaveDecision,
          },
        },
      });

      // Centralized reconciliation: reverses LATE/ABSENT_FAMILY consequences
      // a plain status/checkIn/checkOut correction moves this row OUT of
      // (e.g. HR correcting HALF_DAY(late) or LATE back to PRESENT/ON_LEAVE,
      // or ABSENT/UNINFORMED_ABSENT back to PRESENT — previously the latter
      // was never reversed here at all), APPLIES a new ABSENT_FAMILY
      // consequence when HR sets status directly to ABSENT/UNINFORMED_ABSENT
      // through this edit endpoint (previously silently skipped — only
      // markManual applied it), and reverses a missing-checkout consequence
      // once a checkout is supplied for a previously-open session. Runs in
      // the SAME transaction as the attendance write, and every underlying
      // call is independently idempotent, so this harmlessly no-ops
      // wherever reconcileShortLeaveAttendance already handled the LATE side
      // earlier in this same call.
      await reconcileAttendanceFinancialConsequences(tx, {
        employeeId: log.employeeId,
        date: log.date,
        before: previous,
        after: result,
        dutyStartTimeSnapshot: resolveAttendanceDutyTimes(log, log.employee)
          .dutyStartTime,
      });

      return shortLeaveDecision ? { ...result, shortLeaveDecision } : result;
    });

    // Fires only after the transaction above has committed. Uses log.date
    // — the row's own historical business date, never wall-clock "now" —
    // so correcting an August record in September recomputes AUGUST's
    // PENDING payroll, not the current month's. See
    // PayrollService.recomputePendingPayrollForAttendanceDate.
    await this.payrollService.recomputePendingPayrollForAttendanceDate(
      log.employeeId,
      log.date,
    );

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
    const now = new Date();
    const pkToday = toPakistanDateOnly(now);
    if (dateOnly.getTime() > pkToday.getTime()) {
      return;
    }

    const isToday = dateOnly.getTime() === pkToday.getTime();
    if (isToday) {
      await this.purgePrematureUnmarkedForDate(dateOnly, now, employeeWhere);
    }

    const employees = await this.prisma.employee.findMany({
      where: {
        relieverOnly: false,
        ...schedulerAttendanceCandidateWhere(),
        ...(employeeWhere ?? {}),
      },
      select: {
        id: true,
        status: true,
        statusEffectiveFrom: true,
        currentBranchId: true,
        dutyStartTime: true,
        dutyEndTime: true,
        dutyTotalHours: true,
        joiningDate: true,
        weeklyOffWeekdays: true,
        shift: { select: { startTime: true, endTime: true, name: true } },
      },
    });

    const eligible: typeof employees = [];
    for (const employee of employees) {
      if (!isSchedulerAttendanceEligible(employee, dateOnly)) {
        continue;
      }
      if (isWeeklyOffDate(employee.weeklyOffWeekdays, dateOnly)) {
        continue;
      }

      if (is24HourShift(employee)) {
        if (isToday || dateOnly.getTime() < pkToday.getTime()) {
          eligible.push(employee);
        }
        continue;
      }

      const dutyStart =
        employee.dutyStartTime?.trim() ||
        employee.shift?.startTime?.trim() ||
        null;
      if (!dutyStart) {
        continue;
      }

      // Calendar "today" before evening start still belongs to yesterday for
      // overnight duties — do not create a today UNMARKED placeholder.
      if (isToday) {
        const activeDate = getShiftAttendanceDate(now, dutyStart);
        if (activeDate.getTime() !== dateOnly.getTime()) {
          continue;
        }
      }

      if (!hasDutyStartedForAttendanceDate(dateOnly, dutyStart, now)) {
        continue;
      }

      eligible.push(employee);
    }

    if (eligible.length === 0) {
      return;
    }

    const eligibleIds = eligible.map((e) => e.id);

    const [onLeaveRows, existingLogs] = await Promise.all([
      this.prisma.leaveRecord.findMany({
        where: {
          employeeId: { in: eligibleIds },
          status: LeaveStatus.APPROVED,
          startDate: { lte: dateOnly },
          endDate: { gte: dateOnly },
        },
        select: { employeeId: true },
      }),
      this.prisma.attendanceLog.findMany({
        where: {
          employeeId: { in: eligibleIds },
          date: dateOnly,
          type: AttendanceLogType.REGULAR,
        },
        select: { employeeId: true },
      }),
    ]);

    const onLeaveIds = new Set(onLeaveRows.map((r) => r.employeeId));
    const existingIds = new Set(existingLogs.map((r) => r.employeeId));

    const toCreate = eligible.filter(
      (e) => !onLeaveIds.has(e.id) && !existingIds.has(e.id),
    );
    if (toCreate.length === 0) {
      return;
    }

    await this.prisma.attendanceLog.createMany({
      data: toCreate.map((employee) => {
        const dutyStart =
          employee.dutyStartTime?.trim() ||
          employee.shift?.startTime?.trim() ||
          DEFAULT_DUTY_START;
        return {
          employeeId: employee.id,
          branchId: employee.currentBranchId,
          date: dateOnly,
          type: AttendanceLogType.REGULAR,
          status: AttendanceStatus.UNMARKED,
          source: AttendanceSource.MANUAL,
          note: AUTO_UNMARKED_NOTE,
          dutyStartTimeSnapshot: employee.dutyStartTime ?? dutyStart,
          dutyEndTimeSnapshot:
            employee.dutyEndTime ?? employee.shift?.endTime ?? null,
        };
      }),
      skipDuplicates: true,
    });
  }

  /**
   * Removes today's empty UNMARKED placeholders created before the employee's
   * duty start (or while "today" is still yesterday's overnight attendance
   * day). Keeps the dashboard / attendance list from showing overnight staff
   * as Unmarked immediately after midnight.
   */
  private async purgePrematureUnmarkedForDate(
    dateOnly: Date,
    now: Date,
    employeeWhere?: Prisma.EmployeeWhereInput,
  ): Promise<void> {
    const openUnmarked = await this.prisma.attendanceLog.findMany({
      where: {
        type: AttendanceLogType.REGULAR,
        date: dateOnly,
        status: AttendanceStatus.UNMARKED,
        checkIn: null,
        ...(employeeWhere ? { employee: employeeWhere } : {}),
      },
      select: {
        id: true,
        dutyStartTimeSnapshot: true,
        employee: {
          select: {
            dutyStartTime: true,
            dutyEndTime: true,
            dutyTotalHours: true,
            shift: { select: { startTime: true, endTime: true, name: true } },
          },
        },
      },
    });

    const toDelete: string[] = [];
    for (const row of openUnmarked) {
      if (is24HourShift(row.employee)) {
        continue;
      }
      const dutyStart =
        row.dutyStartTimeSnapshot?.trim() ||
        row.employee.dutyStartTime?.trim() ||
        row.employee.shift?.startTime?.trim() ||
        null;
      if (!hasDutyStartedForAttendanceDate(dateOnly, dutyStart, now)) {
        toDelete.push(row.id);
      }
    }

    if (toDelete.length === 0) return;
    await this.prisma.attendanceLog.deleteMany({
      where: { id: { in: toDelete } },
    });
  }

  private async ensureUnmarkedLogsForShift(
    shiftId: string,
    date: Date,
    employeeWhere?: Prisma.EmployeeWhereInput,
  ): Promise<void> {
    // Kept for markAbsentForShift / schedulers that still key by shiftId.
    // Day-list materialization uses ensureUnmarkedForActiveShiftsOnDate above
    // (employee duty clock) so overnight + employees without a shift link
    // are handled correctly.
    const employees = await this.prisma.employee.findMany({
      where: {
        shiftId,
        relieverOnly: false,
        ...schedulerAttendanceCandidateWhere(),
        ...(employeeWhere ?? {}),
      },
      select: {
        id: true,
        status: true,
        statusEffectiveFrom: true,
        currentBranchId: true,
        dutyStartTime: true,
        dutyEndTime: true,
        joiningDate: true,
        weeklyOffWeekdays: true,
        shift: { select: { startTime: true, endTime: true } },
      },
    });

    for (const employee of employees) {
      if (!isSchedulerAttendanceEligible(employee, date)) {
        continue;
      }
      if (isWeeklyOffDate(employee.weeklyOffWeekdays, date)) {
        continue;
      }

      const dutyStart =
        employee.dutyStartTime?.trim() ||
        employee.shift?.startTime?.trim() ||
        null;

      if (!hasDutyStartedForAttendanceDate(date, dutyStart)) {
        continue;
      }

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
            dutyStartTimeSnapshot: employee.dutyStartTime ?? dutyStart,
            dutyEndTimeSnapshot:
              employee.dutyEndTime ?? employee.shift?.endTime ?? null,
          },
        });
      }
    }
  }

  /**
   * Materialize a REGULAR UNMARKED row for every calendar day in the month
   * that does not already have a log (and is not covered by approved leave).
   * Days before joiningDate are stored with PRE_JOIN_UNMARKED_NOTE so the
   * uninformed-absent cron never fines them; they still pay zero basic
   * (UNMARKED without punches, and they sit before stipend effectiveFrom).
   *
   * Today's row is only created once the employee's duty start time has
   * been reached (overnight 21:00–09:00 must not show "today" as unmarked
   * while still on yesterday's shift, or during the day before the next
   * 21:00 start). Premature month-calendar UNMARKED rows for today are
   * removed on the same pass so existing bad rows self-heal when the
   * month view loads.
   */
  private async ensureMonthLogsForEmployee(
    employeeId: string,
    month: number,
    year: number,
  ): Promise<void> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        currentBranchId: true,
        dutyStartTime: true,
        dutyEndTime: true,
        joiningDate: true,
        weeklyOffWeekdays: true,
        shift: { select: { startTime: true, endTime: true } },
      },
    });
    if (!employee) return;

    const dutyStart =
      employee.dutyStartTime?.trim() ||
      employee.shift?.startTime?.trim() ||
      null;
    const dutyEnd =
      employee.dutyEndTime?.trim() || employee.shift?.endTime?.trim() || null;

    const now = new Date();
    const dates = calendarDatesForAttendanceMonth(year, month, now);
    if (dates.length === 0) return;

    const pkToday = toPakistanDateOnly(now);
    const todayInMonth = dates.some((d) => d.getTime() === pkToday.getTime());
    if (
      todayInMonth &&
      !hasDutyStartedForAttendanceDate(pkToday, dutyStart, now)
    ) {
      // Self-heal rows created before this gate existed (overnight staff
      // shown unmarked for "today" during the morning/afternoon).
      await this.prisma.attendanceLog.deleteMany({
        where: {
          employeeId,
          date: pkToday,
          type: AttendanceLogType.REGULAR,
          status: AttendanceStatus.UNMARKED,
          checkIn: null,
        },
      });
    }

    const existing = await this.prisma.attendanceLog.findMany({
      where: {
        employeeId,
        type: AttendanceLogType.REGULAR,
        date: { gte: dates[0], lte: dates[dates.length - 1] },
      },
      select: { date: true },
    });
    const existingKeys = new Set(existing.map((row) => row.date.getTime()));

    const approvedLeave = await this.prisma.leaveRecord.findMany({
      where: {
        employeeId,
        status: LeaveStatus.APPROVED,
        startDate: { lte: dates[dates.length - 1] },
        endDate: { gte: dates[0] },
      },
      select: { startDate: true, endDate: true },
    });

    const coveredByLeave = (date: Date) =>
      approvedLeave.some(
        (leave) => date >= leave.startDate && date <= leave.endDate,
      );

    const missing = dates.filter(
      (date) =>
        !existingKeys.has(date.getTime()) &&
        !coveredByLeave(date) &&
        !isWeeklyOffDate(employee.weeklyOffWeekdays, date) &&
        hasDutyStartedForAttendanceDate(date, dutyStart, now),
    );
    if (missing.length === 0) return;

    await this.prisma.attendanceLog.createMany({
      data: missing.map((date) => ({
        employeeId: employee.id,
        branchId: employee.currentBranchId,
        date,
        type: AttendanceLogType.REGULAR,
        status: AttendanceStatus.UNMARKED,
        source: AttendanceSource.MANUAL,
        note: isPreJoinAttendanceDate(date, employee.joiningDate)
          ? PRE_JOIN_UNMARKED_NOTE
          : MONTH_CALENDAR_UNMARKED_NOTE,
        dutyStartTimeSnapshot: employee.dutyStartTime ?? dutyStart,
        dutyEndTimeSnapshot: employee.dutyEndTime ?? dutyEnd,
      })),
      skipDuplicates: true,
    });
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
        in: [
          EmployeeStatus.ACTIVE,
          EmployeeStatus.ON_LEAVE,
          EmployeeStatus.TRAINEE,
        ],
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

    const dateOnly = isSingleDay
      ? this.toDateOnly(new Date(query.startDate!))
      : null;
    const now = new Date();
    const pkToday = toPakistanDateOnly(now);
    const isQueryingToday =
      !!dateOnly && dateOnly.getTime() === pkToday.getTime();

    // Materialize/purge for single-day lists. For Pakistan "today", always
    // run so premature overnight UNMARKED rows are removed even when the
    // client filters by PRESENT/LATE/etc. (dashboard loads all statuses).
    const shouldEnsureUnmarked =
      isSingleDay &&
      (!query.status ||
        query.status === AttendanceStatus.UNMARKED ||
        isQueryingToday);

    if (shouldEnsureUnmarked && dateOnly) {
      await this.ensureUnmarkedForActiveShiftsOnDate(
        dateOnly,
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
      const { start } = pakistanMonthDateRange(query.year, query.month);
      const visibleEnd = pakistanVisibleAttendanceEnd(
        query.year,
        query.month,
      );
      if (!visibleEnd) {
        where.date = { gte: start, lte: new Date(0) };
      } else {
        where.date = { gte: start, lte: visibleEnd };
      }
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

    if (query.employeeId && query.month && query.year) {
      await this.ensureMonthLogsForEmployee(
        query.employeeId,
        query.month,
        query.year,
      );
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
            status: true,
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
              // Display times prefer this row's own duty snapshot (locked in
              // at creation) over the employee's current duty fields, so a
              // later duty change never retroactively alters past rows.
              // Legacy rows created before the snapshot existed fall back to
              // the employee's current duty fields.
              shift: log.employee.shift
                ? {
                    name: log.employee.shift.name,
                    startTime:
                      log.dutyStartTimeSnapshot ??
                      log.employee.dutyStartTime ??
                      log.employee.shift.startTime,
                    endTime:
                      log.dutyEndTimeSnapshot ??
                      log.employee.dutyEndTime ??
                      log.employee.shift.endTime,
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
    let result = mapped;
    if (dutyFilter !== 'all') {
      const minutesOfDay = toPakistanMinutesOfDay(now);
      result = mapped.filter((log) => {
        const emp = log.employee;
        if (!emp) return true;
        if (emp.relieverOnly) return true;
        const win = getDutyWindow(emp);
        if (!win) return true;
        return isOnDutyAt(win, minutesOfDay, DUTY_FILTER_GRACE_MINUTES);
      });
    }

    // Hard hide: empty UNMARKED for "today" before the employee's duty start
    // (overnight 22:00 must not appear at 01:57). DB purge above is primary;
    // this keeps the dashboard correct even if a stale row remains.
    if (isQueryingToday) {
      result = result.filter((log) => {
        if (
          log.status !== AttendanceStatus.UNMARKED ||
          log.checkIn != null
        ) {
          return true;
        }
        const dutyStart =
          log.dutyStartTimeSnapshot?.trim() ||
          log.employee?.dutyStartTime?.trim() ||
          log.employee?.shift?.startTime?.trim() ||
          null;
        return hasDutyStartedForAttendanceDate(log.date, dutyStart, now);
      });
    }

    return result;
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
    const dateOnly = toPakistanDateOnly(new Date(`${dto.date}T00:00:00+05:00`));
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
    assertEmployeeEligibleForRelieverAttendance(
      employee.status,
      this.employeeAttendanceContext(employee),
      dateOnly,
    );

    await this.reconcileRelieverDutyAttendance(
      dto.employeeId,
      dateOnly,
      employee.currentBranchId,
    );

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

    const session = await this.prisma.relieverSession.create({
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

    await this.payrollService.recomputePendingPayrollForAttendanceDate(
      dto.employeeId,
      dateOnly,
    );

    return session;
  }

  async relieverCheckOut(
    dto: RelieverCheckOutDto,
    addedById: string,
  ) {
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

    // Option A: show on Additional Working Days tab for HR visibility; pay stays
    // on RelieverSession → RELIEVER allowance (not AWD full-day rate).
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

    await this.additionalWorkingDaysService.upsertFromRelieverSession({
      relieverSessionId: updated.id,
      employeeId: updated.employeeId,
      date: updated.date,
      addedById,
    });

    await this.payrollService.recomputePendingPayrollForAttendanceDate(
      updated.employeeId,
      updated.date,
    );

    return updated;
  }

  /**
   * HR correction to an existing RelieverSession's recorded checkIn/checkOut
   * — the Reliever-session equivalent of updateAttendance() for normal
   * AttendanceLog rows. Never touches AttendanceLog; RelieverSession stays
   * the sole source of truth for reliever work, exactly as before.
   *
   * totalMinutes is recomputed and persisted here because
   * computeRelieverPayableMinutes (payroll-hours.util.ts) uses it as the
   * base for the "actual minutes minus own-duty overlap" formula — payroll
   * itself recomputes payable minutes dynamically from RelieverSession rows
   * on every generate/refresh (PayrollService.upsertRelieverAllowanceRow),
   * so no payroll call is needed here; the next PENDING-entry
   * generate/refresh picks up the correction automatically. PROCESSED/PAID
   * entries are already frozen by that same call site's existing early
   * return — unaffected by this change.
   */
  async updateRelieverSession(
    sessionId: string,
    dto: UpdateRelieverSessionDto,
    actingUser: { id: string; role: UserRole },
  ) {
    if (dto.checkIn === undefined && dto.checkOut === undefined) {
      throw new BadRequestException(
        'At least one of checkIn or checkOut must be provided',
      );
    }

    const session = await this.prisma.relieverSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`Reliever session ${sessionId} not found`);
    }

    const effectiveCheckIn = dto.checkIn
      ? parseAttendanceDateTime(dto.checkIn)
      : session.checkIn;
    const effectiveCheckOut = dto.checkOut
      ? parseAttendanceDateTime(dto.checkOut)
      : session.checkOut;

    if (
      effectiveCheckOut &&
      effectiveCheckOut.getTime() < effectiveCheckIn.getTime()
    ) {
      throw new BadRequestException('Check-out must be after check-in');
    }

    // Session-level double-booking check — the existing
    // assertNoRelieverDoubleBooking (leave.service.ts) only guards the
    // assignment layer (date-range + duty-window at request time); this is
    // the equivalent check against actual recorded RelieverSession
    // timestamps for the same reliever. Runs unconditionally (not just when
    // effectiveCheckOut is set) because a correction that leaves this
    // session open still needs checking against other sessions, including
    // other still-open ones — see the open/open branch below.
    //
    // An OPEN other session (checkOut still null) has no known true end, so
    // it cannot be compared with the normal in/out overlap test; the only
    // safe assumption is that it might still be running for any time at or
    // after its own checkIn. That makes three cases:
    //  - other completed (checkOut set): normal interval overlap test,
    //    only decidable when this correction also has a definite end.
    //  - other open, this correction has a definite end: reject unless the
    //    corrected session ends at or before the other session's start —
    //    anything later is ambiguous, since the open session could still be
    //    running through that time.
    //  - other open, this correction also stays open: two open-ended
    //    intervals for the same reliever can never be verified as
    //    non-overlapping — always reject.
    // Scoped to a window around THIS session's own date (±1 calendar day —
    // generous enough to still catch a genuine cross-midnight overlap
    // against an adjacent day's session, since the actual overlap test
    // below compares real checkIn/checkOut timestamps, not date labels).
    // Previously unscoped by date at all, so a correction was compared
    // against this reliever's ENTIRE session history — including any
    // stale/abandoned OPEN session from a completely unrelated date, which
    // the open-session branch below always treats as ambiguous. A
    // corrected checkout time is almost always later than any such
    // session's checkIn, so that stale row alone was enough to reject
    // every correction with a false "overlap" — see relieverCheckIn's own
    // create-time checks above, which already scope by date the same way.
    const windowStart = new Date(session.date);
    windowStart.setDate(windowStart.getDate() - 1);
    const windowEnd = new Date(session.date);
    windowEnd.setDate(windowEnd.getDate() + 1);
    windowEnd.setHours(23, 59, 59, 999);

    const otherSessions = await this.prisma.relieverSession.findMany({
      where: {
        employeeId: session.employeeId,
        id: { not: session.id },
        date: { gte: windowStart, lte: windowEnd },
      },
      select: { checkIn: true, checkOut: true },
    });

    const overlaps = otherSessions.some((other) => {
      if (other.checkOut != null) {
        // Other session is completed.
        if (effectiveCheckOut) {
          return (
            effectiveCheckIn.getTime() < other.checkOut.getTime() &&
            other.checkIn.getTime() < effectiveCheckOut.getTime()
          );
        }
        // This correction stays open — ambiguous unless it starts at or
        // after the other (completed) session's end.
        return effectiveCheckIn.getTime() < other.checkOut.getTime();
      }

      // Other session is still open (no known true end).
      if (effectiveCheckOut) {
        return effectiveCheckOut.getTime() > other.checkIn.getTime();
      }
      // Both this correction and the other session are open-ended.
      return true;
    });

    if (overlaps) {
      throw new ConflictException(
        'Corrected times overlap another recorded Reliever session for this employee',
      );
    }

    const totalMinutes = effectiveCheckOut
      ? Math.max(
          0,
          Math.round(
            (effectiveCheckOut.getTime() - effectiveCheckIn.getTime()) / 60000,
          ),
        )
      : 0;

    const previous = {
      checkIn: session.checkIn,
      checkOut: session.checkOut,
      totalMinutes: session.totalMinutes,
    };

    const result = await this.prisma.$transaction(async (tx) => {
      const result = await tx.relieverSession.update({
        where: { id: sessionId },
        data: {
          checkIn: effectiveCheckIn,
          checkOut: effectiveCheckOut,
          totalMinutes,
        },
        include: {
          employee: {
            select: { id: true, fullName: true, employeeCode: true },
          },
          branch: { select: BRANCH_LABEL_SELECT },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUser.id,
          action: 'RELIEVER_SESSION_UPDATED',
          entity: 'RelieverSession',
          entityId: sessionId,
          changes: {
            previous,
            updated: {
              checkIn: result.checkIn,
              checkOut: result.checkOut,
              totalMinutes: result.totalMinutes,
            },
          },
        },
      });

      return result;
    });

    if (result.checkOut) {
      await this.additionalWorkingDaysService.upsertFromRelieverSession({
        relieverSessionId: result.id,
        employeeId: result.employeeId,
        date: result.date,
        addedById: actingUser.id,
      });
    }

    await this.payrollService.recomputePendingPayrollForAttendanceDate(
      result.employeeId,
      result.date,
    );

    return result;
  }

  private async reconcileRelieverDutyAttendance(
    employeeId: string,
    dateOnly: Date,
    branchId: string,
  ) {
    const ownLeave = await this.prisma.leaveRecord.findFirst({
      where: {
        employeeId,
        leaveType: { not: LeaveType.SHORT_LEAVE },
        status: LeaveStatus.APPROVED,
        startDate: { lte: dateOnly },
        endDate: { gte: dateOnly },
      },
      select: { id: true },
    });
    if (ownLeave) {
      throw new BadRequestException(
        'Cannot start reliever duty on a day you are on approved leave',
      );
    }

    const log = await this.prisma.attendanceLog.findUnique({
      where: {
        employeeId_date_type: {
          employeeId,
          date: dateOnly,
          type: AttendanceLogType.REGULAR,
        },
      },
    });
    if (!log || log.status !== AttendanceStatus.ON_LEAVE) {
      return;
    }

    await this.prisma.attendanceLog.update({
      where: { id: log.id },
      data: {
        status: AttendanceStatus.PRESENT,
        source: AttendanceSource.MANUAL,
        note: log.note?.trim()
          ? `${log.note.trim()} · Reliever duty`
          : 'Reliever duty',
      },
    });
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
    await this.ensureMonthLogsForEmployee(employeeId, month, year);

    const { start } = pakistanMonthDateRange(year, month);
    const visibleEnd = pakistanVisibleAttendanceEnd(year, month);
    const logs = visibleEnd
      ? await this.prisma.attendanceLog.findMany({
          where: {
            employeeId,
            type: AttendanceLogType.REGULAR,
            date: { gte: start, lte: visibleEnd },
          },
        })
      : [];

    // Weekly-off days never get an AttendanceLog row (ensureMonthLogsForEmployee
    // deliberately excludes them, same as the payroll gap-day pass) so they
    // must be counted from the calendar itself, not from `logs` — otherwise
    // the tile's total silently undercounts elapsed days by the weekly-off
    // count with no visible line item explaining the gap.
    let weeklyOff = 0;
    if (visibleEnd) {
      const employee = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { weeklyOffWeekdays: true },
      });
      const elapsedDates = calendarDatesForAttendanceMonth(year, month);
      weeklyOff = elapsedDates.filter((d) =>
        isWeeklyOffDate(employee?.weeklyOffWeekdays, d),
      ).length;
    }

    return summarizeAttendanceLogs(logs, weeklyOff);
  }

  async markAbsentees(date: string) {
    const dateOnly = this.toDateOnly(new Date(date));

    const activeEmployees = await this.prisma.employee.findMany({
      where: {
        status: EmployeeStatus.ACTIVE,
        relieverOnly: false,
        shiftId: { not: null },
      },
      select: { id: true, currentBranchId: true, weeklyOffWeekdays: true },
    });

    const existingLogs = await this.prisma.attendanceLog.findMany({
      where: { date: dateOnly, type: AttendanceLogType.REGULAR },
      select: { employeeId: true },
    });

    const loggedEmployeeIds = new Set(existingLogs.map((log) => log.employeeId));

    const absentEmployees = activeEmployees.filter(
      (emp) =>
        !loggedEmployeeIds.has(emp.id) &&
        !isWeeklyOffDate(emp.weeklyOffWeekdays, dateOnly),
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
    const now = new Date();
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        dutyStartTime: true,
        dutyEndTime: true,
        shift: { select: { startTime: true } },
      },
    });

    const twentyFourHour = employee
      ? is24HourShift({
          dutyStartTime: employee.dutyStartTime,
          dutyEndTime: employee.dutyEndTime,
        })
      : false;
    const dateOnly = employee
      ? this.resolvePunchAttendanceDate(now, employee, twentyFourHour)
      : this.toDateOnly(now);

    let attendanceLog = await this.prisma.attendanceLog.findUnique({
      where: {
        employeeId_date_type: {
          employeeId,
          date: dateOnly,
          type: AttendanceLogType.REGULAR,
        },
      },
    });

    const todaySessionOpen =
      !!attendanceLog?.checkIn && !attendanceLog?.checkOut;
    if (
      !todaySessionOpen &&
      employee &&
      isOvernightShift(
        employee.dutyStartTime ?? null,
        employee.dutyEndTime ?? null,
      )
    ) {
      const priorOpen = await this.findOpenRegularLogForDate(
        employeeId,
        this.pakistanYesterday(dateOnly),
        true,
      );
      if (priorOpen) {
        attendanceLog = priorOpen;
      }
    }

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

    assertEmployeeEligibleForBiometricAttendance(
      employee.status,
      this.employeeAttendanceContext(employee),
    );

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
    const twentyFourHour = is24HourShift(employee);
    const dateOnly = this.resolvePunchAttendanceDate(
      checkTime,
      employee,
      twentyFourHour,
    );

    const existing = await this.prisma.attendanceLog.findUnique({
      where: {
        employeeId_date_type: {
          employeeId,
          date: dateOnly,
          type: AttendanceLogType.REGULAR,
        },
      },
    });

    const openSession = twentyFourHour
      ? existing?.checkIn
        ? existing
        : null
      : await this.findOpenRegularSessionBlockingCheckIn(employee, dateOnly);

    if (openSession?.checkIn) {
      const sameDay = openSession.date.getTime() === dateOnly.getTime();
      throw new BadRequestException(
        sameDay
          ? 'Already checked in today'
          : 'Previous shift session is still open. Check out before checking in again.',
      );
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
      if (status === AttendanceStatus.LATE && lateMinutes > 120) {
        status = AttendanceStatus.HALF_DAY;
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
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

      return tx.attendanceLog.upsert({
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
          dutyStartTimeSnapshot: employee.dutyStartTime ?? null,
          dutyEndTimeSnapshot: employee.dutyEndTime ?? null,
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

    await this.runConsequenceReconcile(
      employeeId,
      dateOnly,
      existing,
      updated,
      employee.dutyStartTime,
    );

    // Fires only after the transaction above has committed. See
    // PayrollService.recomputePendingPayrollForAttendanceDate.
    await this.payrollService.recomputePendingPayrollForAttendanceDate(
      employeeId,
      dateOnly,
    );

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

    assertEmployeeEligibleForBiometricAttendance(
      employee.status,
      this.employeeAttendanceContext(employee),
    );

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

    const existing = await this.findOpenRegularLog(employeeId, dateOnly);

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

      const updated = await tx.attendanceLog.update({
        where: { id: existing.id },
        data: { checkOut: checkTime, overtimeMinutes },
      });

      // Reverses a missing-checkout consequence if the scheduler already
      // flagged this session before this (late) checkout arrived.
      await reconcileAttendanceFinancialConsequences(tx, {
        employeeId,
        date: existing.date,
        before: existing,
        after: updated,
      });
    });

    // Fires only after the transaction above has committed. See
    // PayrollService.recomputePendingPayrollForAttendanceDate.
    await this.payrollService.recomputePendingPayrollForAttendanceDate(
      employeeId,
      existing.date,
    );

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
    return toPakistanDateOnly(date);
  }

  /**
   * Attendance business date for a punch. Overnight duties that start at/after
   * 18:00 still belong to the prior calendar day when the punch is after
   * midnight (e.g. 01:00 against 20:00–08:00 → yesterday). Day shifts and
   * 24-hour staff use the Pakistan calendar date of the punch.
   */
  private resolvePunchAttendanceDate(
    checkTime: Date,
    employee: {
      dutyStartTime?: string | null;
      shift?: { startTime: string } | null;
    },
    twentyFourHour: boolean,
  ): Date {
    if (twentyFourHour) {
      return toPakistanDateOnly(checkTime);
    }
    const dutyStart =
      employee.dutyStartTime?.trim() ||
      employee.shift?.startTime?.trim() ||
      null;
    if (!dutyStart) {
      return toPakistanDateOnly(checkTime);
    }
    return getShiftAttendanceDate(checkTime, dutyStart);
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
   * Same-day duplicate-CHECKIN detection deliberately keeps excludeClosed
   * false: a same-day row must still be found and rejected as a duplicate
   * regardless of closure, since a second check-in would otherwise silently
   * overwrite an already-disciplined row via the upsert.
   */
  private findOpenRegularLogForDate(
    employeeId: string,
    dateOnly: Date,
    excludeClosed = false,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return db.attendanceLog.findFirst({
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
   * Duplicate-CHECKIN detection uses findOpenRegularSessionBlockingCheckIn.
   *
   * Includes internally-closed missing-checkout sessions so a later biometric
   * checkout can still complete the day and reverse that discipline.
   */
  private async findOpenRegularLog(employeeId: string, dateOnly: Date) {
    const todayOpen = await this.findOpenRegularLogForDate(
      employeeId,
      dateOnly,
      false,
    );
    if (todayOpen) return todayOpen;
    return this.findOpenRegularLogForDate(
      employeeId,
      this.pakistanYesterday(dateOnly),
      false,
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
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const todayOpen = await this.findOpenRegularLogForDate(
      employee.id,
      dateOnly,
      true,
      db,
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
      db,
    );
  }

  /**
   * Blocks a new CHECKIN when any still-open REGULAR session exists for today,
   * or — for overnight duty — when yesterday's session is still open
   * (checkIn set, checkOut null, not internally closed by missing-checkout).
   */
  private async findOpenRegularSessionBlockingCheckIn(
    employee: {
      id: string;
      dutyStartTime?: string | null;
      dutyEndTime?: string | null;
    },
    dateOnly: Date,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const todayOpen = await this.findOpenRegularLogForDate(
      employee.id,
      dateOnly,
      false,
      db,
    );
    if (todayOpen?.checkIn) {
      return todayOpen;
    }

    const overnight = isOvernightShift(
      employee.dutyStartTime ?? null,
      employee.dutyEndTime ?? null,
    );
    if (!overnight) {
      return null;
    }

    return this.findOpenRegularLogForDate(
      employee.id,
      this.pakistanYesterday(dateOnly),
      true,
      db,
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

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: {
        status: true,
        currentBranchId: true,
        dutyStartTime: true,
        dutyEndTime: true,
        shift: { select: { startTime: true, endTime: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee with id ${dto.employeeId} not found`,
      );
    }

    assertEmployeeEligibleForAttendanceRecord(
      employee.status,
      this.employeeAttendanceContext(employee),
    );

    if (!employee.currentBranchId && !existing) {
      throw new BadRequestException(
        'Employee has no branch assignment for attendance import',
      );
    }

    const checkIn = dto.checkIn
      ? parseAttendanceDateTime(dto.checkIn)
      : existing?.checkIn ?? null;
    const checkOut = dto.checkOut
      ? parseAttendanceDateTime(dto.checkOut)
      : existing?.checkOut ?? null;
    const lateMinutes =
      checkIn && !is24HourShift(employee)
        ? computeBiometricLateMinutes(checkIn, employee)
        : existing?.lateMinutes ?? 0;

    const log = await this.prisma.$transaction(async (tx) => {
      const attendanceLog = existing
        ? await tx.attendanceLog.update({
            where: { id: existing.id },
            data: {
              checkIn,
              checkOut,
              status: dto.status,
              lateMinutes,
              note: dto.note,
              source: AttendanceSource.MANUAL,
            },
          })
        : await tx.attendanceLog.create({
            data: {
              employeeId: dto.employeeId,
              branchId: employee.currentBranchId!,
              date: dateOnly,
              type,
              checkIn,
              checkOut,
              status: dto.status,
              lateMinutes,
              source: AttendanceSource.MANUAL,
              note: dto.note,
              dutyStartTimeSnapshot: employee.dutyStartTime ?? null,
              dutyEndTimeSnapshot: employee.dutyEndTime ?? null,
            },
          });

      if (type === AttendanceLogType.REGULAR) {
        await reconcileAttendanceFinancialConsequences(tx, {
          employeeId: dto.employeeId,
          date: dateOnly,
          before: existing,
          after: attendanceLog,
          dutyStartTimeSnapshot: employee.dutyStartTime ?? null,
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'ATTENDANCE_IMPORTED',
          entity: 'AttendanceLog',
          entityId: attendanceLog.id,
        },
      });

      return attendanceLog;
    });

    if (type === AttendanceLogType.REGULAR) {
      await this.payrollService.recomputePendingPayrollForAttendanceDate(
        dto.employeeId,
        dateOnly,
      );
    }

    return log;
  }

  async getSuspensionWatchlist(year?: number, month?: number) {
    const now = pakistanYearMonthFromDate(new Date());
    const y =
      year != null && Number.isFinite(year) && year > 0 ? year : now.year;
    const m =
      month != null && Number.isFinite(month) && month >= 1 && month <= 12
        ? month
        : now.month;
    const list = await buildSuspensionWatchlist(this.prisma, y, m);
    return this.excludeActiveSuspensionCases(list);
  }

  /**
   * Raw Due-for-Suspension list (not filtered by open suspension cases).
   * Eligibility notices must use this path: recommendHrSuspensionDraft may
   * already have opened a case, which would hide the employee from the
   * HR watchlist API.
   */
  async issueDueSuspensionEligibilityNotices(year?: number, month?: number) {
    const now = pakistanYearMonthFromDate(new Date());
    const y =
      year != null && Number.isFinite(year) && year > 0 ? year : now.year;
    const m =
      month != null && Number.isFinite(month) && month >= 1 && month <= 12
        ? month
        : now.month;
    const list = await buildSuspensionWatchlist(this.prisma, y, m);
    return issueDueSuspensionEligibilityNotices({
      prisma: this.prisma,
      lettersService: this.lettersService,
      due: list.due,
      year: y,
      month: m,
    });
  }

  async issueNearSuspensionWarnings(year?: number, month?: number) {
    const now = pakistanYearMonthFromDate(new Date());
    const y =
      year != null && Number.isFinite(year) && year > 0 ? year : now.year;
    const m =
      month != null && Number.isFinite(month) && month >= 1 && month <= 12
        ? month
        : now.month;
    const list = await buildSuspensionWatchlist(this.prisma, y, m);
    return issueNearSuspensionWarnings({
      prisma: this.prisma,
      lettersService: this.lettersService,
      near: list.near,
      year: y,
      month: m,
    });
  }

  /**
   * Near-suspension reminder: ADVICE letter + WhatsApp (send path).
   */
  async sendNearSuspensionReminder(
    employeeId: string,
    actingUserId: string,
    actingRole: UserRole,
    year?: number,
    month?: number,
  ) {
    const list = await this.getSuspensionWatchlist(year, month);
    const entry = list.near.find((e) => e.employeeId === employeeId);
    if (!entry) {
      throw new BadRequestException(
        'Employee is not on the near-suspension watchlist for this month',
      );
    }

    await this.accessScopeService.assertEmployeeAccess(
      actingUserId,
      actingRole,
      Permission.LETTERS_GENERATE,
      employeeId,
    );

    const violations = [
      `You are near suspension for ${list.month}.`,
      `Late days this month: ${entry.lateDays}.`,
      `Uninformed absent days this month: ${entry.uninformedAbsentDays}.`,
      'If you continue violating attendance rules, you will be suspended.',
    ].join('\n');

    const { letter } = await this.lettersService.generate(
      {
        employeeId,
        letterType: LetterType.ADVICE,
        extraFields: { violations },
      },
      actingUserId,
      actingRole,
    );

    const sent = await this.lettersService.sendLetter(
      letter.id,
      actingUserId,
      actingRole,
    );

    return {
      letterId: sent.letter.id,
      letterNo: sent.letter.letterNo,
      status: sent.letter.status,
      alreadySent: sent.alreadySent ?? false,
    };
  }

  /**
   * Due-for-suspension: submit an inquiry for opening approval.
   * Employee stays ACTIVE until the selected authority approves.
   */
  async startSuspensionCaseFromWatchlist(
    employeeId: string,
    actingUserId: string,
    actingRole: UserRole,
    year?: number,
    month?: number,
    input?: {
      durationDays: number;
      inquiryOfficerUserId?: string;
      inquiryOfficerName: string;
      inquiryOfficerDesignation?: string;
      inquiryOfficerPhone: string;
      selectedApproverUserId: string;
      approverWhatsApp: string;
    },
    actingRoles?: UserRole[],
  ) {
    if (
      !input?.durationDays ||
      !input.selectedApproverUserId ||
      !input.inquiryOfficerName?.trim() ||
      !input.inquiryOfficerPhone?.trim() ||
      !input.approverWhatsApp?.trim()
    ) {
      throw new BadRequestException(
        'Select inquiry days, inquiry officer (name and WhatsApp), approving authority, and that person’s WhatsApp number.',
      );
    }

    const list = await this.getSuspensionWatchlist(year, month);
    const entry = list.due.find((e) => e.employeeId === employeeId);
    if (!entry) {
      throw new BadRequestException(
        'Employee is not on the due-for-suspension watchlist for this month (or already has an open suspension case)',
      );
    }

    const reason = [
      `Due for suspension (${list.month}).`,
      `Late days: ${entry.lateDays}.`,
      `Uninformed absent days: ${entry.uninformedAbsentDays}.`,
      `Watchlist reasons: ${entry.reasons.join(', ')}.`,
    ].join(' ');

    return this.inquiryOpeningService.submitPendingOpen(
      {
        employeeId,
        reason,
        durationDays: input.durationDays,
        inquiryOfficerUserId: input.inquiryOfficerUserId,
        inquiryOfficerName: input.inquiryOfficerName,
        inquiryOfficerDesignation: input.inquiryOfficerDesignation,
        inquiryOfficerPhone: input.inquiryOfficerPhone,
        selectedApproverUserId: input.selectedApproverUserId,
        approverWhatsApp: input.approverWhatsApp,
      },
      actingUserId,
      actingRole,
      actingRoles,
    );
  }

  async getDueInquiryPreview(
    employeeId: string,
    year?: number,
    month?: number,
  ) {
    const list = await this.getSuspensionWatchlist(year, month);
    const entry = list.due.find((e) => e.employeeId === employeeId);
    if (!entry) {
      throw new BadRequestException(
        'Employee is not on the due-for-suspension watchlist for this month (or already has an open suspension case)',
      );
    }
    const reason = [
      `Due for suspension (${list.month}).`,
      `Late days: ${entry.lateDays}.`,
      `Uninformed absent days: ${entry.uninformedAbsentDays}.`,
      `Watchlist reasons: ${entry.reasons.join(', ')}.`,
    ].join(' ');
    return {
      employeeId: entry.employeeId,
      fullName: entry.fullName,
      employeeCode: entry.employeeCode,
      month: list.month,
      lateDays: entry.lateDays,
      uninformedAbsentDays: entry.uninformedAbsentDays,
      reasons: entry.reasons,
      reason,
    };
  }

  private async excludeActiveSuspensionCases<
    T extends {
      near: Array<{ employeeId: string }>;
      due: Array<{ employeeId: string }>;
      counts: { near: number; due: number };
    },
  >(list: T): Promise<T> {
    const ids = [
      ...new Set([
        ...list.near.map((e) => e.employeeId),
        ...list.due.map((e) => e.employeeId),
      ]),
    ];
    if (ids.length === 0) return list;

    const active = await this.prisma.disciplinaryAction.findMany({
      where: {
        employeeId: { in: ids },
        type: DisciplinaryType.SUSPENSION,
        status: {
          in: [DisciplinaryStatus.OPEN, DisciplinaryStatus.UNDER_INQUIRY],
        },
      },
      select: { employeeId: true },
    });
    const blocked = new Set(active.map((row) => row.employeeId));
    if (blocked.size === 0) return list;

    const near = list.near.filter((e) => !blocked.has(e.employeeId));
    const due = list.due.filter((e) => !blocked.has(e.employeeId));
    return {
      ...list,
      near,
      due,
      counts: { near: near.length, due: due.length },
    };
  }
}
