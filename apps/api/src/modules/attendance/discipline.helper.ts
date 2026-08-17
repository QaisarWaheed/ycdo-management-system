import {
  AttendanceLogType,
  AttendanceStatus,
  DeductionType,
  EmployeeStatus,
  LeaveStatus,
  LetterType,
  Prisma,
} from '@prisma/client';
import {
  dailyStipendRate,
  stipendRecordToPackage,
} from '../../common/stipend.util';
import { issueAutoTemplatedLetter } from '../letters/auto-letter.helper';
import {
  parseTimeToMinutes,
  toPakistanMinutesOfDay,
} from './attendance-late.util';

export type DisciplineOptions = {
  lateMinutes?: number;
};

export async function applyDisciplineRules(
  tx: Prisma.TransactionClient,
  employeeId: string,
  status: AttendanceStatus,
  date: Date,
  options: DisciplineOptions = {},
): Promise<AttendanceStatus> {
  const lateMinutes = options.lateMinutes ?? 0;

  // Late > 1 hour is recorded as HALF_DAY for attendance display only.
  // Pay is reduced naturally by unpaid hours; cash penalties apply only at
  // the monthly-cycle 3rd/6th occurrence (Fine) or 9th (Suspension) via
  // applyLateDiscipline.
  if (status === AttendanceStatus.LATE && lateMinutes > 60) {
    await applyLateDiscipline(tx, employeeId, date, lateMinutes);
    return AttendanceStatus.HALF_DAY;
  }

  // Manual/HR attendance entry can compute HALF_DAY directly from lateMinutes
  // (statusFromLateMinutes) without ever passing through LATE first — route
  // it through the exact same monthly late-occurrence counting as the
  // biometric path, so the same lateness is disciplined identically
  // regardless of which of the three live entry paths recorded it. A
  // HALF_DAY caused by Short Leave never reaches this function at all (the
  // leave module writes that status directly, bypassing discipline), so no
  // extra guard is needed here to keep the two cases apart.
  if (status === AttendanceStatus.HALF_DAY && lateMinutes > 0) {
    await applyLateDiscipline(tx, employeeId, date, lateMinutes);
    return status;
  }

  if (status === AttendanceStatus.ABSENT) {
    await applyAbsentDeduction(tx, employeeId, date);
    return status;
  }

  if (status === AttendanceStatus.LATE) {
    await applyLateDiscipline(tx, employeeId, date, lateMinutes);
    return status;
  }

  if (status === AttendanceStatus.UNINFORMED_ABSENT) {
    await applyUninformedAbsentDeduction(tx, employeeId, date);
    return status;
  }

  return status;
}

async function getBasicStipend(
  tx: Prisma.TransactionClient,
  employeeId: string,
): Promise<number> {
  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    include: {
      stipendRecords: {
        where: { effectiveTo: null },
        take: 1,
      },
    },
  });

  return Number(employee?.stipendRecords[0]?.basicStipend ?? 0);
}

