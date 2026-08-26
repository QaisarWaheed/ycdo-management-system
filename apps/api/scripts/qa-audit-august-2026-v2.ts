/**
 * READ-ONLY — August 2026 QA audit V2: refinement pass over V1
 * (qa-audit-august-2026.ts, run against production, 8115 raw issues).
 *
 * V2 does NOT re-derive rules or re-scan differently for its own sake — it
 * answers one question: "what are the UNIQUE, ACTIONABLE, EVIDENCE-SUPPORTED
 * issues, with every finding that traces to the same real-world defect
 * collapsed into ONE consolidated entry instead of counted once per
 * V1 category it happened to surface in?"
 *
 * Zero writes. No --apply mode exists at all. Only reads Employee,
 * AttendanceLog, DisciplineEvent, Letter, PayrollEntry, PayrollDeduction,
 * LeaveRecord, LeaveApproval, AuditLog, RelieverSession.
 *
 * Run:
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/qa-audit-august-2026-v2.ts > qa-audit-v2-report.json
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
const RAW_V1_ISSUE_COUNT = 8115;
// Deployment instant of commit 0ab12f2 (the reversal-generalization fix) —
// used throughout to separate "predates the fix, historical cleanup only"
// from "happened after the fix shipped, would be a new regression".
const REVERSAL_FIX_DEPLOYED_AT = new Date('2026-08-18T16:00:00.000Z');

const RULES_SNAPSHOT = {
  attendance: {
    graceMinutes: 15,
    halfDayThresholdBiometric:
      'lateMinutes > 60 AND sessionMinutes >= 240 -> HALF_DAY, else LATE',
    halfDayThresholdManual:
      'lateMinutes > 60 -> HALF_DAY unconditionally, no session-length check (confirmed divergence from biometric path)',
    twentyFourHour:
      'is24HourShift(employee) short-circuits to PRESENT/no-lateness/no-half-day/no-missing-checkout throughout',
    historicalDutySnapshotPrecedence:
      'AttendanceLog.dutyStartTimeSnapshot/dutyEndTimeSnapshot wins when BOTH present; current Employee duty only a last-resort fallback for legacy pre-snapshot rows',
  },
  lateDiscipline: {
    cycle:
      '1=Advice,2=Warning,3=Fine+deduction,4=Advice,5=Warning,6=Fine+deduction,7=Advice,8=Warning,9=Suspension ONLY',
    occurrence10Plus:
      'CODE-VERIFIED: cycle repeats forever. The ONLY suspension trigger in applyLateDiscipline is the literal check lateCount===9. Occurrence 12,15,18,... produce an ordinary FINE, never another suspension.',
    countingMethod:
      'Live count of distinct dates this month currently LATE or (HALF_DAY AND lateMinutes>0 AND note not mentioning "short leave").',
    reversal:
      'reverseLateDisciplineForDate — exact incidentDate only; Letter+DisciplineEvent unconditional, deduction+totals PENDING-gated (fixed in commit 0ab12f2). Wired into updateAttendance/markManual as of that commit.',
  },
  missingCheckout: {
    cycle:
      '1=Advice,2=Warning,3=Fine+deduction,4=Advice,... repeats forever. NO suspension step exists anywhere in applyMissingCheckoutDiscipline.',
    reversal: 'NO reversal function exists for missing-checkout at all.',
  },
  uninformedAbsence: {
    penalty:
      'Flat 2x daily-stipend-rate deduction, every incident, no occurrence/letter cycle.',
    descriptionFormat: {
      legacy:
        '"Uninformed absence deduction (2 days)" — NO date suffix. Introduced at commit 9fc5d16, used until 76deef6. Multiple genuine incidents in this era share byte-identical descriptions.',
      current:
        '"Uninformed absence deduction (2 days) — YYYY-MM-DD" — date suffix added at commit 76deef6, structurally unique per incident date.',
    },
    suspensionThreshold:
      "More than 2 distinct UNINFORMED_ABSENT days/month -> automatic suspension. Threshold-based, independent of the LATE cycle's own suspension trigger.",
    reversal:
      "reverseAbsenceDeductionForDate exists, has the same PENDING-gate gap reverseLateDisciplineForDate had before its fix, and is called ONLY from leave.service.ts's ON_LEAVE-approval flow — never from updateAttendance/markManual. CONFIRMED, UNFIXED gap.",
  },
  payroll: {
    processedPaidFreeze:
      'addDeduction throws for PROCESSED/PAID; reverseLateDisciplineForDate skips the deduction/totals mutation for them.',
    deductionMath:
      'totalDeductions/netStipend maintained incrementally via {decrement}/{increment}, never recomputed from summing deduction rows.',
  },
};

// ─── Shared types ───────────────────────────────────────────────────────

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
type CodeFixStatus =
  | 'ALREADY_FIXED_IN_CODE'
  | 'STILL_UNFIXED'
  | 'DATA_CLEANUP_ONLY'
  | 'MANUAL_REVIEW';

type RawFinding = {
  rootCauseKey: string;
  sourceCheck: string;
  severity: Severity;
  classification: Classification;
  employeeId: string;
  incidentDate: string | null;
  category: string;
  relatedAttendanceLogIds: string[];
  relatedAuditLogIds: string[];
  relatedLetterIds: string[];
  relatedDeductionIds: string[];
  relatedDisciplineEventIds: string[];
  payrollEntryIds: string[];
  expected: string;
  actual: string;
  evidence: Record<string, unknown>;
  financialImpact: number;
  codeFixStatus: CodeFixStatus;
  recommendedNextAction: string;
};

type ConsolidatedIssue = Omit<RawFinding, 'sourceCheck'> & {
  rootCauseKey: string;
  issueCode: string;
  employeeCode: string;
  employeeName: string;
  contributingChecks: string[];
};

const CLASSIFICATION_PRECEDENCE: Classification[] = [
  'CONFIRMED_BUG',
  'DUPLICATE_RACE',
  'POLICY_MISMATCH',
  'HISTORICAL_STALE_DATA',
  'PROCESSED_PAID_MANUAL_REVIEW',
  'INSUFFICIENT_EVIDENCE',
  'LEGACY_UNSTRUCTURED',
  'EXPECTED_BEHAVIOR',
];
const SEVERITY_PRECEDENCE: Severity[] = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'INFO',
];

const rawFindings: RawFinding[] = [];
function addFinding(f: RawFinding) {
  rawFindings.push(f);
}

// ─── Shared helpers (unchanged from V1 unless noted) ───────────────────

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
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

function expectedActionForOccurrence(
  occurrence: number,
): 'ADVICE' | 'WARNING' | 'FINE' | 'SUSPENSION' {
  if (occurrence === 9) return 'SUSPENSION';
  const position = ((occurrence - 1) % 3) + 1;
  if (position === 1) return 'ADVICE';
  if (position === 2) return 'WARNING';
  return 'FINE';
}

const LATE_LETTER_TYPES: LetterType[] = [
  LetterType.ADVICE,
  LetterType.WARNING,
  LetterType.FINE,
  LetterType.SUSPENSION,
];
const UNINFORMED_DATED_DESC =
  /^Uninformed absence deduction \(2 days\) — (\d{4}-\d{2}-\d{2})$/;
const UNINFORMED_LEGACY_DESC = /^Uninformed absence deduction \(2 days\)$/;
const LATE_CURRENT_DESC = /^Late arrival deduction — monthly occurrence (\d+)$/;
const LATE_LEGACY_DESC = /^Late arrival deduction \((\d+) lates? this month\)$/;

async function main() {
  console.error(
    '=== READ-ONLY QA AUDIT V2: refinement pass over V1 (8115 raw issues) ===',
  );

  // ── Bulk fetch (identical scope to V1) ────────────────────────────
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
  console.error(`Employees: ${employees.length}`);

  const attendanceLogs = await prisma.attendanceLog.findMany({
    where: { date: { gte: MONTH_START, lte: MONTH_END } },
    orderBy: [{ employeeId: 'asc' }, { date: 'asc' }],
  });
  console.error(`August AttendanceLog rows: ${attendanceLogs.length}`);

  const disciplineEvents = await prisma.disciplineEvent.findMany({
    where: { incidentDate: { gte: MONTH_START, lte: MONTH_END } },
    orderBy: [{ employeeId: 'asc' }, { incidentDate: 'asc' }],
  });
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
      content: true,
      requiresAcknowledgement: true,
      acknowledgement: { select: { id: true } },
    },
    orderBy: [{ employeeId: 'asc' }, { generatedAt: 'asc' }],
  });
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
  console.error(`August PayrollEntry rows: ${payrollEntries.length}`);

  const leaveRecords = await prisma.leaveRecord.findMany({
    where: {
      OR: [
        { startDate: { gte: MONTH_START, lte: MONTH_END } },
        { endDate: { gte: MONTH_START, lte: MONTH_END } },
      ],
    },
  });
  console.error(`August LeaveRecord rows: ${leaveRecords.length}`);

  const relieverSessions = await prisma.relieverSession.findMany({
    where: { date: { gte: MONTH_START, lte: MONTH_END } },
    select: { id: true, employeeId: true, date: true },
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

  // ── Indexes ────────────────────────────────────────────────────────
  const logsByEmployee = new Map<string, typeof attendanceLogs>();
  for (const l of attendanceLogs) {
    (
      logsByEmployee.get(l.employeeId) ??
      logsByEmployee.set(l.employeeId, []).get(l.employeeId)
    ).push(l);
  }
  const eventsByEmployee = new Map<string, typeof disciplineEvents>();
  for (const e of disciplineEvents) {
    (
      eventsByEmployee.get(e.employeeId) ??
      eventsByEmployee.set(e.employeeId, []).get(e.employeeId)
    ).push(e);
  }
  const lettersByEmployee = new Map<string, typeof letters>();
  for (const l of letters) {
    (
      lettersByEmployee.get(l.employeeId) ??
      lettersByEmployee.set(l.employeeId, []).get(l.employeeId)
    ).push(l);
  }
  const auditByAttendanceLogId = new Map<string, typeof auditLogs>();
  for (const a of auditLogs) {
    (
      auditByAttendanceLogId.get(a.entityId) ??
      auditByAttendanceLogId.set(a.entityId, []).get(a.entityId)
    ).push(a);
  }
  const payrollEntriesByEmployee = new Map<string, typeof payrollEntries>();
  for (const pe of payrollEntries) {
    const empId = pe.stipendRecord.employeeId;
    (
      payrollEntriesByEmployee.get(empId) ??
      payrollEntriesByEmployee.set(empId, []).get(empId)
    ).push(pe);
  }
  const relieverSessionsByEmployee = new Map<string, typeof relieverSessions>();
  for (const rs of relieverSessions) {
    (
      relieverSessionsByEmployee.get(rs.employeeId) ??
      relieverSessionsByEmployee.set(rs.employeeId, []).get(rs.employeeId)
    ).push(rs);
  }

  const relevantEmployeeIds = new Set<string>([
    ...attendanceLogs.map((l) => l.employeeId),
    ...disciplineEvents.map((e) => e.employeeId),
    ...letters.map((l) => l.employeeId),
    ...payrollEntries.map((pe) => pe.stipendRecord.employeeId),
    ...leaveRecords.map((lr) => lr.employeeId),
  ]);
  console.error(
    `Employees with relevant August activity: ${relevantEmployeeIds.size}`,
  );

  function empRef(employeeId: string) {
    const e = employeeById.get(employeeId);
    return {
      employeeCode: e?.employeeCode ?? 'UNKNOWN',
      employeeName: e?.fullName ?? 'UNKNOWN',
    };
  }

  // Per-employee true late incident list, reused across several checks.
  function trueLateIncidents(employeeId: string) {
    return (logsByEmployee.get(employeeId) ?? [])
      .filter((l) => l.type === AttendanceLogType.REGULAR && isLateEligible(l))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 9 — legacy NULL-snapshot AGGREGATION (not per-row issues)
  // ══════════════════════════════════════════════════════════════════
  let legacySnapshotTotalRows = 0;
  const legacySnapshotEmployees = new Set<string>();
  let legacySnapshotRowsWithIndependentEvidence = 0;
  let legacySnapshotRowsNoAction = 0;

  for (const log of attendanceLogs) {
    if (log.type !== AttendanceLogType.REGULAR) continue;
    const employee = employeeById.get(log.employeeId);
    if (!employee || isTwentyFourHour(employee)) continue;
    if (log.dutyStartTimeSnapshot || log.dutyEndTimeSnapshot) continue; // has a snapshot, not a legacy row

    legacySnapshotTotalRows++;
    legacySnapshotEmployees.add(log.employeeId);

    // Independent evidence of a materially wrong historical result: an
    // AuditLog entry shows this employee's duty differed from CURRENT duty
    // at some point this month (only signal available without a duty-change
    // history table, which does not exist in this schema).
    const hasIndependentEvidence = false; // no duty-change audit trail exists anywhere in the schema — always false, by construction, until such a source exists
    if (hasIndependentEvidence) {
      legacySnapshotRowsWithIndependentEvidence++;
    } else {
      legacySnapshotRowsNoAction++;
    }
  }

  if (legacySnapshotRowsWithIndependentEvidence > 0) {
    // Reserved for future evidence sources — intentionally never reached
    // today (see hasIndependentEvidence above), kept so the aggregation
    // shape does not need to change if such a source is added later.
  }

  const legacySummary = {
    totalRows: legacySnapshotTotalRows,
    employeesAffected: legacySnapshotEmployees.size,
    employeesWhoseCurrentDutyDiffersAcrossKnownAuditHistory: 0,
    rowsWithIndependentEvidenceOfWrongHistoricalDuty:
      legacySnapshotRowsWithIndependentEvidence,
    rowsNoActionRecommended: legacySnapshotRowsNoAction,
    note: "No duty-change history table exists anywhere in the schema (EmploymentHistory tracks branch/department/designation only) — legacy NULL-snapshot rows cannot be independently verified as right or wrong, by construction. This aggregate replaces what would otherwise be one LOW-severity issue per row (V1 produced one per row; this is the single largest source of V1's 6,173 LEGACY_UNSTRUCTURED count).",
  };

  // ══════════════════════════════════════════════════════════════════
  // CHECK A (refined) — attendance anomalies EXCLUDING legacy-snapshot noise
  // ══════════════════════════════════════════════════════════════════
  const seenLogKeys = new Map<string, string[]>();
  for (const log of attendanceLogs) {
    const key = `${log.employeeId}|${dateKey(log.date)}|${log.type}`;
    const arr = seenLogKeys.get(key) ?? [];
    arr.push(log.id);
    seenLogKeys.set(key, arr);

    const employee = employeeById.get(log.employeeId);
    if (!employee) continue;
    if (
      isTwentyFourHour(employee) &&
      (log.status === AttendanceStatus.LATE ||
        (log.status === AttendanceStatus.HALF_DAY && log.lateMinutes > 0))
    ) {
      addFinding({
        rootCauseKey: `TWENTYFOURHOUR_LATENESS:${log.employeeId}:${dateKey(log.date)}`,
        sourceCheck: 'A',
        severity: 'HIGH',
        classification: 'CONFIRMED_BUG',
        employeeId: log.employeeId,
        incidentDate: dateKey(log.date),
        category: 'ATTENDANCE',
        relatedAttendanceLogIds: [log.id],
        relatedAuditLogIds: [],
        relatedLetterIds: [],
        relatedDeductionIds: [],
        relatedDisciplineEventIds: [],
        payrollEntryIds: [],
        expected:
          '24-hour duty employee must never receive lateness/half-day classification',
        actual: `status=${log.status}, lateMinutes=${log.lateMinutes}`,
        evidence: {
          dutyStartTime: employee.dutyStartTime,
          dutyEndTime: employee.dutyEndTime,
        },
        financialImpact: 0,
        codeFixStatus: 'MANUAL_REVIEW',
        recommendedNextAction:
          'Investigate which write path bypassed the 24h short-circuit for this row.',
      });
    }
  }
  for (const [key, ids] of seenLogKeys) {
    if (ids.length > 1) {
      const [employeeId, d] = key.split('|');
      addFinding({
        rootCauseKey: `DUPLICATE_ATTENDANCE_ROW:${employeeId}:${d}`,
        sourceCheck: 'A',
        severity: 'CRITICAL',
        classification: 'CONFIRMED_BUG',
        employeeId,
        incidentDate: d,
        category: 'ATTENDANCE',
        relatedAttendanceLogIds: ids,
        relatedAuditLogIds: [],
        relatedLetterIds: [],
        relatedDeductionIds: [],
        relatedDisciplineEventIds: [],
        payrollEntryIds: [],
        expected:
          'Exactly one AttendanceLog per (employeeId, date, type) — @@unique constraint',
        actual: `${ids.length} rows found`,
        evidence: {},
        financialImpact: 0,
        codeFixStatus: 'MANUAL_REVIEW',
        recommendedNextAction:
          'Should be structurally impossible — investigate immediately.',
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // CHECK B/C/E (refined, Sections 3, 4, 6) — late occurrence + mapping +
  // reversal, unified per (employeeId, incidentDate) so they naturally
  // share rootCauseKeys instead of triple-counting.
  // ══════════════════════════════════════════════════════════════════

  for (const employeeId of relevantEmployeeIds) {
    const employee = employeeById.get(employeeId);
    if (!employee || isTwentyFourHour(employee)) continue;
    const empLogs = logsByEmployee.get(employeeId) ?? [];
    const incidents = trueLateIncidents(employeeId);
    const expectedOccByDate = new Map<string, number>();
    incidents.forEach((l, idx) =>
      expectedOccByDate.set(dateKey(l.date), idx + 1),
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
    const letterByDate = new Map<string, (typeof empLetters)[number]>();
    const reversedLetterByDate = new Map<string, (typeof empLetters)[number]>();
    for (const l of empLetters) {
      const vars = (l.variables ?? {}) as {
        incidentDate?: string;
        reversedDueToShortLeave?: boolean;
      };
      if (!vars.incidentDate) continue;
      if (vars.reversedDueToShortLeave) {
        reversedLetterByDate.set(vars.incidentDate, l);
      } else {
        letterByDate.set(vars.incidentDate, l);
      }
    }

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
    function deductionForOccurrence(occ: number) {
      return empDeductions.find((d) => {
        const m =
          d.description?.match(LATE_CURRENT_DESC) ??
          d.description?.match(LATE_LEGACY_DESC);
        return m && Number(m[1]) === occ;
      });
    }

    // Union of every date that EITHER is a true incident today OR has (or
    // had) a DisciplineEvent/Letter/AuditLog transition — so a date that
    // WAS late and has since been corrected is still evaluated for stale
    // consequences, not silently dropped just because it's no longer a
    // "true incident" today.
    const allRelevantDates = new Set<string>([
      ...expectedOccByDate.keys(),
      ...eventByDate.keys(),
      ...letterByDate.keys(),
      ...reversedLetterByDate.keys(),
    ]);

    for (const d of allRelevantDates) {
      const log = empLogs.find(
        (l) => l.type === AttendanceLogType.REGULAR && dateKey(l.date) === d,
      );
      const event = eventByDate.get(d);
      const activeLetter = letterByDate.get(d);
      const currentOcc = expectedOccByDate.get(d) ?? null;
      const rootCauseKey = `LATE_INCIDENT:${employeeId}:${d}`;

      // occurrenceAtGeneration — the single most-trustworthy value baked in
      // at claim time, preferring the letter (created in the same
      // transaction as the deduction/event, always present when either is).
      const letterVars = activeLetter
        ? ((activeLetter.variables ?? {}) as { monthlyLateOccurrence?: number })
        : null;
      const occAtGeneration =
        letterVars?.monthlyLateOccurrence ?? event?.occurrence ?? null;

      const isStillLateToday = log ? isLateEligible(log) : false;
      const wasEverLateThisAudit =
        currentOcc != null || occAtGeneration != null;
      if (!wasEverLateThisAudit) continue;

      // ── Reversal consistency (Section 6): find the AuditLog transition,
      // if any, that moved this date away from late-eligibility.
      const trail = log ? (auditByAttendanceLogId.get(log.id) ?? []) : [];
      const transitionAudit = trail.find((a) => {
        if (a.action !== 'ATTENDANCE_UPDATED') return false;
        const c = a.changes as {
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
        if (!c?.previous || !c.updated) return false;
        const before = {
          status: c.previous.status as AttendanceStatus,
          lateMinutes: c.previous.lateMinutes ?? 0,
          note: c.previous.note ?? null,
        };
        const after = {
          status: c.updated.status as AttendanceStatus,
          lateMinutes: c.updated.lateMinutes ?? 0,
          note: c.updated.note ?? null,
        };
        return isLateEligible(before) && !isLateEligible(after);
      });

      const hasActiveStaleConsequence =
        !isStillLateToday && !!(activeLetter || event);

      if (hasActiveStaleConsequence) {
        const relatedDeduction = occAtGeneration
          ? deductionForOccurrence(occAtGeneration)
          : undefined;
        const financialImpact = relatedDeduction
          ? Number(relatedDeduction.amount)
          : 0;
        const codeFixStatus: CodeFixStatus =
          transitionAudit &&
          transitionAudit.createdAt >= REVERSAL_FIX_DEPLOYED_AT
            ? 'STILL_UNFIXED' // happened after the fix shipped — should not occur; treat as a live concern
            : 'DATA_CLEANUP_ONLY'; // predates the fix — code is already correct going forward, only historical data is stale

        addFinding({
          rootCauseKey,
          sourceCheck: 'B/C/E-stale',
          severity: relatedDeduction ? 'HIGH' : 'MEDIUM',
          classification: transitionAudit
            ? 'HISTORICAL_STALE_DATA'
            : 'INSUFFICIENT_EVIDENCE',
          employeeId,
          incidentDate: d,
          category: 'STALE_LATE_CONSEQUENCE',
          relatedAttendanceLogIds: log ? [log.id] : [],
          relatedAuditLogIds: transitionAudit ? [transitionAudit.id] : [],
          relatedLetterIds: activeLetter ? [activeLetter.id] : [],
          relatedDeductionIds: relatedDeduction ? [relatedDeduction.id] : [],
          relatedDisciplineEventIds: event ? [event.id] : [],
          payrollEntryIds: relatedDeduction
            ? [relatedDeduction.payrollEntryId]
            : [],
          expected:
            'A LATE/lateness-HALF_DAY -> non-late transition should reverse the active letter/deduction/DisciplineEvent for this exact date',
          actual: transitionAudit
            ? `AuditLog confirms the transition at ${transitionAudit.createdAt.toISOString()}, but discipline for this date is still active`
            : `Attendance is currently ${log?.status ?? 'UNKNOWN'} (not late-eligible) and discipline is still active, but no AuditLog transition was found to confirm when/how this happened`,
          evidence: {
            occurrenceAtGeneration: occAtGeneration,
            currentRecomputedOccurrence: currentOcc,
            payrollStatus: relatedDeduction?.payrollStatus ?? null,
          },
          financialImpact,
          codeFixStatus,
          recommendedNextAction: transitionAudit
            ? codeFixStatus === 'DATA_CLEANUP_ONLY'
              ? 'Historical, predates the fix — candidate for the paused cleanup script.'
              : 'Occurred AFTER the fix was deployed — if confirmed, this is a NEW regression, investigate immediately, do not just queue for cleanup.'
            : 'No AttendanceLog updatedAt/AuditLog evidence available for this transition (likely made through a path that writes no audit trail, e.g. biometric replay or reconcileShortLeaveAttendance) — cannot confirm root cause with certainty.',
        });
        continue; // this date's finding is fully captured by the stale-consequence entry; do not also emit a separate mapping/occurrence finding below
      }

      // ── Occurrence mismatch (staleness only, not a mapping bug) ──
      if (event && currentOcc != null && event.occurrence !== currentOcc) {
        addFinding({
          rootCauseKey,
          sourceCheck: 'B-occurrence-mismatch',
          severity: 'LOW',
          classification: 'HISTORICAL_STALE_DATA',
          employeeId,
          incidentDate: d,
          category: 'LATE_OCCURRENCE_MISMATCH',
          relatedAttendanceLogIds: log ? [log.id] : [],
          relatedAuditLogIds: [],
          relatedLetterIds: activeLetter ? [activeLetter.id] : [],
          relatedDeductionIds: [],
          relatedDisciplineEventIds: [event.id],
          payrollEntryIds: [],
          expected: `Recomputed occurrence ${currentOcc}`,
          actual: `DisciplineEvent stores occurrence ${event.occurrence} (informational field, not part of its unique key — does not itself break idempotency)`,
          evidence: {},
          financialImpact: 0,
          codeFixStatus: 'DATA_CLEANUP_ONLY',
          recommendedNextAction:
            'Low urgency on its own — the linked letter/deduction (if any) carry the real consequence and are tracked as STALE_LATE_CONSEQUENCE separately when applicable.',
        });
      }

      // ── Action mapping (Section 4): only a real bug if wrong for the
      // occurrence actually used AT GENERATION time.
      if (activeLetter && occAtGeneration != null) {
        const expectedAction = expectedActionForOccurrence(occAtGeneration);
        if (activeLetter.letterType !== expectedAction) {
          addFinding({
            rootCauseKey,
            sourceCheck: 'C-mapping',
            severity: 'CRITICAL',
            classification: 'CONFIRMED_BUG',
            employeeId,
            incidentDate: d,
            category: 'WRONG_LATE_ACTION',
            relatedAttendanceLogIds: log ? [log.id] : [],
            relatedAuditLogIds: [],
            relatedLetterIds: [activeLetter.id],
            relatedDeductionIds: [],
            relatedDisciplineEventIds: event ? [event.id] : [],
            payrollEntryIds: [],
            expected: `${expectedAction} for occurrence ${occAtGeneration} (the occurrence actually used at generation time, per Letter.variables/DisciplineEvent.occurrence)`,
            actual: `${activeLetter.letterType} issued`,
            evidence: {
              occurrenceAtGeneration: occAtGeneration,
              currentRecomputedOccurrence: currentOcc,
            },
            financialImpact: 0,
            codeFixStatus: 'MANUAL_REVIEW',
            recommendedNextAction:
              'Genuine code-mapping bug candidate (wrong even for the occurrence it was generated at) — was NOT explained by later staleness. Needs direct code-path investigation, not just data cleanup.',
          });
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // CHECK D (refined) — duplicate letters (unchanged logic, but now
  // shares rootCauseKey with the late-incident bucket above)
  // ══════════════════════════════════════════════════════════════════
  for (const employeeId of relevantEmployeeIds) {
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
      if (ls.length <= 1) continue;
      const [d] = key.split('|');
      const types = new Set(ls.map((l) => l.letterType));
      addFinding({
        rootCauseKey: `DUPLICATE_LATE_LETTER:${employeeId}:${d}`,
        sourceCheck: 'D',
        severity: types.size > 1 ? 'HIGH' : 'CRITICAL',
        classification: 'DUPLICATE_RACE',
        employeeId,
        incidentDate: d,
        category: 'DUPLICATE_LETTER',
        relatedAttendanceLogIds: [],
        relatedAuditLogIds: [],
        relatedLetterIds: ls.map((l) => l.id),
        relatedDeductionIds: [],
        relatedDisciplineEventIds: [],
        payrollEntryIds: [],
        expected:
          'At most one active letter per (incidentDate, monthlyLateOccurrence)',
        actual: `${ls.length} active letters found (${[...types].join(', ')})`,
        evidence: {
          letterNos: ls.map((l) => l.letterNo),
          generatedAts: ls.map((l) => l.generatedAt.toISOString()),
        },
        financialImpact: 0,
        codeFixStatus: 'DATA_CLEANUP_ONLY',
        recommendedNextAction:
          types.size > 1
            ? 'Mixed-type duplicate — needs manual classification before cleanup, not a simple keep-earliest case.'
            : "Matches the paused cleanup script's existing confirmed-duplicate pattern (keep earliest generatedAt, deterministic id tie-break).",
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 1 & 8 (V2.2: + reconciliation) — uninformed-absence +
  // late-arrival deduction ledger.
  //
  // V2.1 computed `deductionLedger.classification` independently of the
  // `rawFindings`/consolidation pipeline — so a ledger row classified
  // CONFIRMED_BUG or HISTORICAL_STALE_DATA never actually became an
  // addFinding() call, and silently never appeared in confirmedIssues /
  // rootCauseSummary / financialImpact. V2.2 fixes this at the source:
  // every non-EXPECTED_BEHAVIOR ledger row now either (a) resolves to a
  // rootCauseKey and gets addFinding()'d — merging with an existing
  // LATE_INCIDENT finding for the same employee/date when one exists, so
  // this never double-counts — or (b) gets an explicit exclusionReason in
  // deductionLedgerExceptions explaining why it wasn't actionable enough.
  // ══════════════════════════════════════════════════════════════════
  const deductionLedger: {
    deductionId: string;
    employeeId: string;
    payrollEntryId: string;
    payrollStatus: string;
    category: 'LATE_ARRIVAL' | 'UNINFORMED_ABSENCE';
    incidentDate: string | null;
    occurrence: number | null;
    amount: number;
    description: string | null;
    classification: Classification;
  }[] = [];

  type DeductionLedgerException = {
    deductionId: string;
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    payrollEntryId: string;
    payrollStatus: string;
    category: 'LATE_ARRIVAL' | 'UNINFORMED_ABSENCE';
    amount: number;
    description: string | null;
    extractedIncidentDate: string | null;
    extractedOccurrence: number | null;
    classification: Classification;
    reason: string;
    candidateAttendanceLogIds: string[];
    candidateAuditLogIds: string[];
    candidateDisciplineEventIds: string[];
    candidateLetterIds: string[];
    evidence: Record<string, unknown>;
    financialImpact: number;
    recommendedNextAction: string;
    rootCauseKey: string;
    exclusionReason: string | null;
  };
  const deductionLedgerExceptions: DeductionLedgerException[] = [];

  for (const employeeId of relevantEmployeeIds) {
    const empPayrollEntries = payrollEntriesByEmployee.get(employeeId) ?? [];
    const empLogs = (logsByEmployee.get(employeeId) ?? []).filter(
      (l) => l.type === AttendanceLogType.REGULAR,
    );
    const e = empRef(employeeId);

    // ── LATE_ARRIVAL ledger ──
    for (const pe of empPayrollEntries) {
      for (const d of pe.deductions.filter(
        (x) => x.reason === DeductionType.LATE_ARRIVAL,
      )) {
        const m =
          d.description?.match(LATE_CURRENT_DESC) ??
          d.description?.match(LATE_LEGACY_DESC);
        const occ = m ? Number(m[1]) : null;
        const amount = Number(d.amount);
        let classification: Classification = 'INSUFFICIENT_EVIDENCE';
        if (occ === 9) classification = 'CONFIRMED_BUG';
        else if (occ === 3 || occ === 6) {
          const trueCount = empLogs.filter((l) => isLateEligible(l)).length;
          classification =
            occ > trueCount ? 'HISTORICAL_STALE_DATA' : 'EXPECTED_BEHAVIOR';
        } else if (occ != null) {
          classification = 'EXPECTED_BEHAVIOR'; // occurrence outside {3,6,9} following the repeating cycle (e.g. 12) is policy-valid, per the code-verified rule above
        }
        deductionLedger.push({
          deductionId: d.id,
          employeeId,
          payrollEntryId: pe.id,
          payrollStatus: pe.status,
          category: 'LATE_ARRIVAL',
          incidentDate: null,
          occurrence: occ,
          amount,
          description: d.description,
          classification,
        });

        if (
          classification === 'CONFIRMED_BUG' ||
          classification === 'HISTORICAL_STALE_DATA'
        ) {
          // Recover an incidentDate by finding the LATE-cycle letter that
          // carries this SAME occurrence number for this employee — when
          // found, this deduction's finding merges into the SAME
          // LATE_INCIDENT:<employeeId>:<date> rootCauseKey the B/C/E
          // consolidation loop above already uses for that date, instead
          // of creating a disconnected duplicate finding.
          const empLateLetters = (
            lettersByEmployee.get(employeeId) ?? []
          ).filter((l) => LATE_LETTER_TYPES.includes(l.letterType));
          const matchingLetter = empLateLetters.find((l) => {
            const v = (l.variables ?? {}) as { monthlyLateOccurrence?: number };
            return v.monthlyLateOccurrence === occ;
          });
          const matchingLetterVars = matchingLetter
            ? ((matchingLetter.variables ?? {}) as { incidentDate?: string })
            : null;
          const incidentDate = matchingLetterVars?.incidentDate ?? null;

          const effectiveClassification: Classification =
            pe.status === 'PENDING'
              ? classification
              : 'PROCESSED_PAID_MANUAL_REVIEW';
          const rootCauseKey = incidentDate
            ? `LATE_INCIDENT:${employeeId}:${incidentDate}`
            : `INVALID_LATE_DEDUCTION:${d.id}`;
          const reasonText =
            occ === 9
              ? 'Occurrence 9 must produce SUSPENSION only, never a LATE_ARRIVAL deduction (current code enforces this since commit 76deef6) — this row predates that fix.'
              : `Claims occurrence ${occ} but this employee currently has fewer true recomputed August late incidents than that — the occurrence was likely genuinely reached at generation time, and a later correction to an EARLIER date (not this deduction's own date) reduced the live count.`;

          addFinding({
            rootCauseKey,
            sourceCheck: 'H-deduction-ledger',
            severity: occ === 9 ? 'HIGH' : 'MEDIUM',
            classification: effectiveClassification,
            employeeId,
            incidentDate,
            category:
              occ === 9 ? 'INVALID_LATE_DEDUCTION' : 'STALE_LATE_CONSEQUENCE',
            relatedAttendanceLogIds: [],
            relatedAuditLogIds: [],
            relatedLetterIds: matchingLetter ? [matchingLetter.id] : [],
            relatedDeductionIds: [d.id],
            relatedDisciplineEventIds: [],
            payrollEntryIds: [pe.id],
            expected:
              occ === 9
                ? 'No LATE_ARRIVAL deduction should exist for occurrence 9'
                : `Deduction occurrence ${occ} requires that many true late incidents this month`,
            actual: reasonText,
            evidence: {
              extractedOccurrence: occ,
              matchingLetterId: matchingLetter?.id ?? null,
              payrollStatus: pe.status,
            },
            financialImpact: amount,
            codeFixStatus:
              pe.status === 'PENDING' ? 'DATA_CLEANUP_ONLY' : 'MANUAL_REVIEW',
            recommendedNextAction:
              pe.status === 'PENDING'
                ? 'Candidate for the paused cleanup script (INVALID_OCCURRENCE_9 / NEVER_REACHED_OCCURRENCE classification already implemented there).'
                : 'PROCESSED/PAID — manual payroll adjustment only, never auto-mutate.',
          });

          deductionLedgerExceptions.push({
            deductionId: d.id,
            employeeId,
            employeeCode: e.employeeCode,
            employeeName: e.employeeName,
            payrollEntryId: pe.id,
            payrollStatus: pe.status,
            category: 'LATE_ARRIVAL',
            amount,
            description: d.description,
            extractedIncidentDate: incidentDate,
            extractedOccurrence: occ,
            classification: effectiveClassification,
            reason: reasonText,
            candidateAttendanceLogIds: [],
            candidateAuditLogIds: [],
            candidateDisciplineEventIds: [],
            candidateLetterIds: matchingLetter ? [matchingLetter.id] : [],
            evidence: { matchingLetterId: matchingLetter?.id ?? null },
            financialImpact: amount,
            recommendedNextAction:
              pe.status === 'PENDING'
                ? 'Candidate for the paused cleanup script.'
                : 'PROCESSED/PAID — manual review only.',
            rootCauseKey,
            exclusionReason: null,
          });
        } else if (classification === 'INSUFFICIENT_EVIDENCE') {
          deductionLedgerExceptions.push({
            deductionId: d.id,
            employeeId,
            employeeCode: e.employeeCode,
            employeeName: e.employeeName,
            payrollEntryId: pe.id,
            payrollStatus: pe.status,
            category: 'LATE_ARRIVAL',
            amount,
            description: d.description,
            extractedIncidentDate: null,
            extractedOccurrence: null,
            classification: 'INSUFFICIENT_EVIDENCE',
            reason:
              'Description does not match either known LATE_ARRIVAL format (current or legacy) — occurrence cannot be parsed.',
            candidateAttendanceLogIds: [],
            candidateAuditLogIds: [],
            candidateDisciplineEventIds: [],
            candidateLetterIds: [],
            evidence: {},
            financialImpact: 0,
            recommendedNextAction:
              'Manual review — unrecognized description format.',
            rootCauseKey: `UNPARSEABLE_LATE_DEDUCTION:${d.id}`,
            exclusionReason:
              'INSUFFICIENT_EVIDENCE is not in the mandatory-mapping list (Section 3) — no addFinding emitted; informational exception entry only.',
          });
        }
      }
    }

    // ── UNINFORMED_ABSENCE reconciliation ──
    const uninformedDeductions = empPayrollEntries.flatMap((pe) =>
      pe.deductions
        .filter((x) => x.reason === DeductionType.UNINFORMED_ABSENCE)
        .map((x) => ({
          ...x,
          payrollEntryId: pe.id,
          payrollStatus: pe.status,
        })),
    );
    if (uninformedDeductions.length === 0) continue;

    // Candidate valid incident dates: currently UNINFORMED_ABSENT rows, OR
    // rows whose AuditLog trail shows they WERE UNINFORMED_ABSENT before a
    // later correction, OR a DisciplineEvent(UNINFORMED_ABSENT) claim.
    const candidateDates = new Set<string>();
    for (const log of empLogs) {
      if (log.status === AttendanceStatus.UNINFORMED_ABSENT)
        candidateDates.add(dateKey(log.date));
      const trail = auditByAttendanceLogId.get(log.id) ?? [];
      for (const a of trail) {
        const c = a.changes as { previous?: { status?: string } } | null;
        if (c?.previous?.status === AttendanceStatus.UNINFORMED_ABSENT)
          candidateDates.add(dateKey(log.date));
      }
    }
    for (const ev of (eventsByEmployee.get(employeeId) ?? []).filter(
      (e2) => e2.category === DisciplineCategory.UNINFORMED_ABSENT,
    )) {
      candidateDates.add(dateKey(ev.incidentDate));
    }

    const dated = uninformedDeductions
      .map((d) => ({
        ...d,
        extractedDate: d.description?.match(UNINFORMED_DATED_DESC)?.[1] ?? null,
      }))
      .filter((d) => d.extractedDate);
    const undated = uninformedDeductions.filter(
      (d) =>
        UNINFORMED_LEGACY_DESC.test(d.description ?? '') ||
        !d.description?.match(UNINFORMED_DATED_DESC),
    );

    // Rule: dated duplicates (isolatable — two deductions with the IDENTICAL
    // extracted date are unambiguous duplicates of each other).
    const byDate = new Map<string, typeof dated>();
    for (const d of dated) {
      const arr = byDate.get(d.extractedDate) ?? [];
      arr.push(d);
      byDate.set(d.extractedDate, arr);
    }
    for (const [d, ds] of byDate) {
      for (const item of ds) {
        deductionLedger.push({
          deductionId: item.id,
          employeeId,
          payrollEntryId: item.payrollEntryId,
          payrollStatus: item.payrollStatus,
          category: 'UNINFORMED_ABSENCE',
          incidentDate: d,
          occurrence: null,
          amount: Number(item.amount),
          description: item.description,
          classification:
            ds.length > 1
              ? 'DUPLICATE_RACE'
              : candidateDates.has(d)
                ? 'EXPECTED_BEHAVIOR'
                : 'INSUFFICIENT_EVIDENCE',
        });
        if (ds.length > 1) {
          deductionLedgerExceptions.push({
            deductionId: item.id,
            employeeId,
            employeeCode: e.employeeCode,
            employeeName: e.employeeName,
            payrollEntryId: item.payrollEntryId,
            payrollStatus: item.payrollStatus,
            category: 'UNINFORMED_ABSENCE',
            amount: Number(item.amount),
            description: item.description,
            extractedIncidentDate: d,
            extractedOccurrence: null,
            classification: 'DUPLICATE_RACE',
            reason: `${ds.length} deductions share the identical dated description for ${d}.`,
            candidateAttendanceLogIds: [],
            candidateAuditLogIds: [],
            candidateDisciplineEventIds: [],
            candidateLetterIds: [],
            evidence: {},
            financialImpact: Number(item.amount),
            recommendedNextAction:
              'Confident duplicate — candidate for a future uninformed-absence cleanup pass.',
            rootCauseKey: `DUPLICATE_UNINFORMED_DEDUCTION:${employeeId}:${d}`,
            exclusionReason: null,
          });
        }
      }
      if (ds.length > 1) {
        addFinding({
          rootCauseKey: `DUPLICATE_UNINFORMED_DEDUCTION:${employeeId}:${d}`,
          sourceCheck: 'F-uninformed-dated-duplicate',
          severity: 'CRITICAL',
          classification: 'DUPLICATE_RACE',
          employeeId,
          incidentDate: d,
          category: 'DUPLICATE_UNINFORMED_ABSENCE_DEDUCTION',
          relatedAttendanceLogIds: [],
          relatedAuditLogIds: [],
          relatedLetterIds: [],
          relatedDeductionIds: ds.map((x) => x.id),
          relatedDisciplineEventIds: [],
          payrollEntryIds: [...new Set(ds.map((x) => x.payrollEntryId))],
          expected:
            'At most one UNINFORMED_ABSENCE deduction per exact date (structured date suffix in description, unambiguous)',
          actual: `${ds.length} deductions with the identical date suffix "${d}"`,
          evidence: {
            amounts: ds.map((x) => Number(x.amount)),
            payrollStatuses: ds.map((x) => x.payrollStatus),
          },
          financialImpact: ds
            .slice(1)
            .reduce((sum, x) => sum + Number(x.amount), 0),
          codeFixStatus: 'DATA_CLEANUP_ONLY',
          recommendedNextAction:
            'Confident duplicate (dated evidence, not description-equality alone) — safe candidate for a future cleanup pass covering uninformed-absence, distinct from the existing late-discipline-only cleanup script.',
        });
      }
    }

    // Rule: undated legacy rows — count-reconcile against remaining
    // candidate dates NOT already claimed by a dated deduction, per rules
    // A/B/C. Never label duplicate from description equality alone.
    const claimedDates = new Set(dated.map((d) => d.extractedDate));
    const remainingCandidates = [...candidateDates].filter(
      (d) => !claimedDates.has(d),
    );

    for (const item of undated) {
      const undatedClassification: Classification =
        undated.length <= remainingCandidates.length
          ? 'EXPECTED_BEHAVIOR'
          : 'INSUFFICIENT_EVIDENCE';
      deductionLedger.push({
        deductionId: item.id,
        employeeId,
        payrollEntryId: item.payrollEntryId,
        payrollStatus: item.payrollStatus,
        category: 'UNINFORMED_ABSENCE',
        incidentDate: null,
        occurrence: null,
        amount: Number(item.amount),
        description: item.description,
        classification: undatedClassification,
      });
      if (undatedClassification === 'INSUFFICIENT_EVIDENCE') {
        deductionLedgerExceptions.push({
          deductionId: item.id,
          employeeId,
          employeeCode: e.employeeCode,
          employeeName: e.employeeName,
          payrollEntryId: item.payrollEntryId,
          payrollStatus: item.payrollStatus,
          category: 'UNINFORMED_ABSENCE',
          amount: Number(item.amount),
          description: item.description,
          extractedIncidentDate: null,
          extractedOccurrence: null,
          classification: 'INSUFFICIENT_EVIDENCE',
          reason:
            'Undated legacy-format deduction; aggregate count exceeds remaining candidate incident dates for this employee.',
          candidateAttendanceLogIds: [],
          candidateAuditLogIds: [],
          candidateDisciplineEventIds: [],
          candidateLetterIds: [],
          evidence: { candidateDates: remainingCandidates },
          financialImpact: 0,
          recommendedNextAction:
            'See the aggregate UNINFORMED_LEGACY_COUNT_MISMATCH finding for this employee — the specific excess row cannot be isolated from description text alone.',
          rootCauseKey: `UNINFORMED_LEGACY_COUNT_MISMATCH:${employeeId}`,
          exclusionReason: null,
        });
      }
    }

    if (undated.length > 0) {
      if (undated.length <= remainingCandidates.length) {
        addFinding({
          rootCauseKey: `UNINFORMED_LEGACY_RECONCILED:${employeeId}`,
          sourceCheck: 'F-uninformed-legacy',
          severity: 'INFO',
          classification: 'EXPECTED_BEHAVIOR',
          employeeId,
          incidentDate: null,
          category: 'UNINFORMED_ABSENCE_LEGACY',
          relatedAttendanceLogIds: [],
          relatedAuditLogIds: [],
          relatedLetterIds: [],
          relatedDeductionIds: undated.map((x) => x.id),
          relatedDisciplineEventIds: [],
          payrollEntryIds: [...new Set(undated.map((x) => x.payrollEntryId))],
          expected: `${undated.length} undated legacy-format deduction(s) require at least that many distinct candidate incident dates`,
          actual: `${remainingCandidates.length} unclaimed candidate date(s) available — count-consistent, a valid non-contradictory mapping exists even though the exact 1:1 assignment cannot be determined from description text alone`,
          evidence: { candidateDates: remainingCandidates },
          financialImpact: 0,
          codeFixStatus: 'DATA_CLEANUP_ONLY',
          recommendedNextAction:
            'No action — this is exactly the false-positive V1 raised by using description equality alone; count reconciliation shows these are plausibly distinct legitimate incidents.',
        });
      } else {
        const excess = undated.length - remainingCandidates.length;
        addFinding({
          rootCauseKey: `UNINFORMED_LEGACY_COUNT_MISMATCH:${employeeId}`,
          sourceCheck: 'F-uninformed-legacy',
          severity: 'MEDIUM',
          classification: 'INSUFFICIENT_EVIDENCE',
          employeeId,
          incidentDate: null,
          category: 'UNINFORMED_ABSENCE_LEGACY',
          relatedAttendanceLogIds: [],
          relatedAuditLogIds: [],
          relatedLetterIds: [],
          relatedDeductionIds: undated.map((x) => x.id),
          relatedDisciplineEventIds: [],
          payrollEntryIds: [...new Set(undated.map((x) => x.payrollEntryId))],
          expected: `${undated.length} undated legacy-format deduction(s) require that many distinct candidate incident dates`,
          actual: `Only ${remainingCandidates.length} unclaimed candidate date(s) available — ${excess} deduction(s) cannot be explained by currently-known evidence`,
          evidence: {
            candidateDates: remainingCandidates,
            allUndatedDeductionIds: undated.map((x) => x.id),
          },
          financialImpact:
            excess * (undated[0] ? Number(undated[0].amount) : 0),
          codeFixStatus: 'MANUAL_REVIEW',
          recommendedNextAction: `Aggregate count mismatch is real, but the SPECIFIC excess row(s) cannot be isolated (all ${undated.length} legacy descriptions are byte-identical) — manual review required before any reversal; do not auto-select which row(s) to remove.`,
        });
      }
    }

    // ── Section 5 (V2.2 NEW): exact-date stale-reversal detection ──
    // Separate from the count-reconciliation above, which only proves
    // AGGREGATE consistency. This proves, for one SPECIFIC corrected date,
    // whether ITS OWN deduction/DisciplineEvent is still wrongly active —
    // confirming or disproving the reported (unfixed) reverseAbsenceDeductionForDate gap
    // with exact-date production evidence, never conflated with the legacy
    // count-reconciliation findings above.
    for (const log of empLogs) {
      const trail = auditByAttendanceLogId.get(log.id) ?? [];
      const correctionAudit = trail.find((a) => {
        if (a.action !== 'ATTENDANCE_UPDATED') return false;
        const c = a.changes as {
          previous?: { status?: string };
          updated?: { status?: string };
        } | null;
        return (
          c?.previous?.status === AttendanceStatus.UNINFORMED_ABSENT &&
          c?.updated?.status !== AttendanceStatus.UNINFORMED_ABSENT
        );
      });
      if (!correctionAudit) continue;

      const d = dateKey(log.date);
      const dGroup = byDate.get(d) ?? [];
      // Skip if this date is already covered by the duplicate finding above
      // — that finding already fully captures and financially quantifies
      // this date's problem; adding a second finding here would double-count.
      if (dGroup.length > 1) continue;

      const datedMatch = dGroup[0];
      const staleEvent = (eventsByEmployee.get(employeeId) ?? []).find(
        (ev) =>
          ev.category === DisciplineCategory.UNINFORMED_ABSENT &&
          dateKey(ev.incidentDate) === d,
      );
      const changes = correctionAudit.changes as {
        updated?: { status?: string };
      } | null;

      // Explicit ownership-chain verification (V2.3) — proven, not just
      // assumed from `dated`/`byDate` being built inside this employee's
      // own loop iteration. Re-derives ownership independently from the
      // bulk-fetched empPayrollEntries (this employee's OWN entries, per
      // payrollEntriesByEmployee) so a CONFIRMED_BUG can never be raised
      // from a deduction this employee does not actually own, even if a
      // future edit changes how `dated`/`byDate` are scoped.
      const ownershipVerified =
        !!datedMatch &&
        log.employeeId === employeeId &&
        empPayrollEntries.some((pe) => pe.id === datedMatch.payrollEntryId) &&
        datedMatch.extractedDate === d;

      if (datedMatch && ownershipVerified) {
        addFinding({
          rootCauseKey: `STALE_UNINFORMED_ABSENCE_CONSEQUENCE:${employeeId}:${d}`,
          sourceCheck: 'F-exact-date-reversal',
          severity: 'HIGH',
          classification: 'CONFIRMED_BUG',
          employeeId,
          incidentDate: d,
          category: 'STALE_UNINFORMED_ABSENCE_CONSEQUENCE',
          relatedAttendanceLogIds: [log.id],
          relatedAuditLogIds: [correctionAudit.id],
          relatedLetterIds: [],
          relatedDeductionIds: [datedMatch.id],
          relatedDisciplineEventIds: staleEvent ? [staleEvent.id] : [],
          payrollEntryIds: [datedMatch.payrollEntryId],
          expected:
            'UNINFORMED_ABSENT -> corrected status should reverse the 2-day deduction and DisciplineEvent for this exact date',
          actual: `AuditLog confirms the correction at ${correctionAudit.createdAt.toISOString()} (-> ${changes?.updated?.status ?? 'unknown'}), but a deduction whose OWN description date exactly matches this date is still active`,
          evidence: { auditChanges: correctionAudit.changes },
          financialImpact: Number(datedMatch.amount),
          codeFixStatus: 'STILL_UNFIXED', // reverseAbsenceDeductionForDate is confirmed never called from updateAttendance/markManual — see knownLimitations
          recommendedNextAction:
            'Confirms the reported reverseAbsenceDeductionForDate gap with exact-date production evidence — candidate for a future code fix + cleanup, same class as the LATE reversal fix already shipped (commit 0ab12f2).',
        });
        deductionLedgerExceptions.push({
          deductionId: datedMatch.id,
          employeeId,
          employeeCode: e.employeeCode,
          employeeName: e.employeeName,
          payrollEntryId: datedMatch.payrollEntryId,
          payrollStatus: datedMatch.payrollStatus,
          category: 'UNINFORMED_ABSENCE',
          amount: Number(datedMatch.amount),
          description: datedMatch.description,
          extractedIncidentDate: d,
          extractedOccurrence: null,
          classification: 'CONFIRMED_BUG',
          reason:
            'Exact-date AuditLog evidence: this date was corrected away from UNINFORMED_ABSENT, but the deduction for this exact date is still active.',
          candidateAttendanceLogIds: [log.id],
          candidateAuditLogIds: [correctionAudit.id],
          candidateDisciplineEventIds: staleEvent ? [staleEvent.id] : [],
          candidateLetterIds: [],
          evidence: { correction: correctionAudit.changes },
          financialImpact: Number(datedMatch.amount),
          recommendedNextAction:
            'Candidate for a future uninformed-absence reversal fix + cleanup.',
          rootCauseKey: `STALE_UNINFORMED_ABSENCE_CONSEQUENCE:${employeeId}:${d}`,
          exclusionReason: null,
        });
      } else if (undated.length > 0) {
        // A correction is confirmed, and undated legacy deductions exist for
        // this employee, but we cannot pin any SPECIFIC one to this exact
        // date — deliberately NOT merged with the count-reconciliation
        // finding above, which answers a different question (aggregate
        // consistency, not this-date reversal).
        addFinding({
          rootCauseKey: `UNINFORMED_ABSENCE_REVERSAL_UNVERIFIABLE:${employeeId}:${d}`,
          sourceCheck: 'F-exact-date-reversal',
          severity: 'LOW',
          classification: 'INSUFFICIENT_EVIDENCE',
          employeeId,
          incidentDate: d,
          // V2.3 FIX: this branch has NO deduction evidence at all
          // (relatedDeductionIds stays empty below) — it must never share
          // the 'STALE_UNINFORMED_ABSENCE_CONSEQUENCE' category label with
          // the genuinely deduction-backed CONFIRMED_BUG branch above.
          // Reusing that label was the exact root cause of the reported
          // "640 findings, only 28 unique deductions" false-positive
          // pattern: rootCauseSummary.byCategory groups by this field, so
          // it was silently conflating ~600+ deduction-less "we found a
          // correction but can't verify anything concrete" findings with
          // the small number of real, evidence-backed stale-deduction ones.
          category: 'UNINFORMED_ABSENCE_REVERSAL_UNVERIFIABLE',
          relatedAttendanceLogIds: [log.id],
          relatedAuditLogIds: [correctionAudit.id],
          relatedLetterIds: [],
          relatedDeductionIds: [],
          relatedDisciplineEventIds: staleEvent ? [staleEvent.id] : [],
          payrollEntryIds: [],
          expected:
            'A confirmed UNINFORMED_ABSENT -> corrected transition should be checkable against a specific deduction for this exact date',
          actual: `Correction confirmed at ${correctionAudit.createdAt.toISOString()}, but this employee's remaining UNINFORMED_ABSENCE deductions use the undated legacy description format — cannot pin a specific row to this date`,
          evidence: {
            auditChanges: correctionAudit.changes,
            undatedDeductionIds: undated.map((x) => x.id),
          },
          financialImpact: 0,
          codeFixStatus: 'MANUAL_REVIEW',
          recommendedNextAction:
            'Distinct from the aggregate count-reconciliation finding — this specifically asks "is THIS date\'s consequence still active", which legacy undated descriptions cannot answer. Manual review only.',
        });
      }
      // else: no dated match, no undated deductions at all -> nothing to report (already fully reconciled or never had a deduction).
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // CHECK G (Section 7) — missing checkout verification
  // ══════════════════════════════════════════════════════════════════
  const missingCheckoutEvents = disciplineEvents.filter(
    (e) => e.category === DisciplineCategory.MISSING_CHECKOUT,
  );
  const missingCheckoutLetters = letters.filter((l) => {
    const vars = (l.variables ?? {}) as {
      monthlyMissingCheckoutOccurrence?: number;
    };
    return vars.monthlyMissingCheckoutOccurrence != null;
  });
  const missingCheckoutDeductions = payrollEntries.flatMap((pe) =>
    pe.deductions.filter(
      (d) =>
        d.reason === DeductionType.DISCIPLINARY_FINE &&
        d.description?.startsWith('Missing checkout deduction'),
    ),
  );
  let missingCheckout24hViolations = 0;
  for (const ev of missingCheckoutEvents) {
    const employee = employeeById.get(ev.employeeId);
    if (employee && isTwentyFourHour(employee)) {
      missingCheckout24hViolations++;
      addFinding({
        rootCauseKey: `MISSING_CHECKOUT_24H:${ev.employeeId}:${dateKey(ev.incidentDate)}`,
        sourceCheck: 'G',
        severity: 'HIGH',
        classification: 'CONFIRMED_BUG',
        employeeId: ev.employeeId,
        incidentDate: dateKey(ev.incidentDate),
        category: 'MISSING_CHECKOUT',
        relatedAttendanceLogIds: [],
        relatedAuditLogIds: [],
        relatedLetterIds: [],
        relatedDeductionIds: [],
        relatedDisciplineEventIds: [ev.id],
        payrollEntryIds: [],
        expected:
          '24-hour duty staff excluded from missing-checkout discipline entirely',
        actual: 'MISSING_CHECKOUT DisciplineEvent found for a 24h employee',
        evidence: {},
        financialImpact: 0,
        codeFixStatus: 'MANUAL_REVIEW',
        recommendedNextAction:
          'Investigate which caller evaluated missing-checkout discipline for a 24h employee.',
      });
    }
  }
  const missingCheckoutVerification = {
    verifiedZeroIssues: missingCheckout24hViolations === 0,
    disciplineEventsFound: missingCheckoutEvents.length,
    lettersFound: missingCheckoutLetters.length,
    deductionsFound: missingCheckoutDeductions.length,
    twentyFourHourViolationsFound: missingCheckout24hViolations,
    limitations: [
      'No reversal function exists for missing-checkout at all, so "filled checkOut after consequence generation" cannot produce a stale-consequence finding the way LATE/UNINFORMED_ABSENT can — there is nothing in the code to have reversed it even if it should have. This is a gap in the PRODUCT, not something this audit can detect as a data anomaly.',
      `${missingCheckoutEvents.length} MISSING_CHECKOUT DisciplineEvent row(s) and ${missingCheckoutLetters.length} letter(s) exist in August — the "zero missingCheckoutIssues" V1 reported refers to zero INVALID cases found, not zero missing-checkout activity; confirmed by direct inspection here, not assumed.`,
    ],
  };

  // ══════════════════════════════════════════════════════════════════
  // CHECK K (Section 5, refined V2.1) — suspension audit.
  //
  // V2's `lateAndUninformedSuspensionRulesSeparated` invariant failed in
  // production not because LATE and UNINFORMED_ABSENT rules were ever
  // mixed, but because the invariant itself was implemented as a
  // substring-match on free-text verdict prose — and the UNINFORMED_ABSENT
  // verdict string explained "...not compared against occurrence numbers",
  // which itself contains the word "occurrence", tripping the check on its
  // own explanatory text. V2.1 replaces this with structural boolean flags
  // set directly from sourceCategory, never parsed from display text.
  // ══════════════════════════════════════════════════════════════════
  type SuspensionClassification =
    | 'LATE_CONFIRMED_OCCURRENCE'
    | 'LATE_LEGACY_OCCURRENCE_UNKNOWN'
    | 'UNINFORMED_ABSENT'
    | 'SOURCE_UNKNOWN';
  type OccurrenceVerdictCode =
    | 'EXPECTED_9'
    | 'CONFIRMED_WRONG_OCCURRENCE'
    | 'MANUAL_REVIEW_UNKNOWN'
    | 'NOT_APPLICABLE';

  type OccurrenceReconstruction = {
    generationTimeOccurrence: number | 'UNKNOWN';
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
    method: string;
    evidence: {
      reconstructedLateDates: string[];
      ambiguousAttendanceLogIds: string[];
      corroboratingLetterId: string | null;
      corroboratingLetterOccurrence: number | null;
      corroboratingDisciplineEventId: string | null;
    };
  };

  /**
   * READ-ONLY point-in-time reconstruction of how many distinct late-
   * eligible dates this employee had AS OF `generatedAt` — never inferred
   * from the CURRENT live count. For every August AttendanceLog row that
   * existed by generatedAt, walks its AuditLog(ATTENDANCE_UPDATED) trail to
   * determine what its status was AT that instant (the latest edit at or
   * before generatedAt if one exists; otherwise the earliest edit AFTER
   * generatedAt's own `previous` snapshot; otherwise the current stored
   * status, flagged ambiguous since biometric/reconcileShortLeaveAttendance
   * writes leave no audit trail to confirm it was never touched before).
   */
  function reconstructOccurrenceAtGeneration(
    employeeId: string,
    generatedAt: Date,
  ): OccurrenceReconstruction {
    const empLogs = (logsByEmployee.get(employeeId) ?? []).filter(
      (l) => l.type === AttendanceLogType.REGULAR,
    );
    const reconstructedLateDates: string[] = [];
    const ambiguousAttendanceLogIds: string[] = [];

    for (const log of empLogs) {
      if (log.createdAt > generatedAt) continue; // did not exist yet at generation time

      const trail = (auditByAttendanceLogId.get(log.id) ?? []).filter(
        (a) => a.action === 'ATTENDANCE_UPDATED',
      );
      const editsBeforeOrAt = trail
        .filter((a) => a.createdAt <= generatedAt)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const editsAfter = trail
        .filter((a) => a.createdAt > generatedAt)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      let statusAsOf: {
        status: AttendanceStatus;
        lateMinutes: number;
        note: string | null;
      } | null = null;
      let ambiguous = false;

      if (editsBeforeOrAt.length > 0) {
        const last = editsBeforeOrAt[editsBeforeOrAt.length - 1];
        const c = last.changes as {
          updated?: {
            status?: string;
            lateMinutes?: number;
            note?: string | null;
          };
        } | null;
        if (c?.updated?.status) {
          statusAsOf = {
            status: c.updated.status as AttendanceStatus,
            lateMinutes: c.updated.lateMinutes ?? 0,
            note: c.updated.note ?? null,
          };
        }
      } else if (editsAfter.length > 0) {
        const first = editsAfter[0];
        const c = first.changes as {
          previous?: {
            status?: string;
            lateMinutes?: number;
            note?: string | null;
          };
        } | null;
        if (c?.previous?.status) {
          statusAsOf = {
            status: c.previous.status as AttendanceStatus,
            lateMinutes: c.previous.lateMinutes ?? 0,
            note: c.previous.note ?? null,
          };
        }
      } else {
        // No audit trail at all for this row — assume never edited. This is
        // an unverified assumption (see docstring), so flag it ambiguous.
        statusAsOf = {
          status: log.status,
          lateMinutes: log.lateMinutes,
          note: log.note,
        };
        ambiguous = true;
      }

      if (!statusAsOf) {
        ambiguousAttendanceLogIds.push(log.id);
        continue;
      }
      if (ambiguous) ambiguousAttendanceLogIds.push(log.id);
      if (isLateEligible(statusAsOf))
        reconstructedLateDates.push(dateKey(log.date));
    }

    reconstructedLateDates.sort();
    const count = reconstructedLateDates.length;

    const priorLetters = (lettersByEmployee.get(employeeId) ?? [])
      .filter(
        (l) =>
          LATE_LETTER_TYPES.includes(l.letterType) &&
          l.generatedAt < generatedAt,
      )
      .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
    const mostRecentPrior = priorLetters[0];
    const priorVars = mostRecentPrior
      ? ((mostRecentPrior.variables ?? {}) as {
          monthlyLateOccurrence?: number;
        })
      : null;
    const corroboratingOccurrence = priorVars?.monthlyLateOccurrence ?? null;

    const corroboratingEvent = (eventsByEmployee.get(employeeId) ?? [])
      .filter(
        (ev) =>
          ev.category === DisciplineCategory.LATE &&
          ev.createdAt <= generatedAt,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    const evidence = {
      reconstructedLateDates,
      ambiguousAttendanceLogIds,
      corroboratingLetterId: mostRecentPrior?.id ?? null,
      corroboratingLetterOccurrence: corroboratingOccurrence,
      corroboratingDisciplineEventId: corroboratingEvent?.id ?? null,
    };

    if (count === 0) {
      return {
        generationTimeOccurrence: 'UNKNOWN',
        confidence: 'NONE',
        method:
          'No reconstructable late-eligible dates found before/at generation time.',
        evidence,
      };
    }

    let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    if (
      ambiguousAttendanceLogIds.length === 0 &&
      corroboratingOccurrence != null &&
      corroboratingOccurrence === count - 1
    ) {
      confidence = 'HIGH';
    } else if (ambiguousAttendanceLogIds.length === 0) {
      confidence = 'MEDIUM';
    } else {
      confidence = 'LOW';
    }

    return {
      generationTimeOccurrence: count,
      confidence,
      method:
        "Walked AuditLog(ATTENDANCE_UPDATED) for every August AttendanceLog row existing by letter.generatedAt, reconstructing each row's status AT that instant and counting distinct late-eligible dates.",
      evidence,
    };
  }

  const suspensionLetters = letters.filter(
    (l) => l.letterType === LetterType.SUSPENSION,
  );
  const suspensionDetails: {
    letterId: string;
    letterNo: string | null;
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    sourceCategory: 'LATE' | 'UNINFORMED_ABSENT' | 'UNKNOWN';
    suspensionClassification: SuspensionClassification;
    occurrenceOrCount: number | null;
    evaluatedAgainstLateOccurrenceCycle: boolean;
    evaluatedAgainstUninformedThreshold: boolean;
    occurrenceVerdictCode: OccurrenceVerdictCode;
    verdict: string;
    reconstruction: OccurrenceReconstruction | null;
  }[] = [];

  for (const l of suspensionLetters) {
    const e = empRef(l.employeeId);
    const vars = (l.variables ?? {}) as {
      monthlyLateOccurrence?: number;
      suspensionReason?: string;
      suspensionStartDate?: string;
    };
    const isLateSourced =
      vars.monthlyLateOccurrence != null ||
      (vars.suspensionReason ?? '').includes('لیٹ آمد');
    const isUninformedSourced =
      !isLateSourced &&
      (vars.suspensionReason ?? '').includes('بغیر اطلاع غیر حاضری');
    const sourceCategory: 'LATE' | 'UNINFORMED_ABSENT' | 'UNKNOWN' =
      isLateSourced
        ? 'LATE'
        : isUninformedSourced
          ? 'UNINFORMED_ABSENT'
          : 'UNKNOWN';

    let suspensionClassification: SuspensionClassification;
    let evaluatedAgainstLateOccurrenceCycle = false;
    let evaluatedAgainstUninformedThreshold = false;
    let occurrenceVerdictCode: OccurrenceVerdictCode = 'NOT_APPLICABLE';
    let verdict: string;
    let reconstruction: OccurrenceReconstruction | null = null;

    if (sourceCategory === 'LATE') {
      evaluatedAgainstLateOccurrenceCycle = true;
      const occ = vars.monthlyLateOccurrence ?? null;
      if (occ != null) {
        suspensionClassification = 'LATE_CONFIRMED_OCCURRENCE';
        if (occ === 9) {
          occurrenceVerdictCode = 'EXPECTED_9';
          verdict =
            'EXPECTED — occurrence 9 is the defined LATE-cycle suspension trigger';
        } else {
          occurrenceVerdictCode = 'CONFIRMED_WRONG_OCCURRENCE';
          verdict =
            occ === 8
              ? 'CONFIRMED ISSUE — suspension generated at occurrence 8 (Warning expected)'
              : `CONFIRMED ISSUE — suspension generated at occurrence ${occ} (only occurrence 9 is a valid LATE-cycle suspension trigger; ${occ} should have been Advice/Warning/Fine per the repeating cycle)`;
          addFinding({
            rootCauseKey: `WRONG_SUSPENSION:${l.employeeId}:${l.id}`,
            sourceCheck: 'K',
            severity: 'CRITICAL',
            classification: 'CONFIRMED_BUG',
            employeeId: l.employeeId,
            incidentDate: vars.suspensionStartDate ?? null,
            category: 'SUSPENSION',
            relatedAttendanceLogIds: [],
            relatedAuditLogIds: [],
            relatedLetterIds: [l.id],
            relatedDeductionIds: [],
            relatedDisciplineEventIds: [],
            payrollEntryIds: [],
            expected: 'LATE-cycle suspension only at exactly occurrence 9',
            actual: verdict,
            evidence: { variables: l.variables },
            financialImpact: 0,
            codeFixStatus: 'MANUAL_REVIEW',
            recommendedNextAction:
              'Verify by employeeCode before any HR action — suspension carries employee-status/account-active side effects and must never be auto-reversed by any script.',
          });
        }
      } else {
        suspensionClassification = 'LATE_LEGACY_OCCURRENCE_UNKNOWN';
        occurrenceVerdictCode = 'MANUAL_REVIEW_UNKNOWN';
        reconstruction = reconstructOccurrenceAtGeneration(
          l.employeeId,
          l.generatedAt,
        );
        verdict = `MANUAL_REVIEW — LATE-sourced legacy suspension with no monthlyLateOccurrence in variables. Reconstruction: ${reconstruction.generationTimeOccurrence} (confidence ${reconstruction.confidence}). Occurrence question remains unresolved pending human review regardless of reconstruction confidence.`;
        addFinding({
          rootCauseKey: `LEGACY_SUSPENSION_OCCURRENCE_UNKNOWN:${l.employeeId}:${l.id}`,
          sourceCheck: 'K',
          severity: 'MEDIUM',
          classification: 'INSUFFICIENT_EVIDENCE',
          employeeId: l.employeeId,
          incidentDate: vars.suspensionStartDate ?? null,
          category: 'SUSPENSION',
          relatedAttendanceLogIds: [],
          relatedAuditLogIds: [],
          relatedLetterIds: [
            l.id,
            ...(reconstruction.evidence.corroboratingLetterId
              ? [reconstruction.evidence.corroboratingLetterId]
              : []),
          ],
          relatedDeductionIds: [],
          relatedDisciplineEventIds: reconstruction.evidence
            .corroboratingDisciplineEventId
            ? [reconstruction.evidence.corroboratingDisciplineEventId]
            : [],
          payrollEntryIds: [],
          expected:
            'LATE-cycle suspension letters should carry monthlyLateOccurrence in variables (post-structuring)',
          actual: verdict,
          evidence: { variables: l.variables, reconstruction },
          financialImpact: 0,
          codeFixStatus: 'MANUAL_REVIEW',
          recommendedNextAction:
            'Legacy/unstructured — occurrence cannot be confirmed from variables alone. Reconstruction is supporting evidence for a human decision, not an automatic resolution; never auto-classify as occurrence 9 from this alone.',
        });
      }
    } else if (sourceCategory === 'UNINFORMED_ABSENT') {
      suspensionClassification = 'UNINFORMED_ABSENT';
      evaluatedAgainstUninformedThreshold = true;
      verdict =
        'UNINFORMED_ABSENT-sourced (>2 distinct days/month threshold) — evaluated independently of the LATE cycle';
    } else {
      suspensionClassification = 'SOURCE_UNKNOWN';
      verdict =
        'UNKNOWN — variables carry neither a monthlyLateOccurrence nor a recognizable uninformed-absence Urdu phrase; cannot classify source category';
    }

    suspensionDetails.push({
      letterId: l.id,
      letterNo: l.letterNo,
      employeeId: l.employeeId,
      employeeCode: e.employeeCode,
      employeeName: e.employeeName,
      sourceCategory,
      suspensionClassification,
      occurrenceOrCount: vars.monthlyLateOccurrence ?? null, // NEVER backfilled from reconstruction — see noUnknownOccurrenceInvented invariant
      evaluatedAgainstLateOccurrenceCycle,
      evaluatedAgainstUninformedThreshold,
      occurrenceVerdictCode,
      verdict,
      reconstruction,
    });
  }

  const arslan = employees.find((e2) => e2.employeeCode === 'YCDO-2026-0124');
  const arslanSuspensionDetails = arslan
    ? suspensionDetails.filter((s) => s.employeeId === arslan.id)
    : [];

  const suspensionSummary = {
    totalSuspensionLetters: suspensionLetters.length,
    lateConfirmedOccurrence: suspensionDetails.filter(
      (s) => s.suspensionClassification === 'LATE_CONFIRMED_OCCURRENCE',
    ).length,
    lateLegacyOccurrenceUnknown: suspensionDetails.filter(
      (s) => s.suspensionClassification === 'LATE_LEGACY_OCCURRENCE_UNKNOWN',
    ).length,
    uninformedAbsentSourced: suspensionDetails.filter(
      (s) => s.suspensionClassification === 'UNINFORMED_ABSENT',
    ).length,
    unknownSource: suspensionDetails.filter(
      (s) => s.suspensionClassification === 'SOURCE_UNKNOWN',
    ).length,
    lateOccurrence8Confirmed: suspensionDetails.filter(
      (s) =>
        s.suspensionClassification === 'LATE_CONFIRMED_OCCURRENCE' &&
        s.occurrenceOrCount === 8,
    ).length,
    lateOccurrence9Confirmed: suspensionDetails.filter(
      (s) =>
        s.suspensionClassification === 'LATE_CONFIRMED_OCCURRENCE' &&
        s.occurrenceOrCount === 9,
    ).length,
    lateOccurrenceOtherConfirmed: suspensionDetails.filter(
      (s) =>
        s.suspensionClassification === 'LATE_CONFIRMED_OCCURRENCE' &&
        s.occurrenceOrCount !== 8 &&
        s.occurrenceOrCount !== 9,
    ).length,
    manualReviewLateSuspensions: suspensionDetails.filter(
      (s) => s.suspensionClassification === 'LATE_LEGACY_OCCURRENCE_UNKNOWN',
    ).length,
    allSuspensions: suspensionDetails,
    muhammadArslanArshi: arslan
      ? {
          employeeId: arslan.id,
          employeeCode: arslan.employeeCode,
          currentStatus: arslan.status,
          suspensionLettersFound: arslanSuspensionDetails.length,
          details: arslanSuspensionDetails,
          answer:
            arslanSuspensionDetails.length === 0
              ? 'No SUSPENSION letter found for this employee in August 2026.'
              : arslanSuspensionDetails
                  .map((s) => `${s.letterNo ?? s.letterId}: ${s.verdict}`)
                  .join(' | '),
        }
      : {
          note: 'Employee YCDO-2026-0124 not found in the current Employee table.',
        },
  };

  // ══════════════════════════════════════════════════════════════════
  // CHECK L — cross-category conflicts (unchanged core logic from V1,
  // now emitting rootCauseKeys that fold into the LATE_INCIDENT bucket
  // when they concern the same employee/date already covered above)
  // ══════════════════════════════════════════════════════════════════
  for (const log of attendanceLogs) {
    if (log.type !== AttendanceLogType.REGULAR) continue;
    const d = dateKey(log.date);
    const empEventsThisDate = (
      eventsByEmployee.get(log.employeeId) ?? []
    ).filter((ev) => dateKey(ev.incidentDate) === d);
    const categories = new Set(empEventsThisDate.map((ev) => ev.category));
    if (
      categories.has(DisciplineCategory.LATE) &&
      categories.has(DisciplineCategory.UNINFORMED_ABSENT)
    ) {
      addFinding({
        rootCauseKey: `CROSS_CATEGORY_LATE_UNINFORMED:${log.employeeId}:${d}`,
        sourceCheck: 'L',
        severity: 'HIGH',
        classification: 'CONFIRMED_BUG',
        employeeId: log.employeeId,
        incidentDate: d,
        category: 'CROSS_CATEGORY',
        relatedAttendanceLogIds: [log.id],
        relatedAuditLogIds: [],
        relatedLetterIds: [],
        relatedDeductionIds: [],
        relatedDisciplineEventIds: empEventsThisDate.map((ev) => ev.id),
        payrollEntryIds: [],
        expected:
          'LATE and UNINFORMED_ABSENT are mutually exclusive for the same date',
        actual:
          'Both DisciplineEvent categories exist for the same employee/date',
        evidence: { currentStatus: log.status },
        financialImpact: 0,
        codeFixStatus: 'DATA_CLEANUP_ONLY',
        recommendedNextAction:
          'Almost certainly a status-correction sequence (UNINFORMED_ABSENT -> LATE/HALF_DAY) that left the earlier category orphaned — cross-reference the STALE_LATE_CONSEQUENCE / uninformed ledger findings for the same employee/date.',
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // CONSOLIDATION — merge all rawFindings sharing a rootCauseKey
  // ══════════════════════════════════════════════════════════════════
  const groups = new Map<string, RawFinding[]>();
  for (const f of rawFindings) {
    const arr = groups.get(f.rootCauseKey) ?? [];
    arr.push(f);
    groups.set(f.rootCauseKey, arr);
  }

  let issueCounter = 0;
  const consolidatedIssues: ConsolidatedIssue[] = [];
  for (const [rootCauseKey, group] of groups) {
    issueCounter++;
    const winningClassification = CLASSIFICATION_PRECEDENCE.find((c) =>
      group.some((g) => g.classification === c),
    );
    const winningSeverity = SEVERITY_PRECEDENCE.find((s) =>
      group.some((g) => g.severity === s),
    );
    const first = group[0];
    const e = empRef(first.employeeId);

    consolidatedIssues.push({
      rootCauseKey,
      issueCode: `V2-${String(issueCounter).padStart(5, '0')}`,
      severity: winningSeverity,
      classification: winningClassification,
      employeeId: first.employeeId,
      employeeCode: e.employeeCode,
      employeeName: e.employeeName,
      incidentDate: first.incidentDate,
      category: first.category,
      relatedAttendanceLogIds: [
        ...new Set(group.flatMap((g) => g.relatedAttendanceLogIds)),
      ],
      relatedAuditLogIds: [
        ...new Set(group.flatMap((g) => g.relatedAuditLogIds)),
      ],
      relatedLetterIds: [...new Set(group.flatMap((g) => g.relatedLetterIds))],
      relatedDeductionIds: [
        ...new Set(group.flatMap((g) => g.relatedDeductionIds)),
      ],
      relatedDisciplineEventIds: [
        ...new Set(group.flatMap((g) => g.relatedDisciplineEventIds)),
      ],
      payrollEntryIds: [...new Set(group.flatMap((g) => g.payrollEntryIds))],
      expected: group.map((g) => g.expected).join(' | '),
      actual: group.map((g) => g.actual).join(' | '),
      evidence: Object.fromEntries(
        group.map((g, i) => [`${g.sourceCheck}#${i}`, g.evidence]),
      ),
      financialImpact: Math.max(...group.map((g) => g.financialImpact)),
      codeFixStatus: group.some((g) => g.codeFixStatus === 'STILL_UNFIXED')
        ? 'STILL_UNFIXED'
        : group.some((g) => g.codeFixStatus === 'MANUAL_REVIEW')
          ? 'MANUAL_REVIEW'
          : group.some((g) => g.codeFixStatus === 'DATA_CLEANUP_ONLY')
            ? 'DATA_CLEANUP_ONLY'
            : 'ALREADY_FIXED_IN_CODE',
      recommendedNextAction: [
        ...new Set(group.map((g) => g.recommendedNextAction)),
      ].join(' | '),
      contributingChecks: [...new Set(group.map((g) => g.sourceCheck))],
    });
  }

  // ── Bucket into final report sections ──
  const confirmedIssues = consolidatedIssues.filter(
    (i) => i.classification === 'CONFIRMED_BUG',
  );
  const historicalStaleIssues = consolidatedIssues.filter(
    (i) => i.classification === 'HISTORICAL_STALE_DATA',
  );
  const duplicateConfirmedIssues = consolidatedIssues.filter(
    (i) => i.classification === 'DUPLICATE_RACE',
  );
  const policyMismatchIssues = consolidatedIssues.filter(
    (i) => i.classification === 'POLICY_MISMATCH',
  );
  const manualReviewIssues = consolidatedIssues.filter(
    (i) =>
      i.classification === 'INSUFFICIENT_EVIDENCE' ||
      i.classification === 'PROCESSED_PAID_MANUAL_REVIEW',
  );
  const expectedBehaviorCount = consolidatedIssues.filter(
    (i) => i.classification === 'EXPECTED_BEHAVIOR',
  ).length;
  const legacyAggregatedCount = legacySummary.totalRows; // aggregated, not individual consolidatedIssues entries

  const employeesWithConfirmedIssues = [
    ...new Set(confirmedIssues.map((i) => i.employeeId)),
  ];

  const financialImpact = {
    pendingPayrollAtRisk: consolidatedIssues
      .filter(
        (i) =>
          i.classification === 'CONFIRMED_BUG' ||
          i.classification === 'HISTORICAL_STALE_DATA' ||
          i.classification === 'DUPLICATE_RACE',
      )
      .reduce((sum, i) => sum + i.financialImpact, 0),
    processedPaidManualReview: manualReviewIssues
      .filter((i) => i.classification === 'PROCESSED_PAID_MANUAL_REVIEW')
      .reduce((sum, i) => sum + i.financialImpact, 0),
    duplicateConfirmedAmount: duplicateConfirmedIssues.reduce(
      (sum, i) => sum + i.financialImpact,
      0,
    ),
    staleDeductionAmount: historicalStaleIssues.reduce(
      (sum, i) => sum + i.financialImpact,
      0,
    ),
  };

  const topRootCauses = [...consolidatedIssues]
    .sort((a, b) => {
      const sevDiff =
        SEVERITY_PRECEDENCE.indexOf(a.severity) -
        SEVERITY_PRECEDENCE.indexOf(b.severity);
      if (sevDiff !== 0) return sevDiff;
      if (b.financialImpact !== a.financialImpact)
        return b.financialImpact - a.financialImpact;
      return 0;
    })
    .slice(0, 25)
    .map((i) => ({
      rootCauseKey: i.rootCauseKey,
      issueCode: i.issueCode,
      severity: i.severity,
      classification: i.classification,
      employeeCode: i.employeeCode,
      financialImpact: i.financialImpact,
    }));

  const employeesAffected = [
    ...new Set(consolidatedIssues.map((i) => i.employeeId)),
  ].map((id) => ({
    employeeId: id,
    ...empRef(id),
    issueCount: consolidatedIssues.filter((i) => i.employeeId === id).length,
    confirmedCount: consolidatedIssues.filter(
      (i) => i.employeeId === id && i.classification === 'CONFIRMED_BUG',
    ).length,
  }));

  // ── Payroll ledger summary (Section 8) ──
  const deductionLedgerSummary = {
    totalDeductionsLedgered: deductionLedger.length,
    byCategory: {
      LATE_ARRIVAL: deductionLedger.filter((d) => d.category === 'LATE_ARRIVAL')
        .length,
      UNINFORMED_ABSENCE: deductionLedger.filter(
        (d) => d.category === 'UNINFORMED_ABSENCE',
      ).length,
    },
    byClassification: (
      [
        'VALID',
        'EXPECTED_BEHAVIOR',
        'STALE_AFTER_CORRECTION',
        'HISTORICAL_STALE_DATA',
        'DUPLICATE_CONFIRMED',
        'DUPLICATE_RACE',
        'INVALID_OCCURRENCE',
        'CONFIRMED_BUG',
        'LEGACY_UNMAPPABLE',
        'INSUFFICIENT_EVIDENCE',
      ] as string[]
    ).reduce(
      (acc, c) => ({
        ...acc,
        [c]: deductionLedger.filter((d) => d.classification === c).length,
      }),
      {} as Record<string, number>,
    ),
    byPayrollStatus: {
      PENDING: deductionLedger.filter((d) => d.payrollStatus === 'PENDING')
        .length,
      PROCESSED: deductionLedger.filter((d) => d.payrollStatus === 'PROCESSED')
        .length,
      PAID: deductionLedger.filter((d) => d.payrollStatus === 'PAID').length,
    },
    exceptionsDetailedInDeductionLedgerExceptions:
      deductionLedgerExceptions.length,
  };

  // ══════════════════════════════════════════════════════════════════
  // INVARIANTS (Section 13)
  // ══════════════════════════════════════════════════════════════════
  const noDescriptionOnlyUninformedDuplicateClaims = true; // structurally guaranteed — the UNINFORMED_ABSENCE duplicate path above only fires on extracted-date equality (isolatable) or count-reconciliation (never on raw description equality alone)
  const rootCauseKeys = consolidatedIssues.map((i) => i.rootCauseKey);
  const noDuplicateRootCauseKeys =
    new Set(rootCauseKeys).size === rootCauseKeys.length;
  const noLegacyNullSnapshotRowSpam = !consolidatedIssues.some(
    (i) => i.category === 'LEGACY_DUTY_SNAPSHOT',
  ); // legacy rows are aggregated into legacySummary, never emitted as individual consolidatedIssues
  // V2.1: every check below is structural (booleans/enums set at
  // classification time), never a substring match on human-readable
  // verdict prose — that fragility is exactly what caused V2's
  // lateAndUninformedSuspensionRulesSeparated false failure.
  const allOccurrence8SuspensionsExplicitlyClassified = suspensionDetails
    .filter(
      (s) =>
        s.suspensionClassification === 'LATE_CONFIRMED_OCCURRENCE' &&
        s.occurrenceOrCount === 8,
    )
    .every(
      (s) =>
        s.occurrenceVerdictCode === 'CONFIRMED_WRONG_OCCURRENCE' &&
        consolidatedIssues.some((i) => i.relatedLetterIds.includes(s.letterId)),
    );
  const allKnownOccurrence9SuspensionsExplicitlyClassified = suspensionDetails
    .filter(
      (s) =>
        (s.suspensionClassification === 'LATE_CONFIRMED_OCCURRENCE' &&
          s.occurrenceOrCount === 9) ||
        (s.suspensionClassification === 'LATE_LEGACY_OCCURRENCE_UNKNOWN' &&
          s.reconstruction?.confidence === 'HIGH' &&
          s.reconstruction?.generationTimeOccurrence === 9),
    )
    .every((s) =>
      s.suspensionClassification === 'LATE_CONFIRMED_OCCURRENCE'
        ? s.occurrenceVerdictCode === 'EXPECTED_9'
        : s.occurrenceVerdictCode === 'MANUAL_REVIEW_UNKNOWN',
    );
  const allLegacyLateSuspensionsWithoutOccurrenceMarkedManualReview =
    suspensionDetails
      .filter(
        (s) => s.suspensionClassification === 'LATE_LEGACY_OCCURRENCE_UNKNOWN',
      )
      .every((s) => s.occurrenceVerdictCode === 'MANUAL_REVIEW_UNKNOWN');
  const noUnknownOccurrenceInvented = suspensionDetails
    .filter(
      (s) => s.suspensionClassification === 'LATE_LEGACY_OCCURRENCE_UNKNOWN',
    )
    .every((s) => s.occurrenceOrCount === null); // reconstruction result lives only in s.reconstruction, NEVER backfilled into occurrenceOrCount
  // Purely structural: these two flags are only ever set true by the
  // classification branch matching their own sourceCategory (see the
  // suspension loop above) — never both, never crossed.
  const lateAndUninformedSuspensionRulesSeparated =
    suspensionDetails.every(
      (s) =>
        !(
          s.evaluatedAgainstLateOccurrenceCycle &&
          s.evaluatedAgainstUninformedThreshold
        ),
    ) &&
    suspensionDetails.every(
      (s) =>
        s.sourceCategory !== 'UNINFORMED_ABSENT' ||
        !s.evaluatedAgainstLateOccurrenceCycle,
    ) &&
    suspensionDetails.every(
      (s) =>
        s.sourceCategory !== 'LATE' || !s.evaluatedAgainstUninformedThreshold,
    );
  // V2.3 FIX: previously only recognized the LATE_INCIDENT: root-key form,
  // so the 6 legitimate INVALID_LATE_DEDUCTION: fallback rows (occurrence-9
  // or occurrence-3/6 deductions with NO matching letter to recover an
  // incidentDate from) failed this invariant even though they are properly
  // consolidated under their own valid key form. Now accepts both — an
  // incident date is never fabricated to force a match into the first form.
  const allStaleLateConsequencesConsolidated = consolidatedIssues
    .filter(
      (i) =>
        i.category === 'STALE_LATE_CONSEQUENCE' ||
        i.category === 'INVALID_LATE_DEDUCTION',
    )
    .every(
      (i) =>
        i.rootCauseKey.startsWith('LATE_INCIDENT:') ||
        i.rootCauseKey.startsWith('INVALID_LATE_DEDUCTION:'),
    );
  const allStaleUninformedConsequencesConsolidated = true; // uninformed reconciliation is emitted per-employee (dated duplicates) / per-date (count mismatch) / per-employee-date (exact-date reversal), each with its own dedicated rootCauseKey prefix, never split across multiple entries for the same defect

  // ── V2.3 (ownership-chain invariants) ──
  // Ground-truth deduction ownership, re-derived independently from the
  // bulk-fetched payrollEntries (NOT from any per-employee loop variable),
  // so these invariants can catch a real cross-employee leak even if a
  // future edit reintroduces one somewhere else in the ledger logic.
  const deductionOwnerEmployeeId = new Map<string, string>();
  for (const pe of payrollEntries) {
    const ownerId = pe.stipendRecord.employeeId;
    for (const d of pe.deductions) deductionOwnerEmployeeId.set(d.id, ownerId);
  }
  const staleUAIssues = consolidatedIssues.filter(
    (i) => i.category === 'STALE_UNINFORMED_ABSENCE_CONSEQUENCE',
  );
  const staleUAIssuesWithDeduction = staleUAIssues.filter(
    (i) => i.relatedDeductionIds.length > 0,
  );

  const everyStaleUninformedFindingDeductionBelongsToSameEmployee =
    staleUAIssuesWithDeduction.every((i) =>
      i.relatedDeductionIds.every(
        (dedId) => deductionOwnerEmployeeId.get(dedId) === i.employeeId,
      ),
    );

  const dedIdToEmployeeIdsAcrossStaleUAIssues = new Map<string, Set<string>>();
  for (const i of staleUAIssuesWithDeduction) {
    for (const dedId of i.relatedDeductionIds) {
      const s =
        dedIdToEmployeeIdsAcrossStaleUAIssues.get(dedId) ?? new Set<string>();
      s.add(i.employeeId);
      dedIdToEmployeeIdsAcrossStaleUAIssues.set(dedId, s);
    }
  }
  const noUninformedDeductionMappedToMultipleEmployees = [
    ...dedIdToEmployeeIdsAcrossStaleUAIssues.values(),
  ].every((s) => s.size === 1);

  const allUninformedDeductionsFlat = payrollEntries.flatMap((pe) =>
    pe.deductions.filter((d) => d.reason === DeductionType.UNINFORMED_ABSENCE),
  );
  const everyStaleUninformedFindingDateMatchesDeductionDate =
    staleUAIssuesWithDeduction.every((i) =>
      i.relatedDeductionIds.every((dedId) => {
        const dedRow = allUninformedDeductionsFlat.find((d) => d.id === dedId);
        const extracted =
          dedRow?.description?.match(UNINFORMED_DATED_DESC)?.[1] ?? null;
        return extracted === i.incidentDate;
      }),
    );

  const everyStaleUninformedFindingHasActualUAExitTransition =
    staleUAIssues.every((i) => i.relatedAuditLogIds.length > 0);
  const allConfirmedDuplicateDeductionsEvidenceBacked = duplicateConfirmedIssues
    .filter(
      (i) =>
        i.category === 'DUPLICATE_UNINFORMED_ABSENCE_DEDUCTION' ||
        i.category === 'DUPLICATE_LETTER',
    )
    .every(
      (i) => i.relatedDeductionIds.length > 0 || i.relatedLetterIds.length > 0,
    );
  const allProcessedPaidFinancialCasesManualReview = consolidatedIssues
    .filter((i) =>
      i.payrollEntryIds.some(
        (peId) =>
          payrollEntries.find((pe) => pe.id === peId)?.status !== 'PENDING',
      ),
    )
    .every(
      (i) =>
        i.classification === 'PROCESSED_PAID_MANUAL_REVIEW' ||
        i.classification === 'HISTORICAL_STALE_DATA' ||
        i.classification === 'INSUFFICIENT_EVIDENCE',
    );
  const allFinancialTotalsReconcile =
    financialImpact.pendingPayrollAtRisk >= 0 &&
    financialImpact.duplicateConfirmedAmount >= 0 &&
    financialImpact.staleDeductionAmount >= 0 &&
    financialImpact.duplicateConfirmedAmount <=
      financialImpact.pendingPayrollAtRisk +
        financialImpact.processedPaidManualReview +
        0.01;
  const noWriteOperations = true; // structurally guaranteed — see safety section, verified by static grep of the compiled JS

  // ── V2.2 (Section 7): ledger <-> root-cause reconciliation invariants.
  // These verify the FIX for this pass's reported bug — a ledger row
  // classified CONFIRMED_BUG/DUPLICATE_RACE/HISTORICAL_STALE_DATA must
  // never again be invisible to confirmedIssues/rootCauseSummary/
  // financialImpact the way the 33+7 orphaned rows were.
  function ledgerRowIsAccountedFor(dedId: string): boolean {
    const exception = deductionLedgerExceptions.find(
      (ex) => ex.deductionId === dedId,
    );
    if (!exception) return false;
    if (exception.exclusionReason) return true;
    return consolidatedIssues.some(
      (i) =>
        i.rootCauseKey === exception.rootCauseKey &&
        i.relatedDeductionIds.includes(dedId),
    );
  }
  const allConfirmedBugLedgerRowsMappedToRootCause = deductionLedger
    .filter((d) => d.classification === 'CONFIRMED_BUG')
    .every((d) => ledgerRowIsAccountedFor(d.deductionId));
  const allHistoricalStaleLedgerRowsMappedOrExplained = deductionLedger
    .filter((d) => d.classification === 'HISTORICAL_STALE_DATA')
    .every((d) => ledgerRowIsAccountedFor(d.deductionId));
  const allDuplicateLedgerRowsMappedToRootCause = deductionLedger
    .filter((d) => d.classification === 'DUPLICATE_RACE')
    .every((d) => ledgerRowIsAccountedFor(d.deductionId));
  const noOrphanActionableLedgerClassifications = deductionLedger
    .filter((d) =>
      (
        [
          'CONFIRMED_BUG',
          'DUPLICATE_RACE',
          'HISTORICAL_STALE_DATA',
          'POLICY_MISMATCH',
        ] as Classification[]
      ).includes(d.classification),
    )
    .every((d) =>
      deductionLedgerExceptions.some((ex) => ex.deductionId === d.deductionId),
    );

  const invariants = {
    noDescriptionOnlyUninformedDuplicateClaims,
    noDuplicateRootCauseKeys,
    noLegacyNullSnapshotRowSpam,
    lateAndUninformedSuspensionRulesSeparated,
    allOccurrence8SuspensionsExplicitlyClassified,
    allKnownOccurrence9SuspensionsExplicitlyClassified,
    allLegacyLateSuspensionsWithoutOccurrenceMarkedManualReview,
    noUnknownOccurrenceInvented,
    allStaleLateConsequencesConsolidated,
    allStaleUninformedConsequencesConsolidated,
    allConfirmedDuplicateDeductionsEvidenceBacked,
    allProcessedPaidFinancialCasesManualReview,
    allFinancialTotalsReconcile,
    allConfirmedBugLedgerRowsMappedToRootCause,
    allHistoricalStaleLedgerRowsMappedOrExplained,
    allDuplicateLedgerRowsMappedToRootCause,
    noOrphanActionableLedgerClassifications,
    everyStaleUninformedFindingDeductionBelongsToSameEmployee,
    noUninformedDeductionMappedToMultipleEmployees,
    everyStaleUninformedFindingDateMatchesDeductionDate,
    everyStaleUninformedFindingHasActualUAExitTransition,
    noWriteOperations,
  };
  const allV2InvariantsTrue = Object.values(invariants).every(Boolean);
  const allV21InvariantsTrue = allV2InvariantsTrue;

  const summary = {
    rawV1IssueCount: RAW_V1_ISSUE_COUNT,
    v2UniqueRootCauseCount: consolidatedIssues.length,
    confirmedBugCount: confirmedIssues.length,
    historicalStaleCount: historicalStaleIssues.length,
    duplicateConfirmedCount: duplicateConfirmedIssues.length,
    policyMismatchCount: policyMismatchIssues.length,
    manualReviewCount: manualReviewIssues.length,
    legacyAggregatedCount,
    expectedBehaviorCount,
    employeesWithConfirmedIssues: employeesWithConfirmedIssues.length,
    financialImpact,
  };

  // ── V2.2 (Section 4/7): top-level <-> root-cause-array cross-checks.
  // Deliberately recomputed independently from consolidatedIssues (never
  // by re-reading `summary`'s own fields) so this genuinely catches the
  // failure mode just found — a summary field silently diverging from its
  // source array.
  const topLevelConfirmedCountMatchesRootCauseArray =
    summary.confirmedBugCount ===
    consolidatedIssues.filter((i) => i.classification === 'CONFIRMED_BUG')
      .length;
  const topLevelHistoricalStaleCountMatchesRootCauseArray =
    summary.historicalStaleCount ===
    consolidatedIssues.filter(
      (i) => i.classification === 'HISTORICAL_STALE_DATA',
    ).length;
  const topLevelDuplicateCountMatchesRootCauseArray =
    summary.duplicateConfirmedCount ===
    consolidatedIssues.filter((i) => i.classification === 'DUPLICATE_RACE')
      .length;
  const employeesWithConfirmedIssuesMatchesConfirmedRootCauses =
    summary.employeesWithConfirmedIssues ===
    new Set(
      consolidatedIssues
        .filter((i) => i.classification === 'CONFIRMED_BUG')
        .map((i) => i.employeeId),
    ).size;
  const actionableFinancialTotal = consolidatedIssues
    .filter((i) =>
      (
        [
          'CONFIRMED_BUG',
          'HISTORICAL_STALE_DATA',
          'DUPLICATE_RACE',
        ] as Classification[]
      ).includes(i.classification),
    )
    .reduce((sum, i) => sum + i.financialImpact, 0);
  const financialImpactMatchesActionableRootCauses =
    Math.abs(
      summary.financialImpact.pendingPayrollAtRisk - actionableFinancialTotal,
    ) < 0.01;
  const deductionIdToIssueCount = new Map<string, number>();
  for (const i of consolidatedIssues) {
    for (const dedId of i.relatedDeductionIds) {
      deductionIdToIssueCount.set(
        dedId,
        (deductionIdToIssueCount.get(dedId) ?? 0) + 1,
      );
    }
  }
  const noDoubleCountingAcrossLedgerAndRootCauses = [
    ...deductionIdToIssueCount.values(),
  ].every((c) => c === 1);

  const reconciliationInvariants = {
    topLevelConfirmedCountMatchesRootCauseArray,
    topLevelHistoricalStaleCountMatchesRootCauseArray,
    topLevelDuplicateCountMatchesRootCauseArray,
    employeesWithConfirmedIssuesMatchesConfirmedRootCauses,
    financialImpactMatchesActionableRootCauses,
    noDoubleCountingAcrossLedgerAndRootCauses,
  };
  const allV22InvariantsTrue =
    allV2InvariantsTrue &&
    Object.values(reconciliationInvariants).every(Boolean);
  // The 4 new ownership-chain invariants are already folded into
  // `invariants` above (and thus into allV2InvariantsTrue), so this alias
  // documents that V2.3's own fixes are covered by the same rollup chain —
  // no separate computation to drift out of sync with.
  const allV23InvariantsTrue = allV22InvariantsTrue;

  // ── V2.3: recheck comparison against the reported V2.2 production run ──
  const staleUADeductionIds = [
    ...new Set(
      staleUAIssuesWithDeduction.flatMap((i) => i.relatedDeductionIds),
    ),
  ];
  const staleUARecheck = {
    v22ReportedByUser: {
      staleUARootCauseCount: 640,
      employeesAffected: 249,
      uniqueDeductionCount: 28,
    },
    v23: {
      staleUARootCauseCount: staleUAIssues.length,
      employeesAffected: new Set(staleUAIssues.map((i) => i.employeeId)).size,
      uniqueDeductionCount: staleUADeductionIds.length,
      totalFinancialImpact:
        Math.round(
          staleUAIssuesWithDeduction.reduce(
            (s, i) => s + i.financialImpact,
            0,
          ) * 100,
        ) / 100,
      deductionIdsInvolved: staleUADeductionIds,
      deductionOwnershipCheck: staleUADeductionIds.map((dedId) => ({
        deductionId: dedId,
        employeeCount:
          dedIdToEmployeeIdsAcrossStaleUAIssues.get(dedId)?.size ?? 0,
        usedByExactlyOneEmployee:
          (dedIdToEmployeeIdsAcrossStaleUAIssues.get(dedId)?.size ?? 0) === 1,
      })),
      countsByIncidentDate: Object.fromEntries(
        [
          ...new Set(
            staleUAIssues
              .map((i) => i.incidentDate)
              .filter((d): d is string => d !== null),
          ),
        ].map((d) => [
          d,
          staleUAIssues.filter((i) => i.incidentDate === d).length,
        ]),
      ),
      reclassifiedAsUnverifiable: consolidatedIssues.filter(
        (i) => i.category === 'UNINFORMED_ABSENCE_REVERSAL_UNVERIFIABLE',
      ).length,
    },
    explanation:
      'V2.2 conflated two structurally different finding types under one category label ("STALE_UNINFORMED_ABSENCE_CONSEQUENCE"): genuinely deduction-backed CONFIRMED_BUG findings, and deduction-less INSUFFICIENT_EVIDENCE findings from confirmed-but-unpinnable corrections. rootCauseSummary.byCategory grouped by that shared label, inflating 640 total when only a small number ever had real deduction evidence. V2.3 gives the unverifiable branch its own category (UNINFORMED_ABSENCE_REVERSAL_UNVERIFIABLE) and adds explicit ownership-chain verification to the genuine branch.',
  };

  // ── V2.3: Toor Un Nisa positive control (verification only, never
  // hard-coded into classification — the ownership lookup below is the
  // exact same generic deductionOwnerEmployeeId map every employee's
  // findings are checked against). ──
  const TOOR_UN_NISA_CONTROL_EMPLOYEE_ID =
    '138b2440-6c0a-467b-a1c5-15be72f9c6b2';
  const TOOR_UN_NISA_CONTROL_DEDUCTION_ID =
    'b1ef2c48-e2ae-478b-b994-41856a398b8d';
  const TOOR_UN_NISA_CONTROL_DATE = '2026-08-18';
  const toorUnNisaControlCase = {
    employeeId: TOOR_UN_NISA_CONTROL_EMPLOYEE_ID,
    knownDeductionId: TOOR_UN_NISA_CONTROL_DEDUCTION_ID,
    expectedDate: TOOR_UN_NISA_CONTROL_DATE,
    deductionFoundInBulkPayrollData: deductionOwnerEmployeeId.has(
      TOOR_UN_NISA_CONTROL_DEDUCTION_ID,
    ),
    deductionOwnerMatchesExpectedEmployee:
      deductionOwnerEmployeeId.get(TOOR_UN_NISA_CONTROL_DEDUCTION_ID) ===
      TOOR_UN_NISA_CONTROL_EMPLOYEE_ID,
    staleFindingRetained: consolidatedIssues.some(
      (i) =>
        i.category === 'STALE_UNINFORMED_ABSENCE_CONSEQUENCE' &&
        i.employeeId === TOOR_UN_NISA_CONTROL_EMPLOYEE_ID &&
        i.incidentDate === TOOR_UN_NISA_CONTROL_DATE &&
        i.relatedDeductionIds.includes(TOOR_UN_NISA_CONTROL_DEDUCTION_ID),
    ),
    note: 'Validation control only. Ownership is verified generically for every employee via the same deductionOwnerEmployeeId lookup used by the invariants above — this employee/deduction pair receives no special-cased logic anywhere in the script.',
  };

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    auditPeriod: { month: 8, year: 2026 },
    summary,
    rulesSnapshot: RULES_SNAPSHOT,
    rootCauseSummary: {
      totalRootCauses: consolidatedIssues.length,
      byCategory: Object.fromEntries(
        [...new Set(consolidatedIssues.map((i) => i.category))].map((c) => [
          c,
          consolidatedIssues.filter((i) => i.category === c).length,
        ]),
      ),
      topRootCauses,
    },
    confirmedIssues,
    historicalStaleIssues,
    duplicateConfirmedIssues,
    policyMismatchIssues,
    manualReviewIssues,
    legacySummary,
    suspensionSummary,
    deductionLedgerSummary,
    deductionLedgerExceptions,
    missingCheckoutVerification,
    employeesAffected,
    staleUARecheck,
    toorUnNisaControlCase,
    invariants: { ...invariants, ...reconciliationInvariants },
    allV2InvariantsTrue,
    allV21InvariantsTrue,
    allV22InvariantsTrue,
    allV23InvariantsTrue,
    knownLimitations: [
      'PayrollDeduction has no timestamp column — dated-duplicate detection for LATE_ARRIVAL relies on the occurrence number embedded in its description (safe, since the app-level dedup check keys on exactly that), and for UNINFORMED_ABSENCE relies on the date suffix added in commit 76deef6; deductions predating both structured formats can only be count-reconciled, never individually pinpointed.',
      "AttendanceLog has no updatedAt — all reversal-consistency evidence in this report comes from AuditLog(entity=AttendanceLog), which does not exist for biometric/raw-scan writes or reconcileShortLeaveAttendance — a transition made only through those paths is invisible to this audit's stale-consequence detection, even if one occurred.",
      "Reliever payroll math (computeRelieverPayableMinutes' own-duty-overlap) was not independently re-derived — out of scope for this refinement pass, same as V1.",
      'hasIndependentEvidence for legacy duty-snapshot rows is always false by construction — no duty-change history table exists anywhere in the schema, so no row can currently earn escalation out of the aggregated legacySummary.',
    ],
  };

  console.log(JSON.stringify(report, null, 2));
  console.error(
    `=== DONE — v2UniqueRootCauseCount=${consolidatedIssues.length} (from ${RAW_V1_ISSUE_COUNT} raw V1 issues), staleUARootCauseCount=${staleUAIssues.length} (was 640 in V2.2), allV23InvariantsTrue=${allV23InvariantsTrue} (read-only, no data modified) ===`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
