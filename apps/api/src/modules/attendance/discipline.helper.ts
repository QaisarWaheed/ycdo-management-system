import {
  AttendanceLogType,
  AttendanceStatus,
  DeductionType,
  DisciplinaryStatus,
  DisciplinaryType,
  DisciplineCategory,
  EmployeeStatus,
  LeaveStatus,
  LetterStatus,
  LetterType,
  PayrollStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import {
  dailyStipendRate,
} from '../../common/stipend.util';
import { issueAutoTemplatedLetter } from '../letters/auto-letter.helper';
import { is24HourShift } from './attendance-biometric.util';
import {
  pakistanMonthDateRange,
  pakistanMonthWindowFromDate,
  pakistanYearMonthFromDate,
} from './attendance-calendar.util';
import {
  parseTimeToMinutes,
  toPakistanMinutesOfDay,
} from './attendance-late.util';
import { isTemporaryAutoCheckoutEnabled } from './temporary-auto-checkout';

/**
 * When false: attendance still claims DisciplineEvents and may apply payroll
 * fines, but does not auto-create Advice/Warning/Fine/Explanation drafts.
 * When true (production default): auto-create those letters as DRAFT for HR
 * to proofread and Send (portal + WhatsApp). Late/uninformed thresholds
 * never auto-suspend, never deactivate portal users, and never create a
 * SENT suspension letter — they only open an HR recommendation (OPEN case +
 * DRAFT suspension letter). Mutable so unit tests can disable the path.
 */
export const AUTO_DISCIPLINE = {
  lettersAndSuspendEnabled: true,
};

export type DisciplineOptions = {
  lateMinutes?: number;
  /**
   * The attendance record's own dutyStartTimeSnapshot, when the caller has
   * one — used only to label a generated letter's wording with the duty
   * time that actually applied on that date, instead of the employee's
   * current duty. Purely cosmetic (letter text), never affects the
   * late-occurrence count, fine amount, or discipline cycle itself.
   * Callers dealing with a brand-new row (biometric/portal check-in) have
   * no meaningful distinction to make here — current duty IS that row's
   * duty — so this is only worth passing from callers re-evaluating an
   * EXISTING historical row (markManual, updateAttendance).
   */
  dutyStartTimeSnapshot?: string | null;
  /**
   * Payroll backfill / repair only: claim the LATE DisciplineEvent and
   * apply cash fines, but do NOT issue Advice/Warning/Fine/Suspension
   * letters (or auto-suspend). Live biometric/HR marking must leave this
   * false so letters still fire when lateness happens in real time.
   */
  skipLetters?: boolean;
};

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}

/**
 * Atomic idempotency gate for discipline processing (LATE, UNINFORMED_ABSENT,
 * MISSING_CHECKOUT). One genuine incident — employeeId + category +
 * incidentDate — may be claimed at most once, enforced by DisciplineEvent's
 * unique constraint rather than an application-level check-then-insert
 * (which cannot be made race-safe: two concurrent transactions can both
 * pass a SELECT-based check before either commits). occurrence is stored
 * for audit/debugging only and is NOT part of the unique key — see the
 * schema comment on DisciplineEvent for why.
 *
 * Mirrors the already-proven ProcessedDeviceEvent pattern used by
 * rawScan() for biometric replay protection: the INSERT itself, not a
 * prior read, is what Postgres actually serializes under concurrency.
 *
 * Returns true if this call just claimed the incident (caller should
 * proceed with letter/deduction side-effects), false if it was already
 * claimed — by this or a concurrent invocation — in which case the caller
 * must treat it as a no-op and apply NO further side-effects.
 */
async function claimDisciplineEvent(
  tx: Prisma.TransactionClient,
  employeeId: string,
  category: DisciplineCategory,
  incidentDate: Date,
  occurrence: number,
): Promise<boolean> {
  try {
    await tx.disciplineEvent.create({
      data: { employeeId, category, incidentDate, occurrence },
    });
    return true;
  } catch (err: unknown) {
    if (isUniqueConstraintViolation(err)) {
      return false;
    }
    throw err;
  }
}

export async function applyDisciplineRules(
  tx: Prisma.TransactionClient,
  employeeId: string,
  status: AttendanceStatus,
  date: Date,
  options: DisciplineOptions = {},
): Promise<AttendanceStatus> {
  const lateMinutes = options.lateMinutes ?? 0;
  const dutyStartTimeSnapshot = options.dutyStartTimeSnapshot ?? null;
  const skipLetters = options.skipLetters === true;

  // Late > 1 hour is recorded as HALF_DAY for attendance display only.
  // Pay is reduced naturally by unpaid hours; cash penalties apply only at
  // the monthly-cycle 3rd/6th occurrence (Fine) or 9th (Suspension) via
  // applyLateDiscipline.
  if (status === AttendanceStatus.LATE && lateMinutes > 60) {
    await applyLateDiscipline(
      tx,
      employeeId,
      date,
      lateMinutes,
      dutyStartTimeSnapshot,
      skipLetters,
    );
    return AttendanceStatus.HALF_DAY;
  }

  // Manual/HR attendance entry can compute HALF_DAY directly from lateMinutes
  // (statusFromLateMinutes) without ever passing through LATE first — route
  // it through the exact same monthly late-occurrence counting as the
  // biometric path, so the same lateness is disciplined identically
  // regardless of which of the three live entry paths recorded it. Short
  // Leave now writes its own distinct AttendanceStatus.SHORT_LEAVE (see
  // short-leave.util.ts) rather than HALF_DAY, so it structurally never
  // reaches this function at all — no extra guard needed to keep the two
  // cases apart.
  if (status === AttendanceStatus.HALF_DAY && lateMinutes > 0) {
    await applyLateDiscipline(
      tx,
      employeeId,
      date,
      lateMinutes,
      dutyStartTimeSnapshot,
      skipLetters,
    );
    return status;
  }

  if (status === AttendanceStatus.ABSENT) {
    await applyAbsentDeduction(tx, employeeId, date, skipLetters);
    return status;
  }

  if (status === AttendanceStatus.LATE) {
    await applyLateDiscipline(
      tx,
      employeeId,
      date,
      lateMinutes,
      dutyStartTimeSnapshot,
      skipLetters,
    );
    return status;
  }

  if (status === AttendanceStatus.UNINFORMED_ABSENT) {
    await applyUninformedAbsentDeduction(tx, employeeId, date, skipLetters);
    return status;
  }

  return status;
}

/**
 * Resolves the StipendRecord that was actually EFFECTIVE ON a given
 * incident date — never "the currently active record" merely because it
 * happens to be active right now. Uses the same half-open
 * [effectiveFrom, effectiveTo) interval established in payroll.service.ts
 * (Step 2/3): effectiveFrom inclusive, effectiveTo exclusive. A dated
 * incident (LATE, ABSENT, UNINFORMED_ABSENT, missing-checkout, extra-leave
 * rejection) must always be priced and attributed against whichever
 * segment was in force on that exact date, so a later salary revision can
 * never retroactively change the rate or the target PayrollEntry of an
 * already-dated incident.
 */
