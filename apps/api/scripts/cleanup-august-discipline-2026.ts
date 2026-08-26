/**
 * PHASE F — August 2026 discipline cleanup: void confirmed-duplicate LATE
 * letters and reverse confirmed-invalid LATE_ARRIVAL deductions.
 *
 * MODES
 *   default (no flags)  -> DRY RUN. Zero writes. Prints the full proposed
 *                          plan as JSON to stdout.
 *   --apply             -> APPLY. Re-verifies every target row against the
 *                          live database immediately before mutating it,
 *                          skips anything whose state has changed, and
 *                          writes ONLY the exact, explicitly-approved
 *                          target set below (letters) or the live
 *                          re-derived classification (deductions, restricted
 *                          to occurrence 3/6/9 only, PENDING payroll only).
 *
 * There is NO implicit apply mode — the flag must be passed exactly as
 * `--apply` on the command line.
 *
 * WHAT THIS SCRIPT NEVER TOUCHES
 *   - Letter 3124/YCDO/2026 (id 15bea6eb-3909-430a-b1a0-d69ae833f3f8) —
 *     Dr Iram's unstructured WARNING, explicitly left for manual review.
 *   - Letter 2855/YCDO/2026 (Shazia) — Missing-Checkout occurrence 2, a
 *     different discipline category entirely, not late-discipline.
 *   - Any PayrollDeduction whose parsed occurrence is not exactly 3, 6, or
 *     9 (this structurally excludes Muammd Tariq's occurrence-12 row and
 *     any other anomalous occurrence value without needing to name it).
 *   - Any PayrollEntry whose status is not PENDING at the moment of apply.
 *   - VALID_OCCURRENCE_3 / VALID_OCCURRENCE_6 deductions (the one genuine
 *     deduction per duplicate group is always kept).
 *
 * Run:
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/cleanup-august-discipline-2026.ts > cleanup-dry-run-report.json
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/cleanup-august-discipline-2026.ts --apply > cleanup-apply-report.json
 */

