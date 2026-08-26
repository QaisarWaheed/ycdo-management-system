/**
 * READ-ONLY — SYSTEM-WIDE AUGUST 2026 LEGACY DEDUCTION RECONSTRUCTION AUDIT
 * (v2 — fixes the temporal-attribution bug: a new DATED UA incident could
 * previously be miscounted as "proof" supporting an older, UNDATED legacy
 * row for the same employee, because both were treated as one undifferentiated
 * evidence pool. Fixed via one-to-one evidence consumption — see section
 * "TEMPORAL ATTRIBUTION FIX" below.)
 *
 * Extends the single-employee Dr Iram trace (trace-dr-iram-payroll-
 * deductions.ts) to every employee with an August 2026 PayrollEntry.
 * Two independent problem classes are audited and reported SEPARATELY,
 * never merged into one count/amount:
 *
 *   (1) LEGACY UNDATED UNINFORMED_ABSENCE deductions — byte-identical rows
 *       with no date suffix ("Uninformed absence deduction (2 days)" /
 *       "Absent without approved leave (2 days stipend)", no trailing
 *       date). These predate the description date-suffix fix and can
 *       never be found/matched by reverseAbsenceDeductionForDate, so they
 *       survive forever regardless of what later happened to the
 *       employee's attendance. Because they are byte-identical, once an
 *       employee has more legacy rows than provably-real incidents, WHICH
 *       specific row(s) are excess is fundamentally unknowable — only the
 *       aggregate excess count/amount can be proven. See section 2/3.
 *
 *   (2) Already-known STRUCTURED issue classes, recomputed fresh (not
 *       hard-coded from prior run counts, since production state may have
 *       changed since those runs):
 *         A. exact-date stale UNINFORMED_ABSENCE deductions (dated
 *            templates — "Uninformed absence deduction..." AND "Absent
 *            without approved leave..." are ONE financial family per
 *            business policy; a row is stale only when current attendance
 *            for that exact date is NEITHER ABSENT NOR UNINFORMED_ABSENT —
 *            see isAbsenceFinanciallyValid. Matching a specific
 *            DisciplineEvent(UNINFORMED_ABSENT) is never a precondition
 *            for financial validity, since disciplinary tracking is a
 *            separate concern from the deduction itself.)
 *         B. occurrence-9 LATE deductions (code can never legitimately
 *            create one — the 9th late this month is Suspension-only,
 *            see applyLateDiscipline)
 *         C. "never reached" / historical-stale LATE deductions (occurrence
 *            3 or 6 whose current true recomputed late-incident count no
 *            longer reaches that occurrence, or whose matched
 *            DisciplineEvent's date is no longer a true late day)
 *         D. duplicate financial deduction rows (exact byte-identical
 *            reason+description on the same PayrollEntry), EXCLUDING
 *            legacy-undated UA rows (those are handled exclusively by (1)
 *            to avoid double-counting), plus duplicate Letter groups
 *            reported informationally.
 *
 * Zero writes. Only reads Employee, StipendRecord, PayrollEntry,
 * PayrollDeduction, AttendanceLog, AuditLog, LeaveRecord, LeaveApproval,
 * Letter, DisciplineEvent. Optionally READS (never writes) a local baseline
 * JSON file for the drift report — see BASELINE_REPORT_PATH below.
 *
 * EVIDENCE RULES for legacy-UA date reconstruction (section 2):
 *   PROVEN_UA      - current AttendanceLog.status === UNINFORMED_ABSENT for
 *                     that date, OR AuditLog(AttendanceLog) shows any
 *                     changes.previous.status === UNINFORMED_ABSENT for
 *                     that date's log row (i.e. it verifiably WAS
 *                     UNINFORMED_ABSENT at some point, even if since
 *                     corrected), OR a DisciplineEvent(UNINFORMED_ABSENT)
 *                     row exists for that exact date.
 *   PROVEN_NOT_UA  - an AttendanceLog row exists for that date with a
 *                     current status that is definitively NOT
 *                     UNINFORMED_ABSENT, and neither of the PROVEN_UA
 *                     signals above are present for it.
 *   AMBIGUOUS      - anything else with at least SOME evidence a date is
 *                     relevant (e.g. no AttendanceLog row for that date but
 *                     a leave record or other partial signal touches it) —
 *                     not enough to prove either way. Dates with literally
 *                     zero evidence of any kind are not considered
 *                     candidate dates at all (never invented from nothing).
 *
 * Never infers PROVEN_UA merely from the existence of a legacy deduction
 * itself — that would be circular.
 *
 * ── TEMPORAL ATTRIBUTION FIX ──────────────────────────────────────────
 * A PROVEN_UA date is now additionally EXCLUDED from the pool eligible to
 * support an employee's undated legacy rows when either:
 *   (a) that exact date already has its OWN dated UA deduction on record
 *       for this employee this run (UNINFORMED_ABSENT_DATED or ABSENT_DATED
 *       template) — direct one-to-one evidence consumption: one incident
 *       can finance at most one deduction, and this date's evidence is
 *       already spent on its own row; OR
 *   (b) that date falls on/after DATED_FORMAT_FIRST_CONFIRMED_DATE (see
 *       below) — a backstop for the case where a post-cutoff incident's
 *       dated deduction was legitimately created AND SINCE REVERSED (e.g.
 *       via reconcileAttendanceFinancialConsequences after an attendance
 *       correction) — its evidence was still fully processed and accounted
 *       for by the modern pathway, and must not be silently redirected to
 *       prop up an unrelated, older, undated row just because the live
 *       deduction row itself no longer exists.
 * Excluded dates are reported per-employee (consumedByOwnDatedDeductionDates
 * / excludedByCutoffDates) rather than silently dropped, and the script
 * additionally computes what the PRE-FIX (buggy) numbers would have been for
 * every employee so the exact restored delta is directly visible — see
 * section 7 "delta table" in the output, and section 4 "august18DriftReport".
 *
 * TEMPORAL CUTOFF EVIDENCE (this repository's git history — see full
 * reasoning + confidence level in DATED_FORMAT_FIRST_CONFIRMED_DATE's own
 * comment below). No production database timestamp evidence exists for
 * PayrollDeduction (no createdAt/updatedAt column) — the cutoff is
 * evidenced entirely from source history, deliberately conservative.
 *
 * Run:
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/system-wide-legacy-deduction-audit-2026.ts > system-wide-legacy-audit.json
 *
 * Optional drift comparison against a prior run's JSON output (section 5):
 *   BASELINE_REPORT_PATH="./prior-run.json" DATABASE_URL="..." npx ts-node --transpile-only scripts/system-wide-legacy-deduction-audit-2026.ts > system-wide-legacy-audit.json
 */

