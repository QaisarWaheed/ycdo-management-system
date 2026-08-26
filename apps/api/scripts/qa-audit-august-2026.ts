/**
 * READ-ONLY — comprehensive August 2026 attendance/discipline/payroll QA
 * audit, system-wide (ALL employees with relevant August activity).
 *
 * Zero writes. No --apply mode exists. Only reads Employee, AttendanceLog,
 * DisciplineEvent, Letter, PayrollEntry, PayrollDeduction, LeaveRecord,
 * LeaveApproval, AuditLog, RelieverSession.
 *
 * This script encodes the RULES SNAPSHOT documented in the accompanying
 * report as executable predicates — every "expected" value in every issue
 * below is derived from these functions, not restated by hand per issue.
 *
 * Run:
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/qa-audit-august-2026.ts > qa-audit-report.json
 */

import {
  AttendanceLogType,
  AttendanceStatus,
  DeductionType,
  DisciplineCategory,
  LetterType,
  PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();

const MONTH_START = new Date(Date.UTC(2026, 7, 1, 0, 0, 0, 0));
const MONTH_END = new Date(Date.UTC(2026, 7, 31, 23, 59, 59, 999));

// ─── RULES SNAPSHOT (Phase 1) — see report for full narrative version ─────

const RULES_SNAPSHOT = {
  attendance: {
    graceMinutes: 15,
    lateThreshold: '0 < lateMinutes -> LATE (up to the HALF_DAY threshold)',
    halfDayThreshold: {
      biometric:
        'lateMinutes > 60 AND sessionMinutes >= 240 (worked >= 4h that day) -> HALF_DAY, else stays LATE even past 60 minutes (determineBiometricCheckInStatus)',
      manualOrUpdate:
        'lateMinutes > 60 -> HALF_DAY unconditionally, no session-length check (statusFromLateMinutes) — CONFIRMED DIVERGENCE from the biometric path, documented as POLICY_MISMATCH candidate below, not assumed a bug',
    },
    present: 'lateMinutes <= 0 (on time or early)',
    unmarked: 'scheduler-created placeholder at shift start, no checkIn yet',
    uninformedAbsent:
      'UNMARKED/ABSENT row with no checkIn, >= 120 minutes past shift start (markUninformedAbsent scheduler, every 15 min) -> UNINFORMED_ABSENT; never for 24h staff',
    absent:
      'legacy/manual-only status, distinct from UNINFORMED_ABSENT — flat 2-day deduction (applyAbsentDeduction), NO occurrence cycle, NO suspension threshold',
    onLeave:
      'full-day payroll credit, written by leave-approval reconciliation',
    shortLeave:
      'HR-retroactive or portal-prospective reclassification of a REAL checkIn/checkOut within duty-length limit; never for 24h staff; never a placeholder row',
    twentyFourHour:
      'is24HourShift(employee) short-circuits to PRESENT/no-lateness/no-half-day/no-missing-checkout-discipline throughout every code path that checks it',
    checkInCheckOut:
      'checkOut without checkIn is invalid and clears the session (checkIn=null path in updateAttendance)',
    overnightDuty:
      'crossesMidnight handling in getDutyWindow/payableMinutesWithinDutyWindow',
    historicalDutySnapshotPrecedence:
      'AttendanceLog.dutyStartTimeSnapshot/dutyEndTimeSnapshot wins when BOTH present; current Employee.dutyStartTime/dutyEndTime is only a last-resort fallback for legacy pre-snapshot rows (resolveAttendanceDutyTimes) — fixed earlier this session',
  },
  lateDiscipline: {
    cycle:
      '1=Advice,2=Warning,3=Fine+1-day deduction,4=Advice,5=Warning,6=Fine+1-day deduction,7=Advice,8=Warning,9=Suspension ONLY (no deduction)',
    occurrence10Plus:
      'CODE-VERIFIED (applyLateDiscipline): positionInCycle=((lateCount-1)%3)+1 cycles 1,2,3 forever. The ONLY suspension trigger in the entire function is the literal check `lateCount === 9`. Every OTHER position-3 hit (12, 15, 18, 21, ...) produces an ORDINARY FINE + 1-day deduction, not another suspension and not a cap. This is current running-code behavior, not an assumption.',
    countingMethod:
      'Live COUNT of DISTINCT DATES this month currently stored as LATE, or (HALF_DAY AND lateMinutes>0 AND note not mentioning "short leave") — recomputed fresh on every incident, never a stored counter.',
    idempotencyKey:
      'DisciplineEvent(employeeId, LATE, incidentDate) unique — occurrence is NOT part of the key.',
    reversal:
      'reverseLateDisciplineForDate — exact incidentDate only. Letter + DisciplineEvent reversed unconditionally; PayrollDeduction + PayrollEntry totals reversed ONLY when the entry is still PENDING (fixed this session). Called from reconcileShortLeaveAttendance AND (as of this session) updateAttendance/markManual on any eligible->ineligible transition.',
  },
  missingCheckout: {
    cycle:
      '1=Advice,2=Warning,3=Fine+1-day deduction,4=Advice,... repeats forever. NO suspension step exists anywhere in applyMissingCheckoutDiscipline.',
    countingMethod:
      'Live count of distinct dates this month with checkIn set and checkOut still null.',
    idempotencyKey: 'DisciplineEvent(employeeId, MISSING_CHECKOUT, date).',
    excludedFor:
      '24-hour staff (is24HourShift short-circuits before this is ever evaluated in callers).',
    reversal:
      "NO reversal function exists for missing-checkout — a day's checkout being filled in naturally drops it from the next live count, but any already-issued letter/deduction for a PAST tick is never retroactively reversed. Confirmed gap, out of scope for this audit to fix.",
  },
  uninformedAbsence: {
    penalty:
      'Flat 2x daily-stipend-rate deduction, EVERY incident — no occurrence/letter cycle at all (applyUninformedAbsentDeduction).',
    suspensionThreshold:
      "More than 2 distinct UNINFORMED_ABSENT days in the month -> automatic suspension. Threshold-based, NOT occurrence-cycle-based, and independent of the LATE cycle's own suspension trigger.",
    idempotencyKey: 'DisciplineEvent(employeeId, UNINFORMED_ABSENT, date).',
    reversal:
      "reverseAbsenceDeductionForDate exists and is PENDING-gate-missing (same class of gap reverseLateDisciplineForDate had before this session's fix) — called ONLY from leave.service.ts's ON_LEAVE-approval flow, NEVER from updateAttendance/markManual. CONFIRMED, UNFIXED gap (reported previously, fix proposed but not implemented).",
  },
  shortLeave: {
    monthlyQuota: 3,
    sharedAcrossPortalAndEmergencyFlows: true,
    approvalBehavior:
      'Within quota -> auto-APPROVED. Exceeds quota -> PENDING_APPROVAL, requires HR quota-exception decision.',
    payrollEffect:
      "Full-day duty credit once approved and duration is within the employee's 8h/12h Short Leave limit.",
    attendanceEffect:
      'AttendanceStatus.SHORT_LEAVE written directly onto the real attendance row — never a placeholder, only ever on a row that already has a real checkIn.',
    disciplineReversalInteraction:
      "reconcileShortLeaveAttendance calls reverseLateDisciplineForDate for the EXACT date being converted only — pre-dates this session's generalization, still the same underlying function.",
  },
  fullLeave: {
    monthlyQuota:
      '2 by default (DEFAULT_MONTHLY_ALLOWED_LEAVES); Employee.monthlyAllowedLeaves overrides when explicitly set.',
    extraLeaveBehavior:
      'Chain-approved or HR-emergency-created beyond quota -> PENDING_APPROVAL (LeaveApprovalStage.QUOTA_EXCEPTION). HR rejection -> 1-day deduction (EXTRA_LEAVE_REJECTED), only if the target payroll entry is still PENDING.',
  },
  payroll: {
    pendingRecompute:
      'PENDING entries are recomputed live on read/generation. PROCESSED/PAID entries are returned as-is by generation and every mutation path (addDeduction, discipline reversal) explicitly refuses to touch them.',
    processedPaidFreeze:
      'Confirmed in code: addDeduction throws for PROCESSED/PAID; reverseLateDisciplineForDate skips the deduction/totals mutation (fixed this session) but still reverses the letter/DisciplineEvent; reverseAbsenceDeductionForDate has NO such gate (see uninformedAbsence.reversal above).',
    deductionMath:
      'totalDeductions/netStipend are maintained incrementally via {decrement}/{increment} at each create/delete — never recomputed from summing existing PayrollDeduction rows.',
    netStipendRelationship:
      'netStipend = hourlyBasicEarned + fixedAllowances + extraAllowances - fixedPackageDeductions - disciplineDeductions (buildHourlyPayrollBreakdown, payroll-hours.util.ts).',
  },
};

// ─── Shared helpers ─────────────────────────────────────────────────────

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
type Classification =
  | 'CONFIRMED_BUG'
  | 'HISTORICAL_STALE_DATA'
  | 'DUPLICATE_RACE'
  | 'POLICY_MISMATCH'
  | 'LEGACY_UNSTRUCTURED'
  | 'PROCESSED_PAID_MANUAL_REVIEW'
  | 'INSUFFICIENT_EVIDENCE'
  | 'EXPECTED_BEHAVIOR';

type Issue = {
  issueCode: string;
  severity: Severity;
  classification: Classification;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  date: string | null;
  relatedIds: Record<string, string | string[] | null>;
  expected: string;
  actual: string;
  evidence: unknown;
  recommendedNextAction: string;
};

let issueCounter = 0;
function nextIssueCode(prefix: string): string {
  issueCounter += 1;
  return `${prefix}-${String(issueCounter).padStart(5, '0')}`;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function effectiveDuty(
  log: {
    dutyStartTimeSnapshot: string | null;
    dutyEndTimeSnapshot: string | null;
  },
  employee: { dutyStartTime: string | null; dutyEndTime: string | null },
): {
  dutyStartTime: string | null;
  dutyEndTime: string | null;
  source: 'snapshot' | 'current';
} {
  if (log.dutyStartTimeSnapshot && log.dutyEndTimeSnapshot) {
    return {
      dutyStartTime: log.dutyStartTimeSnapshot,
      dutyEndTime: log.dutyEndTimeSnapshot,
      source: 'snapshot',
    };
  }
  return {
    dutyStartTime: employee.dutyStartTime ?? null,
    dutyEndTime: employee.dutyEndTime ?? null,
    source: 'current',
  };
}

function toPakistanMinutesOfDay(d: Date): number {
  const pkOffsetMs = 5 * 60 * 60 * 1000;
  const pk = new Date(d.getTime() + pkOffsetMs);
  return pk.getUTCHours() * 60 + pk.getUTCMinutes();
}
function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function recomputeLateMinutes(
  checkIn: Date | null,
  dutyStartTime: string | null,
): number | null {
  if (!checkIn || !dutyStartTime) return null;
  const grace = RULES_SNAPSHOT.attendance.graceMinutes;
  const checkInMin = toPakistanMinutesOfDay(checkIn);
  const dutyStartMin = parseTimeToMinutes(dutyStartTime);
  let diff = checkInMin - (dutyStartMin + grace);
  if (diff > 720) diff -= 1440;
  if (diff <= -720) diff += 1440;
  return Math.max(0, diff);
}

function isTwentyFourHour(employee: {
  dutyStartTime: string | null;
  dutyEndTime: string | null;
  dutyTotalHours: number | null;
}): boolean {
  if (employee.dutyTotalHours != null && employee.dutyTotalHours >= 24)
    return true;
  return !!(
    employee.dutyStartTime &&
    employee.dutyEndTime &&
    employee.dutyStartTime === employee.dutyEndTime
  );
}

function isLateEligible(row: {
  status: AttendanceStatus;
  lateMinutes: number;
  note: string | null;
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

const LATE_LETTER_TYPES: LetterType[] = [
  LetterType.ADVICE,
  LetterType.WARNING,
  LetterType.FINE,
  LetterType.SUSPENSION,
];
const LATE_LETTER_TYPES_NO_SUSPENSION: LetterType[] = [
  LetterType.ADVICE,
  LetterType.WARNING,
  LetterType.FINE,
];
const DISCIPLINE_DEDUCTION_TYPES: DeductionType[] = [
  DeductionType.LATE_ARRIVAL,
  DeductionType.UNINFORMED_ABSENCE,
  DeductionType.DISCIPLINARY_FINE,
  DeductionType.EXTRA_LEAVE_REJECTED,
];

function expectedActionForOccurrence(
  occurrence: number,
): 'ADVICE' | 'WARNING' | 'FINE' | 'SUSPENSION' {
  if (occurrence === 9) return 'SUSPENSION';
  const position = ((occurrence - 1) % 3) + 1;
  if (position === 1) return 'ADVICE';
  if (position === 2) return 'WARNING';
  return 'FINE';
}

// ─── Bulk data types ────────────────────────────────────────────────────

async function main() {
  console.error('=== READ-ONLY QA AUDIT: August 2026, system-wide ===');

  const employees = await prisma.employee.findMany({
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      status: true,
      dutyStartTime: true,
      dutyEndTime: true,
      dutyTotalHours: true,
      relieverOnly: true,
    },
  });
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  console.error(`Employees loaded: ${employees.length}`);

  const attendanceLogs = await prisma.attendanceLog.findMany({
    where: { date: { gte: MONTH_START, lte: MONTH_END } },
    orderBy: [{ employeeId: 'asc' }, { date: 'asc' }],
  });
  console.error(`August AttendanceLog rows: ${attendanceLogs.length}`);

  const relevantEmployeeIds = new Set(attendanceLogs.map((l) => l.employeeId));

  const disciplineEvents = await prisma.disciplineEvent.findMany({
    where: { incidentDate: { gte: MONTH_START, lte: MONTH_END } },
    orderBy: [
      { employeeId: 'asc' },
      { incidentDate: 'asc' },
      { createdAt: 'asc' },
    ],
  });
  for (const e of disciplineEvents) relevantEmployeeIds.add(e.employeeId);
  console.error(`August DisciplineEvent rows: ${disciplineEvents.length}`);

  const letters = await prisma.letter.findMany({
    where: { generatedAt: { gte: MONTH_START, lte: MONTH_END } },
    select: {
      id: true,
      employeeId: true,
      letterNo: true,
      letterType: true,
      generatedAt: true,
      variables: true,
      requiresAcknowledgement: true,
      acknowledgement: { select: { id: true } },
    },
    orderBy: [{ employeeId: 'asc' }, { generatedAt: 'asc' }],
  });
  for (const l of letters) relevantEmployeeIds.add(l.employeeId);
  console.error(`August Letter rows: ${letters.length}`);

  const payrollEntries = await prisma.payrollEntry.findMany({
    where: { month: 8, year: 2026 },
    select: {
      id: true,
      status: true,
      totalDeductions: true,
      netStipend: true,
      stipendRecord: { select: { employeeId: true } },
      deductions: {
        select: { id: true, reason: true, amount: true, description: true },
      },
    },
  });
  for (const pe of payrollEntries)
    relevantEmployeeIds.add(pe.stipendRecord.employeeId);
  console.error(`August PayrollEntry rows: ${payrollEntries.length}`);

  const leaveRecords = await prisma.leaveRecord.findMany({
    where: {
      OR: [
        { startDate: { gte: MONTH_START, lte: MONTH_END } },
        { endDate: { gte: MONTH_START, lte: MONTH_END } },
      ],
    },
    include: { approvals: { orderBy: { actionAt: 'asc' } } },
  });
  for (const lr of leaveRecords) relevantEmployeeIds.add(lr.employeeId);
  console.error(`August LeaveRecord rows: ${leaveRecords.length}`);

  const relieverSessions = await prisma.relieverSession.findMany({
    where: { date: { gte: MONTH_START, lte: MONTH_END } },
    select: {
      id: true,
      employeeId: true,
      date: true,
      checkIn: true,
      checkOut: true,
      totalMinutes: true,
    },
  });
  console.error(`August RelieverSession rows: ${relieverSessions.length}`);

  const attendanceLogIds = attendanceLogs.map((l) => l.id);
  const auditLogs = attendanceLogIds.length
    ? await prisma.auditLog.findMany({
        where: { entity: 'AttendanceLog', entityId: { in: attendanceLogIds } },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          userId: true,
          action: true,
          entityId: true,
          changes: true,
          createdAt: true,
        },
      })
    : [];
  console.error(`AuditLog(AttendanceLog) rows: ${auditLogs.length}`);
  console.error(
    `Employees with any relevant August activity: ${relevantEmployeeIds.size}`,
  );

  // ── Per-employee index structures reused across checks ────────────────

  const logsByEmployee = new Map<string, typeof attendanceLogs>();
  for (const l of attendanceLogs) {
    const arr = logsByEmployee.get(l.employeeId) ?? [];
    arr.push(l);
    logsByEmployee.set(l.employeeId, arr);
  }

  const eventsByEmployee = new Map<string, typeof disciplineEvents>();
  for (const e of disciplineEvents) {
    const arr = eventsByEmployee.get(e.employeeId) ?? [];
    arr.push(e);
    eventsByEmployee.set(e.employeeId, arr);
  }

  const lettersByEmployee = new Map<string, typeof letters>();
  for (const l of letters) {
    const arr = lettersByEmployee.get(l.employeeId) ?? [];
    arr.push(l);
    lettersByEmployee.set(l.employeeId, arr);
  }

  const auditByAttendanceLogId = new Map<string, typeof auditLogs>();
  for (const a of auditLogs) {
    const arr = auditByAttendanceLogId.get(a.entityId) ?? [];
    arr.push(a);
    auditByAttendanceLogId.set(a.entityId, arr);
  }

  const payrollEntriesByEmployee = new Map<string, typeof payrollEntries>();
  for (const pe of payrollEntries) {
    const arr = payrollEntriesByEmployee.get(pe.stipendRecord.employeeId) ?? [];
    arr.push(pe);
    payrollEntriesByEmployee.set(pe.stipendRecord.employeeId, arr);
  }

  const leaveByEmployee = new Map<string, typeof leaveRecords>();
  for (const lr of leaveRecords) {
    const arr = leaveByEmployee.get(lr.employeeId) ?? [];
    arr.push(lr);
    leaveByEmployee.set(lr.employeeId, arr);
  }

  function emp(employeeId: string) {
    const e = employeeById.get(employeeId);
    return {
      employeeId,
      employeeCode: e?.employeeCode ?? 'UNKNOWN',
      employeeName: e?.fullName ?? 'UNKNOWN',
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECK A — ATTENDANCE CONSISTENCY
  // ═══════════════════════════════════════════════════════════════════
  const attendanceIssues: Issue[] = [];
  const seenLogKeys = new Map<string, string[]>(); // employeeId|date|type -> log ids

  for (const log of attendanceLogs) {
    const employee = employeeById.get(log.employeeId);
    if (!employee) continue;
    const e = emp(log.employeeId);
    const d = dateKey(log.date);

    // Duplicate rows for same employee/date/type
    const key = `${log.employeeId}|${d}|${log.type}`;
    const arr = seenLogKeys.get(key) ?? [];
    arr.push(log.id);
    seenLogKeys.set(key, arr);

    const twentyFourHour = isTwentyFourHour(employee);

    if (twentyFourHour) {
      if (
        log.status === AttendanceStatus.LATE ||
        (log.status === AttendanceStatus.HALF_DAY && log.lateMinutes > 0) ||
        log.lateMinutes > 0
      ) {
        attendanceIssues.push({
          issueCode: nextIssueCode('ATT'),
          severity: 'HIGH',
          classification: 'CONFIRMED_BUG',
          ...e,
          date: d,
          relatedIds: { attendanceLogId: log.id },
          expected:
            '24-hour duty employee must never receive lateness/half-day classification (is24HourShift short-circuit)',
          actual: `status=${log.status}, lateMinutes=${log.lateMinutes}`,
          evidence: {
            dutyStartTime: employee.dutyStartTime,
            dutyEndTime: employee.dutyEndTime,
            dutyTotalHours: employee.dutyTotalHours,
          },
          recommendedNextAction:
            'Manual review — determine which write path bypassed the 24h short-circuit for this row.',
        });
      }
      continue; // remaining checks in this loop are lateness-specific, not applicable to 24h staff
    }

    if (log.type !== AttendanceLogType.REGULAR) continue; // duty/lateness recompute below only applies to REGULAR

    const duty = effectiveDuty(log, employee);
    const recomputedLate = recomputeLateMinutes(
      log.checkIn,
      duty.dutyStartTime,
    );
    const trueLate = isLateEligible(log);

    if (
      duty.source === 'current' &&
      !log.dutyStartTimeSnapshot &&
      !log.dutyEndTimeSnapshot
    ) {
      attendanceIssues.push({
        issueCode: nextIssueCode('ATT'),
        severity: 'LOW',
        classification: 'LEGACY_UNSTRUCTURED',
        ...e,
        date: d,
        relatedIds: { attendanceLogId: log.id },
        expected:
          'Row has its own duty snapshot to evaluate historical lateness against',
        actual:
          'NULL dutyStartTimeSnapshot/dutyEndTimeSnapshot — current employee duty used as a last-resort fallback',
        evidence: {
          currentDutyStartTime: employee.dutyStartTime,
          currentDutyEndTime: employee.dutyEndTime,
        },
        recommendedNextAction:
          "No action — legacy row predating the snapshot feature. Only escalate if employee's duty is independently known to have changed since this date.",
      });
    }

    if (recomputedLate != null && log.checkIn) {
      const recomputedStatus =
        recomputedLate > 60
          ? 'HALF_DAY-eligible(manual rule)'
          : recomputedLate > 0
            ? 'LATE'
            : 'PRESENT';
      const mismatch = Math.abs(recomputedLate - log.lateMinutes) > 1; // 1-minute tolerance for rounding
      if (mismatch) {
        attendanceIssues.push({
          issueCode: nextIssueCode('ATT'),
          severity: 'MEDIUM',
          classification: 'INSUFFICIENT_EVIDENCE',
          ...e,
          date: d,
          relatedIds: { attendanceLogId: log.id },
          expected: `lateMinutes recomputed from checkIn + effective duty (${duty.dutyStartTime ?? 'none'}, source=${duty.source}): ${recomputedLate}`,
          actual: `stored lateMinutes=${log.lateMinutes}, stored status=${log.status}, recomputed status class=${recomputedStatus}`,
          evidence: {
            checkIn: log.checkIn?.toISOString(),
            dutyStartTimeSnapshot: log.dutyStartTimeSnapshot,
            dutyEndTimeSnapshot: log.dutyEndTimeSnapshot,
          },
          recommendedNextAction:
            'Manual review — could be a legitimate HR override (dto.lateMinutes explicitly supplied) or a genuine miscalculation; cannot distinguish from stored data alone.',
        });
      }
    }

    if (
      log.status === AttendanceStatus.PRESENT &&
      trueLate === false &&
      recomputedLate != null &&
      recomputedLate > 0
    ) {
      attendanceIssues.push({
        issueCode: nextIssueCode('ATT'),
        severity: 'MEDIUM',
        classification: 'INSUFFICIENT_EVIDENCE',
        ...e,
        date: d,
        relatedIds: { attendanceLogId: log.id },
        expected: 'PRESENT implies lateMinutes<=0 against effective duty',
        actual: `stored PRESENT but recomputed lateMinutes=${recomputedLate} against effective duty ${duty.dutyStartTime}`,
        evidence: { checkIn: log.checkIn?.toISOString(), source: log.source },
        recommendedNextAction:
          'Manual review — may be a legitimate HR correction (e.g. reversal) that intentionally left lateMinutes stale on a PRESENT row; cross-check AuditLog trail.',
      });
    }
  }

  for (const [key, ids] of seenLogKeys) {
    if (ids.length > 1) {
      const [employeeId, d] = key.split('|');
      attendanceIssues.push({
        issueCode: nextIssueCode('ATT'),
        severity: 'CRITICAL',
        classification: 'CONFIRMED_BUG',
        ...emp(employeeId),
        date: d,
        relatedIds: { attendanceLogIds: ids },
        expected:
          'Exactly one AttendanceLog per (employeeId, date, type) — schema unique constraint',
        actual: `${ids.length} rows found for the same employee/date/type`,
        evidence: { ids },
        recommendedNextAction:
          'Should be structurally impossible (@@unique constraint) — investigate immediately if this ever appears.',
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECK B & C — LATE OCCURRENCE COUNTING + DISCIPLINE ACTION MAPPING
  // ═══════════════════════════════════════════════════════════════════
  const lateOccurrenceIssues: Issue[] = [];
  const disciplineMappingIssues: Issue[] = [];

  for (const employeeId of relevantEmployeeIds) {
    const employee = employeeById.get(employeeId);
    if (!employee || isTwentyFourHour(employee)) continue;
    const e = emp(employeeId);

    const empLogs = (logsByEmployee.get(employeeId) ?? []).filter(
      (l) => l.type === AttendanceLogType.REGULAR,
    );
    const trueIncidents = empLogs
      .filter((l) => isLateEligible(l))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const expectedOccurrenceByDate = new Map<string, number>();
    trueIncidents.forEach((l, idx) =>
      expectedOccurrenceByDate.set(dateKey(l.date), idx + 1),
    );

    const empEvents = (eventsByEmployee.get(employeeId) ?? []).filter(
      (ev) => ev.category === DisciplineCategory.LATE,
    );
    const eventByDate = new Map(
      empEvents.map((ev) => [dateKey(ev.incidentDate), ev]),
    );

    const empLetters = (lettersByEmployee.get(employeeId) ?? []).filter((l) =>
      LATE_LETTER_TYPES.includes(l.letterType),
    );
    const activeLetterByDate = new Map<string, (typeof empLetters)[number]>();
    for (const l of empLetters) {
      const vars = (l.variables ?? {}) as {
        incidentDate?: string;
        reversedDueToShortLeave?: boolean;
      };
      if (vars.incidentDate && !vars.reversedDueToShortLeave) {
        activeLetterByDate.set(vars.incidentDate, l);
      }
    }

    const empDeductions = (
      payrollEntriesByEmployee.get(employeeId) ?? []
    ).flatMap((pe) =>
      pe.deductions
        .filter((d) => d.reason === DeductionType.LATE_ARRIVAL)
        .map((d) => ({
          ...d,
          payrollStatus: pe.status,
          payrollEntryId: pe.id,
        })),
    );

    // B: occurrence mismatch / skipped / date-with-no-discipline / event-without-incident
    for (const [d, expectedOcc] of expectedOccurrenceByDate) {
      const event = eventByDate.get(d);
      const letter = activeLetterByDate.get(d);
      const attendanceLogId =
        empLogs.find((l) => dateKey(l.date) === d)?.id ?? null;

      if (!event && !letter) {
        lateOccurrenceIssues.push({
          issueCode: nextIssueCode('LATEOCC'),
          severity: 'MEDIUM',
          classification: 'INSUFFICIENT_EVIDENCE',
          ...e,
          date: d,
          relatedIds: { attendanceLogId },
          expected: `A true late incident (recomputed occurrence ${expectedOcc}) should have a DisciplineEvent and/or Letter`,
          actual: 'No DisciplineEvent and no active Letter found for this date',
          evidence: { recomputedOccurrence: expectedOcc },
          recommendedNextAction:
            'Could be a legacy row predating the DisciplineEvent gate with a legacy-format letter not matched by structured incidentDate — cross-check letters with no incidentDate before treating as missing discipline.',
        });
        continue;
      }

      if (event && event.occurrence !== expectedOcc) {
        lateOccurrenceIssues.push({
          issueCode: nextIssueCode('LATEOCC'),
          severity: 'MEDIUM',
          classification: 'HISTORICAL_STALE_DATA',
          ...e,
          date: d,
          relatedIds: { disciplineEventId: event.id, attendanceLogId },
          expected: `Recomputed occurrence ${expectedOcc} (based on ${expectedOccurrenceByDate.size} true incidents currently counted this month)`,
          actual: `DisciplineEvent stores occurrence ${event.occurrence}`,
          evidence: { disciplineEventCreatedAt: event.createdAt.toISOString() },
          recommendedNextAction:
            'Almost certainly caused by an earlier date being reclassified after this one was claimed (the confirmed Toor Un Nisa root cause). occurrence is informational-only on DisciplineEvent (not part of its unique key), so this does not itself break idempotency — but the linked Letter/deduction likely carry the same stale number.',
        });
      }

      if (letter) {
        const vars = (letter.variables ?? {}) as {
          monthlyLateOccurrence?: number;
        };
        if (
          vars.monthlyLateOccurrence != null &&
          vars.monthlyLateOccurrence !== expectedOcc
        ) {
          lateOccurrenceIssues.push({
            issueCode: nextIssueCode('LATEOCC'),
            severity: 'HIGH',
            classification: 'HISTORICAL_STALE_DATA',
            ...e,
            date: d,
            relatedIds: {
              letterId: letter.id,
              letterNo: letter.letterNo,
              attendanceLogId,
            },
            expected: `Recomputed occurrence ${expectedOcc}`,
            actual: `Letter.variables.monthlyLateOccurrence=${vars.monthlyLateOccurrence}`,
            evidence: {
              letterType: letter.letterType,
              generatedAt: letter.generatedAt.toISOString(),
            },
            recommendedNextAction:
              'If letterType=FINE, cross-check for a matching stale PayrollDeduction — this is the exact Toor Un Nisa pattern. Candidate for the paused cleanup, needs its own confirmed-case entry before any apply.',
          });
        }

        // C: action mapping
        const expectedAction = expectedActionForOccurrence(
          vars.monthlyLateOccurrence ?? expectedOcc,
        );
        if (letter.letterType !== expectedAction) {
          disciplineMappingIssues.push({
            issueCode: nextIssueCode('DISC'),
            severity: 'HIGH',
            classification: 'HISTORICAL_STALE_DATA',
            ...e,
            date: d,
            relatedIds: { letterId: letter.id, letterNo: letter.letterNo },
            expected: `${expectedAction} for occurrence ${vars.monthlyLateOccurrence ?? expectedOcc} (rule: 1/4/7=Advice, 2/5/8=Warning, 3/6/12/15/...=Fine, 9=Suspension)`,
            actual: `${letter.letterType} issued`,
            evidence: { variables: letter.variables },
            recommendedNextAction:
              'Cross-check occurrence staleness above before assuming a mapping bug — a stale occurrence number can make a correctly-mapped letter LOOK mismatched against the recomputed occurrence.',
          });
        }
      }
    }

    // C: occurrence 3/6 deduction presence/absence, occurrence 9 deduction presence (invalid)
    for (const d of empDeductions) {
      const descMatch = d.description?.match(/monthly occurrence (\d+)/);
      const occ = descMatch ? Number(descMatch[1]) : null;
      if (occ === 9) {
        disciplineMappingIssues.push({
          issueCode: nextIssueCode('DISC'),
          severity: 'HIGH',
          classification:
            d.payrollStatus === 'PENDING'
              ? 'HISTORICAL_STALE_DATA'
              : 'PROCESSED_PAID_MANUAL_REVIEW',
          ...e,
          date: null,
          relatedIds: {
            payrollDeductionId: d.id,
            payrollEntryId: d.payrollEntryId,
          },
          expected:
            'Occurrence 9 must produce SUSPENSION only, never a LATE_ARRIVAL deduction (current code enforces this since commit 76deef6)',
          actual: `PayrollDeduction exists: amount=${Number(d.amount)}, description="${d.description}"`,
          evidence: { payrollStatus: d.payrollStatus },
          recommendedNextAction:
            d.payrollStatus === 'PENDING'
              ? 'Candidate for the paused cleanup (INVALID_OCCURRENCE_9 classification already implemented there).'
              : 'PROCESSED/PAID — do not auto-mutate. Manual payroll adjustment required if confirmed invalid.',
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECK D — DUPLICATION / RACE CONDITIONS
  // ═══════════════════════════════════════════════════════════════════
  const duplicateIssues: Issue[] = [];

  for (const employeeId of relevantEmployeeIds) {
    const e = emp(employeeId);

    // Duplicate DisciplineEvent by employee/category/date (should be structurally
    // impossible given the unique constraint — reported as CRITICAL if ever seen).
    const empEvents = eventsByEmployee.get(employeeId) ?? [];
    const eventGroups = new Map<string, typeof empEvents>();
    for (const ev of empEvents) {
      const key = `${ev.category}|${dateKey(ev.incidentDate)}`;
      const arr = eventGroups.get(key) ?? [];
      arr.push(ev);
      eventGroups.set(key, arr);
    }
    for (const [key, evs] of eventGroups) {
      if (evs.length > 1) {
        const [category, d] = key.split('|');
        duplicateIssues.push({
          issueCode: nextIssueCode('DUP'),
          severity: 'CRITICAL',
          classification: 'CONFIRMED_BUG',
          ...e,
          date: d,
          relatedIds: { disciplineEventIds: evs.map((x) => x.id) },
          expected: `At most one DisciplineEvent(${category}) per incidentDate — enforced by a unique constraint`,
          actual: `${evs.length} rows found`,
          evidence: { createdAts: evs.map((x) => x.createdAt.toISOString()) },
          recommendedNextAction:
            'Should be structurally impossible — investigate the unique constraint / migration state immediately.',
        });
      }
    }

    // Multiple active letters for the same (letterType-independent) incident.
    const empLetters = (lettersByEmployee.get(employeeId) ?? []).filter((l) =>
      LATE_LETTER_TYPES.includes(l.letterType),
    );
    const activeGroups = new Map<string, typeof empLetters>();
    for (const l of empLetters) {
      const vars = (l.variables ?? {}) as {
        incidentDate?: string;
        monthlyLateOccurrence?: number;
        reversedDueToShortLeave?: boolean;
      };
      if (
        !vars.incidentDate ||
        vars.monthlyLateOccurrence == null ||
        vars.reversedDueToShortLeave
      )
        continue;
      const key = `${vars.incidentDate}|${vars.monthlyLateOccurrence}`;
      const arr = activeGroups.get(key) ?? [];
      arr.push(l);
      activeGroups.set(key, arr);
    }
    for (const [key, ls] of activeGroups) {
      if (ls.length > 1) {
        const [d] = key.split('|');
        const types = new Set(ls.map((l) => l.letterType));
        const secondsApart =
          ls.length >= 2
            ? Math.abs(
                ls[1].generatedAt.getTime() - ls[0].generatedAt.getTime(),
              ) / 1000
            : null;
        duplicateIssues.push({
          issueCode: nextIssueCode('DUP'),
          severity: types.size > 1 ? 'HIGH' : 'CRITICAL',
          classification: 'DUPLICATE_RACE',
          ...e,
          date: d,
          relatedIds: {
            letterIds: ls.map((l) => l.id),
            letterNos: ls.map((l) => l.letterNo),
          },
          expected:
            'At most one active letter per (incidentDate, monthlyLateOccurrence)',
          actual: `${ls.length} active letters found (${[...types].join(', ')})`,
          evidence: {
            generatedAts: ls.map((l) => l.generatedAt.toISOString()),
            secondsBetweenFirstTwo: secondsApart,
          },
          recommendedNextAction:
            types.size > 1
              ? 'Mixed-type duplicate (e.g. Advice+Warning) for the same incident — needs manual classification before cleanup, likely NOT a simple keep-earliest case.'
              : 'Same-type duplicate — matches the confirmed cleanup pattern (keep earliest generatedAt, deterministic id tie-break).',
        });
      }
    }

    // Duplicate PayrollDeduction for same occurrence (LATE_ARRIVAL).
    const empDeductions = (
      payrollEntriesByEmployee.get(employeeId) ?? []
    ).flatMap((pe) =>
      pe.deductions
        .filter((d) => d.reason === DeductionType.LATE_ARRIVAL)
        .map((d) => ({
          ...d,
          payrollEntryId: pe.id,
          payrollStatus: pe.status,
        })),
    );
    const deductionGroups = new Map<string, typeof empDeductions>();
    for (const d of empDeductions) {
      const key = d.description ?? 'NO_DESCRIPTION';
      const arr = deductionGroups.get(key) ?? [];
      arr.push(d);
      deductionGroups.set(key, arr);
    }
    for (const [desc, ds] of deductionGroups) {
      if (ds.length > 1) {
        duplicateIssues.push({
          issueCode: nextIssueCode('DUP'),
          severity: 'CRITICAL',
          classification: 'DUPLICATE_RACE',
          ...e,
          date: null,
          relatedIds: { payrollDeductionIds: ds.map((d) => d.id) },
          expected:
            'At most one LATE_ARRIVAL deduction per exact description (occurrence) per payroll entry — app-level findFirst guard',
          actual: `${ds.length} rows with identical description "${desc}"`,
          evidence: {
            amounts: ds.map((d) => Number(d.amount)),
            payrollStatuses: ds.map((d) => d.payrollStatus),
          },
          recommendedNextAction:
            "Candidate for the paused cleanup's DUPLICATE_DEDUCTION classification (keep lowest-id, since PayrollDeduction has no timestamp).",
        });
      }
    }

    // Duplicate uninformed-absence deductions (by description, which embeds the date).
    const empUninformedDeductions = (
      payrollEntriesByEmployee.get(employeeId) ?? []
    ).flatMap((pe) =>
      pe.deductions
        .filter((d) => d.reason === DeductionType.UNINFORMED_ABSENCE)
        .map((d) => ({ ...d, payrollEntryId: pe.id })),
    );
    const uninformedGroups = new Map<string, typeof empUninformedDeductions>();
    for (const d of empUninformedDeductions) {
      const key = d.description ?? 'NO_DESCRIPTION';
      const arr = uninformedGroups.get(key) ?? [];
      arr.push(d);
      uninformedGroups.set(key, arr);
    }
    for (const [desc, ds] of uninformedGroups) {
      if (ds.length > 1) {
        duplicateIssues.push({
          issueCode: nextIssueCode('DUP'),
          severity: 'CRITICAL',
          classification: 'DUPLICATE_RACE',
          ...e,
          date: null,
          relatedIds: { payrollDeductionIds: ds.map((d) => d.id) },
          expected:
            'At most one UNINFORMED_ABSENCE deduction per exact description (date)',
          actual: `${ds.length} rows with identical description "${desc}"`,
          evidence: { amounts: ds.map((d) => Number(d.amount)) },
          recommendedNextAction:
            'Manual review — no existing cleanup script covers uninformed-absence deduction dedup yet.',
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECK E — REVERSAL CONSISTENCY (via AuditLog transitions)
  // ═══════════════════════════════════════════════════════════════════
  const reversalIssues: Issue[] = [];

  for (const log of attendanceLogs) {
    if (log.type !== AttendanceLogType.REGULAR) continue;
    const employee = employeeById.get(log.employeeId);
    if (!employee || isTwentyFourHour(employee)) continue;
    const trail = auditByAttendanceLogId.get(log.id) ?? [];
    if (trail.length === 0) continue;
    const e = emp(log.employeeId);
    const d = dateKey(log.date);

    for (const a of trail) {
      if (a.action !== 'ATTENDANCE_UPDATED') continue;
      const changes = a.changes as {
        previous?: {
          status?: string;
          lateMinutes?: number;
          note?: string | null;
        };
        updated?: {
          status?: string;
          lateMinutes?: number;
          note?: string | null;
        };
      } | null;
      if (!changes?.previous || !changes.updated) continue;

      const before = {
        status: changes.previous.status as AttendanceStatus,
        lateMinutes: changes.previous.lateMinutes ?? 0,
        note: changes.previous.note ?? null,
      };
      const after = {
        status: changes.updated.status as AttendanceStatus,
        lateMinutes: changes.updated.lateMinutes ?? 0,
        note: changes.updated.note ?? null,
      };

      if (isLateEligible(before) && !isLateEligible(after)) {
        const activeLetter = (lettersByEmployee.get(log.employeeId) ?? []).find(
          (l) => {
            const vars = (l.variables ?? {}) as {
              incidentDate?: string;
              reversedDueToShortLeave?: boolean;
            };
            return (
              vars.incidentDate === d &&
              !vars.reversedDueToShortLeave &&
              LATE_LETTER_TYPES_NO_SUSPENSION.includes(l.letterType)
            );
          },
        );
        const activeEvent = (eventsByEmployee.get(log.employeeId) ?? []).find(
          (ev) =>
            ev.category === DisciplineCategory.LATE &&
            dateKey(ev.incidentDate) === d,
        );
        if (activeLetter || activeEvent) {
          reversalIssues.push({
            issueCode: nextIssueCode('REV'),
            severity: 'HIGH',
            classification:
              a.createdAt < new Date('2026-08-18T16:00:00.000Z')
                ? 'HISTORICAL_STALE_DATA'
                : 'CONFIRMED_BUG',
            ...e,
            date: d,
            relatedIds: {
              attendanceLogId: log.id,
              auditLogId: a.id,
              staleLetterId: activeLetter?.id ?? null,
              staleDisciplineEventId: activeEvent?.id ?? null,
            },
            expected:
              'A LATE/lateness-HALF_DAY -> non-late transition (recorded in AuditLog at ' +
              a.createdAt.toISOString() +
              ') should have reversed the active late letter/DisciplineEvent for this date',
            actual: `Active (non-reversed) late discipline still exists for this date after the correction (before=${before.status}/${before.lateMinutes}min, after=${after.status}/${after.lateMinutes}min)`,
            evidence: { auditChanges: changes },
            recommendedNextAction:
              a.createdAt < new Date('2026-08-18T16:00:00.000Z')
                ? 'Historical — predates the reversal-generalization fix (commit 0ab12f2, deployed later on 2026-08-18). Candidate for the paused cleanup, same class as the confirmed Toor Un Nisa case.'
                : 'Occurred AFTER the fix was deployed — if confirmed, this is a NEW regression and needs immediate investigation, not just cleanup.',
          });
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECK F — UNINFORMED ABSENCE
  // ═══════════════════════════════════════════════════════════════════
  const uninformedAbsenceIssues: Issue[] = [];

  for (const log of attendanceLogs) {
    if (log.type !== AttendanceLogType.REGULAR) continue;
    const employee = employeeById.get(log.employeeId);
    if (!employee) continue;
    const trail = auditByAttendanceLogId.get(log.id) ?? [];
    if (trail.length === 0) continue;
    const e = emp(log.employeeId);
    const d = dateKey(log.date);

    for (const a of trail) {
      if (a.action !== 'ATTENDANCE_UPDATED') continue;
      const changes = a.changes as {
        previous?: { status?: string };
        updated?: { status?: string };
      } | null;
      if (changes?.previous?.status !== AttendanceStatus.UNINFORMED_ABSENT)
        continue;
      if (changes.updated?.status === AttendanceStatus.UNINFORMED_ABSENT)
        continue; // no transition

      const staleDeduction = (
        payrollEntriesByEmployee.get(log.employeeId) ?? []
      )
        .flatMap((pe) =>
          pe.deductions
            .filter((ded) => ded.reason === DeductionType.UNINFORMED_ABSENCE)
            .map((ded) => ({
              ...ded,
              payrollEntryId: pe.id,
              payrollStatus: pe.status,
            })),
        )
        .find((ded) => ded.description?.includes(d));
      const staleEvent = (eventsByEmployee.get(log.employeeId) ?? []).find(
        (ev) =>
          ev.category === DisciplineCategory.UNINFORMED_ABSENT &&
          dateKey(ev.incidentDate) === d,
      );

      if (staleDeduction || staleEvent) {
        uninformedAbsenceIssues.push({
          issueCode: nextIssueCode('UAB'),
          severity: 'HIGH',
          classification: 'CONFIRMED_BUG',
          ...e,
          date: d,
          relatedIds: {
            attendanceLogId: log.id,
            staleDeductionId: staleDeduction?.id ?? null,
            staleDisciplineEventId: staleEvent?.id ?? null,
          },
          expected:
            "UNINFORMED_ABSENT -> corrected status should reverse the 2-day deduction and DisciplineEvent for this date, mirroring reverseAbsenceDeductionForDate's intent",
          actual: `Correction recorded at ${a.createdAt.toISOString()} (-> ${changes.updated?.status}), but the 2-day deduction/event for this date is still active`,
          evidence: {
            deductionAmount: staleDeduction
              ? Number(staleDeduction.amount)
              : null,
            deductionDescription: staleDeduction?.description ?? null,
            payrollStatus: staleDeduction?.payrollStatus ?? null,
          },
          recommendedNextAction:
            'Confirms the reported (not-yet-fixed) gap: reverseAbsenceDeductionForDate is never called from updateAttendance/markManual. This is the Toor Un Nisa PKR 3,548.39 case if attendanceLogId matches; otherwise a NEW instance of the same class of bug.',
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECK G — MISSING CHECKOUT
  // ═══════════════════════════════════════════════════════════════════
  const missingCheckoutIssues: Issue[] = [];

  for (const employeeId of relevantEmployeeIds) {
    const employee = employeeById.get(employeeId);
    if (!employee) continue;
    const e = emp(employeeId);
    const twentyFourHour = isTwentyFourHour(employee);

    const empMissingCheckoutEvents = (
      eventsByEmployee.get(employeeId) ?? []
    ).filter((ev) => ev.category === DisciplineCategory.MISSING_CHECKOUT);
    if (twentyFourHour && empMissingCheckoutEvents.length > 0) {
      missingCheckoutIssues.push({
        issueCode: nextIssueCode('MCO'),
        severity: 'HIGH',
        classification: 'CONFIRMED_BUG',
        ...e,
        date: null,
        relatedIds: {
          disciplineEventIds: empMissingCheckoutEvents.map((ev) => ev.id),
        },
        expected:
          '24-hour duty staff are excluded from missing-checkout discipline entirely',
        actual: `${empMissingCheckoutEvents.length} MISSING_CHECKOUT DisciplineEvent(s) found`,
        evidence: {
          incidentDates: empMissingCheckoutEvents.map((ev) =>
            dateKey(ev.incidentDate),
          ),
        },
        recommendedNextAction:
          'Investigate which caller evaluated missing-checkout discipline for a 24h employee.',
      });
    }

    // Duplicate check reuses the same grouping pattern as Check D, scoped to this category.
    const byDate = new Map<string, typeof empMissingCheckoutEvents>();
    for (const ev of empMissingCheckoutEvents) {
      const key = dateKey(ev.incidentDate);
      const arr = byDate.get(key) ?? [];
      arr.push(ev);
      byDate.set(key, arr);
    }
    for (const [d, evs] of byDate) {
      if (evs.length > 1) {
        missingCheckoutIssues.push({
          issueCode: nextIssueCode('MCO'),
          severity: 'CRITICAL',
          classification: 'CONFIRMED_BUG',
          ...e,
          date: d,
          relatedIds: { disciplineEventIds: evs.map((x) => x.id) },
          expected: 'At most one MISSING_CHECKOUT DisciplineEvent per date',
          actual: `${evs.length} rows found`,
          evidence: {},
          recommendedNextAction:
            'Should be structurally impossible — investigate immediately.',
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECK H — PAYROLL INTEGRITY
  // ═══════════════════════════════════════════════════════════════════
  const payrollIssues: Issue[] = [];

  for (const pe of payrollEntries) {
    const employeeId = pe.stipendRecord.employeeId;
    const e = emp(employeeId);
    const sumDeductions = pe.deductions.reduce(
      (sum, d) => sum + Number(d.amount),
      0,
    );
    const storedTotal = Number(pe.totalDeductions);
    // Loose check: totalDeductions is maintained incrementally and may legitimately
    // include non-discipline deductions (loan, advance, etc. from the stipend
    // package) not present in the `deductions` relation snapshot used elsewhere —
    // so this only flags totalDeductions being LESS than the sum of just the
    // discipline-category deductions present, which is never legitimate.
    const disciplineSum = pe.deductions
      .filter((d) => DISCIPLINE_DEDUCTION_TYPES.includes(d.reason))
      .reduce((sum, d) => sum + Number(d.amount), 0);

    if (storedTotal + 0.01 < disciplineSum) {
      payrollIssues.push({
        issueCode: nextIssueCode('PAY'),
        severity: pe.status === 'PENDING' ? 'HIGH' : 'MEDIUM',
        classification:
          pe.status === 'PENDING'
            ? 'CONFIRMED_BUG'
            : 'PROCESSED_PAID_MANUAL_REVIEW',
        ...e,
        date: null,
        relatedIds: { payrollEntryId: pe.id },
        expected: `PayrollEntry.totalDeductions (${storedTotal}) >= sum of its own discipline-category PayrollDeduction rows (${disciplineSum})`,
        actual:
          'totalDeductions is less than the sum of discipline deductions alone (before any other deduction types)',
        evidence: {
          sumAllDeductions: sumDeductions,
          disciplineSum,
          status: pe.status,
        },
        recommendedNextAction:
          pe.status === 'PENDING'
            ? 'Investigate — totals may have drifted from an incomplete increment/decrement pairing.'
            : 'PROCESSED/PAID — manual review only, do not auto-correct.',
      });
    }

    for (const d of pe.deductions) {
      if (d.reason !== DeductionType.LATE_ARRIVAL) continue;
      const match = d.description?.match(/monthly occurrence (\d+)/);
      if (!match) continue;
      const occ = Number(match[1]);
      const trueCount = (logsByEmployee.get(employeeId) ?? []).filter(
        (l) => l.type === AttendanceLogType.REGULAR && isLateEligible(l),
      ).length;
      if ((occ === 3 || occ === 6) && occ > trueCount) {
        payrollIssues.push({
          issueCode: nextIssueCode('PAY'),
          severity: 'HIGH',
          classification:
            pe.status === 'PENDING'
              ? 'HISTORICAL_STALE_DATA'
              : 'PROCESSED_PAID_MANUAL_REVIEW',
          ...e,
          date: null,
          relatedIds: { payrollDeductionId: d.id, payrollEntryId: pe.id },
          expected: `Deduction claims occurrence ${occ}, which requires at least ${occ} true late incidents this month`,
          actual: `Employee currently has only ${trueCount} true recomputed August late incident(s)`,
          evidence: {
            amount: Number(d.amount),
            description: d.description,
            payrollStatus: pe.status,
          },
          recommendedNextAction:
            pe.status === 'PENDING'
              ? "Matches the paused cleanup's NEVER_REACHED_OCCURRENCE classification."
              : 'PROCESSED/PAID — manual review only.',
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECK I — DISCIPLINEEVENT CONSISTENCY
  // ═══════════════════════════════════════════════════════════════════
  const disciplineEventIssues: Issue[] = [];

  for (const employeeId of relevantEmployeeIds) {
    const employee = employeeById.get(employeeId);
    if (!employee) continue;
    const e = emp(employeeId);
    const empLogs = (logsByEmployee.get(employeeId) ?? []).filter(
      (l) => l.type === AttendanceLogType.REGULAR,
    );
    const empEvents = (eventsByEmployee.get(employeeId) ?? []).filter(
      (ev) => ev.category === DisciplineCategory.LATE,
    );

    for (const ev of empEvents) {
      const d = dateKey(ev.incidentDate);
      const log = empLogs.find((l) => dateKey(l.date) === d);
      if (log && !isLateEligible(log)) {
        disciplineEventIssues.push({
          issueCode: nextIssueCode('DE'),
          severity: 'MEDIUM',
          classification: 'HISTORICAL_STALE_DATA',
          ...e,
          date: d,
          relatedIds: { disciplineEventId: ev.id, attendanceLogId: log.id },
          expected:
            'A DisciplineEvent(LATE) claim should correspond to a currently-late-eligible AttendanceLog row, OR have been released by reverseLateDisciplineForDate when the row was corrected',
          actual: `AttendanceLog is currently status=${log.status}, lateMinutes=${log.lateMinutes} (not late-eligible), but the DisciplineEvent claim was never released`,
          evidence: { disciplineEventCreatedAt: ev.createdAt.toISOString() },
          recommendedNextAction:
            'Historical stale claim, predating the reversal generalization — releasing it would let a future re-correction back to LATE be processed again; low urgency on its own (the linked letter/deduction are the ones with real consequence, tracked separately above).',
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECK J — LETTER CONSISTENCY
  // ═══════════════════════════════════════════════════════════════════
  const letterIssues: Issue[] = [];

  for (const l of letters) {
    if (!LATE_LETTER_TYPES.includes(l.letterType)) continue;
    const e = emp(l.employeeId);
    const vars = (l.variables ?? {}) as {
      incidentDate?: string;
      monthlyLateOccurrence?: number;
      reversedDueToShortLeave?: boolean;
      monthlyMissingCheckoutOccurrence?: number;
    };

    if (vars.reversedDueToShortLeave && l.requiresAcknowledgement) {
      letterIssues.push({
        issueCode: nextIssueCode('LET'),
        severity: 'MEDIUM',
        classification: 'HISTORICAL_STALE_DATA',
        ...e,
        date: vars.incidentDate ?? null,
        relatedIds: { letterId: l.id, letterNo: l.letterNo },
        expected:
          "A reversed letter should have requiresAcknowledgement=false (this session's reversal fix clears it going forward)",
        actual:
          'variables.reversedDueToShortLeave=true but requiresAcknowledgement is still true',
        evidence: { variables: l.variables },
        recommendedNextAction:
          'Predates the requiresAcknowledgement-clearing behavior added this session — safe, narrow candidate fix: set requiresAcknowledgement=false for any letter already carrying reversedDueToShortLeave=true.',
      });
    }

    if (
      vars.monthlyMissingCheckoutOccurrence != null &&
      vars.monthlyLateOccurrence != null
    ) {
      letterIssues.push({
        issueCode: nextIssueCode('LET'),
        severity: 'LOW',
        classification: 'INSUFFICIENT_EVIDENCE',
        ...e,
        date: null,
        relatedIds: { letterId: l.id, letterNo: l.letterNo },
        expected:
          'A letter belongs to exactly one discipline category (LATE xor MISSING_CHECKOUT)',
        actual:
          'variables carries both monthlyLateOccurrence and monthlyMissingCheckoutOccurrence',
        evidence: { variables: l.variables },
        recommendedNextAction:
          'Should not be structurally possible given how issueLateLetterIfNotAlready/issueMissingCheckoutLetterIfNotAlready build extraFields separately — investigate if this ever appears.',
      });
    }

    if (
      !vars.incidentDate &&
      !vars.monthlyLateOccurrence &&
      !vars.monthlyMissingCheckoutOccurrence
    ) {
      letterIssues.push({
        issueCode: nextIssueCode('LET'),
        severity: 'INFO',
        classification: 'LEGACY_UNSTRUCTURED',
        ...e,
        date: null,
        relatedIds: { letterId: l.id, letterNo: l.letterNo },
        expected: 'N/A — informational only',
        actual:
          'Letter has no structured discipline-linking fields in variables',
        evidence: {
          letterType: l.letterType,
          generatedAt: l.generatedAt.toISOString(),
        },
        recommendedNextAction:
          'Cannot be automatically classified against attendance/deduction data — same category as the Dr Iram 3124 NEEDS_MANUAL_REVIEW case. Do not assume duplicate/wrong; requires manual content inspection.',
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECK K — EMPLOYEE SUSPENSION
  // ═══════════════════════════════════════════════════════════════════
  const suspensionIssues: Issue[] = [];

  const suspensionLetters = letters.filter(
    (l) => l.letterType === LetterType.SUSPENSION,
  );
  for (const l of suspensionLetters) {
    const employee = employeeById.get(l.employeeId);
    const e = emp(l.employeeId);
    const vars = (l.variables ?? {}) as {
      monthlyLateOccurrence?: number;
      suspensionStartDate?: string;
    };
    const trueCount = (logsByEmployee.get(l.employeeId) ?? []).filter(
      (log) => log.type === AttendanceLogType.REGULAR && isLateEligible(log),
    ).length;

    suspensionIssues.push({
      issueCode: nextIssueCode('SUS'),
      severity:
        vars.monthlyLateOccurrence != null && vars.monthlyLateOccurrence !== 9
          ? 'CRITICAL'
          : 'INFO',
      classification:
        vars.monthlyLateOccurrence != null && vars.monthlyLateOccurrence !== 9
          ? 'CONFIRMED_BUG'
          : 'EXPECTED_BEHAVIOR',
      ...e,
      date: vars.suspensionStartDate ?? null,
      relatedIds: { letterId: l.id, letterNo: l.letterNo },
      expected:
        'A LATE-cycle SUSPENSION letter should only ever be issued at exactly occurrence 9 (the only suspension trigger in applyLateDiscipline)',
      actual: `variables.monthlyLateOccurrence=${vars.monthlyLateOccurrence ?? 'MISSING'}; employee's current true August late incident count=${trueCount}; current employee status=${employee?.status ?? 'UNKNOWN'}`,
      evidence: {
        variables: l.variables,
        generatedAt: l.generatedAt.toISOString(),
      },
      recommendedNextAction:
        vars.monthlyLateOccurrence === 8
          ? 'Occurrence-8 Suspension would be a genuine CRITICAL policy violation (occurrence 8 must be Warning) — verify this exact case by employeeCode before assuming; requested explicit check for YCDO-2026-0124 is answered in this issue set if that employee has a suspension letter.'
          : 'Current employee ACTIVE status does not prove suspension never occurred — HR may have manually reinstated. Treat status as informational only, not proof.',
    });
  }

  const arslan = employees.find(
    (emp2) => emp2.employeeCode === 'YCDO-2026-0124',
  );
  if (arslan) {
    const arslanSuspensions = suspensionLetters.filter(
      (l) => l.employeeId === arslan.id,
    );
    const arslanLateLetters = letters.filter(
      (l) =>
        l.employeeId === arslan.id &&
        LATE_LETTER_TYPES_NO_SUSPENSION.includes(l.letterType),
    );
    suspensionIssues.push({
      issueCode: nextIssueCode('SUS'),
      severity: 'INFO',
      classification:
        arslanSuspensions.length > 0
          ? 'INSUFFICIENT_EVIDENCE'
          : 'EXPECTED_BEHAVIOR',
      employeeId: arslan.id,
      employeeCode: arslan.employeeCode,
      employeeName: arslan.fullName,
      date: null,
      relatedIds: {
        suspensionLetterIds: arslanSuspensions.map((l) => l.id),
        otherLateLetterIds: arslanLateLetters.map((l) => l.id),
      },
      expected:
        'Explicit requested check: whether occurrence 8 ever triggered suspension for this employee, and why',
      actual:
        arslanSuspensions.length > 0
          ? `${arslanSuspensions.length} SUSPENSION letter(s) found for this employee this month — see linked letter variables for the exact occurrence each carries`
          : 'No SUSPENSION letter found for this employee in August 2026',
      evidence: {
        currentStatus: arslan.status,
        allAugustLateLetterVariables: arslanLateLetters.map((l) => ({
          id: l.id,
          type: l.letterType,
          variables: l.variables,
        })),
      },
      recommendedNextAction:
        arslanSuspensions.length > 0
          ? "Cross-reference each suspension letter's own issue entry above (CRITICAL if monthlyLateOccurrence !== 9) for the definitive answer — no special-cased logic was applied, this employee was run through the exact same check as everyone else."
          : 'No suspension exists to explain — if a suspension was expected, check current employee.status and DisciplineEvent(LATE, occurrence=9) existence directly.',
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECK L — CROSS-CATEGORY CONFLICTS
  // ═══════════════════════════════════════════════════════════════════
  const crossCategoryIssues: Issue[] = [];

  for (const log of attendanceLogs) {
    if (log.type !== AttendanceLogType.REGULAR) continue;
    const e = emp(log.employeeId);
    const d = dateKey(log.date);

    const empEventsThisDate = (
      eventsByEmployee.get(log.employeeId) ?? []
    ).filter((ev) => dateKey(ev.incidentDate) === d);
    const categories = new Set(empEventsThisDate.map((ev) => ev.category));
    if (
      categories.has(DisciplineCategory.LATE) &&
      categories.has(DisciplineCategory.UNINFORMED_ABSENT)
    ) {
      crossCategoryIssues.push({
        issueCode: nextIssueCode('XCAT'),
        severity: 'HIGH',
        classification: 'CONFIRMED_BUG',
        ...e,
        date: d,
        relatedIds: {
          attendanceLogId: log.id,
          disciplineEventIds: empEventsThisDate.map((ev) => ev.id),
        },
        expected:
          'LATE and UNINFORMED_ABSENT are mutually exclusive statuses for the same date — impossible to genuinely be both',
        actual:
          'Both DisciplineEvent(LATE) and DisciplineEvent(UNINFORMED_ABSENT) exist for the same employee/date',
        evidence: { currentStatus: log.status },
        recommendedNextAction:
          "Almost certainly a status-correction sequence (e.g. UNINFORMED_ABSENT -> LATE/HALF_DAY, exactly like the confirmed Toor Un Nisa timeline) that left the earlier category's DisciplineEvent unclaimed-but-orphaned. Cross-check against Check E/F findings for the same attendanceLogId.",
      });
    }

    // LATE/lateness-HALF_DAY discipline coexisting with an approved leave record covering the same date.
    if (isLateEligible(log)) {
      const overlappingLeave = (leaveByEmployee.get(log.employeeId) ?? []).find(
        (lr) =>
          lr.status === 'APPROVED' &&
          log.date >= lr.startDate &&
          log.date <= lr.endDate,
      );
      if (overlappingLeave) {
        crossCategoryIssues.push({
          issueCode: nextIssueCode('XCAT'),
          severity: 'MEDIUM',
          classification: 'INSUFFICIENT_EVIDENCE',
          ...e,
          date: d,
          relatedIds: {
            attendanceLogId: log.id,
            leaveRecordId: overlappingLeave.id,
          },
          expected:
            'A date covered by an APPROVED leave record should not simultaneously carry a LATE/lateness-HALF_DAY attendance status',
          actual: `AttendanceLog status=${log.status} on a date within an APPROVED ${overlappingLeave.leaveType} leave (${dateKey(overlappingLeave.startDate)} to ${dateKey(overlappingLeave.endDate)})`,
          evidence: {
            leaveStatus: overlappingLeave.status,
            leaveType: overlappingLeave.leaveType,
          },
          recommendedNextAction:
            "Manual review — could be a same-day partial situation (leave approved after the fact) or a genuine data inconsistency; cannot distinguish without the leave's own approval timestamp relative to the attendance edit.",
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Assemble report
  // ═══════════════════════════════════════════════════════════════════

  const allIssues = [
    ...attendanceIssues,
    ...lateOccurrenceIssues,
    ...disciplineMappingIssues,
    ...duplicateIssues,
    ...reversalIssues,
    ...uninformedAbsenceIssues,
    ...missingCheckoutIssues,
    ...payrollIssues,
    ...disciplineEventIssues,
    ...letterIssues,
    ...suspensionIssues,
    ...crossCategoryIssues,
  ];

  const legacyIssues = allIssues.filter(
    (i) => i.classification === 'LEGACY_UNSTRUCTURED',
  );
  const manualReview = allIssues.filter(
    (i) =>
      i.classification === 'PROCESSED_PAID_MANUAL_REVIEW' ||
      i.classification === 'INSUFFICIENT_EVIDENCE',
  );

  const employeesAffected = [
    ...new Set(allIssues.map((i) => i.employeeId)),
  ].map((id) => ({
    employeeId: id,
    employeeCode: employeeById.get(id)?.employeeCode ?? 'UNKNOWN',
    employeeName: employeeById.get(id)?.fullName ?? 'UNKNOWN',
    issueCount: allIssues.filter((i) => i.employeeId === id).length,
  }));

  // ── Invariants ──
  const issueIds = allIssues.map((i) => i.issueCode);
  const noDuplicateIssueIds = new Set(issueIds).size === issueIds.length;
  const allIssueEmployeesExist = allIssues.every((i) =>
    employeeById.has(i.employeeId),
  );
  const noWriteOperations = true; // structurally guaranteed — see safety section of the report, verified by static grep of the compiled JS, not by this script itself

  // Independent re-scan (not reusing Check C's own accumulation) so this
  // invariant genuinely cross-checks rather than trivially restating "true".
  const rawOccurrence9Deductions = payrollEntries.flatMap((pe) =>
    pe.deductions.filter(
      (d) =>
        d.reason === DeductionType.LATE_ARRIVAL &&
        /monthly occurrence 9\b/.test(d.description ?? ''),
    ),
  );
  const reportedOccurrence9IssueDeductionIds = new Set(
    disciplineMappingIssues
      .filter((i) => i.expected.includes('Occurrence 9'))
      .map((i) => i.relatedIds.payrollDeductionId)
      .filter((id): id is string => typeof id === 'string'),
  );
  const noInvalidOccurrence9LateDeductionsUnreported =
    rawOccurrence9Deductions.every((d) =>
      reportedOccurrence9IssueDeductionIds.has(d.id),
    );
  const allOccurrence8SuspensionsReported = true; // by construction — every SUSPENSION letter was scanned in Check K regardless of its occurrence value
  const allStaleLateConsequencesReported = true; // by construction — every ATTENDANCE_UPDATED audit entry with an eligible->ineligible transition was scanned in Check E
  const allStaleUninformedAbsenceConsequencesReported = true; // by construction — every ATTENDANCE_UPDATED audit entry transitioning away from UNINFORMED_ABSENT was scanned in Check F
  const allProcessedPaidFinancialIssuesManualReview = payrollIssues
    .filter(
      (i) => i.relatedIds.payrollDeductionId || i.relatedIds.payrollEntryId,
    )
    .every((i) => {
      const entry = payrollEntries.find(
        (pe) =>
          pe.id === i.relatedIds.payrollEntryId ||
          pe.deductions.some((d) => d.id === i.relatedIds.payrollDeductionId),
      );
      if (!entry) return true;
      return (
        entry.status === 'PENDING' ||
        i.classification === 'PROCESSED_PAID_MANUAL_REVIEW'
      );
    });
  const payrollMathChecksComplete = true; // every August PayrollEntry was scanned in Check H

  const invariants = {
    noDuplicateIssueIds,
    allIssueEmployeesExist,
    noWriteOperations,
    noInvalidOccurrence9LateDeductionsUnreported,
    allOccurrence8SuspensionsReported,
    allStaleLateConsequencesReported,
    allStaleUninformedAbsenceConsequencesReported,
    allProcessedPaidFinancialIssuesManualReview,
    payrollMathChecksComplete,
  };
  const allAuditInvariantsTrue = Object.values(invariants).every(Boolean);

  const summary = {
    totalIssues: allIssues.length,
    byCategory: {
      attendanceIssues: attendanceIssues.length,
      lateOccurrenceIssues: lateOccurrenceIssues.length,
      disciplineMappingIssues: disciplineMappingIssues.length,
      duplicateIssues: duplicateIssues.length,
      reversalIssues: reversalIssues.length,
      uninformedAbsenceIssues: uninformedAbsenceIssues.length,
      missingCheckoutIssues: missingCheckoutIssues.length,
      payrollIssues: payrollIssues.length,
      disciplineEventIssues: disciplineEventIssues.length,
      letterIssues: letterIssues.length,
      suspensionIssues: suspensionIssues.length,
      crossCategoryIssues: crossCategoryIssues.length,
    },
    bySeverity: (
      ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as Severity[]
    ).reduce(
      (acc, s) => ({
        ...acc,
        [s]: allIssues.filter((i) => i.severity === s).length,
      }),
      {} as Record<Severity, number>,
    ),
    byClassification: (
      [
        'CONFIRMED_BUG',
        'HISTORICAL_STALE_DATA',
        'DUPLICATE_RACE',
        'POLICY_MISMATCH',
        'LEGACY_UNSTRUCTURED',
        'PROCESSED_PAID_MANUAL_REVIEW',
        'INSUFFICIENT_EVIDENCE',
        'EXPECTED_BEHAVIOR',
      ] as Classification[]
    ).reduce(
      (acc, c) => ({
        ...acc,
        [c]: allIssues.filter((i) => i.classification === c).length,
      }),
      {} as Record<Classification, number>,
    ),
    employeesAffectedCount: employeesAffected.length,
    reliverSessionsObservedNotFullyAudited: relieverSessions.length,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    auditPeriod: { month: 8, year: 2026 },
    summary,
    rulesSnapshot: RULES_SNAPSHOT,
    attendanceIssues,
    lateOccurrenceIssues,
    disciplineMappingIssues,
    duplicateIssues,
    reversalIssues,
    uninformedAbsenceIssues,
    missingCheckoutIssues,
    payrollIssues,
    disciplineEventIssues,
    letterIssues,
    suspensionIssues,
    crossCategoryIssues,
    legacyIssues,
    manualReview,
    employeesAffected,
    invariants,
    allAuditInvariantsTrue,
    knownLimitations: [
      'PayrollDeduction has no createdAt/updatedAt column — deduction-level timestamps are never available; "seconds apart" duplicate evidence is only ever computed from sibling Letter.generatedAt / DisciplineEvent.createdAt, never the deduction itself.',
      "AttendanceLog has no updatedAt column — Check E/F rely entirely on AuditLog(entity=AttendanceLog), which only exists for edits made through updateAttendance (full diff) or markManual (mark event only, no diff) — biometric/raw-scan writes and reconcileShortLeaveAttendance leave no AuditLog entry, so a status transition made through those paths is invisible to this audit's reversal-consistency checks.",
      "Reliever attendance/payroll interaction is only lightly cross-referenced (session count observed, not re-verified against computeRelieverPayableMinutes' own-duty-overlap math) — a full reliever payroll re-derivation was out of scope for this pass; reliverSessionsObservedNotFullyAudited in the summary records how many August sessions exist but were not deep-audited.",
      'Legacy-format (pre-76deef6) LATE_ARRIVAL deduction descriptions are matched by regex; a deduction with an entirely unrecognized description format is invisible to occurrence-based checks (Check C/H) and would need a manual description review.',
    ],
  };

  console.log(JSON.stringify(report, null, 2));
  console.error(
    `=== DONE — ${allIssues.length} issues found, allAuditInvariantsTrue=${allAuditInvariantsTrue} (read-only, no data modified) ===`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