import {
  AttendanceLogType,
  AttendanceStatus,
  DeductionType,
  PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

const MONTH_START = new Date(Date.UTC(2026, 7, 1, 0, 0, 0, 0));
const MONTH_END = new Date(Date.UTC(2026, 7, 31, 23, 59, 59, 999));

const VOID_REASON = 'DUPLICATE_LATE_DISCIPLINE_RACE_AUGUST_2026';
const VOIDED_BY = 'SYSTEM_CLEANUP_2026_08';

// ─── EXPLICIT, HUMAN-VERIFIED TARGET SET (Section 1) ──────────────────────

type LetterRef = { id: string; letterNo: string };

const CONFIRMED_DUPLICATES: {
  employeeCode: string;
  employeeName: string;
  keep: LetterRef;
  void: LetterRef[];
}[] = [
  {
    employeeCode: 'YCDO-2026-0383',
    employeeName: 'Dr Iram',
    keep: {
      id: '816d1bf3-62a6-4496-9493-e49112960078',
      letterNo: '3079/YCDO/2026',
    },
    void: [
      {
        id: 'c6dd5785-7bea-437d-9995-ee690f1b5729',
        letterNo: '3078/YCDO/2026',
      },
    ],
  },
  {
    employeeCode: 'YCDO-2026-0381',
    employeeName: 'Miss Faiza',
    keep: {
      id: '33ce2bee-5dd8-4ddd-868b-83c000d9355c',
      letterNo: '3076/YCDO/2026',
    },
    void: [
      {
        id: '99f76d4b-a63a-479d-8381-2ebd823113b1',
        letterNo: '3077/YCDO/2026',
      },
    ],
  },
  {
    employeeCode: 'YCDO-2026-0482',
    employeeName: 'Shazia',
    keep: {
      id: 'e49f61db-4db5-4b73-b8cc-d87fbeab5857',
      letterNo: '3196/YCDO/2026',
    },
    void: [
      {
        id: 'c09d2b0d-979c-46dd-af13-5707161522ef',
        letterNo: '3197/YCDO/2026',
      },
      {
        id: 'a197f20b-9890-4b90-a6b1-904a31997fa8',
        letterNo: '3199/YCDO/2026',
      },
    ],
  },
];

// Explicit never-touch assertion set — defense-in-depth even though these
// IDs never appear in CONFIRMED_DUPLICATES.void above.
const NEVER_TOUCH_LETTER_IDS = new Set([
  '15bea6eb-3909-430a-b1a0-d69ae833f3f8', // 3124/YCDO/2026 — Dr Iram, NEEDS_MANUAL_REVIEW
]);
const NEVER_TOUCH_LETTER_NOS = new Set([
  '3124/YCDO/2026',
  '2855/YCDO/2026', // Shazia — Missing-Checkout occurrence 2, different category entirely
]);

// ─── DEDUCTION CLASSIFIER (re-derived live, restricted scope) ─────────────
// Only occurrence 3, 6, or 9 is EVER eligible for automatic action — any
// other occurrence value (e.g. 12) is structurally excluded and always
// reported as MANUAL_REVIEW, with no name-specific exclusion required.

const CURRENT_FORMAT = /Late arrival deduction — monthly occurrence (\d+)/;
const LEGACY_FORMAT = /Late arrival deduction \((\d+) lates? this month\)/;

function parseOccurrence(description: string | null): {
  occurrence: number | null;
  legacyFormat: boolean;
} {
  if (!description) return { occurrence: null, legacyFormat: false };
  const current = description.match(CURRENT_FORMAT);
  if (current) return { occurrence: Number(current[1]), legacyFormat: false };
  const legacy = description.match(LEGACY_FORMAT);
  if (legacy) return { occurrence: Number(legacy[1]), legacyFormat: true };
  return { occurrence: null, legacyFormat: false };
}

type DeductionClassification =
  | 'VALID_OCCURRENCE_3'
  | 'VALID_OCCURRENCE_6'
  | 'INVALID_OCCURRENCE_9'
  | 'DUPLICATE_DEDUCTION'
  | 'NEVER_REACHED_OCCURRENCE'
  | 'MANUAL_REVIEW';

type ClassifiedDeduction = {
  id: string;
  payrollEntryId: string;
  payrollStatus: string;
  employeeCode: string;
  employeeName: string;
  amount: number;
  description: string | null;
  parsedOccurrence: number | null;
  legacyFormat: boolean;
  trueAugustLateIncidentCount: number;
  classification: DeductionClassification;
  reason: string;
  eligibleForAutoReversal: boolean;
};

async function classifyAllAugustLateArrivalDeductions(): Promise<
  ClassifiedDeduction[]
> {
  const payrollEntries = await prisma.payrollEntry.findMany({
    where: { month: 8, year: 2026 },
    select: {
      id: true,
      status: true,
      stipendRecord: {
        select: {
          employeeId: true,
          employee: { select: { employeeCode: true, fullName: true } },
        },
      },
      deductions: {
        where: { reason: DeductionType.LATE_ARRIVAL },
        select: { id: true, amount: true, description: true },
      },
    },
  });

  const results: ClassifiedDeduction[] = [];

  for (const entry of payrollEntries.filter((pe) => pe.deductions.length > 0)) {
    const employeeId = entry.stipendRecord.employeeId;
    const employee = entry.stipendRecord.employee;

    const trueLateIncidents = await prisma.attendanceLog.findMany({
      where: {
        employeeId,
        type: AttendanceLogType.REGULAR,
        date: { gte: MONTH_START, lte: MONTH_END },
        OR: [
          { status: AttendanceStatus.LATE },
          {
            status: AttendanceStatus.HALF_DAY,
            lateMinutes: { gt: 0 },
            NOT: { note: { contains: 'short leave', mode: 'insensitive' } },
          },
        ],
      },
      select: { date: true },
    });
    const trueCount = trueLateIncidents.length;

    const parsed = entry.deductions.map((d) => ({
      ...d,
      amount: Number(d.amount),
      ...parseOccurrence(d.description),
    }));

    const seenValidOccurrences = new Set<number>();
    for (const d of [...parsed].sort(
      (a, b) => (a.occurrence ?? 0) - (b.occurrence ?? 0),
    )) {
      let classification: DeductionClassification;
      let reason: string;
      let eligibleForAutoReversal = false;

      if (d.occurrence === null) {
        classification = 'MANUAL_REVIEW';
        reason = `Description "${d.description ?? '(none)'}" does not match a known format — cannot parse occurrence.`;
      } else if (
        d.occurrence !== 3 &&
        d.occurrence !== 6 &&
        d.occurrence !== 9
      ) {
        // Structural exclusion — covers occurrence 12 (Muammd Tariq) and any
        // other anomalous value, with no name-specific logic required.
        classification = 'MANUAL_REVIEW';
        reason = `Occurrence ${d.occurrence} is outside the defined Fine-cycle points (3, 6) and the invalid-9 case — never auto-reversed, always manual review regardless of amount.`;
      } else if (seenValidOccurrences.has(d.occurrence)) {
        classification = 'DUPLICATE_DEDUCTION';
        reason = `Occurrence ${d.occurrence} already has a canonical deduction for this employee this month — this is an extra duplicate row.`;
        eligibleForAutoReversal = true;
      } else if (d.occurrence === 9) {
        classification = 'INVALID_OCCURRENCE_9';
        reason = `Occurrence 9 must be SUSPENSION only, never a deduction (fixed in commit 76deef6) — this row predates that fix. Legacy description format: ${d.legacyFormat}.`;
        eligibleForAutoReversal = true;
        seenValidOccurrences.add(d.occurrence);
      } else if (d.occurrence > trueCount) {
        classification = 'NEVER_REACHED_OCCURRENCE';
        reason = `Claims occurrence ${d.occurrence} but employee has only ${trueCount} true recomputed August late incident(s) — this occurrence was never genuinely reached.`;
        eligibleForAutoReversal = true;
        seenValidOccurrences.add(d.occurrence);
      } else {
        classification =
          d.occurrence === 3 ? 'VALID_OCCURRENCE_3' : 'VALID_OCCURRENCE_6';
        reason = `Genuine Fine-cycle deduction; employee has ${trueCount} true late incident(s) this month (>= ${d.occurrence}). KEPT.`;
        seenValidOccurrences.add(d.occurrence);
      }

      results.push({
        id: d.id,
        payrollEntryId: entry.id,
        payrollStatus: entry.status,
        employeeCode: employee.employeeCode,
        employeeName: employee.fullName,
        amount: d.amount,
        description: d.description,
        parsedOccurrence: d.occurrence,
        legacyFormat: d.legacyFormat,
        trueAugustLateIncidentCount: trueCount,
        classification,
        reason,
        eligibleForAutoReversal,
      });
    }
  }

  return results;
}

// ─── DEDUCTION MUTATION PLAN (dry-run + apply share this builder) ─────────
// Single source of truth for "which PayrollDeduction rows get removed, from
// which PayrollEntry, and what that entry's totals become afterward" — both
// the dry-run report and --apply's actual mutation loop consume this same
// plan, so reporting cannot diverge from what apply would actually do.

type PayrollMutationGroup = {
  payrollEntryId: string;
  employeeCode: string;
  employeeName: string;
  status: string;
  deductionIdsToRemove: string[];
  deductionCount: number;
  reversalAmount: number;
  beforeTotalDeductions: number;
  afterTotalDeductions: number;
  beforeNetStipend: number;
  afterNetStipend: number;
  targets: ClassifiedDeduction[];
};

type DeductionReversalDetail = {
  id: string;
  payrollEntryId: string;
  employeeCode: string;
  employeeName: string;
  payrollStatus: string;
  amount: number;
  reason: string;
  description: string | null;
  parsedOccurrence: number | null;
  trueAugustLateIncidentCount: number;
  classification: DeductionClassification;
  before: {
    deduction: {
      id: string;
      amount: number;
      reason: string;
      description: string | null;
    };
    payrollEntry: {
      totalDeductions: number;
      netStipend: number;
      status: string;
    };
  };
  after: {
    deductionExists: false;
    payrollEntry: {
      totalDeductions: number;
      netStipend: number;
      status: string;
    };
  };
  mutationReason: string;
};

/**
 * Builds one group per affected PayrollEntry, re-reading its LIVE
 * totalDeductions/netStipend/status (independent of the classifier's cached
 * status) so before/after figures reflect the database at plan-build time —
 * apply mode re-verifies again per-row immediately before mutating, this is
 * the reporting/target-selection layer, not the final safety check.
 */
async function buildDeductionPlan(
  eligibleAndPending: ClassifiedDeduction[],
): Promise<{
  payrollMutationPlan: PayrollMutationGroup[];
  deductionsToReverse: DeductionReversalDetail[];
}> {
  const payrollEntryIds = [
    ...new Set(eligibleAndPending.map((d) => d.payrollEntryId)),
  ];
  const payrollMutationPlan: PayrollMutationGroup[] = [];
  const deductionsToReverse: DeductionReversalDetail[] = [];

  for (const payrollEntryId of payrollEntryIds) {
    const targets = eligibleAndPending.filter(
      (d) => d.payrollEntryId === payrollEntryId,
    );
    const entry = await prisma.payrollEntry.findUnique({
      where: { id: payrollEntryId },
    });
    if (!entry) {
      // Reported via blockedByPayrollStatus-equivalent path in main() — the
      // group is simply omitted from the plan; apply mode will independently
      // re-discover this as SKIPPED_PAYROLL_ENTRY_NOT_FOUND if it recurs.
      continue;
    }

    const beforeTotalDeductions = Number(entry.totalDeductions);
    const beforeNetStipend = Number(entry.netStipend);
    const reversalAmount =
      Math.round(targets.reduce((sum, t) => sum + t.amount, 0) * 100) / 100;
    const afterTotalDeductions =
      Math.round((beforeTotalDeductions - reversalAmount) * 100) / 100;
    const afterNetStipend =
      Math.round((beforeNetStipend + reversalAmount) * 100) / 100;

    payrollMutationPlan.push({
      payrollEntryId,
      employeeCode: targets[0].employeeCode,
      employeeName: targets[0].employeeName,
      status: entry.status,
      deductionIdsToRemove: targets.map((t) => t.id),
      deductionCount: targets.length,
      reversalAmount,
      beforeTotalDeductions,
      afterTotalDeductions,
      beforeNetStipend,
      afterNetStipend,
      targets,
    });

    // IMPORTANT: every deduction in this same payroll entry shares the SAME
    // after.payrollEntry — the final planned state once ALL targeted
    // deductions for this entry are removed, not a running/partial total.
    for (const t of targets) {
      deductionsToReverse.push({
        id: t.id,
        payrollEntryId,
        employeeCode: t.employeeCode,
        employeeName: t.employeeName,
        payrollStatus: t.payrollStatus,
        amount: t.amount,
        reason: t.reason,
        description: t.description,
        parsedOccurrence: t.parsedOccurrence,
        trueAugustLateIncidentCount: t.trueAugustLateIncidentCount,
        classification: t.classification,
        before: {
          deduction: {
            id: t.id,
            amount: t.amount,
            reason: DeductionType.LATE_ARRIVAL,
            description: t.description,
          },
          payrollEntry: {
            totalDeductions: beforeTotalDeductions,
            netStipend: beforeNetStipend,
            status: entry.status,
          },
        },
        after: {
          deductionExists: false,
          payrollEntry: {
            totalDeductions: afterTotalDeductions,
            netStipend: afterNetStipend,
            status: entry.status,
          },
        },
        mutationReason: t.classification,
      });
    }
  }

  return { payrollMutationPlan, deductionsToReverse };
}

// ─── INVARIANT CHECKS (must ALL be true for READY) ─────────────────────────

function computeInvariants(input: {
  deductionsToReverse: DeductionReversalDetail[];
  deductionsToReverseCount: number;
  deductionsToReverseAmount: number;
  byClassification: Record<string, { count: number; totalAmount: number }>;
  payrollMutationPlan: PayrollMutationGroup[];
}): Record<string, boolean> {
  const {
    deductionsToReverse,
    deductionsToReverseCount,
    deductionsToReverseAmount,
    byClassification,
    payrollMutationPlan,
  } = input;

  const detailAmountSum =
    Math.round(deductionsToReverse.reduce((s, d) => s + d.amount, 0) * 100) /
    100;

  const classificationCountsMatchSummary = Object.entries(
    byClassification,
  ).every(([classification, summary]) => {
    const detailForClass = deductionsToReverse.filter(
      (d) => d.classification === classification,
    );
    const detailAmount =
      Math.round(detailForClass.reduce((s, d) => s + d.amount, 0) * 100) / 100;
    return (
      detailForClass.length === summary.count &&
      detailAmount === summary.totalAmount
    );
  });

  const noProcessedOrPaidTargets = deductionsToReverse.every(
    (d) => d.payrollStatus === 'PENDING',
  );
  const noOccurrence12AutoTargets = deductionsToReverse.every(
    (d) =>
      d.parsedOccurrence === 3 ||
      d.parsedOccurrence === 6 ||
      d.parsedOccurrence === 9,
  );

  const payrollEntryMathValid = payrollMutationPlan.every((g) => {
    const expectedAfterDeductions =
      Math.round((g.beforeTotalDeductions - g.reversalAmount) * 100) / 100;
    const expectedAfterNet =
      Math.round((g.beforeNetStipend + g.reversalAmount) * 100) / 100;
    return (
      g.afterTotalDeductions === expectedAfterDeductions &&
      g.afterNetStipend === expectedAfterNet
    );
  });

  const noNegativeTotalDeductions = payrollMutationPlan.every(
    (g) => g.afterTotalDeductions >= 0,
  );

  const ids = deductionsToReverse.map((d) => d.id);
  const uniqueTargetDeductionIds = new Set(ids).size === ids.length;

  return {
    deductionDetailCountMatchesSummary:
      deductionsToReverse.length === deductionsToReverseCount,
    deductionDetailAmountMatchesSummary:
      detailAmountSum === deductionsToReverseAmount,
    classificationCountsMatchSummary,
    noProcessedOrPaidTargets,
    noOccurrence12AutoTargets,
    payrollEntryMathValid,
    noNegativeTotalDeductions,
    uniqueTargetDeductionIds,
  };
}

// ─── LETTER VOID PLAN (dry-run + apply share this builder) ────────────────

async function buildLetterPlan() {
  const lettersToKeep: unknown[] = [];
  const lettersToVoid: unknown[] = [];
  const problems: unknown[] = [];

  for (const group of CONFIRMED_DUPLICATES) {
    const employee = await prisma.employee.findUnique({
      where: { employeeCode: group.employeeCode },
      select: { id: true, employeeCode: true, fullName: true },
    });
    if (!employee) {
      problems.push({
        employeeCode: group.employeeCode,
        problem: 'EMPLOYEE_NOT_FOUND',
      });
      continue;
    }

    const keepLetter = await prisma.letter.findUnique({
      where: { id: group.keep.id },
    });
    if (!keepLetter) {
      problems.push({
        employeeCode: group.employeeCode,
        letterId: group.keep.id,
        problem: 'KEEP_LETTER_NOT_FOUND',
      });
    } else if (
      keepLetter.letterNo !== group.keep.letterNo ||
      keepLetter.employeeId !== employee.id
    ) {
      problems.push({
        employeeCode: group.employeeCode,
        letterId: group.keep.id,
        problem: 'KEEP_LETTER_MISMATCH',
        expected: group.keep,
        actual: {
          letterNo: keepLetter.letterNo,
          employeeId: keepLetter.employeeId,
        },
      });
    } else {
      lettersToKeep.push({
        employeeCode: group.employeeCode,
        employeeName: group.employeeName,
        id: keepLetter.id,
        letterNo: keepLetter.letterNo,
        generatedAt: keepLetter.generatedAt.toISOString(),
      });
    }

    for (const target of group.void) {
      if (
        NEVER_TOUCH_LETTER_IDS.has(target.id) ||
        NEVER_TOUCH_LETTER_NOS.has(target.letterNo)
      ) {
        // Cannot happen given the hardcoded list above, but this is the
        // hard safety backstop the instructions require — abort rather
        // than silently proceed if it ever did.
        throw new Error(
          `REFUSING TO PROCEED: ${target.letterNo} is on the never-touch list but appeared in a void target.`,
        );
      }

      const letter = await prisma.letter.findUnique({
        where: { id: target.id },
      });
      if (!letter) {
        problems.push({
          employeeCode: group.employeeCode,
          letterId: target.id,
          problem: 'VOID_LETTER_NOT_FOUND',
        });
        continue;
      }
      if (
        letter.letterNo !== target.letterNo ||
        letter.employeeId !== employee.id
      ) {
        problems.push({
          employeeCode: group.employeeCode,
          letterId: target.id,
          problem: 'VOID_LETTER_MISMATCH',
          expected: target,
          actual: { letterNo: letter.letterNo, employeeId: letter.employeeId },
        });
        continue;
      }

      const currentVars = (letter.variables ?? {}) as Record<string, unknown>;
      const alreadyVoided = currentVars.voided === true;

      const afterVars = {
        ...currentVars,
        voided: true,
        voidedAt: new Date().toISOString(),
        voidedReason: VOID_REASON,
        voidedBy: VOIDED_BY,
      };

      lettersToVoid.push({
        employeeCode: group.employeeCode,
        employeeName: group.employeeName,
        id: letter.id,
        letterNo: letter.letterNo,
        alreadyVoided,
        acknowledged: false, // filled below for real via a second query in dry-run detail if needed
        before: {
          variables: currentVars,
          requiresAcknowledgement: letter.requiresAcknowledgement,
        },
        after: alreadyVoided
          ? {
              note: 'ALREADY_VOIDED — apply mode will SKIP this row, no write.',
            }
          : {
              variables: afterVars,
              // Uses the EXISTING requiresAcknowledgement/acknowledgement=null
              // filter that Portal's getPendingAcknowledgements already
              // queries (acknowledgements.service.ts) — no new filtering
              // logic, no frontend change. See report item 5.
              requiresAcknowledgement: false,
            },
        reason: VOID_REASON,
      });
    }
  }

  return { lettersToKeep, lettersToVoid, problems };
}

async function main() {
  console.error(
    `=== PHASE F cleanup — mode: ${APPLY ? 'APPLY' : 'DRY RUN'} ===`,
  );
  if (APPLY) {
    console.error('!!! APPLY MODE — this WILL write to the database !!!');
  }

  const {
    lettersToKeep,
    lettersToVoid,
    problems: letterProblems,
  } = await buildLetterPlan();
  const allDeductions = await classifyAllAugustLateArrivalDeductions();

  const manualReviewLetters = [
    {
      letterNo: '3124/YCDO/2026',
      id: '15bea6eb-3909-430a-b1a0-d69ae833f3f8',
      employeeCode: 'YCDO-2026-0383',
      classification: 'NEEDS_MANUAL_REVIEW',
      reason:
        'Legacy/unstructured WARNING — content references a 10-minute late arrival; employee has only 1 true August late incident; no structured incidentDate/monthlyLateOccurrence in variables. Left untouched.',
    },
  ];

  const eligibleDeductions = allDeductions.filter(
    (d) => d.eligibleForAutoReversal,
  );
  const manualReviewDeductions = allDeductions.filter(
    (d) => !d.eligibleForAutoReversal && d.classification === 'MANUAL_REVIEW',
  );
  const keptDeductions = allDeductions.filter(
    (d) =>
      d.classification === 'VALID_OCCURRENCE_3' ||
      d.classification === 'VALID_OCCURRENCE_6',
  );

  const byClassification: Record<
    string,
    { count: number; totalAmount: number }
  > = {};
  for (const d of eligibleDeductions) {
    const c = (byClassification[d.classification] ??= {
      count: 0,
      totalAmount: 0,
    });
    c.count += 1;
    c.totalAmount = Math.round((c.totalAmount + d.amount) * 100) / 100;
  }

  const blockedByPayrollStatus = eligibleDeductions.filter(
    (d) => d.payrollStatus !== 'PENDING',
  );
  const eligibleAndPending = eligibleDeductions.filter(
    (d) => d.payrollStatus === 'PENDING',
  );

  const deductionsToReverseCount = eligibleAndPending.length;
  const deductionsToReverseAmount =
    Math.round(eligibleAndPending.reduce((sum, d) => sum + d.amount, 0) * 100) /
    100;

  // Single shared plan — both the dry-run report below AND the --apply
  // mutation loop iterate this exact same structure, so reporting cannot
  // diverge from what apply actually does.
  const { payrollMutationPlan, deductionsToReverse } =
    await buildDeductionPlan(eligibleAndPending);
  const payrollEntriesAffected = payrollMutationPlan.map(
    (g) => g.payrollEntryId,
  );

  const invariants = computeInvariants({
    deductionsToReverse,
    deductionsToReverseCount,
    deductionsToReverseAmount,
    byClassification,
    payrollMutationPlan,
  });
  const allInvariantsTrue = Object.values(invariants).every(Boolean);

  const applyResults: unknown[] = [];

  if (APPLY) {
    // ── Letters ──
    for (const group of CONFIRMED_DUPLICATES) {
      const employee = await prisma.employee.findUnique({
        where: { employeeCode: group.employeeCode },
      });
      if (!employee) {
        applyResults.push({
          type: 'LETTER',
          employeeCode: group.employeeCode,
          result: 'SKIPPED_EMPLOYEE_NOT_FOUND',
        });
        continue;
      }
      for (const target of group.void) {
        if (
          NEVER_TOUCH_LETTER_IDS.has(target.id) ||
          NEVER_TOUCH_LETTER_NOS.has(target.letterNo)
        ) {
          throw new Error(
            `REFUSING TO APPLY: ${target.letterNo} is on the never-touch list.`,
          );
        }
        const letter = await prisma.letter.findUnique({
          where: { id: target.id },
        });
        if (
          !letter ||
          letter.letterNo !== target.letterNo ||
          letter.employeeId !== employee.id
        ) {
          applyResults.push({
            type: 'LETTER',
            id: target.id,
            letterNo: target.letterNo,
            result: 'SKIPPED_SOURCE_MISMATCH',
          });
          continue;
        }
        const currentVars = (letter.variables ?? {}) as Record<string, unknown>;
        if (currentVars.voided === true) {
          applyResults.push({
            type: 'LETTER',
            id: target.id,
            letterNo: target.letterNo,
            result: 'SKIPPED_ALREADY_VOIDED',
          });
          continue;
        }
        await prisma.letter.update({
          where: { id: target.id },
          data: {
            variables: {
              ...currentVars,
              voided: true,
              voidedAt: new Date().toISOString(),
              voidedReason: VOID_REASON,
              voidedBy: VOIDED_BY,
            },
            requiresAcknowledgement: false,
          },
        });
        applyResults.push({
          type: 'LETTER',
          id: target.id,
          letterNo: target.letterNo,
          result: 'VOIDED',
        });
      }
    }

    // ── Deductions — one transaction per affected PayrollEntry, sourced
    // from the SAME payrollMutationPlan the dry-run report above was built
    // from — never a separately recomputed target list. ──
    for (const group of payrollMutationPlan) {
      const payrollEntryId = group.payrollEntryId;
      const targets = group.targets;
      await prisma.$transaction(async (tx) => {
        const entry = await tx.payrollEntry.findUnique({
          where: { id: payrollEntryId },
        });
        if (!entry) {
          for (const t of targets)
            applyResults.push({
              type: 'DEDUCTION',
              id: t.id,
              result: 'SKIPPED_PAYROLL_ENTRY_NOT_FOUND',
            });
          return;
        }
        if (entry.status !== 'PENDING') {
          for (const t of targets)
            applyResults.push({
              type: 'DEDUCTION',
              id: t.id,
              result: 'BLOCKED_BY_PAYROLL_STATUS',
              payrollStatus: entry.status,
            });
          return;
        }

        let totalToDecrement = 0;
        for (const t of targets) {
          const deduction = await tx.payrollDeduction.findUnique({
            where: { id: t.id },
          });
          if (!deduction) {
            applyResults.push({
              type: 'DEDUCTION',
              id: t.id,
              result: 'SKIPPED_NOT_FOUND',
            });
            continue;
          }
          if (
            deduction.reason !== DeductionType.LATE_ARRIVAL ||
            deduction.description !== t.description ||
            Number(deduction.amount) !== t.amount
          ) {
            applyResults.push({
              type: 'DEDUCTION',
              id: t.id,
              result: 'SKIPPED_SOURCE_MISMATCH',
            });
            continue;
          }
          await tx.payrollDeduction.delete({ where: { id: t.id } });
          totalToDecrement += Number(deduction.amount);
          applyResults.push({
            type: 'DEDUCTION',
            id: t.id,
            result: 'REVERSED',
            amount: Number(deduction.amount),
            classification: t.classification,
          });
        }

        if (totalToDecrement > 0) {
          await tx.payrollEntry.update({
            where: { id: payrollEntryId },
            data: {
              totalDeductions: { decrement: totalToDecrement },
              netStipend: { increment: totalToDecrement },
            },
          });
        }
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? 'APPLY' : 'DRY_RUN',
    lettersToKeep,
    lettersToVoid,
    lettersManualReview: manualReviewLetters,
    letterProblems,
    deductionsToReverseCount,
    deductionsToReverseAmount,
    deductionsByClassification: byClassification,
    deductionsToReverse,
    payrollMutationPlan,
    manualReviewDeductions,
    keptDeductions,
    blockedByPayrollStatus,
    payrollEntriesAffected,
    invariants,
    allInvariantsTrue,
    ...(APPLY ? { applyResults } : {}),
  };

  console.log(JSON.stringify(report, null, 2));
  console.error(
    `=== DONE (${APPLY ? 'APPLY — writes performed as listed above' : 'DRY RUN — zero writes performed'}) ===`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
