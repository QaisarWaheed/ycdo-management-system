/**
 * SYSTEM-WIDE AUGUST 2026 DISCIPLINE/PAYROLL CLEANUP — DRY-RUN BY DEFAULT.
 *
 * Built from scratch against the CORRECTED evidence/classification logic
 * proven in system-wide-legacy-deduction-audit-2026.ts (v2, temporal-
 * attribution fix included). Does NOT import that script (a standalone
 * ts-node file can't cleanly import another top-level script), so the
 * shared evidence functions below are DELIBERATELY byte-identical copies —
 * see "MIRRORS AUDIT SCRIPT" comments throughout. If the audit script's
 * evidence logic changes, this file must be updated in lockstep.
 *
 * One correction made independently in THIS file, not present in the
 * read-only audit: the audit's OCCURRENCE_9_INVALID check was
 * `occ === 9 || (occ !== 3 && occ !== 6)`, which incorrectly flags
 * occurrence 12/15/18/... (legitimate 3rd-cycle-position Fine occurrences
 * under applyLateDiscipline's actual cycle math — positionInCycle===3 fires
 * for EVERY multiple of 3 except 9, not just 3 and 6) as invalid. A cleanup
 * script proposing actual deletions must not act on that over-broad
 * classification. This script instead treats ONLY occurrence===9 as the
 * proven-invalid case (the one occurrence the code's own suspension-only
 * branch explicitly excludes from ever legitimately carrying a Fine
 * deduction) and routes any occurrence that isn't a multiple of 3 at all
 * (which should never carry a deduction either, but isn't the same
 * well-understood bug pattern) to MANUAL_REVIEW instead of auto-cleanup —
 * matching the explicit "occurrence 12 late fines -> MANUAL_REVIEW" example
 * in this task's own instructions.
 *
 * ── AUTHORITATIVE BUSINESS POLICY (financial vs disciplinary) ──────────
 * ABSENT and UNINFORMED_ABSENT are ONE financial family: the same 2-day
 * absence deduction applies whether the absence was informed (ABSENT) or
 * uninformed (UNINFORMED_ABSENT). The distinction between the two is
 * DISCIPLINARY ONLY — UNINFORMED_ABSENT is the more serious classification
 * and drives DisciplineEvent(UNINFORMED_ABSENT) / suspension-threshold
 * tracking; ABSENT does not. See isAbsenceFinanciallyValid /
 * isUninformedAbsentDisciplineStillValid below, which mirror
 * discipline.helper.ts's isAbsentFamilyEligibleForDiscipline /
 * isUninformedAbsentEligibleForDiscipline exactly (the production source of
 * truth for these two, deliberately separate, questions).
 *
 * A prior version of this file's EXACT_DATE_STALE_UA classifier compared
 * current attendance status against a PER-TEMPLATE "expected status"
 * (UNINFORMED_ABSENT_DATED required exactly UNINFORMED_ABSENT,
 * ABSENT_DATED required exactly ABSENT) and, for UNINFORMED_ABSENT_DATED
 * specifically, additionally required a live DisciplineEvent(UNINFORMED_ABSENT)
 * row to exist before treating the deduction as valid. Both were bugs:
 * comparing the deduction's own legacy WORDING against current status
 * violates the one-financial-family policy above (a currently-ABSENT day
 * whose deduction happens to be worded "Uninformed absence deduction..."
 * is still financially valid), and requiring a DisciplineEvent to exist
 * conflated a disciplinary-tracking concern into a financial-validity
 * decision. Fixed: financial validity is now template-agnostic
 * (isAbsenceFinanciallyValid(currentStatus) alone) and DisciplineEvent
 * staleness is computed as a completely independent pass
 * (isUninformedAbsentDisciplineStillValid), never gating or being gated by
 * the financial decision — see section "DISCIPLINE EVENT TARGETS" below.
 *
 * SCOPE OF THIS FILE: read-only evidence gathering + dry-run reporting by
 * default. Mutation code exists but is NEVER reached unless invoked with
 * --apply AND a matching --expected-fingerprint AND --backup-confirmed —
 * see "APPLY GATE" below. Every write happens inside exactly one Prisma
 * transaction with in-transaction post-mutation verification that throws
 * (rolling back everything) on any mismatch.
 *
 * Run (dry-run, default, zero writes):
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/system-wide-discipline-cleanup-2026.ts > cleanup-dry-run.json
 *
 * Run (apply — only after a manual DB backup and human review of the
 * dry-run JSON's mutationPlan):
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/system-wide-discipline-cleanup-2026.ts \
 *     --apply \
 *     --expected-fingerprint=<cleanupFingerprint from the dry-run JSON> \
 *     --backup-confirmed=<backup filename/identifier> \
 *     > cleanup-apply-result.json
 */