async function getStipendRecordEffectiveOn(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
) {
  return tx.stipendRecord.findFirst({
    where: {
      employeeId,
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
}

/** basicStipend as of the StipendRecord effective ON `date` — see
 * getStipendRecordEffectiveOn. Every deduction-rate calculation in this
 * file (dailyStipendRate(basicStipend, date)) must use the rate that
 * actually applied on the incident date, not today's rate. */
async function getBasicStipend(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<number> {
  const stipendRecord = await getStipendRecordEffectiveOn(tx, employeeId, date);
  return Number(stipendRecord?.basicStipend ?? 0);
}

/** PROCESSED and PAID payroll entries must not be financially mutated. */
function isPayrollFinanciallyFrozen(status: PayrollStatus): boolean {
  return (
    status === PayrollStatus.PROCESSED || status === PayrollStatus.PAID
  );
}

async function applyLateArrivalFineDeduction(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
  lateCount: number,
): Promise<void> {
  const basicStipend = await getBasicStipend(tx, employeeId, date);
  if (basicStipend <= 0) return;

  const payrollEntry = await getOrCreatePayrollEntry(tx, employeeId, date);
  if (!payrollEntry || isPayrollFinanciallyFrozen(payrollEntry.status)) return;

  const deductionAmount = dailyStipendRate(basicStipend, date);
  const deductionDescription = `Late arrival deduction — monthly occurrence ${lateCount}`;

  const alreadyDeducted = await tx.payrollDeduction.findFirst({
    where: {
      payrollEntryId: payrollEntry.id,
      reason: DeductionType.LATE_ARRIVAL,
      description: deductionDescription,
    },
  });
  if (alreadyDeducted) return;

  await tx.payrollDeduction.create({
    data: {
      payrollEntryId: payrollEntry.id,
      reason: DeductionType.LATE_ARRIVAL,
      amount: deductionAmount,
      description: deductionDescription,
    },
  });

  await tx.payrollEntry.update({
    where: { id: payrollEntry.id },
    data: {
      totalDeductions: { increment: deductionAmount },
      netStipend: { decrement: deductionAmount },
    },
  });
}

async function applyMissingCheckoutFineDeduction(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
  missingCount: number,
): Promise<void> {
  const basicStipend = await getBasicStipend(tx, employeeId, date);
  if (basicStipend <= 0) return;

  const payrollEntry = await getOrCreatePayrollEntry(tx, employeeId, date);
  if (!payrollEntry || isPayrollFinanciallyFrozen(payrollEntry.status)) return;

  const deductionAmount = dailyStipendRate(basicStipend, date);
  const deductionDescription = `Missing checkout deduction — monthly occurrence ${missingCount}`;

  const alreadyDeducted = await tx.payrollDeduction.findFirst({
    where: {
      payrollEntryId: payrollEntry.id,
      reason: DeductionType.DISCIPLINARY_FINE,
      description: deductionDescription,
    },
  });
  if (alreadyDeducted) return;

  await tx.payrollDeduction.create({
    data: {
      payrollEntryId: payrollEntry.id,
      reason: DeductionType.DISCIPLINARY_FINE,
      amount: deductionAmount,
      description: deductionDescription,
    },
  });

  await tx.payrollEntry.update({
    where: { id: payrollEntry.id },
    data: {
      totalDeductions: { increment: deductionAmount },
      netStipend: { decrement: deductionAmount },
    },
  });
}

function parseLetterIncidentDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Apply the payroll deduction that belongs to an auto-generated discipline
 * letter. Called from Send — draft create must not touch stipend.
 */
export async function applyDisciplineDeductionOnLetterSend(
  tx: Prisma.TransactionClient,
  letter: {
    employeeId: string;
    letterType: LetterType;
    variables: Prisma.JsonValue | null;
    content?: Prisma.JsonValue | null;
  },
): Promise<void> {
  const vars = {
    ...((letter.content as Record<string, unknown> | null) ?? {}),
    ...((letter.variables as Record<string, unknown> | null) ?? {}),
  };
  const category = String(vars.disciplineCategory ?? '');
  const date = parseLetterIncidentDate(vars.incidentDate);
  if (!date) return;

  if (letter.letterType === LetterType.FINE && category === 'LATE') {
    const occurrence = Number(vars.monthlyLateOccurrence);
    if (occurrence > 0) {
      await applyLateArrivalFineDeduction(tx, letter.employeeId, date, occurrence);
    }
    return;
  }

  if (letter.letterType === LetterType.FINE && category === 'MISSING_CHECKOUT') {
    const occurrence = Number(vars.monthlyMissingCheckoutOccurrence);
    if (occurrence > 0) {
      await applyMissingCheckoutFineDeduction(
        tx,
        letter.employeeId,
        date,
        occurrence,
      );
    }
    return;
  }

  if (letter.letterType !== LetterType.EXPLANATION) return;

  if (category === 'ABSENT') {
    await applyAbsentDeduction(tx, letter.employeeId, date, true);
    return;
  }

  if (category === 'UNINFORMED_ABSENT') {
    await applyUninformedAbsenceFinancial(tx, letter.employeeId, date);
  }
}

function incidentDateLabel(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function halfDayDeductionDescription(date: Date): string {
  return `Half day deduction (0.5 day stipend) — ${incidentDateLabel(date)}`;
}

export function isHalfDayPayDeductionEligible(row: {
  status: AttendanceStatus;
  note?: string | null;
}): boolean {
  if (row.status !== AttendanceStatus.HALF_DAY) return false;
  return !(row.note ?? '').toLowerCase().includes('short leave');
}

export type AbsentApplicationResult = {
  deductionApplied: boolean;
  /** True when a deduction would otherwise have been created but the
   * target PayrollEntry is PROCESSED or PAID — financial mutation was skipped
   * entirely. ABSENT has no non-financial discipline tracking to preserve
   * (no DisciplineEvent category), so this is the only side effect of this
   * function, unlike applyUninformedAbsentDeduction. */
  blockedByPayrollStatus: boolean;
  deductionAmount: number | null;
  payrollStatus: string | null;
};

/**
 * Financial deduction for a plain ABSENT day, gated on PayrollEntry.status
 * the same way every reversal function in this file already is — mirrors
 * the existing pattern in applyExtraLeaveRejectedDeduction, which this
 * function previously did not follow. On PROCESSED or PAID: no
 * PayrollDeduction is created, totalDeductions/netStipend are never
 * touched, blockedByPayrollStatus is reported.
 */
async function applyAbsentDeduction(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
  skipLetters = false,
): Promise<AbsentApplicationResult> {
  const noOp: AbsentApplicationResult = {
    deductionApplied: false,
    blockedByPayrollStatus: false,
    deductionAmount: null,
    payrollStatus: null,
  };

  const approvedLeave = await tx.leaveRecord.findFirst({
    where: {
      employeeId,
      status: LeaveStatus.APPROVED,
      startDate: { lte: date },
      endDate: { gte: date },
    },
  });

  if (approvedLeave) return noOp;

  if (AUTO_DISCIPLINE.lettersAndSuspendEnabled && !skipLetters) {
    await issueAbsenceLetterIfNotAlready(
      tx,
      employeeId,
      date,
      'ABSENT',
      `تاریخ ${date.toISOString().slice(0, 10)} کو بغیر منظور شدہ چھٹی غیر حاضری۔`,
    );
    // Payroll waits until HR sends the draft explanation letter.
    return noOp;
  }

  const basicStipend = await getBasicStipend(tx, employeeId, date);
  if (basicStipend <= 0) return noOp;

  const payrollEntry = await getOrCreatePayrollEntry(tx, employeeId, date);
  if (!payrollEntry) return noOp;

  if (isPayrollFinanciallyFrozen(payrollEntry.status)) {
    return {
      ...noOp,
      blockedByPayrollStatus: true,
      payrollStatus: payrollEntry.status,
    };
  }

  const deductionAmount = dailyStipendRate(basicStipend, date) * 2;

  // Date suffix lets a later leave approval / centralized reconciliation
  // find and reverse this exact deduction (see reverseAbsenceDeductionForDate)
  // without risking matching a different day's identically-worded row. Also
  // doubles as the idempotency guard below — ABSENT has no DisciplineEvent
  // category (unlike UNINFORMED_ABSENT's claimDisciplineEvent gate), so this
  // exact-match check is this function's only protection against a
  // redundant re-mark of the same day creating a second deduction.
  const description = `Absent without approved leave (2 days stipend) — ${date.toISOString().slice(0, 10)}`;

  const alreadyDeducted = await tx.payrollDeduction.findFirst({
    where: {
      payrollEntryId: payrollEntry.id,
      reason: DeductionType.UNINFORMED_ABSENCE,
      description,
    },
  });
  if (alreadyDeducted) {
    return { ...noOp, payrollStatus: payrollEntry.status };
  }

  await tx.payrollDeduction.create({
    data: {
      payrollEntryId: payrollEntry.id,
      reason: DeductionType.UNINFORMED_ABSENCE,
      amount: deductionAmount,
      description,
    },
  });

  await tx.payrollEntry.update({
    where: { id: payrollEntry.id },
    data: {
      totalDeductions: { increment: deductionAmount },
      netStipend: { decrement: deductionAmount },
    },
  });

  await tx.notification.create({
    data: {
      employeeId,
      message:
        'You have been marked absent. 2 days stipend has been deducted from your monthly stipend.',
      type: 'ABSENT_DEDUCTION',
    },
  });

  return {
    deductionApplied: true,
    blockedByPayrollStatus: false,
    deductionAmount,
    payrollStatus: payrollEntry.status,
  };
}

async function applyHalfDayDeduction(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<AbsentApplicationResult> {
  const noOp: AbsentApplicationResult = {
    deductionApplied: false,
    blockedByPayrollStatus: false,
    deductionAmount: null,
    payrollStatus: null,
  };

  const basicStipend = await getBasicStipend(tx, employeeId, date);
  if (basicStipend <= 0) return noOp;

  const payrollEntry = await getOrCreatePayrollEntry(tx, employeeId, date);
  if (!payrollEntry) return noOp;

  if (isPayrollFinanciallyFrozen(payrollEntry.status)) {
    return {
      ...noOp,
      blockedByPayrollStatus: true,
      payrollStatus: payrollEntry.status,
    };
  }

  const deductionAmount = dailyStipendRate(basicStipend, date) * 0.5;
  const description = halfDayDeductionDescription(date);

  const alreadyDeducted = await tx.payrollDeduction.findFirst({
    where: {
      payrollEntryId: payrollEntry.id,
      reason: DeductionType.HALF_DAY,
      description,
    },
  });
  if (alreadyDeducted) {
    return { ...noOp, payrollStatus: payrollEntry.status };
  }

  await tx.payrollDeduction.create({
    data: {
      payrollEntryId: payrollEntry.id,
      reason: DeductionType.HALF_DAY,
      amount: deductionAmount,
      description,
    },
  });

  await tx.payrollEntry.update({
    where: { id: payrollEntry.id },
    data: {
      totalDeductions: { increment: deductionAmount },
      netStipend: { decrement: deductionAmount },
    },
  });

  return {
    deductionApplied: true,
    blockedByPayrollStatus: false,
    deductionAmount,
    payrollStatus: payrollEntry.status,
  };
}

async function reverseHalfDayDeductionForDate(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<AbsenceDeductionReversalResult> {
  const dateLabel = incidentDateLabel(date);
  const { month, year } = pakistanYearMonthFromDate(date);
  const empty: AbsenceDeductionReversalResult = {
    reversed: false,
    deductionId: null,
    deductionReversed: false,
    deductionAmount: null,
    blockedByPayrollStatus: false,
    payrollStatus: null,
    disciplineEventRemoved: false,
  };

  const stipendRecord = await getStipendRecordEffectiveOn(tx, employeeId, date);
  if (!stipendRecord) return empty;

  const payrollEntry = await tx.payrollEntry.findUnique({
    where: {
      stipendRecordId_month_year: {
        stipendRecordId: stipendRecord.id,
        month,
        year,
      },
    },
  });
  if (!payrollEntry) return empty;

  const deduction = await tx.payrollDeduction.findFirst({
    where: {
      payrollEntryId: payrollEntry.id,
      reason: DeductionType.HALF_DAY,
      description: halfDayDeductionDescription(date),
    },
  });
  if (!deduction) {
    return { ...empty, payrollStatus: payrollEntry.status };
  }

  if (isPayrollFinanciallyFrozen(payrollEntry.status)) {
    return {
      reversed: true,
      deductionId: deduction.id,
      deductionReversed: false,
      deductionAmount: Number(deduction.amount),
      blockedByPayrollStatus: true,
      payrollStatus: payrollEntry.status,
      disciplineEventRemoved: false,
    };
  }

  await tx.payrollDeduction.delete({ where: { id: deduction.id } });
  await tx.payrollEntry.update({
    where: { id: payrollEntry.id },
    data: {
      totalDeductions: { decrement: deduction.amount },
      netStipend: { increment: deduction.amount },
    },
  });

  return {
    reversed: true,
    deductionId: deduction.id,
    deductionReversed: true,
    deductionAmount: Number(deduction.amount),
    blockedByPayrollStatus: false,
    payrollStatus: payrollEntry.status,
    disciplineEventRemoved: false,
  };
}

/** "HH:mm", wrapping across midnight. */
function formatMinutesAsHHmm(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The actual check-in clock time for the letter, derived arithmetically
 * (dutyStart + 15-min grace + lateMinutes) rather than read back from the
 * AttendanceLog row. applyLateDiscipline runs BEFORE the caller's own
 * checkIn/status write lands (markManual/biometricRegularCheckIn both call
 * discipline first, then upsert the row) — a DB read here would see the
 * row's OLD value (often null), not today's actual punch. The three
 * inputs used here (lateMinutes=0 excluded by the callers already — see
 * applyDisciplineRules) fully determine the same value the engine used to
 * classify this arrival as late in the first place.
 */
function deriveCheckInLabel(
  dutyStartTime: string | null,
  lateMinutes: number,
): string {
  if (!dutyStartTime) return 'نامعلوم';
  return formatMinutesAsHHmm(
    parseTimeToMinutes(dutyStartTime) + 15 + lateMinutes,
  );
}

/**
 * Monthly late-occurrence cycle: 1/4/7 -> Advice, 2/5/8 -> Warning,
 * 3/6 -> Fine + 1-day deduction, 9 -> Suspension (no additional deduction).
 * Attendance status itself is never changed here — only letters/deductions/
 * suspension are applied on top of whatever status the caller already
 * determined (LATE, or a lateness-driven HALF_DAY).
 */
async function applyLateDiscipline(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
  todayLateMinutes: number,
  dutyStartTimeSnapshot: string | null = null,
  skipLetters = false,
): Promise<void> {
  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    include: { shift: true },
  });
  if (employee && is24HourShift(employee)) {
    return;
  }
  // Fine amount must use the rate that was EFFECTIVE ON `date`, not
  // today's rate — see getStipendRecordEffectiveOn.
  const stipendRecordForDate = await getStipendRecordEffectiveOn(
    tx,
    employeeId,
    date,
  );
  const basicStipend = Number(stipendRecordForDate?.basicStipend ?? 0);
  // The date's own duty snapshot wins for the letter's wording when the
  // caller has one (a historical row being re-evaluated) — current employee
  // duty is only a fallback for callers with no snapshot (brand-new rows,
  // where current duty IS correct, or legacy rows with none stored). This
  // only affects letter text, never the occurrence count or fine amount.
  const dutyStartTime =
    dutyStartTimeSnapshot ?? employee?.dutyStartTime ?? null;

  const { startOfMonth } = pakistanMonthWindowFromDate(date);
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);

  // Count LATE and late-driven HALF_DAY days up to THIS incident date
  // only — later days in the same month must not inflate today's
  // occurrence (e.g. legacy backfill or bulk import that wrote the
  // whole month before discipline ran).
  const priorLateDays = await tx.attendanceLog.findMany({
    where: {
      employeeId,
      date: { gte: startOfMonth, lte: dayStart },
      OR: [
        { status: AttendanceStatus.LATE },
        {
          status: AttendanceStatus.HALF_DAY,
          NOT: {
            note: { contains: 'short leave', mode: 'insensitive' },
          },
          lateMinutes: { gt: 0 },
        },
      ],
    },
    select: { date: true },
  });

  const uniqueDays = new Set(
    priorLateDays.map((row) => row.date.toISOString().slice(0, 10)),
  );
  uniqueDays.add(dayStart.toISOString().slice(0, 10));
  const lateCount = uniqueDays.size; // resets naturally every month — derived fresh from AttendanceLog, no in-memory/stored counter.

  // Atomic idempotency gate — must be claimed before ANY letter/deduction
  // side-effect below. Retries, biometric replay, concurrent HR edits, and
  // cron overlap all collapse to the same claim attempt for this exact
  // employee+date instead of racing on separate SELECT-based checks.
  const claimed = await claimDisciplineEvent(
    tx,
    employeeId,
    DisciplineCategory.LATE,
    dayStart,
    lateCount,
  );
  if (!claimed) return; // already processed — true no-op, no duplicate letter/deduction

  const dateLabel = dayStart.toISOString().slice(0, 10);
  const checkInLabel = deriveCheckInLabel(dutyStartTime, todayLateMinutes);
  const dutyStartLabel = dutyStartTime ?? 'نامعلوم';
  const baseDetail = `تاریخ: ${dateLabel}، ڈیوٹی کا مقررہ وقت: ${dutyStartLabel}، حاضری کا اصل وقت: ${checkInLabel}، تاخیر: ${todayLateMinutes} منٹ۔`;

  const positionInCycle = ((lateCount - 1) % 3) + 1; // 1, 2, or 3
  const shouldIssueLetters =
    AUTO_DISCIPLINE.lettersAndSuspendEnabled && !skipLetters;

  if (positionInCycle === 1) {
    // 1st / 4th / 7th this month -> Advice, no deduction.
    if (shouldIssueLetters) {
      await issueLateLetterIfNotAlready(
        tx,
        employeeId,
        LetterType.ADVICE,
        lateCount,
        date,
        {
          violations: `اس ماہ ${lateCount} مرتبہ لیٹ آمد۔ ${baseDetail} آئندہ وقت کی پابندی کی ہدایت کی جاتی ہے۔`,
          incidentDate: dateLabel,
        },
      );
    }
    return;
  }

  if (positionInCycle === 2) {
    // 2nd / 5th / 8th this month -> Warning, no deduction.
    if (shouldIssueLetters) {
      await issueLateLetterIfNotAlready(
        tx,
        employeeId,
        LetterType.WARNING,
        lateCount,
        date,
        {
          violations: `اس ماہ ${lateCount} مرتبہ لیٹ آمد (اس ماہ کی دوسری تنبیہ)۔ ${baseDetail}`,
          incidentDate: dateLabel,
        },
      );
    }
    return;
  }

  // positionInCycle === 3 -> 3rd / 6th / 9th this month.
  if (lateCount === 9) {
    // Suspension only — no additional one-day deduction at the 9th.
    // When AUTO_DISCIPLINE.lettersAndSuspendEnabled is false, claim the event only
    // (HR suspends manually via the watchlist). Payroll repair
    // (skipLetters) likewise claims without suspending.
    if (skipLetters || !AUTO_DISCIPLINE.lettersAndSuspendEnabled) return;

    await issueLateLetterIfNotAlready(
      tx,
      employeeId,
      LetterType.SUSPENSION,
      lateCount,
      date,
      {
        suspensionReason: `اس ماہ ${lateCount} مرتبہ لیٹ آمد کی بنا پر معطلی کی سفارش۔ ${baseDetail}`,
        suspensionStartDate: dateLabel,
        suspensionDuration: 'Pending HR review',
        incidentDate: dateLabel,
      },
    );
    return;
  }

  // 3rd or 6th this month -> Fine letter. Cash deduction waits until HR
  // Send, unless this is a letter-less repair path (skipLetters / flag off).
  const deductionAmount = dailyStipendRate(basicStipend, date);
  const monthLabel = date.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  if (!shouldIssueLetters) {
    await applyLateArrivalFineDeduction(tx, employeeId, date, lateCount);
  }

  if (shouldIssueLetters) {
    await issueLateLetterIfNotAlready(
      tx,
      employeeId,
      LetterType.FINE,
      lateCount,
      date,
      {
        fineReason: `اس ماہ ${lateCount} مرتبہ لیٹ آمد کی بنا پر یک روزہ تنخواہ کی کٹوتی۔ ${baseDetail}`,
        fineAmount: `Rs. ${deductionAmount.toFixed(2)}`,
        deductionMonth: monthLabel,
        // Structured date link (ADVICE/WARNING already carried this) — lets a
        // later Short Leave correction on this exact date find and reverse
        // this exact fine, see reverseLateDisciplineForDate below.
        incidentDate: dateLabel,
      },
    );
  }
}

export type UninformedAbsenceDisciplineTrackingResult = {
  /** False only when this exact date's UNINFORMED_ABSENT incident was
   * already claimed by an earlier call — a true idempotent no-op, nothing
   * below it (count/suspension) was (re)evaluated. */
  disciplineEventCreated: boolean;
  uninformedCount: number;
  /** True only when THIS call is what flipped the employee into SUSPENDED —
   * false on a replay that finds them already suspended. */
  suspensionTriggered: boolean;
};

/**
 * Non-financial half of UNINFORMED_ABSENT handling: claims the
 * DisciplineEvent(UNINFORMED_ABSENT) idempotency slot for this exact date,
 * derives the fresh monthly count (always re-read from current AttendanceLog
 * state, never stored), and evaluates/applies the >2-day auto-suspension
 * threshold using the existing, unchanged business rule. Never creates,
 * touches, or even looks up a PayrollDeduction/PayrollEntry — safe to call
 * regardless of payroll status, and safe to call on its own (ABSENT ->
 * UNINFORMED_ABSENT subtype promotion, where a same-amount deduction already
 * exists under a different description template and must not be duplicated)
 * as well as from applyUninformedAbsentDeduction (full family entry, which
 * also needs the deduction).
 *
 * Idempotent: claimDisciplineEvent's unique constraint makes a second call
 * for the same date a true no-op (disciplineEventCreated: false), and the
 * suspension check re-reads Employee.status fresh every call, so it never
 * re-suspends an employee HR has since manually reinstated.
 */
async function applyUninformedAbsenceDisciplineTracking(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
  skipLetters = false,
): Promise<UninformedAbsenceDisciplineTrackingResult> {
  const { startOfMonth, endOfMonth } = pakistanMonthWindowFromDate(date);
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayKey = dayStart.toISOString().slice(0, 10);

  // Count unique uninformed-absent days this month, including the current day
  // (the attendance log may not be written yet when discipline runs).
  const priorDays = await tx.attendanceLog.findMany({
    where: {
      employeeId,
      date: { gte: startOfMonth, lte: endOfMonth },
      status: AttendanceStatus.UNINFORMED_ABSENT,
    },
    select: { date: true },
  });

  const uniqueDays = new Set(
    priorDays.map((row) => row.date.toISOString().slice(0, 10)),
  );
  uniqueDays.add(dayKey);
  const uninformedCount = uniqueDays.size;

  // Atomic idempotency gate — see claimDisciplineEvent's doc comment.
  const claimed = await claimDisciplineEvent(
    tx,
    employeeId,
    DisciplineCategory.UNINFORMED_ABSENT,
    dayStart,
    uninformedCount,
  );
  if (!claimed) {
    return {
      disciplineEventCreated: false,
      uninformedCount,
      suspensionTriggered: false,
    };
  }

  const shouldIssueLetters =
    AUTO_DISCIPLINE.lettersAndSuspendEnabled && !skipLetters;

  if (shouldIssueLetters) {
    await issueAbsenceLetterIfNotAlready(
      tx,
      employeeId,
      date,
      'UNINFORMED_ABSENT',
      `تاریخ ${dayKey} کو بغیر اطلاع غیر حاضری۔`,
    );
  }

  // More than 2 uninformed-absent days in a month → HR suspension
  // recommendation only (never auto-suspend / never SENT auto letter).
  let suspensionTriggered = false;
  if (shouldIssueLetters && uninformedCount > 2) {
    const employee = await tx.employee.findUnique({
      where: { id: employeeId },
      select: { status: true },
    });

    if (employee?.status !== EmployeeStatus.SUSPENDED) {
      const reason = `اس ماہ ${uninformedCount} دن بغیر اطلاع غیر حاضری (2 دن سے زیادہ) — معطلی کی سفارش۔`;
      suspensionTriggered = await recommendHrSuspensionDraft(
        tx,
        employeeId,
        date,
        {
          suspensionReason: reason,
          suspensionStartDate: dayKey,
          suspensionDuration: 'Pending HR review',
          violations: reason,
          monthlyLateOccurrence: uninformedCount,
          incidentDate: dayKey,
          disciplineCategory: 'UNINFORMED_ABSENT',
        },
        reason,
      );
    }
  }

  return { disciplineEventCreated: true, uninformedCount, suspensionTriggered };
}

export type UninformedAbsentApplicationResult =
  UninformedAbsenceDisciplineTrackingResult & {
    deductionApplied: boolean;
    /** True when the incident was newly claimed (disciplineEventCreated)
     * and would otherwise have carried a deduction, but the target
     * PayrollEntry is PROCESSED/PAID — financial mutation was skipped, the
     * discipline tracking above still ran in full. */
    blockedByPayrollStatus: boolean;
    deductionAmount: number | null;
    payrollStatus: string | null;
  };

/**
 * Full UNINFORMED_ABSENT application: discipline tracking (see
 * applyUninformedAbsenceDisciplineTracking) plus the 2-day financial
 * deduction, now gated on PayrollEntry.status the same way every reversal
 * function in this file already is — mirrors the existing pattern in
 * applyExtraLeaveRejectedDeduction, which this function previously did not.
 * On PROCESSED/PAID: no PayrollDeduction is created, totalDeductions/
 * netStipend are never touched, blockedByPayrollStatus is reported — the
 * discipline tracking (DisciplineEvent claim, monthly count, suspension
 * threshold) still runs unconditionally, since none of that is financial.
 */
async function applyUninformedAbsenceFinancial(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<
  Pick<
    UninformedAbsentApplicationResult,
    | 'deductionApplied'
    | 'blockedByPayrollStatus'
    | 'deductionAmount'
    | 'payrollStatus'
  >
> {
  const noOp = {
    deductionApplied: false,
    blockedByPayrollStatus: false,
    deductionAmount: null as number | null,
    payrollStatus: null as string | null,
  };

  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayKey = dayStart.toISOString().slice(0, 10);

  const basicStipend = await getBasicStipend(tx, employeeId, date);
  if (basicStipend <= 0) return noOp;

  const payrollEntry = await getOrCreatePayrollEntry(tx, employeeId, date);
  if (!payrollEntry) return noOp;

  if (isPayrollFinanciallyFrozen(payrollEntry.status)) {
    return {
      ...noOp,
      blockedByPayrollStatus: true,
      payrollStatus: payrollEntry.status,
    };
  }

  const deductionAmount = dailyStipendRate(basicStipend, date) * 2;
  const uaDescription = `Uninformed absence deduction (2 days) — ${dayKey}`;
  const absentDescription = `Absent without approved leave (2 days stipend) — ${dayKey}`;

  const existingFamilyDeduction = await tx.payrollDeduction.findFirst({
    where: {
      payrollEntryId: payrollEntry.id,
      reason: DeductionType.UNINFORMED_ABSENCE,
      OR: [{ description: uaDescription }, { description: absentDescription }],
    },
  });
  if (existingFamilyDeduction) {
    return { ...noOp, payrollStatus: payrollEntry.status };
  }

  await tx.payrollDeduction.create({
    data: {
      payrollEntryId: payrollEntry.id,
      reason: DeductionType.UNINFORMED_ABSENCE,
      amount: deductionAmount,
      description: uaDescription,
    },
  });

  await tx.payrollEntry.update({
    where: { id: payrollEntry.id },
    data: {
      totalDeductions: { increment: deductionAmount },
      netStipend: { decrement: deductionAmount },
    },
  });

  return {
    deductionApplied: true,
    blockedByPayrollStatus: false,
    deductionAmount,
    payrollStatus: payrollEntry.status,
  };
}

/**
 * Full UNINFORMED_ABSENT application: discipline tracking (see
 * applyUninformedAbsenceDisciplineTracking) plus the 2-day financial
 * deduction, now gated on PayrollEntry.status the same way every reversal
 * function in this file already is — mirrors the existing pattern in
 * applyExtraLeaveRejectedDeduction, which this function previously did not.
 * On PROCESSED/PAID: no PayrollDeduction is created, totalDeductions/
 * netStipend are never touched, blockedByPayrollStatus is reported — the
 * discipline tracking (DisciplineEvent claim, monthly count, suspension
 * threshold) still runs unconditionally, since none of that is financial.
 */
async function applyUninformedAbsentDeduction(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
  skipLetters = false,
): Promise<UninformedAbsentApplicationResult> {
  const tracking = await applyUninformedAbsenceDisciplineTracking(
    tx,
    employeeId,
    date,
    skipLetters,
  );
  if (!tracking.disciplineEventCreated) {
    // Already processed — true no-op, matches the pre-existing early return.
    return {
      ...tracking,
      deductionApplied: false,
      blockedByPayrollStatus: false,
      deductionAmount: null,
      payrollStatus: null,
    };
  }

  if (AUTO_DISCIPLINE.lettersAndSuspendEnabled && !skipLetters) {
    return {
      ...tracking,
      deductionApplied: false,
      blockedByPayrollStatus: false,
      deductionAmount: null,
      payrollStatus: null,
    };
  }

  const financial = await applyUninformedAbsenceFinancial(tx, employeeId, date);
  return { ...tracking, ...financial };
}

/**
 * Resolves (or creates a bare placeholder) PayrollEntry for the
 * StipendRecord segment that was actually EFFECTIVE ON `date` — NOT
 * whichever record happens to be active right now. See
 * getStipendRecordEffectiveOn. This is what guarantees a dated
 * discipline incident always lands on its own historically-correct
 * PayrollEntry (and, transitively, whichever PROCESSED/PAID freeze that
 * entry already has) instead of silently migrating to the currently-
 * active segment after a later salary revision.
 */
async function getOrCreatePayrollEntry(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
) {
  const { month, year } = pakistanYearMonthFromDate(date);
  const stipendRecord = await getStipendRecordEffectiveOn(tx, employeeId, date);

  if (!stipendRecord) {
    return null;
  }

  return tx.payrollEntry.findUnique({
    where: {
      stipendRecordId_month_year: {
        stipendRecordId: stipendRecord.id,
        month,
        year,
      },
    },
  });
}

/**
 * Has a late-discipline letter of this exact type already been issued for
 * this exact monthly occurrence number? Matched via Letter.variables (an
 * existing JSON field — no schema change) rather than substring-matching
 * free text, so it cannot collide between different occurrence counts (e.g.
 * a `contains` match on "3 late" was previously liable to also match a
 * differently-worded description that happened to contain that substring).
 *
 * Also requires an exact incidentDate match when the candidate letter has
 * one (all letters do, post Phase 2). Occurrence numbers are only stable
 * 1:1 with dates as long as nothing in the month has been corrected — once
 * reverseLateDisciplineForDate removes an earlier day from the derived
 * count (Short Leave conversion), a *different*, later date can legitimately
 * recompute the same occurrence number an unrelated already-issued letter
 * already holds. Requiring the date to match too means that later date still
 * gets its own letter instead of being silently swallowed as "already
 * handled". Letters created before this field existed have no incidentDate
 * and fall back to the original occurrence-number-only match, so existing
 * data's dedup behavior is unchanged.
 */
async function hasLetterForMonthlyOccurrence(
  tx: Prisma.TransactionClient,
  employeeId: string,
  letterType: LetterType,
  lateCount: number,
  date: Date,
): Promise<boolean> {
  const { startOfMonth } = pakistanMonthWindowFromDate(date);
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dateLabel = dayStart.toISOString().slice(0, 10);

  const existing = await tx.letter.findMany({
    where: {
      employeeId,
      letterType,
      generatedAt: { gte: startOfMonth },
    },
    select: { variables: true },
  });

  return existing.some((letter) => {
    const vars = letter.variables as {
      monthlyLateOccurrence?: number;
      incidentDate?: string;
      reversedDueToShortLeave?: boolean;
      reversed?: boolean;
    } | null;
    // Soft-voided letters must not block a fresh claim after Short Leave /
    // status reversal released the DisciplineEvent for this date.
    if (vars?.reversedDueToShortLeave || vars?.reversed) return false;
    if (vars?.monthlyLateOccurrence !== lateCount) return false;
    if (vars?.incidentDate != null) {
      return vars.incidentDate === dateLabel;
    }
    return true;
  });
}

async function hasAnyActiveSuspensionLetterThisMonth(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<boolean> {
  const { startOfMonth } = pakistanMonthWindowFromDate(date);
  const existing = await tx.letter.findMany({
    where: {
      employeeId,
      letterType: LetterType.SUSPENSION,
      generatedAt: { gte: startOfMonth },
    },
    select: { variables: true },
  });
  return existing.some((letter) => {
    const vars = letter.variables as {
      reversedDueToShortLeave?: boolean;
      reversed?: boolean;
    } | null;
    return !vars?.reversedDueToShortLeave && !vars?.reversed;
  });
}

async function hasLetterForAbsenceIncident(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
  category: 'ABSENT' | 'UNINFORMED_ABSENT',
): Promise<boolean> {
  const { startOfMonth } = pakistanMonthWindowFromDate(date);
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayKey = dayStart.toISOString().slice(0, 10);

  const existing = await tx.letter.findMany({
    where: {
      employeeId,
      letterType: LetterType.EXPLANATION,
      generatedAt: { gte: startOfMonth },
    },
    select: { variables: true },
  });

  return existing.some((letter) => {
    const vars = letter.variables as {
      incidentDate?: string;
      disciplineCategory?: string;
      reversed?: boolean;
    } | null;
    if (vars?.reversed) return false;
    return (
      vars?.disciplineCategory === category && vars?.incidentDate === dayKey
    );
  });
}

async function issueAbsenceLetterIfNotAlready(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
  category: 'ABSENT' | 'UNINFORMED_ABSENT',
  violations: string,
): Promise<void> {
  if (await hasLetterForAbsenceIncident(tx, employeeId, date, category)) {
    return;
  }

  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayKey = dayStart.toISOString().slice(0, 10);

  await issueAutoTemplatedLetter(tx, {
    employeeId,
    letterType: LetterType.EXPLANATION,
    extraFields: {
      violations,
      incidentDate: dayKey,
      disciplineCategory: category,
    },
    notificationMessage: `Draft explanation letter for ${dayKey} absence is ready for proofread and send.`,
    notificationType: 'DRAFT_LETTER_READY',
  });
}

/**
 * Open an HR-only suspension recommendation: OPEN DisciplinaryAction + DRAFT
 * letter + HR notification. Never changes Employee.status, never deactivates
 * User, never creates a SENT suspension letter or SuspensionRequest.
 */
async function recommendHrSuspensionDraft(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
  extraFields: Record<string, unknown>,
  reason: string,
): Promise<boolean> {
  if (await hasAnyActiveSuspensionLetterThisMonth(tx, employeeId, date)) {
    return false;
  }

  await tx.disciplinaryAction.create({
    data: {
      employeeId,
      type: DisciplinaryType.SUSPENSION,
      reason,
      status: DisciplinaryStatus.OPEN,
    },
  });

  await tx.letter.create({
    data: {
      employeeId,
      letterType: LetterType.SUSPENSION,
      status: LetterStatus.DRAFT,
      content: extraFields as Prisma.InputJsonValue,
      variables: extraFields as Prisma.InputJsonValue,
      requiresAcknowledgement: false,
    },
  });

  const hrManagers = await tx.user.findMany({
    where: { role: UserRole.HR_MANAGER, isActive: true },
  });
  for (const hr of hrManagers) {
    if (hr.employeeId) {
      await tx.notification.create({
        data: {
          employeeId: hr.employeeId,
          type: 'SUSPENSION_RECOMMENDED',
          message:
            'Attendance threshold recommends suspension. HR must prepare and issue via the approval workflow.',
        },
      });
    }
  }

  return true;
}

const LATE_LETTER_NOTIFICATION: Record<
  'ADVICE' | 'WARNING' | 'FINE' | 'SUSPENSION',
  { message: (lateCount: number) => string; type: string }
> = {
  ADVICE: {
    message: (n) =>
      `Advice notice issued — you have been late ${n} time(s) this month.`,
    type: 'ADVICE_ISSUED',
  },
  WARNING: {
    message: (n) =>
      `Warning Letter has been issued due to ${n} late arrivals this month.`,
    type: 'WARNING_ISSUED',
  },
  FINE: {
    message: (n) =>
      `A one-day stipend deduction and Fine Letter have been issued due to ${n} late arrivals this month.`,
    type: 'FINE_ISSUED',
  },
  SUSPENSION: {
    message: (n) =>
      `You have been suspended due to repeated late arrivals (${n} lates this month).`,
    type: 'SUSPENSION_ISSUED',
  },
};

/**
 * Issue an ADVICE/WARNING/FINE/SUSPENSION letter for one specific monthly
 * late occurrence, unless one already exists for that exact occurrence
 * number (see hasLetterForMonthlyOccurrence) — safe to call on every replay
 * of the same attendance event without creating a duplicate letter.
 */
async function issueLateLetterIfNotAlready(
  tx: Prisma.TransactionClient,
  employeeId: string,
  letterType: LetterType,
  lateCount: number,
  date: Date,
  extraFields: Record<string, unknown>,
): Promise<void> {
  const alreadyIssued = await hasLetterForMonthlyOccurrence(
    tx,
    employeeId,
    letterType,
    lateCount,
    date,
  );
  if (alreadyIssued) return;

  if (letterType === LetterType.SUSPENSION) {
    await recommendHrSuspensionDraft(
      tx,
      employeeId,
      date,
      {
        ...extraFields,
        monthlyLateOccurrence: lateCount,
        disciplineCategory: 'LATE',
      },
      String(
        extraFields.suspensionReason ??
          extraFields.violations ??
          `Attendance threshold recommends suspension (${lateCount} late arrivals this month).`,
      ),
    );
    return;
  }

  const notif =
    LATE_LETTER_NOTIFICATION[
      letterType as 'ADVICE' | 'WARNING' | 'FINE' | 'SUSPENSION'
    ];

  await issueAutoTemplatedLetter(tx, {
    employeeId,
    letterType,
    extraFields: {
      ...extraFields,
      monthlyLateOccurrence: lateCount,
      disciplineCategory: 'LATE',
    },
    notificationMessage: notif.message(lateCount),
    notificationType: notif.type,
  });
}

// ─── MISSING CHECKOUT (separate category from lateness — never mixed) ─────

export type MissingCheckoutOptions = {
  checkIn: Date;
  dutyEndTime: string | null;
};

/**
 * Chronological Missing Checkout occurrence for one incident date within
 * the Pakistan calendar month of that date.
 *
 * Counts existing DisciplineEvent(MISSING_CHECKOUT) rows with an earlier
 * incidentDate in the same month, then +1 for this date. Does NOT count
 * currently-open AttendanceLog rows (checkOut IS NULL) — that old approach
 * reset the sequence whenever earlier days later received a checkout
 * (HR edit, temp auto-checkout, backfill), which is the production bug
 * behind repeating "occurrence 1" mid-month.
 *
 * Resolved incidents (checkout provided) delete their claim via
 * reverseMissingCheckoutDisciplineForDate, so they no longer occupy a slot
 * in the monthly sequence.
 */
export async function resolveMissingCheckoutOccurrenceForDate(
  tx: Prisma.TransactionClient,
  employeeId: string,
  incidentDate: Date,
): Promise<number> {
  const dayStart = new Date(incidentDate);
  dayStart.setUTCHours(0, 0, 0, 0);
  const { startOfMonth } = pakistanMonthWindowFromDate(dayStart);

  const priorCount = await tx.disciplineEvent.count({
    where: {
      employeeId,
      category: DisciplineCategory.MISSING_CHECKOUT,
      incidentDate: { gte: startOfMonth, lt: dayStart },
    },
  });

  return priorCount + 1;
}

/**
 * Re-assign occurrence = chronological rank (1..n) for all
 * MISSING_CHECKOUT DisciplineEvents in the employee+month window.
 * Idempotent. Does not create/delete events or touch letters — audit field
 * repair only so out-of-order claims still end with stable ranks.
 */
export async function renumberMissingCheckoutOccurrencesForMonth(
  tx: Prisma.TransactionClient,
  employeeId: string,
  monthDate: Date,
): Promise<{ updated: number }> {
  const { startOfMonth, endOfMonth } = pakistanMonthWindowFromDate(monthDate);
  const events = await tx.disciplineEvent.findMany({
    where: {
      employeeId,
      category: DisciplineCategory.MISSING_CHECKOUT,
      incidentDate: { gte: startOfMonth, lte: endOfMonth },
    },
    orderBy: { incidentDate: 'asc' },
    select: { id: true, occurrence: true },
  });

  let updated = 0;
  for (let i = 0; i < events.length; i++) {
    const expected = i + 1;
    if (events[i].occurrence !== expected) {
      await tx.disciplineEvent.update({
        where: { id: events[i].id },
        data: { occurrence: expected },
      });
      updated++;
    }
  }
  return { updated };
}

/**
 * Monthly missing-checkout cycle: 1/4/7 -> Advice, 2/5/8 -> Warning,
 * 3/6/9 -> Fine + 1-day deduction. No suspension step ever — the 3-step
 * cycle just keeps repeating. Counted entirely separately from lateness
 * via DisciplineEvent(MISSING_CHECKOUT) chronological rank (see
 * resolveMissingCheckoutOccurrenceForDate). Dedupes via a distinct
 * Letter.variables key (monthlyMissingCheckoutOccurrence) so it cannot
 * collide with applyLateDiscipline's monthlyLateOccurrence even though
 * both cycles reuse the same LetterType values (ADVICE/WARNING/FINE).
 */
export async function applyMissingCheckoutDiscipline(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
  options: MissingCheckoutOptions,
): Promise<void> {
  // Temporary ops mode: auto-checkout path owns closure; do not issue
  // Advice/Warning/Fine or deductions. Flip TEMPORARY_AUTO_CHECKOUT off to
  // restore this function's normal behaviour — no other edits required.
  if (isTemporaryAutoCheckoutEnabled()) {
    return;
  }

  const basicStipend = await getBasicStipend(tx, employeeId, date);

  const { startOfMonth } = pakistanMonthWindowFromDate(date);
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayKey = dayStart.toISOString().slice(0, 10);

  // Provisional rank among already-claimed earlier incidents (+ this day).
  // Final letter/deduction use the post-renumber value for this date so
  // out-of-order repair claims still escalate on chronological position.
  const provisionalCount = await resolveMissingCheckoutOccurrenceForDate(
    tx,
    employeeId,
    dayStart,
  );

  // Atomic idempotency gate — see claimDisciplineEvent's doc comment.
  const claimed = await claimDisciplineEvent(
    tx,
    employeeId,
    DisciplineCategory.MISSING_CHECKOUT,
    dayStart,
    provisionalCount,
  );
  if (!claimed) return; // already processed for this open day — true no-op

  await renumberMissingCheckoutOccurrencesForMonth(tx, employeeId, dayStart);

  const claimedEvent = await tx.disciplineEvent.findUnique({
    where: {
      employeeId_category_incidentDate: {
        employeeId,
        category: DisciplineCategory.MISSING_CHECKOUT,
        incidentDate: dayStart,
      },
    },
    select: { occurrence: true },
  });
  const missingCount = claimedEvent?.occurrence ?? provisionalCount;

  // Belt-and-suspenders: if an active (non-reversed) letter already exists
  // for this incident date on the missing-checkout track, never issue another.
  const priorForDay = await tx.letter.findMany({
    where: {
      employeeId,
      letterType: {
        in: [LetterType.ADVICE, LetterType.WARNING, LetterType.FINE],
      },
      generatedAt: { gte: startOfMonth },
    },
    select: { variables: true },
  });
  const alreadyHandledIncident = priorForDay.some((letter) => {
    const vars = letter.variables as {
      monthlyMissingCheckoutOccurrence?: number;
      incidentDate?: string;
      reversed?: boolean;
    } | null;
    if (vars?.reversed) return false;
    return (
      vars?.monthlyMissingCheckoutOccurrence != null &&
      vars.incidentDate === dayKey
    );
  });
  if (alreadyHandledIncident) return;

  const checkInLabel = formatMinutesAsHHmm(
    toPakistanMinutesOfDay(options.checkIn),
  );
  const expectedCheckoutLabel = options.dutyEndTime ?? 'نامعلوم';
  const baseDetail = `تاریخ: ${dayKey}، حاضری کا وقت: ${checkInLabel}، متوقع چیک آؤٹ کا وقت: ${expectedCheckoutLabel}۔ ڈیوٹی مکمل ہونے کے باوجود چیک آؤٹ نہیں کیا گیا، جو کہ ہر ملازم کی ذمہ داری ہے۔`;

  const positionInCycle = ((missingCount - 1) % 3) + 1; // 1, 2, or 3

  if (positionInCycle === 1) {
    if (AUTO_DISCIPLINE.lettersAndSuspendEnabled) {
      await issueMissingCheckoutLetterIfNotAlready(
        tx,
        employeeId,
        LetterType.ADVICE,
        missingCount,
        date,
        {
          violations: `اس ماہ چیک آؤٹ نہ کرنے کی ${missingCount} ویں خلاف ورزی۔ ${baseDetail} آئندہ ڈیوٹی مکمل ہونے پر چیک آؤٹ یقینی بنائیں۔`,
          incidentDate: dayKey,
          disciplineCategory: 'MISSING_CHECKOUT',
        },
      );
    }
    return;
  }

  if (positionInCycle === 2) {
    if (AUTO_DISCIPLINE.lettersAndSuspendEnabled) {
      await issueMissingCheckoutLetterIfNotAlready(
        tx,
        employeeId,
        LetterType.WARNING,
        missingCount,
        date,
        {
          violations: `اس ماہ چیک آؤٹ نہ کرنے کی ${missingCount} ویں خلاف ورزی (اس ماہ کی دوسری تنبیہ)۔ ${baseDetail}`,
          incidentDate: dayKey,
          disciplineCategory: 'MISSING_CHECKOUT',
        },
      );
    }
    return;
  }

  // positionInCycle === 3 -> 3rd / 6th / 9th ... this month: Fine + 1-day
  // deduction, then the cycle resets. No suspension at any point.
  const deductionAmount = dailyStipendRate(basicStipend, date);
  const monthLabel = date.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  if (!AUTO_DISCIPLINE.lettersAndSuspendEnabled) {
    await applyMissingCheckoutFineDeduction(
      tx,
      employeeId,
      date,
      missingCount,
    );
  }

  if (AUTO_DISCIPLINE.lettersAndSuspendEnabled) {
    await issueMissingCheckoutLetterIfNotAlready(
      tx,
      employeeId,
      LetterType.FINE,
      missingCount,
      date,
      {
        fineReason: `اس ماہ چیک آؤٹ نہ کرنے کی ${missingCount} ویں خلاف ورزی کی بنا پر یک روزہ تنخواہ کی کٹوتی۔ ${baseDetail}`,
        fineAmount: `Rs. ${deductionAmount.toFixed(2)}`,
        deductionMonth: monthLabel,
        // Structured date link, matching applyLateDiscipline's FINE letter —
        // lets reverseMissingCheckoutDisciplineForDate find and reverse this
        // exact letter/deduction later. Previously omitted here (ADVICE/WARNING
        // already carried it); no reversal existed to need it until now.
        incidentDate: dayKey,
        disciplineCategory: 'MISSING_CHECKOUT',
      },
    );
  }
}

/**
 * Has a missing-checkout letter of this exact type already been issued for
 * this exact monthly occurrence number? Matched via a distinct
 * Letter.variables key (monthlyMissingCheckoutOccurrence), independent from
 * hasLetterForMonthlyOccurrence's monthlyLateOccurrence key — the two never
 * read each other's letters even when both are ADVICE/WARNING/FINE for the
 * same employee in the same month.
 */
async function hasLetterForMonthlyMissingCheckoutOccurrence(
  tx: Prisma.TransactionClient,
  employeeId: string,
  letterType: LetterType,
  missingCount: number,
  date: Date,
): Promise<boolean> {
  const { startOfMonth } = pakistanMonthWindowFromDate(date);
  const existing = await tx.letter.findMany({
    where: {
      employeeId,
      letterType,
      generatedAt: { gte: startOfMonth },
    },
    select: { variables: true },
  });

  const dateLabel = date.toISOString().slice(0, 10);
  return existing.some((letter) => {
    const vars = letter.variables as {
      monthlyMissingCheckoutOccurrence?: number;
      incidentDate?: string;
      reversedDueToShortLeave?: boolean;
      reversed?: boolean;
    } | null;
    // Soft-voided / checkout-resolved letters no longer block re-issue.
    if (vars?.reversedDueToShortLeave) return false;
    if (vars?.reversed) return false;
    if (vars?.monthlyMissingCheckoutOccurrence !== missingCount) return false;
    if (!vars.incidentDate) return true;
    return vars.incidentDate === dateLabel;
  });
}

const MISSING_CHECKOUT_LETTER_NOTIFICATION: Record<
  'ADVICE' | 'WARNING' | 'FINE',
  { message: (n: number) => string; type: string }
> = {
  ADVICE: {
    message: (n) =>
      `Advice notice issued — you missed checkout ${n} time(s) this month.`,
    type: 'MISSING_CHECKOUT_ADVICE_ISSUED',
  },
  WARNING: {
    message: (n) =>
      `Warning Letter has been issued due to ${n} missed checkouts this month.`,
    type: 'MISSING_CHECKOUT_WARNING_ISSUED',
  },
  FINE: {
    message: (n) =>
      `A one-day stipend deduction and Fine Letter have been issued due to ${n} missed checkouts this month.`,
    type: 'MISSING_CHECKOUT_FINE_ISSUED',
  },
};

/**
 * Issue an ADVICE/WARNING/FINE letter for one specific monthly
 * missing-checkout occurrence, unless one already exists for that exact
 * occurrence number — safe to call on every scheduler tick that re-detects
 * the same still-open attendance row without creating a duplicate letter.
 */
async function issueMissingCheckoutLetterIfNotAlready(
  tx: Prisma.TransactionClient,
  employeeId: string,
  letterType: LetterType,
  missingCount: number,
  date: Date,
  extraFields: Record<string, unknown>,
): Promise<void> {
  const alreadyIssued = await hasLetterForMonthlyMissingCheckoutOccurrence(
    tx,
    employeeId,
    letterType,
    missingCount,
    date,
  );
  if (alreadyIssued) return;

  const notif =
    MISSING_CHECKOUT_LETTER_NOTIFICATION[
      letterType as 'ADVICE' | 'WARNING' | 'FINE'
    ];

  await issueAutoTemplatedLetter(tx, {
    employeeId,
    letterType,
    extraFields: {
      ...extraFields,
      monthlyMissingCheckoutOccurrence: missingCount,
    },
    notificationMessage: notif.message(missingCount),
    notificationType: notif.type,
  });
}

// ─── LEAVE ↔ ATTENDANCE RECONCILIATION (Phase 2) ───────────────────────
//
// Reversal is intentionally exact-match-only: if the structured link that
// identifies "which specific letter/deduction belongs to this exact date"
// is not present (e.g. a historical row created before this field existed),
// these functions do nothing rather than guess. That keeps every reversal
// provably tied to the one attendance event being corrected — never an
// unrelated date, employee, or letter.

/**
 * Predicate for "does this AttendanceLog row count toward the monthly late
 * cycle right now" — the EXACT same rule applyLateDiscipline's own
 * priorLateDays query uses (status LATE, or lateness-driven HALF_DAY
 * excluding short-leave-noted rows). Exported so callers outside this file
 * (attendance.service.ts) can compare a row's late-eligibility BEFORE and
 * AFTER an edit without duplicating or drifting from this exact rule.
 */
export function isLateEligibleForDiscipline(row: {
  status: AttendanceStatus;
  lateMinutes: number;
  note?: string | null;
}): boolean {
  if (row.status === AttendanceStatus.LATE) return true;
  if (
    row.status === AttendanceStatus.HALF_DAY &&
    row.lateMinutes > 0 &&
    !(row.note ?? '').toLowerCase().includes('short leave')
  ) {
    return true;
  }
  return false;
}

export type LateDisciplineReversalResult = {
  /** True if an active (not-already-reversed) letter for this date was
   * found and processed this call. False on every idempotent replay, or
   * when nothing was ever issued for this date. */
  reversed: boolean;
  letterId: string | null;
  letterType: LetterType | null;
  deductionReversed: boolean;
  deductionAmount: number | null;
  /** True when a matching deduction existed but its PayrollEntry is no
   * longer PENDING — the deduction/totals were deliberately left untouched
   * (financial freeze preserved) even though the letter/DisciplineEvent
   * were still reversed. */
  blockedByPayrollStatus: boolean;
  payrollStatus: string | null;
  disciplineEventRemoved: boolean;
};

/**
 * Reverses the LATE-discipline consequences of one exact incident date —
 * called whenever an existing AttendanceLog row transitions from a
 * late-counting state (see isLateEligibleForDiscipline) to a non-late one,
 * for ANY reason: Short Leave reconciliation, or a plain HR status
 * correction (LATE/lateness-HALF_DAY -> PRESENT/ON_LEAVE/ABSENT/etc). Finds
 * the exact ADVICE/WARNING/FINE letter issued for THIS date (matched via
 * Letter.variables.incidentDate) and reverses its consequences:
 *  - FINE: delete the exact matching 1-day LATE_ARRIVAL deduction for that
 *    month (identified via the same monthlyLateOccurrence number the letter
 *    itself carries), and restore PayrollEntry.totalDeductions/netStipend —
 *    but ONLY when that entry is still PENDING; PROCESSED/PAID entries are
 *    never mutated, matching the freeze every other reversal in this file
 *    already respects.
 *  - Any type: the letter itself is kept (never deleted — it's a real
 *    historical record, may already be portal-visible/acknowledged) but is
 *    annotated as reversed in its `variables` JSON, and requiresAcknowledgement
 *    is cleared so it stops appearing as an actionable pending item.
 *  - The date's DisciplineEvent(LATE) claim is released, so a later
 *    legitimate correction back to LATE for this same date can be
 *    processed again instead of being silently swallowed as "already
 *    handled".
 *
 * Fully idempotent: a second call for the same date finds no active letter
 * (already annotated reversed) and returns a no-op result — no double
 * payroll credit, no error, missing deduction/DisciplineEvent are no-ops.
 *
 * Does NOT attempt to renumber or reissue consequences for any OTHER date's
 * already-issued letters — see Phase 2 report for why that is out of scope
 * for a safe, deterministic, idempotent change. Does NOT reverse SUSPENSION
 * (occurrence 9) — that carries employee-status/account side effects that
 * remain intentionally HR-manual, unchanged from before this generalization.
 */
export async function reverseLateDisciplineForDate(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<LateDisciplineReversalResult> {
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dateLabel = dayStart.toISOString().slice(0, 10);
  const { startOfMonth } = pakistanMonthWindowFromDate(date);

  const noOpResult: LateDisciplineReversalResult = {
    reversed: false,
    letterId: null,
    letterType: null,
    deductionReversed: false,
    deductionAmount: null,
    blockedByPayrollStatus: false,
    payrollStatus: null,
    disciplineEventRemoved: false,
  };

  const candidates = await tx.letter.findMany({
    where: {
      employeeId,
      letterType: {
        in: [LetterType.ADVICE, LetterType.WARNING, LetterType.FINE],
      },
      generatedAt: { gte: startOfMonth },
    },
  });

  const letter = candidates.find((l) => {
    const vars = l.variables as {
      incidentDate?: string;
      reversedDueToShortLeave?: boolean;
      monthlyLateOccurrence?: number;
    } | null;
    // monthlyLateOccurrence presence is required, not just incidentDate —
    // applyMissingCheckoutDiscipline's ADVICE/WARNING/FINE letters also
    // carry an incidentDate for the same employee/date (a different
    // discipline category entirely) and must never be picked up here.
    if (vars?.monthlyLateOccurrence == null) return false;
    return vars.incidentDate === dateLabel && !vars.reversedDueToShortLeave;
  });

  if (!letter) {
    const deletedEvents = await tx.disciplineEvent.deleteMany({
      where: {
        employeeId,
        category: DisciplineCategory.LATE,
        incidentDate: dayStart,
      },
    });
    if (deletedEvents.count > 0) {
      return {
        ...noOpResult,
        reversed: true,
        disciplineEventRemoved: true,
      };
    }
    return noOpResult;
  }

  const vars = letter.variables as {
    monthlyLateOccurrence?: number;
  } | null;
  const occurrence = vars?.monthlyLateOccurrence;

  let deductionReversed = false;
  let deductionAmount: number | null = null;
  let blockedByPayrollStatus = false;
  let payrollStatus: string | null = null;

  if (letter.letterType === LetterType.FINE && occurrence != null) {
    const { month, year } = pakistanYearMonthFromDate(date);
    // Reverse against the segment that was EFFECTIVE ON the incident date —
    // the same segment the original fine was (now correctly) applied to —
    // never the currently-active one, or a later salary revision would
    // make this reversal silently find nothing.
    const stipendRecord = await getStipendRecordEffectiveOn(tx, employeeId, date);

    if (stipendRecord) {
      const payrollEntry = await tx.payrollEntry.findUnique({
        where: {
          stipendRecordId_month_year: {
            stipendRecordId: stipendRecord.id,
            month,
            year,
          },
        },
      });

      if (payrollEntry) {
        payrollStatus = payrollEntry.status;
        const deductionDescription = `Late arrival deduction — monthly occurrence ${occurrence}`;
        const deduction = await tx.payrollDeduction.findFirst({
          where: {
            payrollEntryId: payrollEntry.id,
            reason: DeductionType.LATE_ARRIVAL,
            description: deductionDescription,
          },
        });

        if (deduction) {
          if (isPayrollFinanciallyFrozen(payrollEntry.status)) {
            // Financial freeze — never mutate a PROCESSED/PAID entry.
            // The letter/DisciplineEvent below are still reversed; only the
            // money is deliberately left exactly as it was.
            blockedByPayrollStatus = true;
          } else {
            await tx.payrollDeduction.delete({ where: { id: deduction.id } });
            await tx.payrollEntry.update({
              where: { id: payrollEntry.id },
              data: {
                totalDeductions: { decrement: deduction.amount },
                netStipend: { increment: deduction.amount },
              },
            });
            deductionReversed = true;
            deductionAmount = Number(deduction.amount);
          }
        }
      }
    }
  }

  await tx.letter.update({
    where: { id: letter.id },
    data: {
      variables: {
        ...((letter.variables as object) ?? {}),
        reversedDueToShortLeave: true,
        reversedAt: new Date().toISOString(),
        // Distinct from reversedDueToShortLeave (kept as-is — it is the
        // established dedup/soft-void marker every reader already checks)
        // purely for future readability of WHY this letter was reversed.
        reversalTrigger: 'STATUS_NO_LONGER_LATE',
        ...(blockedByPayrollStatus
          ? { reversalBlockedByPayrollStatus: true }
          : {}),
      },
      requiresAcknowledgement: false,
    },
  });

  // This date no longer represents a genuine late incident — release the
  // idempotency claim too (deleteMany: safe no-op if none exists), so a
  // LEGITIMATE later correction back to LATE for this same date (HR
  // undoing the Short Leave, or re-correcting a status back to LATE) can be
  // processed again instead of being silently swallowed as "already
  // handled" by claimDisciplineEvent.
  const deletedEvents = await tx.disciplineEvent.deleteMany({
    where: {
      employeeId,
      category: DisciplineCategory.LATE,
      incidentDate: dayStart,
    },
  });

  return {
    reversed: true,
    letterId: letter.id,
    letterType: letter.letterType,
    deductionReversed,
    deductionAmount,
    blockedByPayrollStatus,
    payrollStatus,
    disciplineEventRemoved: deletedEvents.count > 0,
  };
}

/**
 * Predicate for "does this AttendanceLog row currently represent an
 * uninformed-absence incident" — the single condition applyUninformedAbsent
 * Deduction's own gating uses. Exported so callers outside this file
 * (attendance.service.ts) can compare a row's eligibility BEFORE and AFTER
 * an edit without duplicating or drifting from this exact rule — mirrors
 * isLateEligibleForDiscipline's role for the LATE category.
 */
export function isUninformedAbsentEligibleForDiscipline(row: {
  status: AttendanceStatus;
}): boolean {
  return row.status === AttendanceStatus.UNINFORMED_ABSENT;
}

/**
 * Broader "absence family" predicate — true for either ABSENT or
 * UNINFORMED_ABSENT. applyAbsentDeduction and applyUninformedAbsentDeduction
 * apply the same-shaped 2-day deduction (reverseAbsenceDeductionForDate
 * already matches either description template), so for the purposes of
 * "does this row currently carry an absence-family financial consequence"
 * the two are one financial category. This does NOT erase their distinct
 * application semantics — applyDisciplineRules still dispatches each status
 * to its own function, and only UNINFORMED_ABSENT ever claims a
 * DisciplineEvent / counts toward the >2-day auto-suspension threshold.
 */
export function isAbsentFamilyEligibleForDiscipline(row: {
  status: AttendanceStatus;
}): boolean {
  return (
    row.status === AttendanceStatus.ABSENT ||
    row.status === AttendanceStatus.UNINFORMED_ABSENT
  );
}

/**
 * "Does this row currently have an open, checked-in-but-never-checked-out
 * session" — the exact same shape ShiftMissingCheckoutScheduler's own query
 * uses (checkIn set, checkOut null). Orthogonal to status: a row can be
 * simultaneously late-eligible (or absence-family-eligible, in principle)
 * AND missing-checkout-eligible, since lateness/absence is a status field
 * while this is purely about checkIn/checkOut presence.
 */
export function isMissingCheckoutEligibleForDiscipline(row: {
  checkIn?: Date | null;
  checkOut?: Date | null;
}): boolean {
  return row.checkIn != null && row.checkOut == null;
}

export type AbsenceDeductionReversalResult = {
  /** True if a deduction was found and/or a DisciplineEvent claim was
   * released this call. False on every idempotent replay once both are
   * already gone (or never existed for this date). */
  reversed: boolean;
  deductionId: string | null;
  deductionReversed: boolean;
  deductionAmount: number | null;
  /** True when a matching deduction existed but its PayrollEntry is no
   * longer PENDING — deliberately left untouched (financial freeze
   * preserved), even though the DisciplineEvent claim is still released. */
  blockedByPayrollStatus: boolean;
  payrollStatus: string | null;
  disciplineEventRemoved: boolean;
};

/**
 * Reverses the exact-date consequences of a day previously auto-marked
 * ABSENT/UNINFORMED_ABSENT once it is corrected away — called from the
 * leave-approval flow (ON_LEAVE) and, as of this fix, from updateAttendance/
 * markManual whenever an existing row transitions out of UNINFORMED_ABSENT
 * eligibility for ANY reason (PRESENT, LATE, HALF_DAY, ON_LEAVE,
 * SWAP_COVERED, etc — see isUninformedAbsentEligibleForDiscipline).
 *
 * Finds the exact 2-day absence deduction created for THIS date (matched
 * via the date suffix embedded in its description — see applyAbsentDeduction
 * / applyUninformedAbsentDeduction) and, ONLY when its PayrollEntry is still
 * PENDING, deletes it and restores totalDeductions/netStipend — matching the
 * same PROCESSED/PAID financial freeze reverseLateDisciplineForDate already
 * respects. The DisciplineEvent(UNINFORMED_ABSENT) claim for this date is
 * released unconditionally (non-financial, safe regardless of payroll
 * status) so a legitimate later correction back to UNINFORMED_ABSENT for
 * this same date can be processed again.
 *
 * Deductions created before the date-suffix format existed have no exact
 * link and are intentionally left untouched — HR must reverse those
 * manually (matches the existing, unchanged legacy-undated-deduction
 * policy this file already documents elsewhere).
 *
 * Fully idempotent: a second call for the same date finds no matching
 * deduction (already deleted) and no DisciplineEvent (already released) —
 * true no-op, no error, no double credit.
 *
 * Scope is deliberately deduction + DisciplineEvent only — this function
 * never touches Employee.status/User.isActive. No safe, existing,
 * code-defined "unsuspend when the >2-day threshold is no longer met"
 * mechanism exists anywhere in this codebase (the only reinstatement path
 * is the fully manual HR Inquiry-outcome flow in disciplinary.service.ts),
 * so correcting an incident below the threshold never automatically
 * reactivates an employee.
 */
export async function reverseAbsenceDeductionForDate(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<AbsenceDeductionReversalResult> {
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dateLabel = dayStart.toISOString().slice(0, 10);
  const { month, year } = pakistanYearMonthFromDate(date);

  let deductionId: string | null = null;
  let deductionReversed = false;
  let deductionAmount: number | null = null;
  let blockedByPayrollStatus = false;
  let payrollStatus: string | null = null;

  // Reverse against the segment EFFECTIVE ON the incident date — the same
  // segment the original deduction was applied to.
  const stipendRecord = await getStipendRecordEffectiveOn(tx, employeeId, date);

  if (stipendRecord) {
    const payrollEntry = await tx.payrollEntry.findUnique({
      where: {
        stipendRecordId_month_year: {
          stipendRecordId: stipendRecord.id,
          month,
          year,
        },
      },
    });

    if (payrollEntry) {
      payrollStatus = payrollEntry.status;
      const expectedDescriptions = [
        `Uninformed absence deduction (2 days) — ${dateLabel}`,
        `Absent without approved leave (2 days stipend) — ${dateLabel}`,
      ];

      const deduction = await tx.payrollDeduction.findFirst({
        where: {
          payrollEntryId: payrollEntry.id,
          reason: DeductionType.UNINFORMED_ABSENCE,
          description: { in: expectedDescriptions },
        },
      });

      if (deduction) {
        deductionId = deduction.id;
        if (isPayrollFinanciallyFrozen(payrollEntry.status)) {
          blockedByPayrollStatus = true;
        } else {
          await tx.payrollDeduction.delete({ where: { id: deduction.id } });
          await tx.payrollEntry.update({
            where: { id: payrollEntry.id },
            data: {
              totalDeductions: { decrement: deduction.amount },
              netStipend: { increment: deduction.amount },
            },
          });
          deductionReversed = true;
          deductionAmount = Number(deduction.amount);
        }
      }
    }
  }

  // Release the idempotency claim too, same reasoning as
  // reverseLateDisciplineForDate above. deleteMany is a safe no-op when the
  // original status was plain ABSENT (never gated — only UNINFORMED_ABSENT
  // goes through claimDisciplineEvent), or when it was already released.
  const deletedEvents = await tx.disciplineEvent.deleteMany({
    where: {
      employeeId,
      category: DisciplineCategory.UNINFORMED_ABSENT,
      incidentDate: dayStart,
    },
  });

  const { startOfMonth } = pakistanMonthWindowFromDate(date);
  const absenceLetters = await tx.letter.findMany({
    where: {
      employeeId,
      letterType: LetterType.EXPLANATION,
      generatedAt: { gte: startOfMonth },
    },
  });
  const absenceLetter = absenceLetters.find((letter) => {
    const vars = letter.variables as {
      incidentDate?: string;
      disciplineCategory?: string;
      reversed?: boolean;
    } | null;
    if (vars?.reversed) return false;
    if (vars?.incidentDate !== dateLabel) return false;
    return (
      vars.disciplineCategory === 'ABSENT' ||
      vars.disciplineCategory === 'UNINFORMED_ABSENT'
    );
  });
  if (absenceLetter) {
    await tx.letter.update({
      where: { id: absenceLetter.id },
      data: {
        status:
          absenceLetter.status === LetterStatus.DRAFT
            ? LetterStatus.REVERSED
            : absenceLetter.status,
        variables: {
          ...((absenceLetter.variables as object) ?? {}),
          reversed: true,
          reversedAt: new Date().toISOString(),
          reversalTrigger: 'STATUS_NO_LONGER_ABSENT',
        },
        requiresAcknowledgement: false,
      },
    });
  }

  return {
    reversed:
      deductionReversed || deletedEvents.count > 0 || blockedByPayrollStatus,
    deductionId,
    deductionReversed,
    deductionAmount,
    blockedByPayrollStatus,
    payrollStatus,
    disciplineEventRemoved: deletedEvents.count > 0,
  };
}

export type MissingCheckoutReversalResult = {
  /** True if an active (not-already-reversed) letter for this date was
   * found and processed this call. False on every idempotent replay, or
   * when nothing was ever issued for this date. */
  reversed: boolean;
  letterId: string | null;
  letterType: LetterType | null;
  deductionReversed: boolean;
  deductionAmount: number | null;
  /** True when a matching deduction existed but its PayrollEntry is no
   * longer PENDING — the deduction/totals were deliberately left untouched
   * (financial freeze preserved) even though the letter was still reversed
   * and the DisciplineEvent claim removed. */
  blockedByPayrollStatus: boolean;
  payrollStatus: string | null;
  disciplineEventRemoved: boolean;
};

/**
 * Reverses the MISSING_CHECKOUT-discipline consequences of one exact
 * incident date — byte-for-byte the same structure as
 * reverseLateDisciplineForDate, adapted to the missing-checkout letter/
 * deduction shape (monthlyMissingCheckoutOccurrence instead of
 * monthlyLateOccurrence, DISCIPLINARY_FINE instead of LATE_ARRIVAL). Called
 * whenever an existing AttendanceLog row transitions from missing-checkout
 * (checkIn set, checkOut null) to having a real checkOut, for any reason.
 *
 * Finds the exact ADVICE/WARNING/FINE letter issued for THIS date (matched
 * via Letter.variables.incidentDate AND the presence of
 * monthlyMissingCheckoutOccurrence — the latter is required so this can
 * never pick up an unrelated LATE letter that happens to share the same
 * employee/date/month, mirroring the equivalent guard added to
 * reverseLateDisciplineForDate). FINE: deletes the exact matching 1-day
 * DISCIPLINARY_FINE deduction and restores PayrollEntry.totalDeductions/
 * netStipend, but ONLY when that entry is still PENDING. Any type: the
 * letter is kept but annotated reversed and requiresAcknowledgement is
 * cleared. The date's DisciplineEvent(MISSING_CHECKOUT) claim is DELETED
 * and remaining events in the month are renumbered so a resolved incident
 * no longer counts toward the monthly occurrence sequence.
 *
 * Fully idempotent: a second call for the same date finds no active letter
 * (already annotated reversed) and returns a no-op result.
 *
 * Does not change the missing-checkout policy cadence itself — new
 * consequences are still only ever created by
 * ShiftMissingCheckoutScheduler's own grace-period tick.
 */
export async function reverseMissingCheckoutDisciplineForDate(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<MissingCheckoutReversalResult> {
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dateLabel = dayStart.toISOString().slice(0, 10);
  const { startOfMonth } = pakistanMonthWindowFromDate(date);

  const noOpResult: MissingCheckoutReversalResult = {
    reversed: false,
    letterId: null,
    letterType: null,
    deductionReversed: false,
    deductionAmount: null,
    blockedByPayrollStatus: false,
    payrollStatus: null,
    disciplineEventRemoved: false,
  };

  const candidates = await tx.letter.findMany({
    where: {
      employeeId,
      letterType: {
        in: [LetterType.ADVICE, LetterType.WARNING, LetterType.FINE],
      },
      generatedAt: { gte: startOfMonth },
    },
  });

  const letter = candidates.find((l) => {
    const vars = l.variables as {
      monthlyMissingCheckoutOccurrence?: number;
      incidentDate?: string;
      reversed?: boolean;
    } | null;
    if (vars?.monthlyMissingCheckoutOccurrence == null) return false;
    return vars.incidentDate === dateLabel && !vars.reversed;
  });

  if (!letter) {
    // Idempotent heal: letter already reversed on a prior call but an older
    // reverse path may have left the DisciplineEvent claim behind.
    const reversedForDate = candidates.find((l) => {
      const vars = l.variables as {
        monthlyMissingCheckoutOccurrence?: number;
        incidentDate?: string;
        reversed?: boolean;
      } | null;
      if (vars?.monthlyMissingCheckoutOccurrence == null) return false;
      return vars.incidentDate === dateLabel && vars.reversed === true;
    });
    if (reversedForDate) {
      const deletedEvents = await tx.disciplineEvent.deleteMany({
        where: {
          employeeId,
          category: DisciplineCategory.MISSING_CHECKOUT,
          incidentDate: dayStart,
        },
      });
      if (deletedEvents.count > 0) {
        await renumberMissingCheckoutOccurrencesForMonth(tx, employeeId, date);
      }
      return {
        ...noOpResult,
        disciplineEventRemoved: deletedEvents.count > 0,
      };
    }
    return noOpResult; // no structured link to this exact date — nothing safely reversible
  }

  const vars = letter.variables as {
    monthlyMissingCheckoutOccurrence?: number;
  } | null;
  const occurrence = vars?.monthlyMissingCheckoutOccurrence;

  let deductionReversed = false;
  let deductionAmount: number | null = null;
  let blockedByPayrollStatus = false;
  let payrollStatus: string | null = null;

  if (letter.letterType === LetterType.FINE && occurrence != null) {
    const { month, year } = pakistanYearMonthFromDate(date);
    // Reverse against the segment EFFECTIVE ON the incident date — the
    // same segment the original fine was applied to.
    const stipendRecord = await getStipendRecordEffectiveOn(tx, employeeId, date);

    if (stipendRecord) {
      const payrollEntry = await tx.payrollEntry.findUnique({
        where: {
          stipendRecordId_month_year: {
            stipendRecordId: stipendRecord.id,
            month,
            year,
          },
        },
      });

      if (payrollEntry) {
        payrollStatus = payrollEntry.status;
        const deductionDescription = `Missing checkout deduction — monthly occurrence ${occurrence}`;
        const deduction = await tx.payrollDeduction.findFirst({
          where: {
            payrollEntryId: payrollEntry.id,
            reason: DeductionType.DISCIPLINARY_FINE,
            description: deductionDescription,
          },
        });

        if (deduction) {
          if (isPayrollFinanciallyFrozen(payrollEntry.status)) {
            // Financial freeze — never mutate a PROCESSED/PAID entry.
            blockedByPayrollStatus = true;
          } else {
            await tx.payrollDeduction.delete({ where: { id: deduction.id } });
            await tx.payrollEntry.update({
              where: { id: payrollEntry.id },
              data: {
                totalDeductions: { decrement: deduction.amount },
                netStipend: { increment: deduction.amount },
              },
            });
            deductionReversed = true;
            deductionAmount = Number(deduction.amount);
          }
        }
      }
    }
  }

  await tx.letter.update({
    where: { id: letter.id },
    data: {
      variables: {
        ...((letter.variables as object) ?? {}),
        reversed: true,
        reversedAt: new Date().toISOString(),
        reversalTrigger: 'CHECKOUT_PROVIDED',
        ...(blockedByPayrollStatus
          ? { reversalBlockedByPayrollStatus: true }
          : {}),
      },
      requiresAcknowledgement: false,
    },
  });

  const deletedEvents = await tx.disciplineEvent.deleteMany({
    where: {
      employeeId,
      category: DisciplineCategory.MISSING_CHECKOUT,
      incidentDate: dayStart,
    },
  });

  await renumberMissingCheckoutOccurrencesForMonth(tx, employeeId, date);

  return {
    reversed: true,
    letterId: letter.id,
    letterType: letter.letterType,
    deductionReversed,
    deductionAmount,
    blockedByPayrollStatus,
    payrollStatus,
    disciplineEventRemoved: deletedEvents.count > 0,
  };
}

// ─── CENTRALIZED RECONCILIATION ─────────────────────────────────────────

export type AttendanceConsequenceSnapshot = {
  status: AttendanceStatus;
  lateMinutes: number;
  note?: string | null;
  checkIn?: Date | null;
  checkOut?: Date | null;
};

export type ReconcileAttendanceFinancialConsequencesResult = {
  lateReversal: LateDisciplineReversalResult | null;
  absenceReversal: AbsenceDeductionReversalResult | null;
  missingCheckoutReversal: MissingCheckoutReversalResult | null;
  /** True when a NEW absence-family deduction was actually created this
   * call (family entry: before was not ABSENT_FAMILY, after newly is). */
  deductionApplied: boolean;
  /** True when a deduction attempt (family entry) was skipped because the
   * target PayrollEntry is PROCESSED/PAID. Independent of
   * absenceReversal?.blockedByPayrollStatus, which covers the family-exit
   * (reversal) direction instead. */
  blockedByPayrollStatus: boolean;
  payrollStatus: string | null;
  /** True when a DisciplineEvent(UNINFORMED_ABSENT) was newly claimed this
   * call — either full family entry as UNINFORMED_ABSENT, or an ABSENT ->
   * UNINFORMED_ABSENT subtype promotion (deduction untouched in the
   * latter case — see the subtype-transition branch below). */
  disciplineEventCreated: boolean;
  /** True when a DisciplineEvent(UNINFORMED_ABSENT) was released this call
   * without touching the deduction — either mirrored from
   * absenceReversal?.disciplineEventRemoved (family exit) or a standalone
   * UNINFORMED_ABSENT -> ABSENT subtype demotion. */
  disciplineEventRemoved: boolean;
  /** True only when THIS call is what flipped the employee into SUSPENDED. */
  suspensionTriggered: boolean;
};

/**
 * Single entry point every financially-relevant attendance-mutating call
 * site should use to keep AttendanceLog's corrected state financially
 * authoritative, instead of each call site hand-rolling its own before/after
 * eligibility comparison (which is how the ABSENT-family and missing-
 * checkout gaps were missed for so long — see the read-only audit this
 * change implements).
 *
 * Classifies `before`/`after` along two independent axes and reverses or
 * applies exactly the consequence(s) whose eligibility actually changed:
 *
 *  - STATUS axis (LATE vs ABSENT_FAMILY vs neither) — mutually exclusive,
 *    both derived from the single AttendanceStatus enum value:
 *      LATE eligible -> not eligible:            reverseLateDisciplineForDate
 *      ABSENT_FAMILY eligible -> not eligible:    reverseAbsenceDeductionForDate
 *      not eligible -> ABSENT_FAMILY eligible:    applyAbsentDeduction /
 *                                                  applyUninformedAbsentDeduction
 *                                                  (family entry — deduction +,
 *                                                  for UNINFORMED_ABSENT, full
 *                                                  discipline tracking)
 *      ABSENT_FAMILY -> ABSENT_FAMILY, subtype UNCHANGED (ABSENT -> ABSENT,
 *      UNINFORMED_ABSENT -> UNINFORMED_ABSENT): true no-op — nothing to do.
 *      ABSENT_FAMILY -> ABSENT_FAMILY, subtype CHANGED (ABSENT <->
 *      UNINFORMED_ABSENT): the FINANCIAL deduction is deliberately left
 *        untouched (same 2-day amount either way — reversing and
 *        reapplying would be pure churn and risks the exact double-
 *        deduction this function exists to prevent), but the two subtypes
 *        are NOT discipline-equivalent, so this is a discipline-only
 *        promotion/demotion, not a full no-op:
 *          ABSENT -> UNINFORMED_ABSENT: applyUninformedAbsenceDisciplineTracking
 *            (claims the DisciplineEvent, evaluates the suspension
 *            threshold) WITHOUT calling the deduction path again.
 *          UNINFORMED_ABSENT -> ABSENT: releases the DisciplineEvent(
 *            UNINFORMED_ABSENT) claim for this date. Never touches the
 *            deduction, Employee.status, or User.isActive — there is no
 *            code-defined "un-suspend when reclassified below threshold"
 *            policy (see reverseAbsenceDeductionForDate's doc comment), so
 *            this deliberately does not invent one.
 *      LATE entry (not eligible -> eligible, including `before: null`
 *      creates): applyDisciplineRules. Same transition shape as ABSENT_FAMILY
 *      entry — already-LATE rows that only gain a checkout (or other
 *      non-status edit) must NOT re-enter this branch; re-issuing letters /
 *      PDF inside the attendance transaction was causing 500s on HR
 *      checkout updates. Idempotent via claimDisciplineEvent when a path
 *      still double-dispatches. Pre-write applyDisciplineRules remains
 *      preferred in markManual/biometric where LATE -> HALF_DAY escalation
 *      must happen before the write.
 *
 *  - CHECKOUT axis (missing-checkout vs not) — orthogonal to status, since a
 *    row can be simultaneously late AND missing its checkout:
 *      missing-checkout -> resolved:  reverseMissingCheckoutDisciplineForDate
 *      New missing-checkout consequences are NEVER applied here — that stays
 *      exclusively owned by ShiftMissingCheckoutScheduler's own grace-period
 *      cadence, unchanged.
 *
 * `before: null` means a genuinely new row (nothing existed to compare
 * against) — every reversal branch is skipped, and the ABSENT_FAMILY-apply
 * branch behaves exactly like markManual's pre-existing create-path
 * dispatch (a brand-new row marked ABSENT/UNINFORMED_ABSENT still gets its
 * deduction applied).
 *
 * Idempotent the same way every reversal/apply function in this file already
 * is: `before` is always the value actually read from the database before
 * this correction, so a genuinely separate, later correction re-reads the
 * already-updated state and the transition check correctly no-ops. All
 * underlying calls are themselves safe to retry (claimDisciplineEvent /
 * exact-description-match guards / exact-date Letter matching).
 *
 * Employee/date scoped throughout — every underlying call is keyed by the
 * same (employeeId, date) pair, never touching any other day or employee.
 */
export async function reconcileAttendanceFinancialConsequences(
  tx: Prisma.TransactionClient,
  params: {
    employeeId: string;
    date: Date;
    before: AttendanceConsequenceSnapshot | null;
    after: AttendanceConsequenceSnapshot;
    /** Passed through to applyDisciplineRules for LATE-category letter
     * wording only — ABSENT_FAMILY application ignores it. Harmless to omit
     * for call sites that never reach the ABSENT_FAMILY-apply branch. */
    dutyStartTimeSnapshot?: string | null;
  },
): Promise<ReconcileAttendanceFinancialConsequencesResult> {
  const { employeeId, date, before, after } = params;

  const result: ReconcileAttendanceFinancialConsequencesResult = {
    lateReversal: null,
    absenceReversal: null,
    missingCheckoutReversal: null,
    deductionApplied: false,
    blockedByPayrollStatus: false,
    payrollStatus: null,
    disciplineEventCreated: false,
    disciplineEventRemoved: false,
    suspensionTriggered: false,
  };

  const beforeWasLate = before ? isLateEligibleForDiscipline(before) : false;
  const afterIsLate = isLateEligibleForDiscipline(after);
  const beforeWasAbsentFamily = before
    ? isAbsentFamilyEligibleForDiscipline(before)
    : false;
  const afterIsAbsentFamily = isAbsentFamilyEligibleForDiscipline(after);

  if (beforeWasLate && !afterIsLate) {
    result.lateReversal = await reverseLateDisciplineForDate(
      tx,
      employeeId,
      date,
    );
  } else if (!beforeWasLate && afterIsLate) {
    // Entering LATE only — do not re-apply when the row was already late
    // (e.g. HR adding checkOut on an existing LATE session).
    await applyDisciplineRules(tx, employeeId, after.status, date, {
      lateMinutes: after.lateMinutes,
      dutyStartTimeSnapshot: params.dutyStartTimeSnapshot ?? null,
    });
  }

  if (beforeWasAbsentFamily && !afterIsAbsentFamily) {
    // Family EXIT — full reversal (deduction + DisciplineEvent, PENDING-gated).
    result.absenceReversal = await reverseAbsenceDeductionForDate(
      tx,
      employeeId,
      date,
    );
    result.disciplineEventRemoved = result.absenceReversal.disciplineEventRemoved;
  } else if (!beforeWasAbsentFamily && afterIsAbsentFamily) {
    // Family ENTRY — full application (deduction, PENDING-gated; for
    // UNINFORMED_ABSENT also the discipline tracking).
    if (after.status === AttendanceStatus.UNINFORMED_ABSENT) {
      const applied = await applyUninformedAbsentDeduction(
        tx,
        employeeId,
        date,
      );
      result.deductionApplied = applied.deductionApplied;
      result.blockedByPayrollStatus = applied.blockedByPayrollStatus;
      result.payrollStatus = applied.payrollStatus;
      result.disciplineEventCreated = applied.disciplineEventCreated;
      result.suspensionTriggered = applied.suspensionTriggered;
    } else {
      const applied = await applyAbsentDeduction(tx, employeeId, date);
      result.deductionApplied = applied.deductionApplied;
      result.blockedByPayrollStatus = applied.blockedByPayrollStatus;
      result.payrollStatus = applied.payrollStatus;
    }
  } else if (
    beforeWasAbsentFamily &&
    afterIsAbsentFamily &&
    before!.status !== after.status
  ) {
    // Same financial family, DIFFERENT subtype (ABSENT <-> UNINFORMED_ABSENT)
    // — discipline-only promotion/demotion. The deduction is intentionally
    // never touched here (same 2-day amount either way), see doc comment.
    if (after.status === AttendanceStatus.UNINFORMED_ABSENT) {
      const tracking = await applyUninformedAbsenceDisciplineTracking(
        tx,
        employeeId,
        date,
      );
      result.disciplineEventCreated = tracking.disciplineEventCreated;
      result.suspensionTriggered = tracking.suspensionTriggered;
    } else {
      const dayStart = new Date(date);
      dayStart.setUTCHours(0, 0, 0, 0);
      const deletedEvents = await tx.disciplineEvent.deleteMany({
        where: {
          employeeId,
          category: DisciplineCategory.UNINFORMED_ABSENT,
          incidentDate: dayStart,
        },
      });
      result.disciplineEventRemoved = deletedEvents.count > 0;
    }
  }
  // beforeWasAbsentFamily && afterIsAbsentFamily && before.status ===
  // after.status: true no-op — the row didn't actually change category or
  // subtype (e.g. an unrelated field-only re-save).

  const beforeWasHalfDay = before
    ? isHalfDayPayDeductionEligible(before)
    : false;
  const afterIsHalfDay = isHalfDayPayDeductionEligible(after);

  if (beforeWasHalfDay && !afterIsHalfDay) {
    await reverseHalfDayDeductionForDate(tx, employeeId, date);
  } else if (!beforeWasHalfDay && afterIsHalfDay) {
    const applied = await applyHalfDayDeduction(tx, employeeId, date);
    result.deductionApplied = result.deductionApplied || applied.deductionApplied;
    result.blockedByPayrollStatus =
      result.blockedByPayrollStatus || applied.blockedByPayrollStatus;
    result.payrollStatus = applied.payrollStatus ?? result.payrollStatus;
  }

  const beforeWasMissingCheckout = before
    ? isMissingCheckoutEligibleForDiscipline(before)
    : false;
  const afterIsMissingCheckout = isMissingCheckoutEligibleForDiscipline(after);

  if (beforeWasMissingCheckout && !afterIsMissingCheckout) {
    result.missingCheckoutReversal =
      await reverseMissingCheckoutDisciplineForDate(tx, employeeId, date);
  }

  return result;
}

// ─── QUOTA-EXCEEDED LEAVE REJECTION (leave.service.ts decideQuotaException) ─

/**
 * One-day salary deduction for a quota-exceeded Full Leave HR rejected.
 * Rate is the same calendar-day daily rate used by every deduction in this
 * file (dailyStipendRate — monthly basic / actual days in that payroll
 * month, never a hardcoded /30). Idempotent via an exact incident-linked
 * description, mirroring applyAbsentDeduction. Uses a dedicated
 * DeductionType (EXTRA_LEAVE_REJECTED) rather than UNPAID_LEAVE, which is
 * matched by reason alone elsewhere and recomputed as a monthly aggregate —
 * sharing it here would risk that logic silently overwriting or deleting
 * this exact deduction.
 *
 * Skips entirely (no deduction applied) if the target payroll entry is
 * already PROCESSED or PAID — preserving the existing freeze on finalized
 * payroll rather than mutating it after the fact. A quota-exception
 * decision made this late needs a manual payroll adjustment instead.
 */
export async function applyExtraLeaveRejectedDeduction(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<{ applied: boolean; reason?: string }> {
  const basicStipend = await getBasicStipend(tx, employeeId, date);
  if (basicStipend <= 0) {
    return { applied: false, reason: 'no active stipend record' };
  }

  const deductionAmount = dailyStipendRate(basicStipend, date);
  const dateLabel = date.toISOString().slice(0, 10);
  const description = `Extra Full Leave rejected — 1-day deduction — ${dateLabel}`;
  const payrollEntry = await getOrCreatePayrollEntry(tx, employeeId, date);
  if (!payrollEntry) {
    return { applied: false, reason: 'no payroll entry' };
  }

  if (isPayrollFinanciallyFrozen(payrollEntry.status)) {
    return { applied: false, reason: 'payroll entry is PROCESSED/PAID' };
  }

  const alreadyDeducted = await tx.payrollDeduction.findFirst({
    where: {
      payrollEntryId: payrollEntry.id,
      reason: DeductionType.EXTRA_LEAVE_REJECTED,
      description,
    },
  });
  if (alreadyDeducted) return { applied: true };

  await tx.payrollDeduction.create({
    data: {
      payrollEntryId: payrollEntry.id,
      reason: DeductionType.EXTRA_LEAVE_REJECTED,
      amount: deductionAmount,
      description,
    },
  });

  await tx.payrollEntry.update({
    where: { id: payrollEntry.id },
    data: {
      totalDeductions: { increment: deductionAmount },
      netStipend: { decrement: deductionAmount },
    },
  });

  await tx.notification.create({
    data: {
      employeeId,
      message:
        'Your extra leave request (beyond monthly entitlement) was rejected — a one-day stipend deduction has been applied.',
      type: 'EXTRA_LEAVE_REJECTED_DEDUCTION',
    },
  });

  return { applied: true };
}

export type RepairLateDisciplineResult = {
  /** Days that had no LATE claim and were freshly disciplined. */
  applied: number;
  /** Days with a stale/wrong claim that were reversed and re-disciplined. */
  repaired: number;
  /** Days already correct, or left untouched (e.g. SUSPENSION). */
  skipped: number;
};

/**
 * Ensures every late-eligible REGULAR day in a Pakistan calendar month has
 * the correct LATE discipline claim, letters, and (PENDING payroll) fines.
 *
 * Processes days in calendar order so occurrence numbers (3rd/6th fine,
 * 9th suspension) match the live check-in path. Safe to call repeatedly:
 * correct days no-op; missing days are filled; wrong claims (e.g. legacy
 * bulk import that skipped discipline, or a bad one-off backfill) are
 * reversed and re-applied.
 *
 * Only mutates payroll when the target month's entry is still PENDING —
 * the same freeze every other discipline mutation respects.
 */
export async function repairLateDisciplineForPayrollMonth(
  tx: Prisma.TransactionClient,
  employeeId: string,
  month: number,
  year: number,
): Promise<RepairLateDisciplineResult> {
  const { start, end } = pakistanMonthDateRange(year, month);

  const logs = await tx.attendanceLog.findMany({
    where: {
      employeeId,
      type: AttendanceLogType.REGULAR,
      date: { gte: start, lte: end },
    },
    orderBy: { date: 'asc' },
    select: {
      date: true,
      status: true,
      lateMinutes: true,
      note: true,
      dutyStartTimeSnapshot: true,
    },
  });

  const lateLogs = logs.filter((row) => isLateEligibleForDiscipline(row));
  const result: RepairLateDisciplineResult = {
    applied: 0,
    repaired: 0,
    skipped: 0,
  };

  for (let i = 0; i < lateLogs.length; i++) {
    const log = lateLogs[i];
    const expectedOccurrence = i + 1;
    const dayStart = new Date(log.date);
    dayStart.setUTCHours(0, 0, 0, 0);

    const event = await tx.disciplineEvent.findFirst({
      where: {
        employeeId,
        category: DisciplineCategory.LATE,
        incidentDate: dayStart,
      },
    });

    if (event?.occurrence === expectedOccurrence) {
      result.skipped++;
      continue;
    }

    if (event) {
      const reversal = await reverseLateDisciplineForDate(
        tx,
        employeeId,
        log.date,
      );
      if (reversal.letterType === LetterType.SUSPENSION) {
        result.skipped++;
        continue;
      }
      result.repaired++;
    } else {
      result.applied++;
    }

    await applyDisciplineRules(tx, employeeId, log.status, log.date, {
      lateMinutes: log.lateMinutes,
      dutyStartTimeSnapshot: log.dutyStartTimeSnapshot,
      // Payroll generate must repair fines/events without blasting a month
      // of Advice/Warning/Fine letters all dated "today".
      skipLetters: true,
    });
  }

  return result;
}
