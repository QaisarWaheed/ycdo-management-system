/* eslint-disable no-console */
/**
 * READ-ONLY — Phase D: granular classification of every August LATE_ARRIVAL
 * PayrollDeduction, system-wide. Does NOT assume all flagged deductions are
 * wrongful — classifies each one individually against current policy
 * (occurrence 3/6 -> valid deduction, occurrence 9 -> invalid — see the
 * pre-76deef6 legacy bug) and against the employee's true recomputed
 * August late-incident count.
 *
 * Zero writes. Only reads PayrollEntry, PayrollDeduction, StipendRecord,
 * AttendanceLog, Employee rows.
 *
 * Run:
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/phase-d-classify-deductions.ts > phase-d-report.json
 */

import { AttendanceLogType, AttendanceStatus, DeductionType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MONTH_START = new Date(Date.UTC(2026, 7, 1, 0, 0, 0, 0));
const MONTH_END = new Date(Date.UTC(2026, 7, 31, 23, 59, 59, 999));

type Classification =
  | 'VALID_OCCURRENCE_3'
  | 'VALID_OCCURRENCE_6'
  | 'INVALID_OCCURRENCE_9'
  | 'DUPLICATE_DEDUCTION'
  | 'DEDUCTION_BEFORE_OCCURRENCE_3'
  | 'UNVERIFIABLE_LEGACY'
  | 'OTHER';

/** Current format (post-76deef6): "Late arrival deduction — monthly occurrence N" */
const CURRENT_FORMAT = /Late arrival deduction — monthly occurrence (\d+)/;
/** Legacy format (pre-76deef6, buggy: applied to 3, 6, AND 9): "Late arrival deduction (N lates this month)" */
const LEGACY_FORMAT = /Late arrival deduction \((\d+) lates? this month\)/;

function parseOccurrence(description: string | null): { occurrence: number | null; legacyFormat: boolean } {
  if (!description) return { occurrence: null, legacyFormat: false };
  const current = description.match(CURRENT_FORMAT);
  if (current) return { occurrence: Number(current[1]), legacyFormat: false };
  const legacy = description.match(LEGACY_FORMAT);
  if (legacy) return { occurrence: Number(legacy[1]), legacyFormat: true };
  return { occurrence: null, legacyFormat: false };
}

async function main() {
  console.error('=== READ-ONLY: Phase D — August LATE_ARRIVAL deduction classification ===');

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

  const entriesWithDeductions = payrollEntries.filter((pe) => pe.deductions.length > 0);
  console.error(`Payroll entries (Aug 2026) with >=1 LATE_ARRIVAL deduction: ${entriesWithDeductions.length}`);

  const results: {
    employeeCode: string;
    employeeName: string;
    payrollEntryId: string;
    payrollStatus: string;
    deductionId: string;
    amount: number;
    description: string | null;
    parsedOccurrence: number | null;
    legacyDescriptionFormat: boolean;
    trueAugustLateIncidentCount: number;
    classification: Classification;
    reason: string;
  }[] = [];

  for (const entry of entriesWithDeductions) {
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

    // Parse every deduction's claimed occurrence, then classify in
    // ascending-occurrence order so DUPLICATE_DEDUCTION can be detected
    // relative to an already-seen valid occurrence for this employee.
    const parsed = entry.deductions.map((d) => ({
      ...d,
      amount: Number(d.amount),
      ...parseOccurrence(d.description),
    }));

    const seenOccurrences = new Set<number>();
    for (const d of parsed.sort((a, b) => (a.occurrence ?? 0) - (b.occurrence ?? 0))) {
      let classification: Classification;
      let reason: string;

      if (d.occurrence === null) {
        classification = 'UNVERIFIABLE_LEGACY';
        reason = `Description "${d.description ?? '(none)'}" does not match either the current or legacy known formats — occurrence cannot be parsed.`;
      } else if (seenOccurrences.has(d.occurrence)) {
        classification = 'DUPLICATE_DEDUCTION';
        reason = `A deduction for occurrence ${d.occurrence} was already classified for this employee this month — this is an additional deduction for the same occurrence.`;
      } else if (d.occurrence === 9) {
        classification = 'INVALID_OCCURRENCE_9';
        reason = `Occurrence 9 must produce SUSPENSION only, never a deduction (current code, since commit 76deef6, already enforces this correctly — this row predates that fix). Legacy description format: ${d.legacyFormat}.`;
      } else if (d.occurrence === 3) {
        if (d.occurrence > trueCount) {
          classification = 'OTHER';
          reason = `Claims occurrence 3 but employee has only ${trueCount} true recomputed late incident(s) this month — occurrence was never genuinely reached.`;
        } else {
          classification = 'VALID_OCCURRENCE_3';
          reason = `Occurrence 3 is a genuine Fine-cycle deduction point; employee has ${trueCount} true late incident(s) this month (>= 3).`;
        }
      } else if (d.occurrence === 6) {
        if (d.occurrence > trueCount) {
          classification = 'OTHER';
          reason = `Claims occurrence 6 but employee has only ${trueCount} true recomputed late incident(s) this month — occurrence was never genuinely reached.`;
        } else {
          classification = 'VALID_OCCURRENCE_6';
          reason = `Occurrence 6 is a genuine Fine-cycle deduction point; employee has ${trueCount} true late incident(s) this month (>= 6).`;
        }
      } else if (d.occurrence < 3) {
        classification = 'DEDUCTION_BEFORE_OCCURRENCE_3';
        reason = `Occurrence ${d.occurrence} is below the first Fine-cycle point (3) — no deduction should exist yet at this occurrence under current or legacy-intended policy.`;
      } else {
        // occurrence 1,2,4,5,7,8 already handled above (< 3 or explicit
        // 3/6/9); anything else (should not occur) falls through here.
        classification = 'OTHER';
        reason = `Occurrence ${d.occurrence} does not correspond to a Fine-cycle deduction point (3, 6) or the invalid 9 — needs manual review.`;
      }

      if (classification !== 'UNVERIFIABLE_LEGACY' && d.occurrence !== null) {
        seenOccurrences.add(d.occurrence);
      }

      results.push({
        employeeCode: employee.employeeCode,
        employeeName: employee.fullName,
        payrollEntryId: entry.id,
        payrollStatus: entry.status,
        deductionId: d.id,
        amount: d.amount,
        description: d.description,
        parsedOccurrence: d.occurrence,
        legacyDescriptionFormat: d.legacyFormat,
        trueAugustLateIncidentCount: trueCount,
        classification,
        reason,
      });
    }
  }

  const summary = {
    totalDeductionsClassified: results.length,
    byClassification: {} as Record<string, { count: number; totalAmount: number }>,
    byPayrollStatus: {} as Record<string, { count: number; totalAmount: number }>,
  };

  for (const r of results) {
    const c = (summary.byClassification[r.classification] ??= { count: 0, totalAmount: 0 });
    c.count += 1;
    c.totalAmount = Math.round((c.totalAmount + r.amount) * 100) / 100;

    const s = (summary.byPayrollStatus[r.payrollStatus] ??= { count: 0, totalAmount: 0 });
    s.count += 1;
    s.totalAmount = Math.round((s.totalAmount + r.amount) * 100) / 100;
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), readOnly: true, summary, deductions: results }, null, 2));
  console.error('=== DONE (read-only — no data was modified) ===');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