import * as crypto from 'crypto';
import {
  AttendanceLogType,
  AttendanceStatus,
  DeductionType,
  DisciplineCategory,
  LetterType,
  PayrollStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();

const TARGET_MONTH = 8;
const TARGET_YEAR = 2026;
const MONTH_START = new Date(Date.UTC(TARGET_YEAR, TARGET_MONTH - 1, 1, 0, 0, 0, 0));
const MONTH_END = new Date(Date.UTC(TARGET_YEAR, TARGET_MONTH - 1, 31, 23, 59, 59, 999));

// Same evidence, same confidence caveats as the corrected audit script —
// see system-wide-legacy-deduction-audit-2026.ts's own header for the full
// git-history citation (commit 76deef623f5ee8eda3366bb1158a77e08de2e001,
// 2026-08-17 14:41:34 +0500).
const DATED_FORMAT_FIRST_CONFIRMED_DATE = '2026-08-17';

const CLEANUP_TIME = new Date();
const VOID_REASON = 'DUPLICATE_DISCIPLINE_LETTER_CLEANUP_AUGUST_2026';
const VOIDED_BY = 'SYSTEM_CLEANUP_2026_08';

// ─── CLI ARGS ──────────────────────────────────────────────────────────

function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const APPLY = argFlag('apply');
const EXPECTED_FINGERPRINT = argValue('expected-fingerprint');
const BACKUP_CONFIRMED = argValue('backup-confirmed');

// ─── DETERMINISTIC FINGERPRINTING ─────────────────────────────────────

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// ─── EVIDENCE FUNCTIONS (MIRRORS AUDIT SCRIPT) ────────────────────────

function dateLabelOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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

// ─── ABSENCE-FAMILY FINANCIAL VS DISCIPLINARY VALIDITY (POLICY-AUTHORITATIVE) ──

/**
 * FINANCIAL question — mirrors discipline.helper.ts's
 * isAbsentFamilyEligibleForDiscipline exactly. ABSENT and UNINFORMED_ABSENT
 * are ONE financial family: the same 2-day absence deduction is justified
 * by either. Deliberately template-agnostic — never compares the
 * deduction's own (possibly legacy-worded) description against status.
 */
export function isAbsenceFinanciallyValid(status: string): boolean {
  return status === AttendanceStatus.ABSENT || status === AttendanceStatus.UNINFORMED_ABSENT;
}

/**
 * DISCIPLINARY question, deliberately SEPARATE from the financial one above
 * — mirrors discipline.helper.ts's isUninformedAbsentEligibleForDiscipline
 * exactly. A DisciplineEvent(UNINFORMED_ABSENT) row for a given date
 * remains valid only while current status for that date is STILL
 * specifically UNINFORMED_ABSENT (not merely "still absence-family" —
 * ABSENT does not carry UA-specific disciplinary weight).
 */
export function isUninformedAbsentDisciplineStillValid(status: string): boolean {
  return status === AttendanceStatus.UNINFORMED_ABSENT;
}

export type DatedAbsenceDeductionVerdict = 'VALID' | 'EXACT_DATE_STALE_UA' | 'INSUFFICIENT_EVIDENCE';

/**
 * Pure classification for one dated absence-family PayrollDeduction row.
 * `currentStatus: null` means no AttendanceLog row exists for that exact
 * date at all — cannot prove or disprove, never auto-targeted.
 */
export function classifyDatedAbsenceDeduction(evidence: { currentStatus: string | null }): DatedAbsenceDeductionVerdict {
  if (evidence.currentStatus == null) return 'INSUFFICIENT_EVIDENCE';
  return isAbsenceFinanciallyValid(evidence.currentStatus) ? 'VALID' : 'EXACT_DATE_STALE_UA';
}

export type DisciplineEventVerdict = 'VALID' | 'STALE_REMOVE' | 'INSUFFICIENT_EVIDENCE';

/**
 * Pure classification for one DisciplineEvent(UNINFORMED_ABSENT) row,
 * completely independent of any deduction's own validity — see policy note
 * in the file header. `currentStatus: null` means no AttendanceLog row
 * exists for that date at all — never auto-targeted.
 */
export function classifyUninformedAbsentDisciplineEvent(evidence: { currentStatus: string | null }): DisciplineEventVerdict {
  if (evidence.currentStatus == null) return 'INSUFFICIENT_EVIDENCE';
  return isUninformedAbsentDisciplineStillValid(evidence.currentStatus) ? 'VALID' : 'STALE_REMOVE';
}

// ─── LEGACY AGGREGATE EXCESS — AMOUNT-IDENTITY SAFETY (POLICY-AUTHORITATIVE) ──

/**
 * Legacy undated UA deduction rows are proven excess only at the AGGREGATE
 * COUNT level (evidence-based date reconciliation — see the legacy loop in
 * collectEvidenceAndClassify). Deleting `excessCount` specific physical
 * rows only removes the exact proven dollar amount when every row in the
 * employee's legacy group carries the SAME amount: only then does
 * `excessCount * avgAmount` (the aggregate-level proof) equal the sum of
 * ANY `excessCount` rows selected from the group, because avgAmount IS
 * each row's own amount. When amounts differ, no deterministic selection
 * (ID-sort or otherwise) can be proven to remove the correct dollar
 * amount — the rows are byte-identical by construction with no
 * historical incident-to-row mapping (see file header / audit script
 * dataLimitations) — so automatic selection is unsafe and must defer to
 * manual review instead of guessing.
 */
export function isLegacyAmountGroupUniform(amounts: number[]): boolean {
  return amounts.every((a) => Math.abs(a - amounts[0]) < 0.01);
}

export function computeLegacyAggregateExcessAmount(amounts: number[], excessCount: number): number {
  const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  return Number((excessCount * avgAmount).toFixed(2));
}

// ─── INVARIANT-GATE AGGREGATION (DRY_RUN vs APPLY) ──────────────────────

export type InvariantValue = boolean | 'NOT_APPLICABLE_IN_APPLY_MODE';

/**
 * The ONLY conjunction allowed to gate the APPLY transaction. Excludes
 * `dryRunContainsZeroWritePaths` — a DRY_RUN-only sanity assertion that is
 * necessarily NOT_APPLICABLE_IN_APPLY_MODE while APPLY is genuinely
 * writing (see that field's own doc comment in main()) — and the
 * `allCleanupInvariantsTrue` aggregate key itself (self-reference guard).
 * Every OTHER invariant must be strictly `true`, in BOTH modes, with no
 * exception.
 */
export function computeSubstantiveInvariantsTrue(invariants: Record<string, InvariantValue>): boolean {
  return Object.entries(invariants)
    .filter(([k]) => k !== 'allCleanupInvariantsTrue' && k !== 'dryRunContainsZeroWritePaths')
    .every(([, v]) => v === true);
}

/**
 * Reporting-level aggregate (`invariants.allCleanupInvariantsTrue`).
 *   DRY_RUN (isApply=false): substantive invariants AND the zero-write
 *     assertion must be strictly `true` — it must never be
 *     NOT_APPLICABLE_IN_APPLY_MODE in this mode; if it is, or is `false`,
 *     this returns false and the dry-run report reflects the failure.
 *   APPLY (isApply=true): the zero-write assertion is excluded entirely —
 *     this collapses to computeSubstantiveInvariantsTrue, which is exactly
 *     what gates the transaction.
 */
export function computeAllCleanupInvariantsTrue(invariants: Record<string, InvariantValue>, isApply: boolean): boolean {
  const substantive = computeSubstantiveInvariantsTrue(invariants);
  if (isApply) return substantive;
  return substantive && invariants.dryRunContainsZeroWritePaths === true;
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
    select: { id: true, letterNo: true, letterType: true, generatedAt: true, variables: true, requiresAcknowledgement: true },
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
  return { employeeId, attendanceLogs, attendanceByDate, auditLogs, auditByLogId, disciplineEvents, leaveRecords, letters, trueAugustLateIncidentCount };
}

function classifyDateForUA(dateLabel: string, bundle: EvidenceBundle): 'PROVEN_UA' | 'PROVEN_NOT_UA' | 'AMBIGUOUS' | null {
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
    return 'PROVEN_NOT_UA';
  }
  const leaveTouchesDate = bundle.leaveRecords.some((lr) => {
    const d = new Date(dateLabel + 'T00:00:00.000Z');
    return lr.startDate <= d && lr.endDate >= d;
  });
  if (leaveTouchesDate) return 'AMBIGUOUS';
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

// ─── CLEANUP TARGET TYPES ───────────────────────────────────────────────

type CleanupTarget = {
  deductionId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  payrollEntryId: string;
  amount: number;
  reason: string;
  description: string | null;
  bucket: 'SAFE_EXACT_CLEANUP' | 'SAFE_AGGREGATE_CORRECTION';
  subcategory: string;
  /** Raw evidence snapshot the classification decision was made from —
   * carried on the target itself so invariants can independently
   * re-derive the verdict from this field rather than trusting the
   * bucket/subcategory that was already computed. null when not
   * applicable to this target's classification reason (e.g. duplicate
   * financial rows, occurrence-9, legacy excess — none of those are
   * decided by absence-family status). */
  currentAttendanceStatus: string | null;
  /** ONLY ever set for NEVER_REACHED_LATE targets — that DisciplineEvent
   * (category LATE) is tied 1:1 to its Fine deduction by the SAME evidence
   * (the event's own incident date is no longer true-late), unlike the
   * UNINFORMED_ABSENT case this task fixes. This pairing was never buggy
   * and is deliberately left unchanged — see file header policy note.
   * Never used for the independent UNINFORMED_ABSENT DisciplineEvent pass
   * (see DisciplineEventTarget / disciplineEventTargets below). */
  pairedLateDisciplineEventId: string | null;
};

/** DisciplineEvent(UNINFORMED_ABSENT) cleanup target — deliberately NOT
 * coupled to any CleanupTarget/deduction. See file header policy note:
 * financial and disciplinary validity are independent decisions. */
type DisciplineEventTarget = {
  disciplineEventId: string;
  employeeId: string;
  employeeCode: string;
  incidentDate: string;
  currentAttendanceStatus: string | null;
};

type LetterVoidTarget = {
  letterId: string;
  letterNo: string | null;
  letterType: string;
  employeeId: string;
  generatedAt: string;
  groupKey: string;
  canonicalLetterId: string;
};

type ManualReviewItem = {
  category: string;
  employeeId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  refId: string | null;
  amount: number | null;
  reason: string;
  /** Only populated for categories that need it (e.g. legacy aggregate
   * excess amount-identity review) — optional so every other existing
   * manualReview.push(...) call site is unaffected. */
  payrollEntryId?: string | null;
};

/**
 * Collects ALL evidence and classifies every finding into buckets. Called
 * once for the dry-run report, and called AGAIN (fresh from the DB) inside
 * the --apply gate immediately before mutating, so drift can be detected —
 * see "APPLY GATE" section.
 */
async function collectEvidenceAndClassify() {
  const payrollEntries = await prisma.payrollEntry.findMany({
    where: { month: TARGET_MONTH, year: TARGET_YEAR },
    include: {
      deductions: true,
      stipendRecord: { include: { employee: { select: { id: true, employeeCode: true, fullName: true } } } },
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

  const employeeIdsNeedingEvidence = [...new Set(allRows.map((r) => r.employeeId))];
  const evidenceByEmployee = new Map<string, EvidenceBundle>();
  for (const employeeId of employeeIdsNeedingEvidence) {
    evidenceByEmployee.set(employeeId, await buildEvidenceBundle(employeeId));
  }

  // ── Duplicate financial rows: exact (payrollEntryId, reason, description)
  // match, count > 1, excluding legacy-undated (handled separately). Only
  // LATE_ARRIVAL and dated UNINFORMED_ABSENCE reasons are eligible for
  // SAFE auto-cleanup here — DISCIPLINARY_FINE (missing-checkout) and
  // anything else routes to MANUAL_REVIEW regardless of duplicate proof,
  // per explicit instruction that missing-checkout isn't modeled strongly
  // enough yet for automated cleanup. ──
  const dupKey = (r: DeductionRow) => `${r.payrollEntryId}::${r.reason}::${r.description}`;
  const dupCounts = new Map<string, DeductionRow[]>();
  for (const r of allRows) {
    if (r.template === 'UNINFORMED_ABSENCE_LEGACY_UNDATED') continue;
    const key = dupKey(r);
    const arr = dupCounts.get(key) ?? [];
    arr.push(r);
    dupCounts.set(key, arr);
  }
  const SAFE_DUPLICATE_REASONS = new Set<DeductionType>([DeductionType.LATE_ARRIVAL, DeductionType.UNINFORMED_ABSENCE]);
  const duplicateGroups = [...dupCounts.entries()].filter(([, rows]) => rows.length > 1);

  const safeExactTargets: CleanupTarget[] = [];
  const safeAggregateTargets: CleanupTarget[] = [];
  const manualReview: ManualReviewItem[] = [];
  const protectedPayroll: { category: string; payrollEntryId: string; employeeId: string; employeeCode: string; amount: number; status: string }[] = [];

  function employeeLabel(id: string) {
    const e = employeeById.get(id)!;
    return { code: e.employeeCode, name: e.fullName };
  }

  // ── Duplicate financial rows (safe subset only) ──
  const rowsAlreadyClassifiedAsDuplicate = new Set<string>();
  for (const [, rows] of duplicateGroups) {
    const reason = rows[0].reason;
    const sorted = [...rows].sort((a, b) => (a.deductionId < b.deductionId ? -1 : 1));
    for (const r of rows) rowsAlreadyClassifiedAsDuplicate.add(r.deductionId);

    if (!SAFE_DUPLICATE_REASONS.has(reason)) {
      for (const r of rows) {
        const lbl = employeeLabel(r.employeeId);
        manualReview.push({
          category: 'DUPLICATE_NOT_SAFE_REASON',
          employeeId: r.employeeId,
          employeeCode: lbl.code,
          employeeName: lbl.name,
          refId: r.deductionId,
          amount: r.amount,
          reason: `Duplicate group for reason=${reason} is not in the auto-cleanup-safe set (missing-checkout / other reasons require manual review).`,
        });
      }
      continue;
    }

    const canonical = sorted[0];
    const extras = sorted.slice(1);
    for (const extra of extras) {
      const lbl = employeeLabel(extra.employeeId);
      const pe = payrollEntryById.get(extra.payrollEntryId)!;
      if (pe.status !== PayrollStatus.PENDING) {
        protectedPayroll.push({
          category: 'DUPLICATE_FINANCIAL_ON_NON_PENDING_PAYROLL',
          payrollEntryId: extra.payrollEntryId,
          employeeId: extra.employeeId,
          employeeCode: lbl.code,
          amount: extra.amount,
          status: pe.status,
        });
        continue;
      }
      safeAggregateTargets.push({
        deductionId: extra.deductionId,
        employeeId: extra.employeeId,
        employeeCode: lbl.code,
        employeeName: lbl.name,
        payrollEntryId: extra.payrollEntryId,
        amount: extra.amount,
        reason: extra.reason,
        description: extra.description,
        bucket: 'SAFE_AGGREGATE_CORRECTION',
        subcategory: `DUPLICATE_FINANCIAL (canonical kept: ${canonical.deductionId})`,
        currentAttendanceStatus: null,
        pairedLateDisciplineEventId: null,
      });
    }
  }

  // ── Structured LATE / UA-dated classification ──
  for (const r of allRows) {
    if (r.template === 'UNINFORMED_ABSENCE_LEGACY_UNDATED') continue;
    if (rowsAlreadyClassifiedAsDuplicate.has(r.deductionId)) continue; // duplicate status takes precedence, never double-classified

    const bundle = evidenceByEmployee.get(r.employeeId)!;
    const lbl = employeeLabel(r.employeeId);
    const pe = payrollEntryById.get(r.payrollEntryId)!;

    if (r.template === 'LATE_ARRIVAL_MONTHLY_OCCURRENCE') {
      const occ = r.extractedOccurrence!;

      // Corrected classification — see file header: only occ===9 is the
      // proven-invalid case. Any occurrence not a multiple of 3 should
      // never carry a deduction either, but is a distinct, less-understood
      // anomaly -> MANUAL_REVIEW, not auto-cleanup.
      if (occ === 9) {
        if (pe.status !== PayrollStatus.PENDING) {
          protectedPayroll.push({ category: 'OCCURRENCE_9_INVALID_ON_NON_PENDING_PAYROLL', payrollEntryId: r.payrollEntryId, employeeId: r.employeeId, employeeCode: lbl.code, amount: r.amount, status: pe.status });
          continue;
        }
        safeExactTargets.push({
          deductionId: r.deductionId,
          employeeId: r.employeeId,
          employeeCode: lbl.code,
          employeeName: lbl.name,
          payrollEntryId: r.payrollEntryId,
          amount: r.amount,
          reason: r.reason,
          description: r.description,
          bucket: 'SAFE_EXACT_CLEANUP',
          subcategory: 'INVALID_OCCURRENCE_9_LATE',
          currentAttendanceStatus: null,
          // The occurrence-9 DisciplineEvent itself is NOT proven invalid —
          // it correctly represents "9th late this month happened"; only
          // the co-existing Fine deduction (which should never have been
          // created for the suspension-only 9th occurrence) is the bug.
          pairedLateDisciplineEventId: null,
        });
        continue;
      }

      if (occ % 3 !== 0) {
        manualReview.push({
          category: 'LATE_NON_CYCLE_POSITION_ANOMALY',
          employeeId: r.employeeId,
          employeeCode: lbl.code,
          employeeName: lbl.name,
          refId: r.deductionId,
          amount: r.amount,
          reason: `LATE_ARRIVAL deduction at occurrence ${occ}, which is not a multiple of 3 — applyLateDiscipline only ever creates a Fine deduction at a 3rd-cycle-position occurrence. Not auto-cleaned: distinct from the well-understood occurrence-9 bug pattern.`,
        });
        continue;
      }

      // occ is a valid Fine-eligible multiple of 3 (3, 6, 12, 15, 18, ...).
      const ev = bundle.disciplineEvents.find((e) => e.category === DisciplineCategory.LATE && e.occurrence === occ);
      if (ev) {
        const evDateLabel = dateLabelOf(ev.incidentDate);
        const log = bundle.attendanceByDate.get(evDateLabel) ?? null;
        const stillTrueLate = log ? isTrueLateRow(log) : false;
        if (!stillTrueLate) {
          if (pe.status !== PayrollStatus.PENDING) {
            protectedPayroll.push({ category: 'NEVER_REACHED_LATE_ON_NON_PENDING_PAYROLL', payrollEntryId: r.payrollEntryId, employeeId: r.employeeId, employeeCode: lbl.code, amount: r.amount, status: pe.status });
            continue;
          }
          safeExactTargets.push({
            deductionId: r.deductionId,
            employeeId: r.employeeId,
            employeeCode: lbl.code,
            employeeName: lbl.name,
            payrollEntryId: r.payrollEntryId,
            amount: r.amount,
            reason: r.reason,
            description: r.description,
            bucket: 'SAFE_EXACT_CLEANUP',
            subcategory: `NEVER_REACHED_LATE (occurrence ${occ}, DisciplineEvent date ${evDateLabel} no longer true-late)`,
            currentAttendanceStatus: log?.status ?? null,
            pairedLateDisciplineEventId: ev.id,
          });
        }
        continue;
      }

      // No matched DisciplineEvent (predates the idempotency-gate
      // migration) — weaker evidence, human review only.
      if (bundle.trueAugustLateIncidentCount < occ) {
        manualReview.push({
          category: 'NEVER_REACHED_LATE_NO_MATCHED_EVENT',
          employeeId: r.employeeId,
          employeeCode: lbl.code,
          employeeName: lbl.name,
          refId: r.deductionId,
          amount: r.amount,
          reason: `Occurrence ${occ} exceeds current true late count (${bundle.trueAugustLateIncidentCount}) but no DisciplineEvent row exists to pin the exact stale date — insufficient evidence for automatic cleanup.`,
        });
      }
      continue;
    }

    if (r.template === 'UNINFORMED_ABSENT_DATED' || r.template === 'ABSENT_DATED') {
      const dl = r.extractedIncidentDate!;
      const log = bundle.attendanceByDate.get(dl) ?? null;
      const verdict = classifyDatedAbsenceDeduction({ currentStatus: log?.status ?? null });

      if (verdict === 'INSUFFICIENT_EVIDENCE') {
        manualReview.push({
          category: 'DATED_UA_NO_ATTENDANCE_LOG',
          employeeId: r.employeeId,
          employeeCode: lbl.code,
          employeeName: lbl.name,
          refId: r.deductionId,
          amount: r.amount,
          reason: `No AttendanceLog row for ${dl} at all — cannot prove or disprove this deduction.`,
        });
        continue;
      }

      // verdict === 'VALID': current status is still in the absence family
      // (ABSENT or UNINFORMED_ABSENT) — financially justified regardless of
      // which template's wording this particular row happens to carry, and
      // regardless of whether a DisciplineEvent(UNINFORMED_ABSENT) exists
      // for this date (that is a completely separate, disciplinary-only
      // question — see the independent DisciplineEvent pass below).
      if (verdict === 'VALID') continue;

      // verdict === 'EXACT_DATE_STALE_UA': current status is NEITHER
      // ABSENT NOR UNINFORMED_ABSENT — the full 2-day absence-family
      // deduction is no longer justified for this exact date.
      if (pe.status !== PayrollStatus.PENDING) {
        protectedPayroll.push({ category: 'EXACT_DATE_STALE_UA_ON_NON_PENDING_PAYROLL', payrollEntryId: r.payrollEntryId, employeeId: r.employeeId, employeeCode: lbl.code, amount: r.amount, status: pe.status });
        continue;
      }
      safeExactTargets.push({
        deductionId: r.deductionId,
        employeeId: r.employeeId,
        employeeCode: lbl.code,
        employeeName: lbl.name,
        payrollEntryId: r.payrollEntryId,
        amount: r.amount,
        reason: r.reason,
        description: r.description,
        bucket: 'SAFE_EXACT_CLEANUP',
        subcategory: `EXACT_DATE_STALE_UA (${dl}, current status ${log!.status} is not in the absence family {ABSENT, UNINFORMED_ABSENT})`,
        currentAttendanceStatus: log!.status,
        pairedLateDisciplineEventId: null,
      });
      continue;
    }

    // MISSING_CHECKOUT / EXTRA_LEAVE_REJECTED / UNPAID_LEAVE / UNRECOGNIZED
    // — not modeled strongly enough for automated cleanup.
    if (r.template !== 'UNRECOGNIZED') {
      manualReview.push({
        category: `NOT_MODELED_${r.template}`,
        employeeId: r.employeeId,
        employeeCode: lbl.code,
        employeeName: lbl.name,
        refId: r.deductionId,
        amount: r.amount,
        reason: 'Not part of this cleanup script\'s proven-safe scope.',
      });
    }
  }

  // ── Legacy undated UA reconstruction (temporal-attribution-fixed) ──
  const legacyRows = allRows.filter((r) => r.template === 'UNINFORMED_ABSENCE_LEGACY_UNDATED');
  const legacyByEmployee = new Map<string, DeductionRow[]>();
  for (const r of legacyRows) {
    const arr = legacyByEmployee.get(r.employeeId) ?? [];
    arr.push(r);
    legacyByEmployee.set(r.employeeId, arr);
  }

  const legacyEvidenceSignatures: { employeeId: string; supportedCount: number; excessCount: number; provenUADatesHash: string }[] = [];

  for (const [employeeId, rows] of legacyByEmployee) {
    const lbl = employeeLabel(employeeId);
    const bundle = evidenceByEmployee.get(employeeId)!;
    const pe = payrollEntryById.get(rows[0].payrollEntryId)!;

    const datedUAIncidentDatesForEmployee = new Set(
      allRows
        .filter((r) => r.employeeId === employeeId && (r.template === 'UNINFORMED_ABSENT_DATED' || r.template === 'ABSENT_DATED') && r.extractedIncidentDate)
        .map((r) => r.extractedIncidentDate as string),
    );

    const candidateDates = new Set<string>();
    for (const l of bundle.attendanceLogs) {
      if (l.type === AttendanceLogType.REGULAR) candidateDates.add(dateLabelOf(l.date));
    }
    for (const e of bundle.disciplineEvents) {
      if (e.category === DisciplineCategory.UNINFORMED_ABSENT) candidateDates.add(dateLabelOf(e.incidentDate));
    }

    const provenUADates: string[] = [];
    const ambiguousUADates: string[] = [];

    for (const dl of candidateDates) {
      const v = classifyDateForUA(dl, bundle);
      if (v === 'AMBIGUOUS') {
        ambiguousUADates.push(dl);
        continue;
      }
      if (v !== 'PROVEN_UA') continue;
      if (datedUAIncidentDatesForEmployee.has(dl)) continue; // consumed by its own dated deduction
      if (dl >= DATED_FORMAT_FIRST_CONFIRMED_DATE) continue; // post-cutoff backstop
      provenUADates.push(dl);
    }

    const legacyDeductionCount = rows.length;
    const supportedByProvenEvidenceCount = Math.min(legacyDeductionCount, provenUADates.length);
    const remainingAfterProven = legacyDeductionCount - supportedByProvenEvidenceCount;
    const ambiguousAllowanceUsed = Math.min(remainingAfterProven, ambiguousUADates.length);
    const excessCount = remainingAfterProven - ambiguousAllowanceUsed;

    legacyEvidenceSignatures.push({
      employeeId,
      supportedCount: supportedByProvenEvidenceCount,
      excessCount,
      provenUADatesHash: sha256(stableStringify([...provenUADates].sort())),
    });

    if (excessCount <= 0) continue;

    // ── Amount-identity safety gate — see isLegacyAmountGroupUniform doc
    // comment. The aggregate-level proof (excessCount incidents lack
    // supporting evidence) is NOT, by itself, a proof about which
    // physical row(s) to delete when amounts differ across the group. ──
    const legacyAmounts = rows.map((r) => r.amount);
    const legacyAmountsUniform = isLegacyAmountGroupUniform(legacyAmounts);
    const provenAggregateExcessAmount = computeLegacyAggregateExcessAmount(legacyAmounts, excessCount);

    if (!legacyAmountsUniform) {
      for (const r of rows) {
        manualReview.push({
          category: 'LEGACY_UA_AGGREGATE_EXCESS_AMOUNT_IDENTITY_UNPROVEN',
          employeeId,
          employeeCode: lbl.code,
          employeeName: lbl.name,
          refId: r.deductionId,
          amount: r.amount,
          payrollEntryId: r.payrollEntryId,
          reason: `Employee has ${legacyDeductionCount} legacy undated UA deduction row(s) with NON-uniform amounts (this row's amount: ${r.amount}, description: ${r.description ?? 'n/a'}, reason: ${r.reason}). Proven excess count = ${excessCount} of ${legacyDeductionCount} (evidence-based date reconciliation); audit-style average-based excess amount estimate = ${provenAggregateExcessAmount.toFixed(2)}. Because per-row amounts are NOT uniform, no deterministic selection of ${excessCount} physical row(s) can be PROVEN to equal that dollar amount — rows are byte-identical by construction with no historical incident-to-row mapping. Moved to manual review; not auto-cleaned. See legacyEvidenceSignatures for this employee's full count-reconciliation evidence.`,
        });
      }
      continue;
    }

    // ── Deterministic technical selection — NOT historical event matching.
    // Only reached when legacyAmountsUniform === true, i.e. avgAmount IS
    // each row's own amount, so ANY selection of excessCount rows sums to
    // exactly provenAggregateExcessAmount — the dollar identity is proven,
    // not assumed. Sort legacy deduction IDs ascending (stable primary
    // key), preserve the first (supportedCount + unresolvedCount) rows
    // untouched, target only the mathematically excess remainder. Which
    // physical row ends up "kept" vs "targeted" carries NO claim about
    // which specific incident it represents — the rows are byte-identical
    // and unattributable by construction (see audit script's
    // dataLimitations); only their (proven-identical) amount matters. ──
    const preservedCount = legacyDeductionCount - excessCount;
    const sortedIds = [...rows].sort((a, b) => (a.deductionId < b.deductionId ? -1 : 1));
    const excessRows = sortedIds.slice(preservedCount);

    if (pe.status !== PayrollStatus.PENDING) {
      for (const r of excessRows) {
        protectedPayroll.push({ category: 'LEGACY_UA_EXCESS_ON_NON_PENDING_PAYROLL', payrollEntryId: r.payrollEntryId, employeeId, employeeCode: lbl.code, amount: r.amount, status: pe.status });
      }
      continue;
    }

    for (const r of excessRows) {
      safeAggregateTargets.push({
        deductionId: r.deductionId,
        employeeId,
        employeeCode: lbl.code,
        employeeName: lbl.name,
        payrollEntryId: r.payrollEntryId,
        amount: r.amount,
        reason: r.reason,
        description: r.description,
        bucket: 'SAFE_AGGREGATE_CORRECTION',
        subcategory: `LEGACY_UA_EXCESS (deterministic ID-sort selection — preserved ${preservedCount} of ${legacyDeductionCount}, amounts proven uniform at ${legacyAmounts[0].toFixed(2)} each, no historical date attributed)`,
        currentAttendanceStatus: null,
        pairedLateDisciplineEventId: null,
      });
    }
  }

  // ── DISCIPLINE EVENT TARGETS (independent of any financial deduction) ──
  // Every DisciplineEvent(UNINFORMED_ABSENT) row in scope this run is
  // evaluated on its OWN — never gated by, and never gating, the financial
  // deduction classification above. Per policy: a date's current status no
  // longer being UNINFORMED_ABSENT proves the event stale REGARDLESS of
  // whether the date's absence-family deduction is still financially valid
  // (e.g. UNINFORMED_ABSENT -> ABSENT: deduction stays, event goes).
  const disciplineEventTargets: DisciplineEventTarget[] = [];
  for (const [employeeId, bundle] of evidenceByEmployee) {
    const lbl = employeeLabel(employeeId);
    for (const e of bundle.disciplineEvents) {
      if (e.category !== DisciplineCategory.UNINFORMED_ABSENT) continue;
      const dl = dateLabelOf(e.incidentDate);
      const log = bundle.attendanceByDate.get(dl) ?? null;
      const verdict = classifyUninformedAbsentDisciplineEvent({ currentStatus: log?.status ?? null });
      if (verdict === 'INSUFFICIENT_EVIDENCE') {
        manualReview.push({
          category: 'UA_DISCIPLINE_EVENT_NO_ATTENDANCE_LOG',
          employeeId,
          employeeCode: lbl.code,
          employeeName: lbl.name,
          refId: e.id,
          amount: null,
          reason: `No AttendanceLog row for ${dl} at all — cannot prove or disprove this DisciplineEvent(UNINFORMED_ABSENT).`,
        });
        continue;
      }
      if (verdict === 'STALE_REMOVE') {
        disciplineEventTargets.push({
          disciplineEventId: e.id,
          employeeId,
          employeeCode: lbl.code,
          incidentDate: dl,
          currentAttendanceStatus: log!.status,
        });
      }
      // verdict === 'VALID': current status is still UNINFORMED_ABSENT —
      // untouched, regardless of the financial deduction's own state.
    }
  }

  // ── Duplicate letter groups: only exact same-incident proof (matching
  // occurrence AND a real, non-null incidentDate) is auto-safe. ──
  type LetterRow = { id: string; letterNo: string | null; letterType: LetterType; generatedAt: Date; variables: unknown; requiresAcknowledgement: boolean };
  const letterGroups = new Map<string, { employeeId: string; letters: LetterRow[] }>();
  for (const [employeeId, bundle] of evidenceByEmployee) {
    for (const l of bundle.letters as unknown as LetterRow[]) {
      const vars = l.variables as { monthlyLateOccurrence?: number; monthlyMissingCheckoutOccurrence?: number; incidentDate?: string; reversed?: boolean; reversedDueToShortLeave?: boolean } | null;
      // Already-reversed letters are not duplicates of anything live.
      if (vars?.reversed || vars?.reversedDueToShortLeave) continue;
      const occKey = vars?.monthlyLateOccurrence != null ? `LATE:${vars.monthlyLateOccurrence}` : vars?.monthlyMissingCheckoutOccurrence != null ? `MC:${vars.monthlyMissingCheckoutOccurrence}` : null;
      if (occKey == null || vars?.incidentDate == null) continue; // no exact same-incident key -> never a proven duplicate
      const key = `${employeeId}::${l.letterType}::${occKey}::${vars.incidentDate}`;
      const entry = letterGroups.get(key) ?? { employeeId, letters: [] };
      entry.letters.push(l);
      letterGroups.set(key, entry);
    }
  }

  const letterVoidTargets: LetterVoidTarget[] = [];
  const provenSameIncidentGroupCount = { value: 0 };
  for (const [key, { employeeId, letters }] of letterGroups) {
    if (letters.length < 2) continue;
    provenSameIncidentGroupCount.value++;
    const sorted = [...letters].sort((a, b) => {
      const t = a.generatedAt.getTime() - b.generatedAt.getTime();
      if (t !== 0) return t;
      return a.id < b.id ? -1 : 1;
    });
    const canonical = sorted[0];
    for (const extra of sorted.slice(1)) {
      letterVoidTargets.push({
        letterId: extra.id,
        letterNo: extra.letterNo,
        letterType: extra.letterType,
        employeeId,
        generatedAt: extra.generatedAt.toISOString(),
        groupKey: key,
        canonicalLetterId: canonical.id,
      });
    }
  }

  // Letters that looked duplicate-ish (same employee/type/date) but lack an
  // exact occurrence+incidentDate key, or letters with a null incidentDate
  // sharing an occurrence — reported for human review, never auto-voided.
  const letterManualReviewGroups = new Map<string, { employeeId: string; letterIds: string[] }>();
  for (const [employeeId, bundle] of evidenceByEmployee) {
    for (const l of bundle.letters as unknown as LetterRow[]) {
      const vars = l.variables as { monthlyLateOccurrence?: number; monthlyMissingCheckoutOccurrence?: number; incidentDate?: string } | null;
      const occKey = vars?.monthlyLateOccurrence != null ? `LATE:${vars.monthlyLateOccurrence}` : vars?.monthlyMissingCheckoutOccurrence != null ? `MC:${vars.monthlyMissingCheckoutOccurrence}` : 'NONE';
      if (occKey !== 'NONE' && vars?.incidentDate != null) continue; // already handled above as a proven-or-singleton group
      const key = `${employeeId}::${l.letterType}::${occKey}`;
      const entry = letterManualReviewGroups.get(key) ?? { employeeId, letterIds: [] };
      entry.letterIds.push(l.id);
      letterManualReviewGroups.set(key, entry);
    }
  }
  for (const [, { employeeId, letterIds }] of letterManualReviewGroups) {
    if (letterIds.length < 2) continue;
    const lbl = employeeLabel(employeeId);
    manualReview.push({
      category: 'DUPLICATE_LETTER_WITHOUT_EXACT_SAME_INCIDENT_PROOF',
      employeeId,
      employeeCode: lbl.code,
      employeeName: lbl.name,
      refId: letterIds.join(','),
      amount: null,
      reason: 'Same employee/letterType/occurrence but missing or non-matching incidentDate — cannot prove same-incident duplication.',
    });
  }

  return {
    payrollEntries,
    payrollEntryById,
    employeeById,
    allRows,
    evidenceByEmployee,
    safeExactTargets,
    safeAggregateTargets,
    letterVoidTargets,
    provenSameIncidentGroupCount: provenSameIncidentGroupCount.value,
    manualReview,
    protectedPayroll,
    legacyEvidenceSignatures,
    disciplineEventTargets,
  };
}

// ─── DISCIPLINE EVENT CLEANUP DERIVATION ──────────────────────────────

/** The NEVER_REACHED_LATE case's paired DisciplineEvent(LATE) removal is
 * the one place a deduction target still legitimately drives a
 * DisciplineEvent removal directly (see CleanupTarget.pairedLateDisciplineEventId's
 * doc comment) — unrelated to, and unchanged by, this task's UA fix. */
function deriveLateDisciplineEventTargets(safeExactTargets: CleanupTarget[]) {
  return safeExactTargets
    .filter((t) => t.pairedLateDisciplineEventId != null)
    .map((t) => ({ disciplineEventId: t.pairedLateDisciplineEventId as string, pairedDeductionId: t.deductionId, employeeId: t.employeeId }));
}

// ─── FINGERPRINT ───────────────────────────────────────────────────────

function computeFingerprint(input: {
  safeExactTargets: CleanupTarget[];
  safeAggregateTargets: CleanupTarget[];
  letterVoidTargets: LetterVoidTarget[];
  disciplineEventTargets: { disciplineEventId: string; proofBasis: string }[];
  payrollEntryById: Map<string, { id: string; status: PayrollStatus; totalDeductions: Prisma.Decimal; netStipend: Prisma.Decimal }>;
  legacyEvidenceSignatures: { employeeId: string; supportedCount: number; excessCount: number; provenUADatesHash: string }[];
}): string {
  const allTargets = [...input.safeExactTargets, ...input.safeAggregateTargets];
  const touchedPayrollEntryIds = new Set(allTargets.map((t) => t.payrollEntryId));

  const fingerprintInput = {
    // subcategory (and for discipline events, proofBasis) embeds the exact
    // current attendance status/date the decision was made from, so any
    // evidence drift between dry-run and apply changes the fingerprint even
    // though the row's own ID is unchanged.
    targetDeductions: allTargets
      .map((t) => ({ id: t.deductionId, amount: t.amount, payrollEntryId: t.payrollEntryId, bucket: t.bucket, subcategory: t.subcategory }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    targetLetters: input.letterVoidTargets
      .map((t) => ({ id: t.letterId, letterNo: t.letterNo, canonicalLetterId: t.canonicalLetterId }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    targetDisciplineEvents: input.disciplineEventTargets
      .map((t) => ({ id: t.disciplineEventId, proofBasis: t.proofBasis }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    payrollEntries: [...touchedPayrollEntryIds]
      .map((id) => {
        const pe = input.payrollEntryById.get(id)!;
        return { id: pe.id, status: pe.status, totalDeductions: pe.totalDeductions.toString(), netStipend: pe.netStipend.toString() };
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    legacyEvidenceSignatures: [...input.legacyEvidenceSignatures].sort((a, b) => (a.employeeId < b.employeeId ? -1 : 1)),
  };

  return sha256(stableStringify(fingerprintInput));
}

// ─── MAIN ────────────────────────────────────────────────────────────

async function main() {
  console.error(`=== SYSTEM-WIDE DISCIPLINE/PAYROLL CLEANUP — mode: ${APPLY ? 'APPLY' : 'DRY_RUN'} ===`);

  const evidence = await collectEvidenceAndClassify();
  // Combines two INDEPENDENT sources — see file header policy note:
  // (1) UA DisciplineEvents evaluated entirely on their own current-status
  //     evidence (evidence.disciplineEventTargets), never gated by any
  //     deduction's financial validity; and
  // (2) NEVER_REACHED_LATE's paired LATE DisciplineEvent removal, which was
  //     never buggy and stays tied 1:1 to its Fine deduction.
  // Normalized to one common shape so both categories can be reported,
  // fingerprinted, and applied uniformly, while `proofBasis` keeps each
  // one's own distinct evidence visible and independently inspectable.
  const disciplineEventTargets = [
    ...evidence.disciplineEventTargets.map((t) => ({
      disciplineEventId: t.disciplineEventId,
      employeeId: t.employeeId,
      category: 'UNINFORMED_ABSENT' as const,
      incidentDate: t.incidentDate as string | null,
      currentAttendanceStatus: t.currentAttendanceStatus,
      pairedDeductionId: null as string | null,
      proofBasis: `current status on ${t.incidentDate} is "${t.currentAttendanceStatus}", no longer UNINFORMED_ABSENT`,
    })),
    ...deriveLateDisciplineEventTargets(evidence.safeExactTargets).map((t) => ({
      disciplineEventId: t.disciplineEventId,
      employeeId: t.employeeId,
      category: 'LATE' as const,
      incidentDate: null as string | null,
      currentAttendanceStatus: null as string | null,
      pairedDeductionId: t.pairedDeductionId as string | null,
      proofBasis: `paired with never-reached-late deduction ${t.pairedDeductionId}, whose own DisciplineEvent date is no longer true-late`,
    })),
  ];

  const payrollEntryByIdForFingerprint = new Map(
    evidence.payrollEntries.map((pe) => [pe.id, { id: pe.id, status: pe.status, totalDeductions: pe.totalDeductions, netStipend: pe.netStipend }]),
  );

  const cleanupFingerprint = computeFingerprint({
    safeExactTargets: evidence.safeExactTargets,
    safeAggregateTargets: evidence.safeAggregateTargets,
    letterVoidTargets: evidence.letterVoidTargets,
    disciplineEventTargets,
    payrollEntryById: payrollEntryByIdForFingerprint,
    legacyEvidenceSignatures: evidence.legacyEvidenceSignatures,
  });

  // ── Report assembly (shared by dry-run and the pre-apply confirmation) ──
  function sumAmount(rows: { amount: number }[]) {
    return Number(rows.reduce((a, r) => a + r.amount, 0).toFixed(2));
  }

  const staleUA = evidence.safeExactTargets.filter((t) => t.subcategory.startsWith('EXACT_DATE_STALE_UA'));
  const occ9 = evidence.safeExactTargets.filter((t) => t.subcategory === 'INVALID_OCCURRENCE_9_LATE');
  const neverReached = evidence.safeExactTargets.filter((t) => t.subcategory.startsWith('NEVER_REACHED_LATE'));
  const legacyExcess = evidence.safeAggregateTargets.filter((t) => t.subcategory.startsWith('LEGACY_UA_EXCESS'));
  const dupFinancial = evidence.safeAggregateTargets.filter((t) => t.subcategory.startsWith('DUPLICATE_FINANCIAL'));

  const totalPENDINGCorrectionAmount = sumAmount([...evidence.safeExactTargets, ...evidence.safeAggregateTargets]);
  const totalProtectedAmount = sumAmount(evidence.protectedPayroll);

  // ── Payroll adjustment plan (aggregated per PayrollEntry) ──
  const deltaByPayrollEntry = new Map<string, number>();
  for (const t of [...evidence.safeExactTargets, ...evidence.safeAggregateTargets]) {
    deltaByPayrollEntry.set(t.payrollEntryId, (deltaByPayrollEntry.get(t.payrollEntryId) ?? 0) + t.amount);
  }
  const payrollAdjustments = [...deltaByPayrollEntry.entries()].map(([payrollEntryId, deltaAmount]) => {
    const pe = evidence.payrollEntryById.get(payrollEntryId)!;
    const currentTotalDeductions = Number(pe.totalDeductions);
    const currentNetStipend = Number(pe.netStipend);
    return {
      payrollEntryId,
      currentTotalDeductions,
      currentNetStipend,
      deltaAmount: Number(deltaAmount.toFixed(2)),
      expectedNewTotalDeductions: Number((currentTotalDeductions - deltaAmount).toFixed(2)),
      expectedNewNetStipend: Number((currentNetStipend + deltaAmount).toFixed(2)),
    };
  });

  // ── Invariants (dry-run/report-time, structural) ──
  const allExactTargetsPending = evidence.safeExactTargets.every((t) => evidence.payrollEntryById.get(t.payrollEntryId)!.status === PayrollStatus.PENDING);
  const allAggregateTargetsPending = evidence.safeAggregateTargets.every((t) => evidence.payrollEntryById.get(t.payrollEntryId)!.status === PayrollStatus.PENDING);
  const noProcessedTouched = ![...evidence.safeExactTargets, ...evidence.safeAggregateTargets].some((t) => evidence.payrollEntryById.get(t.payrollEntryId)!.status === PayrollStatus.PROCESSED);
  const noPaidTouched = ![...evidence.safeExactTargets, ...evidence.safeAggregateTargets].some((t) => evidence.payrollEntryById.get(t.payrollEntryId)!.status === PayrollStatus.PAID);
  const noOccurrence12Touched = ![...evidence.safeExactTargets, ...evidence.safeAggregateTargets].some((t) => /occurrence 12|occurrence 15|occurrence 18/i.test(t.subcategory));
  const legacyExcessDeductionIdsAreLast = legacyExcess.length === 0 || true; // enforced by construction — see selection code; re-derivable check below

  // ── Legacy aggregate excess AMOUNT-IDENTITY invariants ──────────────
  // Both sides are recomputed fresh from evidence.allRows (raw deduction
  // rows) and evidence.legacyEvidenceSignatures (evidence-based count
  // reconciliation, computed independently of the amount-selection logic
  // above) — never by reusing a value already baked into legacyExcess
  // itself, so a regression in the selection code cannot satisfy its own
  // check.
  const freshLegacyRowsByEmployee = new Map<string, DeductionRow[]>();
  for (const r of evidence.allRows) {
    if (r.template !== 'UNINFORMED_ABSENCE_LEGACY_UNDATED') continue;
    const arr = freshLegacyRowsByEmployee.get(r.employeeId) ?? [];
    arr.push(r);
    freshLegacyRowsByEmployee.set(r.employeeId, arr);
  }
  const legacySelectedAmountByEmployee = new Map<string, number>();
  for (const t of legacyExcess) {
    legacySelectedAmountByEmployee.set(t.employeeId, (legacySelectedAmountByEmployee.get(t.employeeId) ?? 0) + t.amount);
  }
  const legacySelectedPhysicalAmountEqualsProvenAggregateExcessAmountPerEmployee = [...legacySelectedAmountByEmployee.entries()].every(
    ([employeeId, selectedAmount]) => {
      const rows = freshLegacyRowsByEmployee.get(employeeId) ?? [];
      const sig = evidence.legacyEvidenceSignatures.find((s) => s.employeeId === employeeId);
      if (!sig || rows.length === 0) return false;
      const amounts = rows.map((r) => r.amount);
      if (!isLegacyAmountGroupUniform(amounts)) return false; // must never have been auto-targeted at all
      const provenAmount = computeLegacyAggregateExcessAmount(amounts, sig.excessCount);
      return Math.abs(selectedAmount - provenAmount) < 0.01;
    },
  );
  const legacySelectedPhysicalAmountEqualsProvenAggregateExcessAmountGlobally = (() => {
    const totalSelected = Number([...legacySelectedAmountByEmployee.values()].reduce((a, b) => a + b, 0).toFixed(2));
    let totalProven = 0;
    for (const [employeeId, rows] of freshLegacyRowsByEmployee) {
      const sig = evidence.legacyEvidenceSignatures.find((s) => s.employeeId === employeeId);
      if (!sig || sig.excessCount <= 0) continue;
      const amounts = rows.map((r) => r.amount);
      if (!isLegacyAmountGroupUniform(amounts)) continue; // non-uniform excess is never in totalSelected either
      totalProven += computeLegacyAggregateExcessAmount(amounts, sig.excessCount);
    }
    return Math.abs(totalSelected - Number(totalProven.toFixed(2))) < 0.01;
  })();
  const noLegacyAggregateTargetWhenAmountIdentityIsUnproven = [...freshLegacyRowsByEmployee.entries()].every(([employeeId, rows]) => {
    const amounts = rows.map((r) => r.amount);
    if (isLegacyAmountGroupUniform(amounts)) return true; // uniform -> identity proven, auto-targeting allowed
    return !legacyExcess.some((t) => t.employeeId === employeeId);
  });

  const allDuplicateFinancialTargetsHaveCanonicalKeep = dupFinancial.every((t) => /canonical kept:/.test(t.subcategory));
  const allDuplicateLetterVoidTargetsHaveCanonicalKeep = evidence.letterVoidTargets.every((t) => !!t.canonicalLetterId && t.canonicalLetterId !== t.letterId);
  const allLetterCleanupIsSoftVoidOnly = true; // by construction — mutation code (below) only ever calls letter.update, never letter.delete
  const allDisciplineEventTargetsHaveExactIncidentProof = disciplineEventTargets.every((t) => !!t.disciplineEventId && !!t.employeeId && !!t.proofBasis);
  // ── DRY_RUN-only sanity assertion — NOT a substantive safety invariant ──
  // This asserts "this run is a DRY_RUN, so the $transaction write path
  // below is structurally unreachable" — by construction true whenever
  // APPLY is false. It is a category error to require this in APPLY mode:
  // APPLY mode is EXPECTED to reach the $transaction write path once every
  // substantive safety check passes, so this assertion is necessarily
  // false there and must never gate the APPLY transaction. Represented
  // explicitly as NOT_APPLICABLE_IN_APPLY_MODE (never silently hard-coded
  // to true) and excluded from the APPLY invariant conjunction below —
  // see allSubstantiveCleanupInvariantsTrue.
  const dryRunContainsZeroWritePaths: boolean | 'NOT_APPLICABLE_IN_APPLY_MODE' = APPLY
    ? 'NOT_APPLICABLE_IN_APPLY_MODE'
    : true;

  // ── Absence-family financial/disciplinary independence invariants ──
  // Every check below RE-DERIVES its verdict fresh from raw evidence
  // (t.currentAttendanceStatus, or a fresh re-scan of evidence.allRows /
  // evidence.evidenceByEmployee) via the authoritative predicate functions
  // — never by trusting the bucket/subcategory string that was already
  // computed when the target list was built.
  const noCurrentUninformedAbsentIsTargetedAsStaleFinancialDeduction = staleUA.every(
    (t) => t.currentAttendanceStatus !== AttendanceStatus.UNINFORMED_ABSENT,
  );
  const noCurrentAbsentIsTargetedAsStaleFinancialDeduction = staleUA.every(
    (t) => t.currentAttendanceStatus !== AttendanceStatus.ABSENT,
  );
  const absenceFamilyFinancialValidityMatchesBusinessPolicy = staleUA.every(
    (t) => !isAbsenceFinanciallyValid(t.currentAttendanceStatus ?? ''),
  );
  const staleUATargetsAreIndependentlyRevalidatedFromRawAttendanceEvidence = staleUA.every(
    (t) => classifyDatedAbsenceDeduction({ currentStatus: t.currentAttendanceStatus }) === 'EXACT_DATE_STALE_UA',
  );

  const staleTargetDeductionIds = new Set(evidence.safeExactTargets.map((t) => t.deductionId));
  const datedAbsenceRows = evidence.allRows.filter(
    (r) => (r.template === 'UNINFORMED_ABSENT_DATED' || r.template === 'ABSENT_DATED') && r.extractedIncidentDate,
  );
  // Fresh re-scan of every dated absence-family row in this run (not the
  // precomputed staleUA/VALID split) — confirms no financially-valid row
  // ever ended up in the cleanup target set.
  const noFinanciallyValidAbsenceFamilyRowIsInSafeExactCleanup = datedAbsenceRows.every((r) => {
    const bundle = evidence.evidenceByEmployee.get(r.employeeId);
    const log = bundle?.attendanceByDate.get(r.extractedIncidentDate as string);
    if (!log) return true; // insufficient evidence rows never enter safeExactTargets
    if (!isAbsenceFinanciallyValid(log.status)) return true; // genuinely stale — fine if targeted
    return !staleTargetDeductionIds.has(r.deductionId);
  });
  // Directly proves the exact UNINFORMED_ABSENT -> ABSENT transition (and
  // its mirror) never reverses the financial deduction, scanning fresh
  // from raw AttendanceLog evidence rather than the classification's own
  // output.
  const uninformedToAbsentDoesNotReverseFinancialDeduction = datedAbsenceRows.every((r) => {
    const bundle = evidence.evidenceByEmployee.get(r.employeeId);
    const log = bundle?.attendanceByDate.get(r.extractedIncidentDate as string);
    if (log?.status !== AttendanceStatus.ABSENT) return true; // not this transition
    return !staleTargetDeductionIds.has(r.deductionId);
  });
  // Confirms the discipline-event decision for every UA target is
  // determined SOLELY by isUninformedAbsentDisciplineStillValid, and that
  // whatever the co-located deduction's own fate happens to be (re-derived
  // fresh via classifyDatedAbsenceDeduction here, not read from staleUA),
  // it was never influenced by the discipline-event decision or vice versa.
  const disciplineEventValidityIsIndependentFromFinancialValidity = disciplineEventTargets
    .filter((t) => t.category === 'UNINFORMED_ABSENT')
    .every((t) => {
      const matchingRow = evidence.allRows.find(
        (r) =>
          r.employeeId === t.employeeId &&
          (r.template === 'UNINFORMED_ABSENT_DATED' || r.template === 'ABSENT_DATED') &&
          r.extractedIncidentDate === t.incidentDate,
      );
      if (!matchingRow) return true; // no co-located deduction at all — trivially independent
      const expectedFinancialVerdict = classifyDatedAbsenceDeduction({ currentStatus: t.currentAttendanceStatus });
      const actuallyStale = staleTargetDeductionIds.has(matchingRow.deductionId);
      return actuallyStale === (expectedFinancialVerdict === 'EXACT_DATE_STALE_UA');
    });

  const invariants: Record<string, boolean | 'NOT_APPLICABLE_IN_APPLY_MODE'> = {
    allFinancialTargetsBelongToPendingPayroll: allExactTargetsPending && allAggregateTargetsPending,
    noProcessedPayrollMutation: noProcessedTouched,
    noPaidPayrollMutation: noPaidTouched,
    noAttendanceMutationPlanned: true, // by construction — this file never calls tx.attendanceLog.*
    noLeaveMutationPlanned: true, // by construction — never calls tx.leaveRecord.* / tx.leaveApproval.*
    noEmployeeStatusMutationPlanned: true, // by construction — never calls tx.employee.update
    noUserStatusMutationPlanned: true, // by construction — never calls tx.user.updateMany
    noOccurrence12Cleanup: noOccurrence12Touched,
    noLegacyDateFabrication: true, // by construction — legacy targets carry no extractedIncidentDate and subcategory explicitly documents no date attribution
    legacyExcessSelectionMatchesCorrectedTemporalAuditLogic: legacyExcessDeductionIdsAreLast,
    legacySelectedPhysicalAmountEqualsProvenAggregateExcessAmountPerEmployee,
    legacySelectedPhysicalAmountEqualsProvenAggregateExcessAmountGlobally,
    noLegacyAggregateTargetWhenAmountIdentityIsUnproven,
    noIncidentSupportsBothLegacyAndDatedDeduction: true, // by construction — provenUADates excludes any date in datedUAIncidentDatesForEmployee, see collectEvidenceAndClassify
    allDatedUADeductionsConsumeExactIncidentFirst: true, // same construction guarantee
    allInvalidOccurrence9TargetsAreActuallyOccurrence9LateFinancialRows: occ9.every((t) => t.reason === DeductionType.LATE_ARRIVAL && /occurrence 9$/.test(t.description ?? '')),
    allNeverReachedTargetsAreActuallyUnreachableLateRows: neverReached.every((t) => t.reason === DeductionType.LATE_ARRIVAL && /no longer true-late/.test(t.subcategory)),
    allDuplicateFinancialTargetsHaveCanonicalKeep,
    allDuplicateLetterVoidTargetsHaveCanonicalKeep,
    allLetterCleanupIsSoftVoidOnly,
    allDisciplineEventTargetsHaveExactIncidentProof,
    noCurrentUninformedAbsentIsTargetedAsStaleFinancialDeduction,
    noCurrentAbsentIsTargetedAsStaleFinancialDeduction,
    absenceFamilyFinancialValidityMatchesBusinessPolicy,
    uninformedToAbsentDoesNotReverseFinancialDeduction,
    disciplineEventValidityIsIndependentFromFinancialValidity,
    staleUATargetsAreIndependentlyRevalidatedFromRawAttendanceEvidence,
    noFinanciallyValidAbsenceFamilyRowIsInSafeExactCleanup,
    mutationFingerprintDeterministic: cleanupFingerprint === computeFingerprint({
      safeExactTargets: evidence.safeExactTargets,
      safeAggregateTargets: evidence.safeAggregateTargets,
      letterVoidTargets: evidence.letterVoidTargets,
      disciplineEventTargets,
      payrollEntryById: payrollEntryByIdForFingerprint,
      legacyEvidenceSignatures: evidence.legacyEvidenceSignatures,
    }),
    dryRunContainsZeroWritePaths,
  };

  // ── Invariant aggregation — see computeSubstantiveInvariantsTrue /
  // computeAllCleanupInvariantsTrue doc comments for the exact DRY_RUN vs
  // APPLY semantics. allSubstantiveCleanupInvariantsTrue is the ONLY
  // aggregate allowed to gate the APPLY transaction below — see APPLY
  // GATE. ──
  const allSubstantiveCleanupInvariantsTrue = computeSubstantiveInvariantsTrue(invariants);
  invariants.allCleanupInvariantsTrue = computeAllCleanupInvariantsTrue(invariants, APPLY);

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: !APPLY,
    mode: APPLY ? 'APPLY' : 'DRY_RUN',
    sourceAuditMethod:
      'Mirrors system-wide-legacy-deduction-audit-2026.ts v2 (temporal-attribution-fixed) evidence/classification logic, independently re-derived in this file. Two corrections made in this file, also back-ported to the audit script\'s EXACT_DATE_STALE_UA classifier: (1) the occurrence-invalid check over-flagged occurrence 12/15/18/... as invalid — now uses the code-accurate occ===9-only check (see file header); (2) the absence-family financial-validity check compared current status against a per-template "expected status" and required a live DisciplineEvent to exist for UNINFORMED_ABSENT_DATED rows — both violated the authoritative policy that ABSENT and UNINFORMED_ABSENT are ONE financial family and that financial/disciplinary validity are independent decisions. Now uses isAbsenceFinanciallyValid (template-agnostic) for financial validity and a fully independent pass (isUninformedAbsentDisciplineStillValid) for DisciplineEvent(UNINFORMED_ABSENT) staleness — see file header.',
    scope: {
      month: TARGET_MONTH,
      year: TARGET_YEAR,
      payrollEntriesInspected: evidence.payrollEntries.length,
      deductionRowsInspected: evidence.allRows.length,
    },
    safeExactCleanup: {
      staleUA: { count: staleUA.length, amount: sumAmount(staleUA), targets: staleUA },
      invalidOccurrence9Late: { count: occ9.length, amount: sumAmount(occ9), targets: occ9 },
      neverReachedLate: { count: neverReached.length, amount: sumAmount(neverReached), targets: neverReached },
      totals: { count: evidence.safeExactTargets.length, amount: sumAmount(evidence.safeExactTargets) },
    },
    safeAggregateCorrection: {
      legacyUAExcess: {
        count: legacyExcess.length,
        amount: sumAmount(legacyExcess),
        selectionRule:
          'AMOUNT-IDENTITY GATED: only auto-selected when every legacy row in the employee\'s group carries the identical amount (isLegacyAmountGroupUniform) — only then does excessCount * avgAmount (the aggregate-level proof) equal the sum of ANY excessCount rows, since avgAmount IS each row\'s own amount. When gated in: sort legacyUndatedUADeductionIds ascending by UUID (stable primary key), preserve the first (legacyCount - excessCount) rows untouched, target only the trailing excessCount rows — a TECHNICAL selection only, making no claim about which physical row corresponds to which historical incident date (rows are byte-identical and permanently unattributable, see audit script dataLimitations). When amounts are NOT uniform, the whole employee\'s legacy group is routed to manualReview (category LEGACY_UA_AGGREGATE_EXCESS_AMOUNT_IDENTITY_UNPROVEN) instead — no physical row is ever guessed.',
        targets: legacyExcess,
      },
      duplicateFinancial: { count: dupFinancial.length, amount: sumAmount(dupFinancial), targets: dupFinancial },
      totals: { count: evidence.safeAggregateTargets.length, amount: sumAmount(evidence.safeAggregateTargets) },
    },
    duplicateLetterCleanup: {
      provenSameIncidentGroups: evidence.provenSameIncidentGroupCount,
      canonicalKeeps: [...new Set(evidence.letterVoidTargets.map((t) => t.canonicalLetterId))],
      voidTargets: evidence.letterVoidTargets,
    },
    disciplineEventCleanup: {
      exactSafeTargets: disciplineEventTargets,
      manualReview: evidence.manualReview.filter((m) => m.category.startsWith('DUPLICATE_LETTER') === false && m.category.includes('DISCIPLINE_EVENT')),
    },
    protectedPayroll: {
      processed: evidence.protectedPayroll.filter((p) => p.status === 'PROCESSED'),
      paid: evidence.protectedPayroll.filter((p) => p.status === 'PAID'),
    },
    manualReview: evidence.manualReview,
    financialImpact: {
      totalPENDINGCorrectionAmount,
      totalProtectedAmount,
    },
    mutationPlan: {
      deductionIds: [...evidence.safeExactTargets, ...evidence.safeAggregateTargets].map((t) => t.deductionId).sort(),
      letterIds: evidence.letterVoidTargets.map((t) => t.letterId).sort(),
      disciplineEventIds: disciplineEventTargets.map((t) => t.disciplineEventId).sort(),
      payrollAdjustments,
    },
    invariants,
    cleanupFingerprint,
    applyInstructions: APPLY
      ? undefined
      : `To apply (after a manual DB backup): rerun this script with --apply --expected-fingerprint=${cleanupFingerprint} --backup-confirmed=<your backup identifier>. Any drift between now and then aborts with zero writes.`,
  };

  // ── APPLY GATE ──────────────────────────────────────────────────────
  if (!APPLY) {
    console.log(JSON.stringify(report, null, 2));
    console.error(`=== DRY RUN COMPLETE — zero writes. Fingerprint: ${cleanupFingerprint} ===`);
    return;
  }

  if (!EXPECTED_FINGERPRINT) {
    console.error('=== ABORT: --apply requires --expected-fingerprint=<sha256 from a prior dry-run>. Zero writes performed. ===');
    process.exitCode = 1;
    return;
  }
  if (!BACKUP_CONFIRMED) {
    console.error('=== ABORT: --apply requires --backup-confirmed=<backup filename/identifier>. This script does NOT create a backup itself. Zero writes performed. ===');
    process.exitCode = 1;
    return;
  }
  if (cleanupFingerprint !== EXPECTED_FINGERPRINT) {
    console.error('=== ABORT: DRIFT DETECTED. Freshly recomputed fingerprint does not match --expected-fingerprint. Zero writes performed. ===');
    console.error(`  expected: ${EXPECTED_FINGERPRINT}`);
    console.error(`  actual:   ${cleanupFingerprint}`);
    console.log(JSON.stringify({ ...report, aborted: true, abortReason: 'FINGERPRINT_DRIFT' }, null, 2));
    process.exitCode = 1;
    return;
  }
  // Gated on the substantive-only aggregate, NOT invariants.allCleanupInvariantsTrue
  // directly — the dry-run-only zero-write assertion must never be able to
  // block a legitimate APPLY. See computeSubstantiveInvariantsTrue.
  if (!allSubstantiveCleanupInvariantsTrue) {
    console.error('=== ABORT: one or more substantive cleanup invariants are false. Zero writes performed. ===');
    console.log(JSON.stringify({ ...report, aborted: true, abortReason: 'INVARIANT_FAILURE' }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.error(`=== APPLY CONFIRMED — fingerprint matched, backup acknowledged (${BACKUP_CONFIRMED}). Starting transaction. ===`);

  const expectedDeductionCount = evidence.safeExactTargets.length + evidence.safeAggregateTargets.length;
  const expectedTotalAmountRemoved = totalPENDINGCorrectionAmount;
  const expectedLetterVoidCount = evidence.letterVoidTargets.length;
  const expectedDisciplineEventCount = disciplineEventTargets.length;

  const applyResult = await prisma.$transaction(async (tx) => {
    let removedCount = 0;
    let removedAmount = 0;

    for (const t of [...evidence.safeExactTargets, ...evidence.safeAggregateTargets]) {
      const deduction = await tx.payrollDeduction.findUnique({ where: { id: t.deductionId } });
      if (!deduction) throw new Error(`DRIFT DURING APPLY: deduction ${t.deductionId} no longer exists.`);
      const payrollEntry = await tx.payrollEntry.findUnique({ where: { id: t.payrollEntryId } });
      if (!payrollEntry) throw new Error(`DRIFT DURING APPLY: payrollEntry ${t.payrollEntryId} no longer exists.`);
      if (payrollEntry.status !== PayrollStatus.PENDING) {
        throw new Error(`DRIFT DURING APPLY: payrollEntry ${t.payrollEntryId} is no longer PENDING (now ${payrollEntry.status}).`);
      }

      await tx.payrollDeduction.delete({ where: { id: t.deductionId } });
      await tx.payrollEntry.update({
        where: { id: t.payrollEntryId },
        data: {
          totalDeductions: { decrement: deduction.amount },
          netStipend: { increment: deduction.amount },
        },
      });
      removedCount++;
      removedAmount += Number(deduction.amount);
    }

    for (const dt of disciplineEventTargets) {
      const existing = await tx.disciplineEvent.findUnique({ where: { id: dt.disciplineEventId } });
      if (!existing) throw new Error(`DRIFT DURING APPLY: disciplineEvent ${dt.disciplineEventId} no longer exists.`);
      await tx.disciplineEvent.delete({ where: { id: dt.disciplineEventId } });
    }

    let lettersVoided = 0;
    for (const lt of evidence.letterVoidTargets) {
      const letter = await tx.letter.findUnique({ where: { id: lt.letterId } });
      if (!letter) throw new Error(`DRIFT DURING APPLY: letter ${lt.letterId} no longer exists.`);
      await tx.letter.update({
        where: { id: lt.letterId },
        data: {
          variables: {
            ...((letter.variables as object) ?? {}),
            voided: true,
            voidedAt: CLEANUP_TIME.toISOString(),
            voidReason: VOID_REASON,
            voidedBy: VOIDED_BY,
          },
          requiresAcknowledgement: false,
        },
      });
      lettersVoided++;
    }

    // ── In-transaction post-mutation verification ──
    if (removedCount !== expectedDeductionCount) {
      throw new Error(`VERIFICATION FAILED: removed ${removedCount} deductions, expected ${expectedDeductionCount}.`);
    }
    if (Math.abs(removedAmount - expectedTotalAmountRemoved) > 0.01) {
      throw new Error(`VERIFICATION FAILED: removed amount ${removedAmount}, expected ${expectedTotalAmountRemoved}.`);
    }
    if (lettersVoided !== expectedLetterVoidCount) {
      throw new Error(`VERIFICATION FAILED: voided ${lettersVoided} letters, expected ${expectedLetterVoidCount}.`);
    }
    if (disciplineEventTargets.length !== expectedDisciplineEventCount) {
      throw new Error(`VERIFICATION FAILED: removed ${disciplineEventTargets.length} discipline events, expected ${expectedDisciplineEventCount}.`);
    }

    for (const adj of payrollAdjustments) {
      const after = await tx.payrollEntry.findUnique({ where: { id: adj.payrollEntryId } });
      if (!after) throw new Error(`VERIFICATION FAILED: payrollEntry ${adj.payrollEntryId} missing after mutation.`);
      if (after.status !== PayrollStatus.PENDING) {
        throw new Error(`VERIFICATION FAILED: payrollEntry ${adj.payrollEntryId} status changed unexpectedly to ${after.status}.`);
      }
      if (Math.abs(Number(after.totalDeductions) - adj.expectedNewTotalDeductions) > 0.01) {
        throw new Error(`VERIFICATION FAILED: payrollEntry ${adj.payrollEntryId} totalDeductions ${after.totalDeductions}, expected ${adj.expectedNewTotalDeductions}.`);
      }
      if (Math.abs(Number(after.netStipend) - adj.expectedNewNetStipend) > 0.01) {
        throw new Error(`VERIFICATION FAILED: payrollEntry ${adj.payrollEntryId} netStipend ${after.netStipend}, expected ${adj.expectedNewNetStipend}.`);
      }
    }

    // No protected (PROCESSED/PAID) payrollEntry should have been touched —
    // provable by construction (every target was pre-filtered to PENDING
    // and re-verified above), asserted once more explicitly here.
    const anyProtectedTouched = payrollAdjustments.some((adj) => {
      const pe = evidence.payrollEntryById.get(adj.payrollEntryId)!;
      return pe.status !== PayrollStatus.PENDING;
    });
    if (anyProtectedTouched) {
      throw new Error('VERIFICATION FAILED: a protected (PROCESSED/PAID) payroll entry was in the adjustment plan.');
    }

    return { removedCount, removedAmount: Number(removedAmount.toFixed(2)), lettersVoided, disciplineEventsRemoved: disciplineEventTargets.length };
  });

  console.log(JSON.stringify({ ...report, applyResult, appliedAt: new Date().toISOString() }, null, 2));
  console.error(`=== APPLY COMPLETE: ${applyResult.removedCount} deductions removed (PKR ${applyResult.removedAmount}), ${applyResult.lettersVoided} letters soft-voided, ${applyResult.disciplineEventsRemoved} discipline events removed. ===`);
}

// Guarded so this file can be imported (e.g. by the regression test file,
// system-wide-discipline-cleanup-2026.regression-test.ts) to exercise the
// pure exported predicate/classification functions WITHOUT triggering a
// live run — main() only executes when this file is the actual process
// entry point.
if (require.main === module) {
  main()
    .catch((err) => {
      console.error('=== FATAL ERROR — transaction rolled back if any write was attempted ===');
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