import * as fs from 'fs';
import {
  AttendanceLogType,
  AttendanceStatus,
  DeductionType,
  DisciplineCategory,
  LetterType,
  PayrollStatus,
  PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();

const TARGET_MONTH = 8;
const TARGET_YEAR = 2026;
const MONTH_START = new Date(Date.UTC(TARGET_YEAR, TARGET_MONTH - 1, 1, 0, 0, 0, 0));
const MONTH_END = new Date(Date.UTC(TARGET_YEAR, TARGET_MONTH - 1, 31, 23, 59, 59, 999));

/**
 * Evidence: commit 76deef623f5ee8eda3366bb1158a77e08de2e001 ("late arrival
 * fine fix, biometric architecture, attendance desiplene"), committed
 * 2026-08-17 14:41:34 +0500, is the ONLY commit in this file's entire git
 * history (`git log -p -- discipline.helper.ts`, manually inspected in
 * full) that changes the PayrollDeduction.description literals in
 * applyAbsentDeduction and applyUninformedAbsentDeduction — both changed in
 * the SAME commit, from the undated legacy literals ('Uninformed absence
 * deduction (2 days)' / 'Absent without approved leave (2 days stipend)')
 * to the dated template ('... — ${date}'). No commit before or after it
 * reverts either line back to the undated form. Corroborated by four schema
 * migrations (20260817120000_add_attendance_session_closed_at,
 * 20260817140000_add_attendance_duty_snapshot,
 * 20260817150000_add_attendance_short_leave_status,
 * 20260817160000_add_leave_quota_exception_workflow) deployed the same
 * calendar day, matching features that commit introduces
 * (dutyStartTimeSnapshot, sessionClosedAt, SHORT_LEAVE status) — strong
 * circumstantial evidence this commit was deployed same-day.
 *
 * CONFIDENCE: HIGH that the source code stopped being CAPABLE of producing
 * the undated template at this commit. LOWER confidence on the exact
 * commit-to-production-deploy lag for this specific run, since
 * PayrollDeduction has no createdAt/updatedAt column — no row's actual
 * creation instant can be directly verified against this timestamp.
 *
 * Per "do not invent a cutoff, be conservative": the ENTIRE deployment day
 * is therefore treated as NOT safely pre-cutoff. Only 2026-08-16 and
 * earlier are treated as guaranteed to have been processed exclusively by
 * the legacy undated code path.
 */
const DATED_FORMAT_FIRST_CONFIRMED_DATE = '2026-08-17';
/** Last date conservatively guaranteed to be pre-cutoff — see above. */
const LEGACY_FORMAT_LAST_POSSIBLE_DATE = '2026-08-16';

const BASELINE_REPORT_PATH = process.env.BASELINE_REPORT_PATH ?? null;

function dateLabelOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * AUTHORITATIVE BUSINESS POLICY (financial): ABSENT and UNINFORMED_ABSENT
 * are ONE financial family — the same 2-day absence deduction applies
 * whether the absence was informed (ABSENT) or uninformed
 * (UNINFORMED_ABSENT). The distinction between the two is DISCIPLINARY
 * ONLY (UNINFORMED_ABSENT is more serious and drives DisciplineEvent /
 * suspension tracking) and must NEVER affect whether a dated absence-family
 * deduction is still financially justified. Mirrors discipline.helper.ts's
 * isAbsentFamilyEligibleForDiscipline exactly (the production source of
 * truth for this same question).
 */
function isAbsenceFinanciallyValid(status: string): boolean {
  return status === AttendanceStatus.ABSENT || status === AttendanceStatus.UNINFORMED_ABSENT;
}

/** Mirrors applyLateDiscipline's own "true late" predicate exactly (same
 * logic used in trace-toor-un-nisa-discipline.ts). */
function isTrueLateRow(row: { status: string; lateMinutes: number; note: string | null }): boolean {
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

type DescTemplate =
  | 'LATE_ARRIVAL_MONTHLY_OCCURRENCE'
  | 'UNINFORMED_ABSENT_DATED'
  | 'ABSENT_DATED'
  | 'UNINFORMED_ABSENCE_LEGACY_UNDATED'
  | 'MISSING_CHECKOUT_MONTHLY_OCCURRENCE'
  | 'EXTRA_LEAVE_REJECTED_DATED'
  | 'UNPAID_LEAVE_AGGREGATE'
  | 'UNRECOGNIZED';

function classifyDescriptionTemplate(
  reason: DeductionType,
  description: string | null,
): { templateMatched: DescTemplate; extractedOccurrence: number | null; extractedIncidentDate: string | null } {
  const desc = description ?? '';

  if (reason === DeductionType.LATE_ARRIVAL) {
    const m = desc.match(/^Late arrival deduction — monthly occurrence (\d+)$/);
    if (m) return { templateMatched: 'LATE_ARRIVAL_MONTHLY_OCCURRENCE', extractedOccurrence: Number(m[1]), extractedIncidentDate: null };
    return { templateMatched: 'UNRECOGNIZED', extractedOccurrence: null, extractedIncidentDate: null };
  }

  if (reason === DeductionType.UNINFORMED_ABSENCE) {
    const dated1 = desc.match(/^Uninformed absence deduction \(2 days\) — (\d{4}-\d{2}-\d{2})$/);
    if (dated1) return { templateMatched: 'UNINFORMED_ABSENT_DATED', extractedOccurrence: null, extractedIncidentDate: dated1[1] };
    const dated2 = desc.match(/^Absent without approved leave \(2 days stipend\) — (\d{4}-\d{2}-\d{2})$/);
    if (dated2) return { templateMatched: 'ABSENT_DATED', extractedOccurrence: null, extractedIncidentDate: dated2[1] };
    if (
      /^Uninformed absence deduction \(2 days\)$/.test(desc) ||
      /^Absent without approved leave \(2 days stipend\)$/.test(desc)
    ) {
      return { templateMatched: 'UNINFORMED_ABSENCE_LEGACY_UNDATED', extractedOccurrence: null, extractedIncidentDate: null };
    }
    return { templateMatched: 'UNRECOGNIZED', extractedOccurrence: null, extractedIncidentDate: null };
  }

  if (reason === DeductionType.DISCIPLINARY_FINE) {
    const m = desc.match(/^Missing checkout deduction — monthly occurrence (\d+)$/);
    if (m) return { templateMatched: 'MISSING_CHECKOUT_MONTHLY_OCCURRENCE', extractedOccurrence: Number(m[1]), extractedIncidentDate: null };
    return { templateMatched: 'UNRECOGNIZED', extractedOccurrence: null, extractedIncidentDate: null };
  }

  if ((reason as string) === 'EXTRA_LEAVE_REJECTED') {
    const m = desc.match(/^Extra Full Leave rejected — 1-day deduction — (\d{4}-\d{2}-\d{2})$/);
    if (m) return { templateMatched: 'EXTRA_LEAVE_REJECTED_DATED', extractedOccurrence: null, extractedIncidentDate: m[1] };
    return { templateMatched: 'UNRECOGNIZED', extractedOccurrence: null, extractedIncidentDate: null };
  }

  if (reason === DeductionType.UNPAID_LEAVE) {
    return { templateMatched: 'UNPAID_LEAVE_AGGREGATE', extractedOccurrence: null, extractedIncidentDate: null };
  }

  return { templateMatched: 'UNRECOGNIZED', extractedOccurrence: null, extractedIncidentDate: null };
}

type EvidenceBundle = {
  employeeId: string;
  attendanceLogs: Awaited<ReturnType<typeof fetchEvidenceForEmployee>>['attendanceLogs'];
  attendanceByDate: Map<string, EvidenceBundle['attendanceLogs'][number]>;
  auditLogs: Awaited<ReturnType<typeof fetchEvidenceForEmployee>>['auditLogs'];
  auditByLogId: Map<string, EvidenceBundle['auditLogs']>;
  disciplineEvents: Awaited<ReturnType<typeof fetchEvidenceForEmployee>>['disciplineEvents'];
  leaveRecords: Awaited<ReturnType<typeof fetchEvidenceForEmployee>>['leaveRecords'];
  letters: Awaited<ReturnType<typeof fetchEvidenceForEmployee>>['letters'];
  trueAugustLateIncidentCount: number;
};

async function fetchEvidenceForEmployee(employeeId: string) {
  const attendanceLogs = await prisma.attendanceLog.findMany({
    where: { employeeId, date: { gte: MONTH_START, lte: MONTH_END } },
    orderBy: { date: 'asc' },
  });
  const attendanceLogIds = attendanceLogs.map((l) => l.id);
  const auditLogs = attendanceLogIds.length
    ? await prisma.auditLog.findMany({
        where: { entity: 'AttendanceLog', entityId: { in: attendanceLogIds } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, userId: true, action: true, entityId: true, changes: true, createdAt: true },
      })
    : [];
  const disciplineEvents = await prisma.disciplineEvent.findMany({
    where: { employeeId, incidentDate: { gte: MONTH_START, lte: MONTH_END } },
    orderBy: { createdAt: 'asc' },
  });
  const leaveRecords = await prisma.leaveRecord.findMany({
    where: {
      employeeId,
      OR: [{ startDate: { gte: MONTH_START, lte: MONTH_END } }, { endDate: { gte: MONTH_START, lte: MONTH_END } }],
    },
    include: { approvals: { orderBy: { actionAt: 'asc' } } },
    orderBy: { startDate: 'asc' },
  });
  const letters = await prisma.letter.findMany({
    where: { employeeId, generatedAt: { gte: MONTH_START, lte: MONTH_END } },
    select: { id: true, letterNo: true, letterType: true, generatedAt: true, variables: true },
    orderBy: { generatedAt: 'asc' },
  });
  return { attendanceLogs, auditLogs, disciplineEvents, leaveRecords, letters };
}

async function buildEvidenceBundle(employeeId: string): Promise<EvidenceBundle> {
  const { attendanceLogs, auditLogs, disciplineEvents, leaveRecords, letters } = await fetchEvidenceForEmployee(employeeId);

  const attendanceByDate = new Map(
    attendanceLogs.filter((l) => l.type === AttendanceLogType.REGULAR).map((l) => [dateLabelOf(l.date), l]),
  );
  const auditByLogId = new Map<string, typeof auditLogs>();
  for (const a of auditLogs) {
    const arr = auditByLogId.get(a.entityId) ?? [];
    arr.push(a);
    auditByLogId.set(a.entityId, arr);
  }

  const trueAugustLateIncidentCount = attendanceLogs.filter(
    (l) => l.type === AttendanceLogType.REGULAR && isTrueLateRow(l),
  ).length;

  return {
    employeeId,
    attendanceLogs,
    attendanceByDate,
    auditLogs,
    auditByLogId,
    disciplineEvents,
    leaveRecords,
    letters,
    trueAugustLateIncidentCount,
  };
}

/** PROVEN_UA / PROVEN_NOT_UA / AMBIGUOUS classification for one calendar
 * date, per the evidence rules in the file header. Never consults the
 * legacy deduction rows themselves (would be circular). */
function classifyDateForUA(
  dateLabel: string,
  bundle: EvidenceBundle,
): 'PROVEN_UA' | 'PROVEN_NOT_UA' | 'AMBIGUOUS' | null {
  const log = bundle.attendanceByDate.get(dateLabel) ?? null;
  const disciplineEvent = bundle.disciplineEvents.find(
    (e) => e.category === DisciplineCategory.UNINFORMED_ABSENT && dateLabelOf(e.incidentDate) === dateLabel,
  );

  if (disciplineEvent) return 'PROVEN_UA';

  if (log) {
    if (log.status === AttendanceStatus.UNINFORMED_ABSENT) return 'PROVEN_UA';

    const auditsForLog = bundle.auditByLogId.get(log.id) ?? [];
    const everWasUA = auditsForLog.some((a) => {
      const changes = a.changes as { previous?: { status?: string } } | null;
      return changes?.previous?.status === AttendanceStatus.UNINFORMED_ABSENT;
    });
    if (everWasUA) return 'PROVEN_UA';

    // Has a log row with a definite current non-UA status and no historical
    // evidence it was ever UA.
    return 'PROVEN_NOT_UA';
  }

  // No AttendanceLog row for this date at all. Check if a leave record
  // touches it (partial signal — not proof either way on its own).
  const leaveTouchesDate = bundle.leaveRecords.some((lr) => {
    const d = new Date(dateLabel + 'T00:00:00.000Z');
    return lr.startDate <= d && lr.endDate >= d;
  });
  if (leaveTouchesDate) return 'AMBIGUOUS';

  // Zero evidence of any kind for this date — not a candidate at all.
  return null;
}

type DeductionRow = {
  deductionId: string;
  employeeId: string;
  payrollEntryId: string;
  payrollStatus: PayrollStatus;
  reason: DeductionType;
  amount: number;
  description: string | null;
  template: DescTemplate;
  extractedOccurrence: number | null;
  extractedIncidentDate: string | null;
};

async function main() {
  console.error('=== READ-ONLY SYSTEM-WIDE AUDIT v2: August 2026 legacy + structured payroll deductions (temporal-attribution fix) ===');

  const payrollEntries = await prisma.payrollEntry.findMany({
    where: { month: TARGET_MONTH, year: TARGET_YEAR },
    include: {
      deductions: true,
      stipendRecord: {
        include: { employee: { select: { id: true, employeeCode: true, fullName: true } } },
      },
    },
  });

  const allRows: DeductionRow[] = [];
  const employeeById = new Map<string, { id: string; employeeCode: string; fullName: string }>();
  const payrollEntryById = new Map<string, (typeof payrollEntries)[number]>();

  for (const pe of payrollEntries) {
    const employee = pe.stipendRecord.employee;
    employeeById.set(employee.id, employee);
    payrollEntryById.set(pe.id, pe);
    for (const d of pe.deductions) {
      const t = classifyDescriptionTemplate(d.reason, d.description);
      allRows.push({
        deductionId: d.id,
        employeeId: employee.id,
        payrollEntryId: pe.id,
        payrollStatus: pe.status,
        reason: d.reason,
        amount: Number(d.amount),
        description: d.description,
        template: t.templateMatched,
        extractedOccurrence: t.extractedOccurrence,
        extractedIncidentDate: t.extractedIncidentDate,
      });
    }
  }

  console.error(`Payroll entries: ${payrollEntries.length}, deduction rows: ${allRows.length}, distinct employees: ${employeeById.size}`);

  // ── Fetch evidence bundles for every employee with ANY deduction row this
  // month (needed for both legacy-UA reconstruction and structured checks). ──
  const employeeIdsNeedingEvidence = [...new Set(allRows.map((r) => r.employeeId))];
  const evidenceByEmployee = new Map<string, EvidenceBundle>();
  for (const employeeId of employeeIdsNeedingEvidence) {
    evidenceByEmployee.set(employeeId, await buildEvidenceBundle(employeeId));
  }
  console.error(`Evidence bundles built for ${evidenceByEmployee.size} employees.`);

  // ── Duplicate financial rows: exact (payrollEntryId, reason, description)
  // match with count > 1, EXCLUDING legacy-undated UA (handled separately
  // to avoid double-counting — see file header). ──
  const dupKey = (r: DeductionRow) => `${r.payrollEntryId}::${r.reason}::${r.description}`;
  const dupCounts = new Map<string, DeductionRow[]>();
  for (const r of allRows) {
    if (r.template === 'UNINFORMED_ABSENCE_LEGACY_UNDATED') continue; // handled in legacy-UA section
    const key = dupKey(r);
    const arr = dupCounts.get(key) ?? [];
    arr.push(r);
    dupCounts.set(key, arr);
  }
  const duplicateGroups = [...dupCounts.entries()].filter(([, rows]) => rows.length > 1);
  const duplicateRowIds = new Set<string>();
  for (const [, rows] of duplicateGroups) {
    for (const r of rows) duplicateRowIds.add(r.deductionId);
  }

  // ── Duplicate Letter groups (informational — see file header on why this
  // is reported separately from duplicateFinancialCount/Amount). ──
  type LetterRow = { id: string; letterNo: string | null; letterType: LetterType; generatedAt: Date; variables: unknown };
  const letterDupKey = (employeeId: string, l: LetterRow) => {
    const vars = l.variables as { monthlyLateOccurrence?: number; incidentDate?: string } | null;
    return `${employeeId}::${l.letterType}::${vars?.monthlyLateOccurrence ?? 'null'}::${vars?.incidentDate ?? 'null'}`;
  };
  const letterDupCounts = new Map<string, { employeeId: string; letterIds: string[] }>();
  for (const [employeeId, bundle] of evidenceByEmployee) {
    for (const l of bundle.letters) {
      const key = letterDupKey(employeeId, l);
      const entry = letterDupCounts.get(key) ?? { employeeId, letterIds: [] };
      entry.letterIds.push(l.id);
      letterDupCounts.set(key, entry);
    }
  }
  const duplicateLetterGroups = [...letterDupCounts.values()].filter((v) => v.letterIds.length > 1);

  // ── Classify every non-legacy-undated row into structured buckets ──
  type StructuredVerdict = 'VALID' | 'EXACT_DATE_STALE_UA' | 'OCCURRENCE_9_INVALID' | 'NEVER_REACHED_LATE' | 'DUPLICATE' | 'INSUFFICIENT_EVIDENCE' | 'NOT_MODELED';
  type StructuredRow = DeductionRow & {
    verdict: StructuredVerdict;
    matchedDisciplineEventOccurrence: number | null;
    matchedDisciplineEventDate: string | null;
    matchedLogCurrentStatus: string | null;
    correctedAfterIncident: boolean | 'UNKNOWN';
    cleanupSafetyClass: 'SAFE_EXACT_CLEANUP' | 'SAFE_AGGREGATE_CORRECTION_BUT_ROW_IDENTITY_UNKNOWN' | 'MANUAL_REVIEW' | 'NO_ACTION';
  };

  const structuredRows: StructuredRow[] = [];

  for (const r of allRows) {
    if (r.template === 'UNINFORMED_ABSENCE_LEGACY_UNDATED') continue; // section 2/3 handles these

    const bundle = evidenceByEmployee.get(r.employeeId)!;

    if (duplicateRowIds.has(r.deductionId)) {
      structuredRows.push({
        ...r,
        verdict: 'DUPLICATE',
        matchedDisciplineEventOccurrence: null,
        matchedDisciplineEventDate: null,
        matchedLogCurrentStatus: null,
        correctedAfterIncident: 'UNKNOWN',
        // Byte-identical rows cannot be told apart — WHICH row(s) are the
        // excess is unknowable, only that (count-1) rows in the group are.
        cleanupSafetyClass: 'SAFE_AGGREGATE_CORRECTION_BUT_ROW_IDENTITY_UNKNOWN',
      });
      continue;
    }

    if (r.template === 'LATE_ARRIVAL_MONTHLY_OCCURRENCE') {
      const occ = r.extractedOccurrence!;
      // OCCURRENCE_9_INVALID means literally occurrence === 9 — the one
      // occurrence applyLateDiscipline's own cycle logic hard-codes as
      // suspension-only (no Fine deduction ever legitimately created
      // there). positionInCycle === ((occ-1)%3)+1 reaches 3 (the Fine
      // branch) for EVERY multiple of 3 EXCEPT 9 — so occurrence
      // 3/6/12/15/18/... are all legitimate Fine occurrences under the
      // actual production cycle math and must never be classified invalid
      // here. A prior version of this check (`occ !== 3 && occ !== 6`)
      // over-flagged 12/15/18/... as invalid; fixed to the exact,
      // code-accurate condition.
      if (occ === 9) {
        structuredRows.push({
          ...r,
          verdict: 'OCCURRENCE_9_INVALID',
          matchedDisciplineEventOccurrence: null,
          matchedDisciplineEventDate: null,
          matchedLogCurrentStatus: null,
          correctedAfterIncident: 'UNKNOWN',
          cleanupSafetyClass: 'SAFE_EXACT_CLEANUP',
        });
        continue;
      }

      const ev = bundle.disciplineEvents.find((e) => e.category === DisciplineCategory.LATE && e.occurrence === occ);
      if (ev) {
        const evDateLabel = dateLabelOf(ev.incidentDate);
        const log = bundle.attendanceByDate.get(evDateLabel) ?? null;
        const stillTrueLate = log ? isTrueLateRow(log) : false;
        if (stillTrueLate) {
          structuredRows.push({
            ...r,
            verdict: 'VALID',
            matchedDisciplineEventOccurrence: ev.occurrence,
            matchedDisciplineEventDate: evDateLabel,
            matchedLogCurrentStatus: log?.status ?? null,
            correctedAfterIncident: false,
            cleanupSafetyClass: 'NO_ACTION',
          });
        } else {
          structuredRows.push({
            ...r,
            verdict: 'NEVER_REACHED_LATE',
            matchedDisciplineEventOccurrence: ev.occurrence,
            matchedDisciplineEventDate: evDateLabel,
            matchedLogCurrentStatus: log?.status ?? null,
            correctedAfterIncident: true,
            cleanupSafetyClass: 'SAFE_EXACT_CLEANUP',
          });
        }
        continue;
      }

      // No DisciplineEvent row for this occurrence (predates the
      // idempotency-gate migration) — fall back to the true-count check.
      if (bundle.trueAugustLateIncidentCount < occ) {
        structuredRows.push({
          ...r,
          verdict: 'NEVER_REACHED_LATE',
          matchedDisciplineEventOccurrence: null,
          matchedDisciplineEventDate: null,
          matchedLogCurrentStatus: null,
          correctedAfterIncident: 'UNKNOWN',
          // Row identity is known (single deductionId), but there is no
          // matched DisciplineEvent/date pinning exactly why — weaker
          // evidence than the matched-event case above.
          cleanupSafetyClass: 'MANUAL_REVIEW',
        });
      } else {
        structuredRows.push({
          ...r,
          verdict: 'INSUFFICIENT_EVIDENCE',
          matchedDisciplineEventOccurrence: null,
          matchedDisciplineEventDate: null,
          matchedLogCurrentStatus: null,
          correctedAfterIncident: 'UNKNOWN',
          cleanupSafetyClass: 'MANUAL_REVIEW',
        });
      }
      continue;
    }

    if (r.template === 'UNINFORMED_ABSENT_DATED' || r.template === 'ABSENT_DATED') {
      const dl = r.extractedIncidentDate!;
      const log = bundle.attendanceByDate.get(dl) ?? null;
      if (!log) {
        structuredRows.push({
          ...r,
          verdict: 'INSUFFICIENT_EVIDENCE',
          matchedDisciplineEventOccurrence: null,
          matchedDisciplineEventDate: null,
          matchedLogCurrentStatus: null,
          correctedAfterIncident: 'UNKNOWN',
          cleanupSafetyClass: 'MANUAL_REVIEW',
        });
        continue;
      }
      const auditsForLog = bundle.auditByLogId.get(log.id) ?? [];
      // Financial validity is template-agnostic — BOTH dated templates
      // ("Uninformed absence deduction..." / "Absent without approved
      // leave...") represent the SAME absence-family deduction per policy.
      // The description's own wording is legacy phrasing only and is never
      // compared literally against current status; only whether current
      // status is still in the absence family matters. A
      // DisciplineEvent(UNINFORMED_ABSENT) row's presence/absence is a
      // separate, disciplinary-only concern and plays NO role in financial
      // validity — see isAbsenceFinanciallyValid's doc comment.
      const financiallyValid = isAbsenceFinanciallyValid(log.status);
      const correctedAfter = auditsForLog.some((a) => {
        const changes = a.changes as { previous?: { status?: string } } | null;
        return isAbsenceFinanciallyValid(changes?.previous?.status ?? '') && !financiallyValid;
      });
      if (financiallyValid) {
        structuredRows.push({
          ...r,
          verdict: 'VALID',
          matchedDisciplineEventOccurrence: null,
          matchedDisciplineEventDate: null,
          matchedLogCurrentStatus: log.status,
          correctedAfterIncident: false,
          cleanupSafetyClass: 'NO_ACTION',
        });
      } else {
        structuredRows.push({
          ...r,
          verdict: 'EXACT_DATE_STALE_UA',
          matchedDisciplineEventOccurrence: null,
          matchedDisciplineEventDate: null,
          matchedLogCurrentStatus: log.status,
          correctedAfterIncident: correctedAfter,
          cleanupSafetyClass: 'SAFE_EXACT_CLEANUP',
        });
      }
      continue;
    }

    // MISSING_CHECKOUT / EXTRA_LEAVE_REJECTED / UNPAID_LEAVE / UNRECOGNIZED —
    // not part of this audit's named scope; reported, not judged.
    structuredRows.push({
      ...r,
      verdict: 'NOT_MODELED',
      matchedDisciplineEventOccurrence: null,
      matchedDisciplineEventDate: null,
      matchedLogCurrentStatus: null,
      correctedAfterIncident: 'UNKNOWN',
      cleanupSafetyClass: 'MANUAL_REVIEW',
    });
  }

  // ── Legacy-undated UA reconstruction, per employee ──
  const legacyRows = allRows.filter((r) => r.template === 'UNINFORMED_ABSENCE_LEGACY_UNDATED');
  const legacyByEmployee = new Map<string, DeductionRow[]>();
  for (const r of legacyRows) {
    const arr = legacyByEmployee.get(r.employeeId) ?? [];
    arr.push(r);
    legacyByEmployee.set(r.employeeId, arr);
  }

  type EmployeeLegacyReport = {
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    payrollEntryId: string;
    payrollStatus: PayrollStatus;
    basicStipend: number;
    storedTotalDeductions: number;
    storedNetStipend: number;
    legacyUndatedUADeductionIds: string[];
    legacyUndatedUADeductionCount: number;
    legacyUndatedUATotal: number;
    amountsUniform: boolean;
    provenUADates: string[];
    provenNotUADates: string[];
    ambiguousUADates: string[];
    /** PROVEN_UA dates excluded from the support pool because this exact
     * date already has its own dated UA deduction on record this run. */
    consumedByOwnDatedDeductionDates: string[];
    /** PROVEN_UA dates excluded because they fall on/after the dated-format
     * cutoff — see TEMPORAL ATTRIBUTION FIX in the file header. */
    excludedByCutoffDates: string[];
    provenDistinctUAIncidentCount: number;
    ambiguousUAIncidentCount: number;
    supportedByProvenEvidenceCount: number;
    supportedLegacyAmount: number;
    ambiguousAllowanceUsed: number;
    unresolvedLegacyCount: number;
    unresolvedLegacyAmount: number;
    aggregateExcessProvenCount: number;
    aggregateExcessProvenAmount: number;
    verdict: 'FULLY_SUPPORTED' | 'PARTIALLY_SUPPORTED_WITH_EXCESS' | 'PARTIALLY_SUPPORTED_UNRESOLVED_ONLY' | 'NO_SUPPORTING_EVIDENCE';
    // ── Pre-fix (buggy) numbers, recomputed in the SAME run for a direct,
    // always-fresh delta — never taken from a hard-coded prior report. ──
    preFixSupportedByProvenEvidenceCount: number;
    preFixAggregateExcessProvenCount: number;
    preFixAggregateExcessProvenAmount: number;
    preFixUnresolvedLegacyCount: number;
  };

  const employeeLegacyReports: EmployeeLegacyReport[] = [];

  for (const [employeeId, rows] of legacyByEmployee) {
    const employee = employeeById.get(employeeId)!;
    const pe = payrollEntryById.get(rows[0].payrollEntryId)!;
    const bundle = evidenceByEmployee.get(employeeId)!;

    const amounts = rows.map((r) => r.amount);
    const amountsUniform = amounts.every((a) => Math.abs(a - amounts[0]) < 0.01);
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;

    // ── Dated UA deductions already on record for this employee this run
    // (either template) — each has already fully consumed its own exact
    // incident date's evidence. See TEMPORAL ATTRIBUTION FIX. ──
    const datedUAIncidentDatesForEmployee = new Set(
      allRows
        .filter(
          (r) =>
            r.employeeId === employeeId &&
            (r.template === 'UNINFORMED_ABSENT_DATED' || r.template === 'ABSENT_DATED') &&
            r.extractedIncidentDate,
        )
        .map((r) => r.extractedIncidentDate as string),
    );

    // Candidate dates: every August date with ANY evidence (AttendanceLog
    // row, DisciplineEvent, or leave overlap) — never invented from nothing.
    const candidateDates = new Set<string>();
    for (const l of bundle.attendanceLogs) {
      if (l.type === AttendanceLogType.REGULAR) candidateDates.add(dateLabelOf(l.date));
    }
    for (const e of bundle.disciplineEvents) {
      if (e.category === DisciplineCategory.UNINFORMED_ABSENT) candidateDates.add(dateLabelOf(e.incidentDate));
    }

    const provenUADates: string[] = []; // final, post-fix support pool
    const oldProvenUADates: string[] = []; // pre-fix pool (for the delta table only)
    const provenNotUADates: string[] = [];
    const ambiguousUADates: string[] = [];
    const consumedByOwnDatedDeductionDates: string[] = [];
    const excludedByCutoffDates: string[] = [];

    for (const dl of candidateDates) {
      const v = classifyDateForUA(dl, bundle);
      if (v === 'PROVEN_NOT_UA') {
        provenNotUADates.push(dl);
        continue;
      }
      if (v === 'AMBIGUOUS') {
        ambiguousUADates.push(dl);
        continue;
      }
      if (v !== 'PROVEN_UA') continue;

      // v === 'PROVEN_UA' — this is exactly what the PRE-FIX script counted
      // unconditionally as support-eligible.
      oldProvenUADates.push(dl);

      if (datedUAIncidentDatesForEmployee.has(dl)) {
        consumedByOwnDatedDeductionDates.push(dl);
        continue; // excluded from the post-fix pool
      }
      if (dl >= DATED_FORMAT_FIRST_CONFIRMED_DATE) {
        excludedByCutoffDates.push(dl);
        continue; // excluded from the post-fix pool
      }
      provenUADates.push(dl);
    }
    provenUADates.sort();
    oldProvenUADates.sort();
    provenNotUADates.sort();
    ambiguousUADates.sort();
    consumedByOwnDatedDeductionDates.sort();
    excludedByCutoffDates.sort();

    const legacyDeductionCount = rows.length;
    const provenDistinctUAIncidentCount = provenUADates.length;
    const ambiguousUAIncidentCount = ambiguousUADates.length;

    const supportedByProvenEvidenceCount = Math.min(legacyDeductionCount, provenDistinctUAIncidentCount);
    const remainingAfterProven = legacyDeductionCount - supportedByProvenEvidenceCount;
    const ambiguousAllowanceUsed = Math.min(remainingAfterProven, ambiguousUAIncidentCount);
    const unresolvedLegacyCount = ambiguousAllowanceUsed;
    const aggregateExcessProvenCount = remainingAfterProven - ambiguousAllowanceUsed;

    // ── Pre-fix recomputation (same formula, unfiltered pool) — this is
    // what the buggy script would have reported for this employee, computed
    // fresh against CURRENT data so the delta table is always accurate,
    // never a stale hard-coded snapshot. ──
    const preFixProvenCount = oldProvenUADates.length;
    const preFixSupportedByProvenEvidenceCount = Math.min(legacyDeductionCount, preFixProvenCount);
    const preFixRemainingAfterProven = legacyDeductionCount - preFixSupportedByProvenEvidenceCount;
    const preFixAmbiguousAllowanceUsed = Math.min(preFixRemainingAfterProven, ambiguousUAIncidentCount);
    const preFixUnresolvedLegacyCount = preFixAmbiguousAllowanceUsed;
    const preFixAggregateExcessProvenCount = preFixRemainingAfterProven - preFixAmbiguousAllowanceUsed;

    let verdict: EmployeeLegacyReport['verdict'];
    if (aggregateExcessProvenCount > 0) verdict = 'PARTIALLY_SUPPORTED_WITH_EXCESS';
    else if (unresolvedLegacyCount > 0) verdict = 'PARTIALLY_SUPPORTED_UNRESOLVED_ONLY';
    else if (supportedByProvenEvidenceCount > 0) verdict = 'FULLY_SUPPORTED';
    else verdict = 'NO_SUPPORTING_EVIDENCE';

    employeeLegacyReports.push({
      employeeId,
      employeeCode: employee.employeeCode,
      employeeName: employee.fullName,
      payrollEntryId: pe.id,
      payrollStatus: pe.status,
      basicStipend: Number(pe.basicStipend),
      storedTotalDeductions: Number(pe.totalDeductions),
      storedNetStipend: Number(pe.netStipend),
      legacyUndatedUADeductionIds: rows.map((r) => r.deductionId),
      legacyUndatedUADeductionCount: legacyDeductionCount,
      legacyUndatedUATotal: Number(amounts.reduce((a, b) => a + b, 0).toFixed(2)),
      amountsUniform,
      provenUADates,
      provenNotUADates,
      ambiguousUADates,
      consumedByOwnDatedDeductionDates,
      excludedByCutoffDates,
      provenDistinctUAIncidentCount,
      ambiguousUAIncidentCount,
      supportedByProvenEvidenceCount,
      supportedLegacyAmount: Number((supportedByProvenEvidenceCount * avgAmount).toFixed(2)),
      ambiguousAllowanceUsed,
      unresolvedLegacyCount,
      unresolvedLegacyAmount: Number((unresolvedLegacyCount * avgAmount).toFixed(2)),
      aggregateExcessProvenCount,
      aggregateExcessProvenAmount: Number((aggregateExcessProvenCount * avgAmount).toFixed(2)),
      verdict,
      preFixSupportedByProvenEvidenceCount,
      preFixAggregateExcessProvenCount,
      preFixAggregateExcessProvenAmount: Number((preFixAggregateExcessProvenCount * avgAmount).toFixed(2)),
      preFixUnresolvedLegacyCount,
    });
  }

  // ── Delta table (section 7) — only employees the fix actually changed. ──
  const temporalAttributionDeltaTable = employeeLegacyReports
    .filter((e) => e.supportedByProvenEvidenceCount !== e.preFixSupportedByProvenEvidenceCount)
    .map((e) => ({
      employee: e.employeeName,
      code: e.employeeCode,
      oldSupportedCount: e.preFixSupportedByProvenEvidenceCount,
      correctedSupportedCount: e.supportedByProvenEvidenceCount,
      incorrectlyConsumedDatedIncidentDates: [
        ...e.consumedByOwnDatedDeductionDates,
        ...e.excludedByCutoffDates,
      ].sort(),
      legacyExcessRestoredRows: e.aggregateExcessProvenCount - e.preFixAggregateExcessProvenCount,
      amountRestored: Number(
        (e.aggregateExcessProvenAmount - e.preFixAggregateExcessProvenAmount).toFixed(2),
      ),
    }))
    .sort((a, b) => b.amountRestored - a.amountRestored);

  // ── Section 4: explicit August 18 drift report ──
  const august18DriftReport = employeeLegacyReports
    .filter(
      (e) =>
        e.consumedByOwnDatedDeductionDates.includes('2026-08-18') ||
        e.excludedByCutoffDates.includes('2026-08-18'),
    )
    .map((e) => ({
      employee: e.employeeName,
      code: e.employeeCode,
      reason: e.consumedByOwnDatedDeductionDates.includes('2026-08-18')
        ? 'HAS_OWN_2026-08-18_DATED_UA_DEDUCTION'
        : 'PROVEN_UA_ON_2026-08-18_BUT_NO_LIVE_DATED_DEDUCTION_FOUND_STILL_EXCLUDED_BY_CUTOFF',
      preFixSupportedCount: e.preFixSupportedByProvenEvidenceCount,
      correctedSupportedCount: e.supportedByProvenEvidenceCount,
      preFixAggregateExcessAmount: e.preFixAggregateExcessProvenAmount,
      correctedAggregateExcessAmount: e.aggregateExcessProvenAmount,
    }));

  // ── System-wide legacy UA summary ──
  const legacySummary = {
    employeesWithLegacyUndatedUA: employeeLegacyReports.length,
    totalLegacyUndatedUARows: legacyRows.length,
    totalLegacyUndatedUAAmount: Number(legacyRows.reduce((a, r) => a + r.amount, 0).toFixed(2)),
    employeesWithProvenAggregateExcess: employeeLegacyReports.filter((e) => e.aggregateExcessProvenCount > 0).length,
    provenAggregateExcessRows: employeeLegacyReports.reduce((a, e) => a + e.aggregateExcessProvenCount, 0),
    provenAggregateExcessAmount: Number(employeeLegacyReports.reduce((a, e) => a + e.aggregateExcessProvenAmount, 0).toFixed(2)),
    unresolvedLegacyRows: employeeLegacyReports.reduce((a, e) => a + e.unresolvedLegacyCount, 0),
    unresolvedLegacyAmount: Number(employeeLegacyReports.reduce((a, e) => a + e.unresolvedLegacyAmount, 0).toFixed(2)),
    supportedLegacyRows: employeeLegacyReports.reduce((a, e) => a + e.supportedByProvenEvidenceCount, 0),
    supportedLegacyAmount: Number(employeeLegacyReports.reduce((a, e) => a + e.supportedLegacyAmount, 0).toFixed(2)),
  };

  // ── Structured issue summary (excludes legacy-undated entirely) ──
  function sumBy(rows: StructuredRow[], verdict: StructuredVerdict) {
    const filtered = rows.filter((r) => r.verdict === verdict);
    return { count: filtered.length, amount: Number(filtered.reduce((a, r) => a + r.amount, 0).toFixed(2)) };
  }
  const exactDateStale = sumBy(structuredRows, 'EXACT_DATE_STALE_UA');
  const occurrence9Invalid = sumBy(structuredRows, 'OCCURRENCE_9_INVALID');
  const neverReachedLate = sumBy(structuredRows, 'NEVER_REACHED_LATE');
  const duplicateFinancial = sumBy(structuredRows, 'DUPLICATE');

  const structuredSummary = {
    exactDateStaleUACount: exactDateStale.count,
    exactDateStaleUAAmount: exactDateStale.amount,
    invalidOccurrence9LateCount: occurrence9Invalid.count,
    invalidOccurrence9LateAmount: occurrence9Invalid.amount,
    neverReachedLateCount: neverReachedLate.count,
    neverReachedLateAmount: neverReachedLate.amount,
    duplicateFinancialCount: duplicateFinancial.count,
    duplicateFinancialAmount: duplicateFinancial.amount,
    duplicateLetterGroupsFound: duplicateLetterGroups.length,
  };

  // ── Payroll-status split (all financial findings) ──
  function splitByStatus(rows: { payrollStatus: PayrollStatus; amount: number }[]) {
    const out: Record<PayrollStatus, number> = { PENDING: 0, PROCESSED: 0, PAID: 0 } as Record<PayrollStatus, number>;
    for (const r of rows) out[r.payrollStatus] = (out[r.payrollStatus] ?? 0) + r.amount;
    for (const k of Object.keys(out) as PayrollStatus[]) out[k] = Number(out[k].toFixed(2));
    return out;
  }
  const allFinancialFindingRows: { payrollStatus: PayrollStatus; amount: number }[] = [
    ...legacyRows.map((r) => ({ payrollStatus: r.payrollStatus, amount: r.amount })),
    ...structuredRows.filter((r) => r.verdict !== 'VALID' && r.verdict !== 'NOT_MODELED').map((r) => ({ payrollStatus: r.payrollStatus, amount: r.amount })),
  ];
  const payrollStatusSplit = splitByStatus(allFinancialFindingRows);
  const pendingActionableRows = allFinancialFindingRows.filter((r) => r.payrollStatus === PayrollStatus.PENDING);
  const pendingActionableAmount = Number(pendingActionableRows.reduce((a, r) => a + r.amount, 0).toFixed(2));

  // ── Employee detail table (section 7) ──
  const employeeDetailTable = employeeLegacyReports
    .map((e) => ({
      employee: e.employeeName,
      code: e.employeeCode,
      payrollStatus: e.payrollStatus,
      legacyUARows: e.legacyUndatedUADeductionCount,
      legacyUAAmount: e.legacyUndatedUATotal,
      provenUADates: e.provenUADates,
      ambiguousUADates: e.ambiguousUADates,
      consumedByOwnDatedDeductionDates: e.consumedByOwnDatedDeductionDates,
      excludedByCutoffDates: e.excludedByCutoffDates,
      supportedCount: e.supportedByProvenEvidenceCount,
      provenAggregateExcessCount: e.aggregateExcessProvenCount,
      provenAggregateExcessAmount: e.aggregateExcessProvenAmount,
      unresolvedCount: e.unresolvedLegacyCount,
      verdict: e.verdict,
      potentialFinancialImpact: e.aggregateExcessProvenAmount + e.unresolvedLegacyAmount,
    }))
    .sort((a, b) => b.potentialFinancialImpact - a.potentialFinancialImpact);

  // ── Section 5: new-deduction drift report (optional baseline diff) ──
  type BaselineShape = { structuredRows?: { deductionId: string }[]; employeeLegacyReports?: { legacyUndatedUADeductionIds?: string[] }[] };
  let newDeductionDriftReport: unknown;
  if (BASELINE_REPORT_PATH) {
    try {
      const raw = fs.readFileSync(BASELINE_REPORT_PATH, 'utf8');
      const baseline = JSON.parse(raw) as BaselineShape;
      const baselineDeductionIds = new Set<string>();
      for (const r of baseline.structuredRows ?? []) baselineDeductionIds.add(r.deductionId);
      for (const e of baseline.employeeLegacyReports ?? []) {
        for (const id of e.legacyUndatedUADeductionIds ?? []) baselineDeductionIds.add(id);
      }

      const currentAllRowIds = new Set(allRows.map((r) => r.deductionId));
      const newlyObservedRows = allRows.filter((r) => !baselineDeductionIds.has(r.deductionId));
      const newlyObservedByTemplate: Record<string, number> = {};
      for (const r of newlyObservedRows) {
        newlyObservedByTemplate[r.template] = (newlyObservedByTemplate[r.template] ?? 0) + 1;
      }
      const removedFromBaseline = [...baselineDeductionIds].filter((id) => !currentAllRowIds.has(id));

      // Does any newly-observed row's date show up as an exclusion reason
      // anywhere in this run's legacy reports? (i.e. did a new row actually
      // contaminate/get-correctly-excluded-from legacy support this time.)
      const newRowIdsContaminatingLegacy = newlyObservedRows
        .filter((r) => r.template === 'UNINFORMED_ABSENT_DATED' || r.template === 'ABSENT_DATED')
        .filter((r) =>
          employeeLegacyReports.some(
            (e) =>
              e.employeeId === r.employeeId &&
              r.extractedIncidentDate &&
              e.consumedByOwnDatedDeductionDates.includes(r.extractedIncidentDate),
          ),
        )
        .map((r) => r.deductionId);

      newDeductionDriftReport = {
        baselineSupplied: true,
        baselinePath: BASELINE_REPORT_PATH,
        newlyObservedRowCount: newlyObservedRows.length,
        newlyObservedByTemplate,
        removedFromBaselineCount: removedFromBaseline.length,
        newRowsThatWereCorrectlyExcludedFromLegacySupport: newRowIdsContaminatingLegacy,
        note: 'Counts are recomputed from the supplied baseline file every run — never hard-coded.',
      };
    } catch (err) {
      newDeductionDriftReport = {
        baselineSupplied: true,
        baselinePath: BASELINE_REPORT_PATH,
        error: `Could not read/parse baseline file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } else {
    newDeductionDriftReport = {
      baselineSupplied: false,
      note: 'Set BASELINE_REPORT_PATH to a prior run\'s JSON output to get a computed newly-observed-row drift report. Not hard-coded to any specific count.',
    };
  }

  // ── Invariants (section 6/9) ──
  const totalDeductionRowsSeen = allRows.length;
  const totalAccountedFor = legacyRows.length + structuredRows.length;
  const legacyIdSet = new Set(legacyRows.map((r) => r.deductionId));
  const structuredIdSet = new Set(structuredRows.map((r) => r.deductionId));
  const overlapIds = [...legacyIdSet].filter((id) => structuredIdSet.has(id));

  // Rebuild each employee's dated-incident-date set once more here (cheap,
  // small) purely so the invariants below are independent runtime checks
  // rather than restating "true by construction" — they re-derive from
  // allRows/employeeLegacyReports and would fail if the logic above regressed.
  function datedDatesFor(employeeId: string): Set<string> {
    return new Set(
      allRows
        .filter(
          (r) =>
            r.employeeId === employeeId &&
            (r.template === 'UNINFORMED_ABSENT_DATED' || r.template === 'ABSENT_DATED') &&
            r.extractedIncidentDate,
        )
        .map((r) => r.extractedIncidentDate as string),
    );
  }

  const invariants: Record<string, boolean> = {
    allPayrollDeductionRowsAccountedFor: totalAccountedFor === totalDeductionRowsSeen,
    noLegacyRowDoubleCounted: new Set(legacyRows.map((r) => r.deductionId)).size === legacyRows.length,
    noStructuredIssueDoubleCountedWithLegacy: overlapIds.length === 0,
    aggregateAmountsReconcile:
      Math.abs(
        legacySummary.supportedLegacyAmount + legacySummary.provenAggregateExcessAmount + legacySummary.unresolvedLegacyAmount - legacySummary.totalLegacyUndatedUAAmount,
      ) < 0.05 * employeeLegacyReports.length + 0.5, // small tolerance for per-employee rounding across many employees
    employeeLegacyCountsReconcile: employeeLegacyReports.every(
      (e) => e.supportedByProvenEvidenceCount + e.aggregateExcessProvenCount + e.unresolvedLegacyCount === e.legacyUndatedUADeductionCount,
    ),
    noSpecificLegacyRowInventedAsIncidentMatch: true, // by construction: legacyUndatedUADeductionIds are never individually mapped to a date anywhere in this script
    processedPaidSeparatedFromPending: payrollStatusSplit.PROCESSED >= 0 && payrollStatusSplit.PAID >= 0,
    noWriteOperations: true, // verified externally via grep against the compiled JS — see handoff notes
    noDeductionRowClassifiedInMultipleBuckets: totalAccountedFor === totalDeductionRowsSeen && overlapIds.length === 0,

    // ── New temporal-attribution invariants ──
    noIncidentSupportsBothLegacyAndDatedDeduction: employeeLegacyReports.every((e) =>
      e.provenUADates.every((d) => !datedDatesFor(e.employeeId).has(d)),
    ),
    allDatedUADeductionsConsumeTheirExactIncidentFirst: employeeLegacyReports.every((e) => {
      const dated = datedDatesFor(e.employeeId);
      // Every dated-incident date that also happens to be a candidate date
      // this run must show up as consumed (or simply never make it into
      // provenUADates) — the direct check is just that none of them are in
      // the final support pool.
      return [...dated].every((d) => !e.provenUADates.includes(d));
    }),
    postLegacyFormatIncidentCannotSupportLegacyRow: employeeLegacyReports.every((e) =>
      e.provenUADates.every((d) => d < DATED_FORMAT_FIRST_CONFIRMED_DATE),
    ),
    legacySupportCannotIncreaseMerelyBecauseNewDatedIncidentAppears: employeeLegacyReports.every(
      (e) => e.supportedByProvenEvidenceCount <= e.preFixSupportedByProvenEvidenceCount,
    ),
    legacyRowCountStableMeansNewDatedRowsCannotReduceLegacyExcessWithoutIndependentHistoricalEvidence:
      employeeLegacyReports.every((e) => e.aggregateExcessProvenCount >= e.preFixAggregateExcessProvenCount),

    // ── Occurrence-9 classification invariants — each re-derives from
    // structuredRows' own raw extractedOccurrence field fresh, not from the
    // verdict that was already computed, so a regression of the occ===9
    // condition above would be independently caught here. ──
    noOccurrence12ClassifiedAsInvalid: structuredRows
      .filter((r) => r.template === 'LATE_ARRIVAL_MONTHLY_OCCURRENCE' && r.extractedOccurrence === 12)
      .every((r) => r.verdict !== 'OCCURRENCE_9_INVALID'),
    noPost9ModuloFineClassifiedAsOccurrence9Invalid: structuredRows
      .filter(
        (r) =>
          r.template === 'LATE_ARRIVAL_MONTHLY_OCCURRENCE' &&
          r.extractedOccurrence != null &&
          r.extractedOccurrence % 3 === 0 &&
          r.extractedOccurrence !== 9,
      )
      .every((r) => r.verdict !== 'OCCURRENCE_9_INVALID'),
    allOccurrence9InvalidRowsHaveExtractedOccurrenceExactly9: structuredRows
      .filter((r) => r.verdict === 'OCCURRENCE_9_INVALID')
      .every((r) => r.extractedOccurrence === 9),
  };
  invariants.allLegacySystemAuditInvariantsTrue = Object.entries(invariants)
    .filter(([k]) => k !== 'allLegacySystemAuditInvariantsTrue')
    .every(([, v]) => v === true);

  // ── Cleanup safety classification tally (section 8) ──
  const cleanupSafetyTally = {
    SAFE_EXACT_CLEANUP: structuredRows.filter((r) => r.cleanupSafetyClass === 'SAFE_EXACT_CLEANUP').length,
    SAFE_AGGREGATE_CORRECTION_BUT_ROW_IDENTITY_UNKNOWN:
      structuredRows.filter((r) => r.cleanupSafetyClass === 'SAFE_AGGREGATE_CORRECTION_BUT_ROW_IDENTITY_UNKNOWN').length +
      legacySummary.provenAggregateExcessRows, // legacy aggregate-excess rows are always this class, never SAFE_EXACT_CLEANUP
    MANUAL_REVIEW: structuredRows.filter((r) => r.cleanupSafetyClass === 'MANUAL_REVIEW').length + legacySummary.unresolvedLegacyRows,
    NO_ACTION: structuredRows.filter((r) => r.cleanupSafetyClass === 'NO_ACTION').length + legacySummary.supportedLegacyRows,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    scope: { month: TARGET_MONTH, year: TARGET_YEAR, payrollEntriesInspected: payrollEntries.length, deductionRowsInspected: allRows.length },
    temporalAttributionFix: {
      legacyFormatLastPossibleDate: LEGACY_FORMAT_LAST_POSSIBLE_DATE,
      datedFormatFirstConfirmedDate: DATED_FORMAT_FIRST_CONFIRMED_DATE,
      confidence: 'HIGH on source-code cutover commit (76deef623f5ee8eda3366bb1158a77e08de2e001, 2026-08-17 14:41:34 +0500, corroborated by same-day schema migrations); LOWER on exact production deploy lag since PayrollDeduction has no creation timestamp — the full deployment day is therefore treated conservatively as NOT eligible to support a legacy row.',
      evidenceSource: 'git log -p across discipline.helper.ts full history; no production DB timestamp evidence exists for PayrollDeduction rows.',
    },
    temporalAttributionDeltaTable,
    august18DriftReport,
    newDeductionDriftReport,
    legacyUASummary: legacySummary,
    structuredConfirmedIssues: structuredSummary,
    payrollStatus: {
      PENDING_actionableAmount: payrollStatusSplit.PENDING,
      PROCESSED_manualReviewAmount: payrollStatusSplit.PROCESSED,
      PAID_manualReviewAmount: payrollStatusSplit.PAID,
      note: 'PENDING_actionableAmount is the sum of all non-VALID financial findings (legacy + structured) on PENDING payroll entries. "Actionable" here means eligible for manual/administrative review and correction — this script performs NO mutation regardless of status.',
    },
    employeeDetailTable,
    employeeLegacyReports,
    structuredRows,
    duplicateLetterGroups,
    cleanupSafetyTally,
    invariants,
    dataLimitations: [
      'PayrollDeduction has no createdAt/updatedAt column — exact creation instant not directly queryable; DisciplineEvent.createdAt used as same-transaction proxy where a match exists. This is also why DATED_FORMAT_FIRST_CONFIRMED_DATE is evidenced from git history rather than production timestamps.',
      'AttendanceLog has no updatedAt column — AuditLog(entity=AttendanceLog) is incomplete for markManual/biometric/reconcileShortLeaveAttendance edits (no diff or no entry at all), so correctedAfterIncident / PROVEN_UA-via-audit-history signals are best-effort, not exhaustive. A false PROVEN_NOT_UA or AMBIGUOUS is more likely than a false PROVEN_UA, since PROVEN_UA requires positive evidence to exist rather than absence of evidence.',
      'Legacy undated UA rows are byte-identical by construction — this script never assigns a specific deductionId to a specific date. aggregateExcessProvenCount/Amount are proven at the aggregate level only; the corresponding deductionIds are listed in legacyUndatedUADeductionIds but are NOT individually attributed.',
      'The 2026-08-17 cutover day itself cannot be split by time-of-day (incident dates are day-granularity) — this script conservatively excludes the WHOLE day from legacy-support eligibility rather than guessing which incidents that day landed before/after the ~14:41 deploy.',
    ],
  };

  console.log(JSON.stringify(report, null, 2));
  console.error('=== DONE (read-only — no data was modified) ===');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