async function applyAbsentDeduction(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<void> {
  const approvedLeave = await tx.leaveRecord.findFirst({
    where: {
      employeeId,
      status: LeaveStatus.APPROVED,
      startDate: { lte: date },
      endDate: { gte: date },
    },
  });

  if (approvedLeave) return;

  const basicStipend = await getBasicStipend(tx, employeeId);
  if (basicStipend <= 0) return;

  const deductionAmount = dailyStipendRate(basicStipend, date) * 2;
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const payrollEntry = await getOrCreatePayrollEntry(
    tx,
    employeeId,
    month,
    year,
  );

  await tx.payrollDeduction.create({
    data: {
      payrollEntryId: payrollEntry.id,
      reason: DeductionType.UNINFORMED_ABSENCE,
      amount: deductionAmount,
      // Date suffix lets a later leave approval over this exact day find
      // and reverse this exact deduction (see reverseAbsenceDeductionForDate)
      // without risking matching a different day's identically-worded row.
      description: `Absent without approved leave (2 days stipend) — ${date.toISOString().slice(0, 10)}`,
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
): Promise<void> {
  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    include: {
      stipendRecords: { where: { effectiveTo: null }, take: 1 },
    },
  });
  const basicStipend = Number(employee?.stipendRecords[0]?.basicStipend ?? 0);
  const dutyStartTime = employee?.dutyStartTime ?? null;

  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);

  // Count LATE and late-driven HALF_DAY days. Short-leave HALF_DAY is excluded.
  // Include the current day even if the log has not been written yet.
  const priorLateDays = await tx.attendanceLog.findMany({
    where: {
      employeeId,
      date: { gte: startOfMonth, lte: endOfMonth },
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

  const dateLabel = dayStart.toISOString().slice(0, 10);
  const checkInLabel = deriveCheckInLabel(dutyStartTime, todayLateMinutes);
  const dutyStartLabel = dutyStartTime ?? 'نامعلوم';
  const baseDetail = `تاریخ: ${dateLabel}، ڈیوٹی کا مقررہ وقت: ${dutyStartLabel}، حاضری کا اصل وقت: ${checkInLabel}، تاخیر: ${todayLateMinutes} منٹ۔`;

  const positionInCycle = ((lateCount - 1) % 3) + 1; // 1, 2, or 3

  if (positionInCycle === 1) {
    // 1st / 4th / 7th this month -> Advice, no deduction.
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
    return;
  }

  if (positionInCycle === 2) {
    // 2nd / 5th / 8th this month -> Warning, no deduction.
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
    return;
  }

  // positionInCycle === 3 -> 3rd / 6th / 9th this month.
  if (lateCount === 9) {
    // Suspension only — no additional one-day deduction at the 9th.
    // Idempotency check comes first and gates BOTH the letter and the
    // employee-status/login side effects together, so a replay that finds
    // this exact occurrence already handled changes nothing (does not
    // silently re-suspend an employee HR may have since reinstated).
    const alreadyHandled = await hasLetterForMonthlyOccurrence(
      tx,
      employeeId,
      LetterType.SUSPENSION,
      lateCount,
      date,
    );
    if (alreadyHandled) return;

    await issueLateLetterIfNotAlready(
      tx,
      employeeId,
      LetterType.SUSPENSION,
      lateCount,
      date,
      {
        suspensionReason: `اس ماہ ${lateCount} مرتبہ لیٹ آمد کی بنا پر معطلی۔ ${baseDetail}`,
        suspensionStartDate: dateLabel,
        suspensionDuration: 'Pending HR review',
      },
    );

    await tx.employee.update({
      where: { id: employeeId },
      data: { status: EmployeeStatus.SUSPENDED },
    });
    await tx.user.updateMany({
      where: { employeeId },
      data: { isActive: false },
    });
    return;
  }

  // 3rd or 6th this month -> Fine letter + 1-day deduction.
  const deductionAmount = dailyStipendRate(basicStipend, date);
  const monthLabel = date.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  // Exact-match description, not a `contains` substring check — a fragile
  // `contains "${lateCount} late"` match could in principle collide across
  // different occurrence counts; an exact string cannot.
  const deductionDescription = `Late arrival deduction — monthly occurrence ${lateCount}`;

  if (basicStipend > 0) {
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const payrollEntry = await getOrCreatePayrollEntry(
      tx,
      employeeId,
      month,
      year,
    );

    const alreadyDeducted = await tx.payrollDeduction.findFirst({
      where: {
        payrollEntryId: payrollEntry.id,
        reason: DeductionType.LATE_ARRIVAL,
        description: deductionDescription,
      },
    });

    if (!alreadyDeducted) {
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
  }

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

async function applyUninformedAbsentDeduction(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<void> {
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const dayKey = date.toISOString().slice(0, 10);

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

  const basicStipend = await getBasicStipend(tx, employeeId);
  if (basicStipend > 0) {
    const deductionAmount = dailyStipendRate(basicStipend, date) * 2;
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const payrollEntry = await getOrCreatePayrollEntry(
      tx,
      employeeId,
      month,
      year,
    );

    await tx.payrollDeduction.create({
      data: {
        payrollEntryId: payrollEntry.id,
        reason: DeductionType.UNINFORMED_ABSENCE,
        amount: deductionAmount,
        // Date suffix lets a later leave approval over this exact day find
        // and reverse this exact deduction (see reverseAbsenceDeductionForDate)
        // without risking matching a different day's identically-worded row.
        description: `Uninformed absence deduction (2 days) — ${dayKey}`,
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

  // More than 2 uninformed-absent days in a month → automatic suspension.
  if (uninformedCount > 2) {
    const employee = await tx.employee.findUnique({
      where: { id: employeeId },
      select: { status: true },
    });

    if (employee?.status !== EmployeeStatus.SUSPENDED) {
      await tx.employee.update({
        where: { id: employeeId },
        data: { status: EmployeeStatus.SUSPENDED },
      });
      await tx.user.updateMany({
        where: { employeeId },
        data: { isActive: false },
      });

      const reason = `اس ماہ ${uninformedCount} دن بغیر اطلاع غیر حاضری (2 دن سے زیادہ) — خودکار معطلی۔`;
      await issueAutoTemplatedLetter(tx, {
        employeeId,
        letterType: LetterType.SUSPENSION,
        extraFields: {
          suspensionReason: reason,
          suspensionStartDate: dayKey,
          suspensionDuration: 'Pending HR review',
          violations: reason,
        },
        requiresAcknowledgement: true,
        replyDeadline: null,
        notificationMessage: `You have been suspended due to ${uninformedCount} uninformed absence day(s) this month (more than 2 days). Please contact HR.`,
        notificationType: 'SUSPENSION_ISSUED',
      });
    }
  }
}

async function getOrCreatePayrollEntry(
  tx: Prisma.TransactionClient,
  employeeId: string,
  month: number,
  year: number,
) {
  const stipendRecord = await tx.stipendRecord.findFirst({
    where: { employeeId, effectiveTo: null },
    orderBy: { effectiveFrom: 'desc' },
  });

  if (!stipendRecord) {
    throw new Error(`No active stipend record for employee ${employeeId}`);
  }

  const existing = await tx.payrollEntry.findUnique({
    where: {
      stipendRecordId_month_year: {
        stipendRecordId: stipendRecord.id,
        month,
        year,
      },
    },
  });

  if (existing) {
    return existing;
  }

  const pkg = stipendRecordToPackage(stipendRecord);
  const fixedAllowances =
    (pkg.allowances || 0) +
    (pkg.reward || 0) +
    (pkg.progressReward || 0) +
    (pkg.fuelAllowance || 0);
  const fixedDeductions =
    (pkg.loanDeduction || 0) +
    (pkg.advanceDeduction || 0) +
    (pkg.fineDeduction || 0) +
    (pkg.healthDeduction || 0);

  return tx.payrollEntry.create({
    data: {
      stipendRecordId: stipendRecord.id,
      month,
      year,
      // Placeholder until hourly recalculation runs for the pending entry.
      basicStipend: pkg.basicStipend,
      totalAllowances: fixedAllowances,
      totalDeductions: fixedDeductions,
      netStipend: pkg.lumpsumTotal,
      status: 'PENDING',
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
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
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
    } | null;
    if (vars?.monthlyLateOccurrence !== lateCount) return false;
    if (vars?.incidentDate != null) {
      return vars.incidentDate === dateLabel;
    }
    return true;
  });
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

  const notif =
    LATE_LETTER_NOTIFICATION[
      letterType as 'ADVICE' | 'WARNING' | 'FINE' | 'SUSPENSION'
    ];

  await issueAutoTemplatedLetter(tx, {
    employeeId,
    letterType,
    extraFields: { ...extraFields, monthlyLateOccurrence: lateCount },
    requiresAcknowledgement: true,
    replyDeadline:
      letterType === LetterType.SUSPENSION
        ? null
        : new Date(Date.now() + 48 * 60 * 60 * 1000),
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
 * Monthly missing-checkout cycle: 1/4/7 -> Advice, 2/5/8 -> Warning,
 * 3/6/9 -> Fine + 1-day deduction. No suspension step ever — the 3-step
 * cycle just keeps repeating. Counted entirely separately from lateness:
 * this only looks at AttendanceLog rows with checkIn set and checkOut still
 * null (never LATE/HALF_DAY/UNINFORMED_ABSENT status), and dedupes via a
 * distinct Letter.variables key (monthlyMissingCheckoutOccurrence) so it
 * cannot collide with applyLateDiscipline's monthlyLateOccurrence even
 * though both cycles reuse the same LetterType values (ADVICE/WARNING/FINE)
 * and may issue letters for the same employee in the same month.
 */
export async function applyMissingCheckoutDiscipline(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
  options: MissingCheckoutOptions,
): Promise<void> {
  const basicStipend = await getBasicStipend(tx, employeeId);

  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const dayKey = date.toISOString().slice(0, 10);

  // Missing-checkout days this month, derived fresh from AttendanceLog every
  // run (no in-memory/stored counter). A day whose checkout later gets
  // filled in (HR edit / recalculation) naturally drops out of this count
  // on the next evaluation — mirrors the same derived-count approach used
  // by applyLateDiscipline/applyUninformedAbsentDeduction above.
  const openDays = await tx.attendanceLog.findMany({
    where: {
      employeeId,
      type: AttendanceLogType.REGULAR,
      date: { gte: startOfMonth, lte: endOfMonth },
      checkIn: { not: null },
      checkOut: null,
    },
    select: { date: true },
  });

  const uniqueDays = new Set(
    openDays.map((row) => row.date.toISOString().slice(0, 10)),
  );
  uniqueDays.add(dayKey);
  const missingCount = uniqueDays.size;

  const checkInLabel = formatMinutesAsHHmm(
    toPakistanMinutesOfDay(options.checkIn),
  );
  const expectedCheckoutLabel = options.dutyEndTime ?? 'نامعلوم';
  const baseDetail = `تاریخ: ${dayKey}، حاضری کا وقت: ${checkInLabel}، متوقع چیک آؤٹ کا وقت: ${expectedCheckoutLabel}۔ ڈیوٹی مکمل ہونے کے باوجود چیک آؤٹ نہیں کیا گیا، جو کہ ہر ملازم کی ذمہ داری ہے۔`;

  const positionInCycle = ((missingCount - 1) % 3) + 1; // 1, 2, or 3

  if (positionInCycle === 1) {
    await issueMissingCheckoutLetterIfNotAlready(
      tx,
      employeeId,
      LetterType.ADVICE,
      missingCount,
      date,
      {
        violations: `اس ماہ چیک آؤٹ نہ کرنے کی ${missingCount} ویں خلاف ورزی۔ ${baseDetail} آئندہ ڈیوٹی مکمل ہونے پر چیک آؤٹ یقینی بنائیں۔`,
        incidentDate: dayKey,
      },
    );
    return;
  }

  if (positionInCycle === 2) {
    await issueMissingCheckoutLetterIfNotAlready(
      tx,
      employeeId,
      LetterType.WARNING,
      missingCount,
      date,
      {
        violations: `اس ماہ چیک آؤٹ نہ کرنے کی ${missingCount} ویں خلاف ورزی (اس ماہ کی دوسری تنبیہ)۔ ${baseDetail}`,
        incidentDate: dayKey,
      },
    );
    return;
  }

  // positionInCycle === 3 -> 3rd / 6th / 9th ... this month: Fine + 1-day
  // deduction, then the cycle resets. No suspension at any point.
  const deductionAmount = dailyStipendRate(basicStipend, date);
  const monthLabel = date.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  // Distinct reason (DISCIPLINARY_FINE, unused elsewhere) + exact-match
  // description — cannot collide with applyLateDiscipline's LATE_ARRIVAL
  // deduction even for the same employee/month.
  const deductionDescription = `Missing checkout deduction — monthly occurrence ${missingCount}`;

  if (basicStipend > 0) {
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const payrollEntry = await getOrCreatePayrollEntry(
      tx,
      employeeId,
      month,
      year,
    );

    const alreadyDeducted = await tx.payrollDeduction.findFirst({
      where: {
        payrollEntryId: payrollEntry.id,
        reason: DeductionType.DISCIPLINARY_FINE,
        description: deductionDescription,
      },
    });

    if (!alreadyDeducted) {
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
  }

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
    },
  );
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
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
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
      monthlyMissingCheckoutOccurrence?: number;
    } | null;
    return vars?.monthlyMissingCheckoutOccurrence === missingCount;
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
    requiresAcknowledgement: true,
    replyDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000),
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
 * When a lateness-driven LATE/HALF_DAY day is corrected to SHORT_LEAVE,
 * find the exact ADVICE/WARNING/FINE letter that was issued for THIS date
 * (matched via Letter.variables.incidentDate — a structured field already
 * populated for ADVICE/WARNING, and now for FINE too, see applyLateDiscipline
 * above) and reverse its consequences:
 *  - FINE: delete the exact matching 1-day LATE_ARRIVAL deduction for that
 *    month (identified via the same monthlyLateOccurrence number the letter
 *    itself carries — the deduction and letter were created from the same
 *    lateCount value in the same applyLateDiscipline call, so they always
 *    agree).
 *  - Any type: the letter itself is kept (never deleted — it's a real
 *    historical record, may already be portal-visible/acknowledged) but is
 *    annotated as reversed in its `variables` JSON so it's no longer
 *    findable as "still active" by a future reversal attempt.
 *
 * Does NOT attempt to renumber or reissue consequences for any OTHER date's
 * already-issued letters — see Phase 2 report for why that is out of scope
 * for a safe, deterministic, idempotent change.
 */
export async function reverseLateDisciplineForDate(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<void> {
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dateLabel = dayStart.toISOString().slice(0, 10);
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);

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
    } | null;
    return vars?.incidentDate === dateLabel && !vars?.reversedDueToShortLeave;
  });

  if (!letter) return; // no structured link to this exact date — nothing safely reversible

  const vars = letter.variables as {
    monthlyLateOccurrence?: number;
  } | null;
  const occurrence = vars?.monthlyLateOccurrence;

  if (letter.letterType === LetterType.FINE && occurrence != null) {
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const stipendRecord = await tx.stipendRecord.findFirst({
      where: { employeeId, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
    });

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
        const deductionDescription = `Late arrival deduction — monthly occurrence ${occurrence}`;
        const deduction = await tx.payrollDeduction.findFirst({
          where: {
            payrollEntryId: payrollEntry.id,
            reason: DeductionType.LATE_ARRIVAL,
            description: deductionDescription,
          },
        });

        if (deduction) {
          await tx.payrollDeduction.delete({ where: { id: deduction.id } });
          await tx.payrollEntry.update({
            where: { id: payrollEntry.id },
            data: {
              totalDeductions: { decrement: deduction.amount },
              netStipend: { increment: deduction.amount },
            },
          });
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
      },
    },
  });
}

/**
 * When a day previously auto-marked ABSENT/UNINFORMED_ABSENT is corrected to
 * ON_LEAVE via a later leave approval, find and reverse the exact 2-day
 * absence deduction created for THIS date (matched via the date suffix now
 * embedded in the deduction's description — see applyAbsentDeduction /
 * applyUninformedAbsentDeduction above). Deductions created before this date
 * suffix existed have no exact link and are intentionally left untouched —
 * HR must reverse those manually.
 */
export async function reverseAbsenceDeductionForDate(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
): Promise<void> {
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dateLabel = dayStart.toISOString().slice(0, 10);
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  const stipendRecord = await tx.stipendRecord.findFirst({
    where: { employeeId, effectiveTo: null },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!stipendRecord) return;

  const payrollEntry = await tx.payrollEntry.findUnique({
    where: {
      stipendRecordId_month_year: {
        stipendRecordId: stipendRecord.id,
        month,
        year,
      },
    },
  });
  if (!payrollEntry) return;

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

  if (!deduction) return;

  await tx.payrollDeduction.delete({ where: { id: deduction.id } });
  await tx.payrollEntry.update({
    where: { id: payrollEntry.id },
    data: {
      totalDeductions: { decrement: deduction.amount },
      netStipend: { increment: deduction.amount },
    },
  });
}
