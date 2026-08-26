/* eslint-disable no-console */
/**
 * READ-ONLY AUDIT — August 2026 late-discipline duplicate/sequence/deduction
 * investigation, system-wide (ALL employees).
 *
 * This script performs ZERO writes. It contains no create/update/delete/
 * upsert call anywhere. It only reads AttendanceLog, Letter, PayrollEntry,
 * PayrollDeduction, and Employee rows and cross-references them.
 *
 * "True late incident" is defined identically to how
 * discipline.helper.ts's own applyLateDiscipline() counts occurrences
 * (see its `priorLateDays` query) — status LATE, or status HALF_DAY with
 * lateMinutes > 0 and a note that does not mention "short leave". This
 * means SHORT_LEAVE-status rows, Short-Leave-reversed HALF_DAY rows, and
 * any row that was corrected away from LATE/HALF_DAY are automatically
 * excluded, because the query only reads each row's CURRENT status.
 *
 * Run against a database connection pointed at PRODUCTION (or, more safely,
 * a read replica / restored backup):
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/audit-late-discipline-august-2026.ts
 *
 * Optionally redirect to a file for easier review:
 *   ... > audit-report.json
 */

import { PrismaClient, AttendanceLogType, AttendanceStatus, LetterType } from '@prisma/client';

const prisma = new PrismaClient();

const MONTH_START = new Date(Date.UTC(2026, 7, 1, 0, 0, 0, 0));
const MONTH_END = new Date(Date.UTC(2026, 7, 31, 23, 59, 59, 999));

const LATE_LETTER_TYPES: LetterType[] = [
  LetterType.ADVICE,
  LetterType.WARNING,
  LetterType.FINE,
  LetterType.SUSPENSION,
];

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Mirrors discipline.helper.ts's own positionInCycle/lateCount === 9 logic exactly. */
function expectedLetterTypeForOccurrence(occurrence: number): LetterType {
  if (occurrence === 9) return LetterType.SUSPENSION;
  const positionInCycle = ((occurrence - 1) % 3) + 1;
  if (positionInCycle === 1) return LetterType.ADVICE;
  if (positionInCycle === 2) return LetterType.WARNING;
  return LetterType.FINE;
}

type IncidentReport = {
  date: string;
  attendanceLogId: string;
  status: string;
  checkIn: string | null;
  lateMinutes: number;
  dutyStartTimeSnapshot: string | null;
  dutyEndTimeSnapshot: string | null;
};

type LetterReport = {
  id: string;
  referenceNumber: string | null;
  type: string;
  createdAt: string;
  incidentDate: string | null;
  monthlyLateOccurrence: number | null;
  reversed: boolean;
  acknowledged: boolean;
};

type Flag = {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branch: string;
  kind: string;
  detail: string;
};

async function main() {
  // Progress/status messages go to stderr, never stdout — stdout carries
  // ONLY the final JSON report, so `node audit.js > audit-report.json`
  // produces a strictly valid, parseable JSON file with nothing else in it.
  console.error('=== READ-ONLY AUDIT: August 2026 Late Discipline (system-wide) ===');
  console.error('(No writes performed by this script.)');

  // ── 1. Every genuine late-driven AttendanceLog row in August, ALL employees ──
  const lateLogs = await prisma.attendanceLog.findMany({
    where: {
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
    select: {
      id: true,
      employeeId: true,
      date: true,
      status: true,
      checkIn: true,
      lateMinutes: true,
      note: true,
      dutyStartTimeSnapshot: true,
      dutyEndTimeSnapshot: true,
      employee: {
        select: {
          employeeCode: true,
          fullName: true,
          currentBranch: { select: { name: true } },
        },
      },
    },
    orderBy: [{ employeeId: 'asc' }, { date: 'asc' }],
  });

  const employeeIds = [...new Set(lateLogs.map((l) => l.employeeId))];
  console.error(`Employees with >=1 true late incident in August: ${employeeIds.length}`);

  // ── 2. Every LATE-category discipline letter generated in August for these employees ──
  const letters = employeeIds.length
    ? await prisma.letter.findMany({
        where: {
          employeeId: { in: employeeIds },
          letterType: { in: LATE_LETTER_TYPES },
          generatedAt: { gte: MONTH_START, lte: MONTH_END },
        },
        select: {
          id: true,
          employeeId: true,
          letterType: true,
          letterNo: true,
          generatedAt: true,
          variables: true,
          acknowledgement: { select: { id: true } },
        },
        orderBy: [{ employeeId: 'asc' }, { generatedAt: 'asc' }],
      })
    : [];
  console.error(`Late-category letters (ADVICE/WARNING/FINE/SUSPENSION) generated in August: ${letters.length}`);

  // ── 3. August payroll LATE_ARRIVAL deductions for these employees ──
  const payrollEntries = employeeIds.length
    ? await prisma.payrollEntry.findMany({
        where: {
          month: 8,
          year: 2026,
          stipendRecord: { employeeId: { in: employeeIds } },
        },
        select: {
          id: true,
          status: true,
          stipendRecord: { select: { employeeId: true } },
          deductions: {
            where: { reason: 'LATE_ARRIVAL' },
            select: { id: true, amount: true, description: true },
          },
        },
      })
    : [];

  // ── Per-employee cross-reference ──────────────────────────────────────
  const perEmployeeReport: Record<string, unknown> = {};
  const duplicateFlags: Flag[] = [];
  const sequenceFlags: Flag[] = [];
  const deductionFlags: Flag[] = [];
  const dutySnapshotFlags: Flag[] = [];

  let totalDuplicateLetters = 0;
  let totalInvalidWarnings = 0;
  let totalInvalidFines = 0;
  let totalInvalidSuspensions = 0;
  let totalQuestionableDeductionCount = 0;
  let totalQuestionableDeductionAmount = 0;

  const branchImpact = new Map<string, number>();
  const letterTypeImpact = new Map<string, number>();
  const occurrenceImpact = new Map<number, number>();

  for (const employeeId of employeeIds) {
    const empLogs = lateLogs.filter((l) => l.employeeId === employeeId);
    const emp = empLogs[0].employee;
    const branchName = emp.currentBranch?.name ?? 'UNKNOWN';
    const empLetters = letters.filter((l) => l.employeeId === employeeId);

    const incidents: IncidentReport[] = empLogs.map((l) => ({
      date: dateKey(l.date),
      attendanceLogId: l.id,
      status: l.status,
      checkIn: l.checkIn ? l.checkIn.toISOString() : null,
      lateMinutes: l.lateMinutes,
      dutyStartTimeSnapshot: l.dutyStartTimeSnapshot,
      dutyEndTimeSnapshot: l.dutyEndTimeSnapshot,
    }));

    // Occurrence numbers recomputed independently from the AttendanceLog
    // rows themselves (date order), never trusted from a stored letter.
    const expectedByDate = new Map<string, number>();
    incidents.forEach((inc, idx) => expectedByDate.set(inc.date, idx + 1));

    const letterReports: LetterReport[] = empLetters.map((l) => {
      const vars = (l.variables ?? {}) as {
        monthlyLateOccurrence?: number;
        incidentDate?: string;
        reversedDueToShortLeave?: boolean;
      };
      return {
        id: l.id,
        referenceNumber: l.letterNo,
        type: l.letterType,
        createdAt: l.generatedAt.toISOString(),
        incidentDate: vars.incidentDate ?? null,
        monthlyLateOccurrence: vars.monthlyLateOccurrence ?? null,
        reversed: !!vars.reversedDueToShortLeave,
        acknowledged: !!l.acknowledgement,
      };
    });

    // ── Duplicate detection: >1 ACTIVE letter for the same
    //    incidentDate + monthlyLateOccurrence key.
    const activeByKey = new Map<string, LetterReport[]>();
    for (const lr of letterReports) {
      if (lr.reversed) continue;
      if (lr.incidentDate == null || lr.monthlyLateOccurrence == null) {
        duplicateFlags.push({
          employeeId,
          employeeCode: emp.employeeCode,
          employeeName: emp.fullName,
          branch: branchName,
          kind: 'UNLINKED_LETTER_NEEDS_MANUAL_REVIEW',
          detail: `Letter ${lr.id} (${lr.type}, ${lr.createdAt}) has no incidentDate/monthlyLateOccurrence — pre-dates structured linking, cannot verify against attendance automatically.`,
        });
        continue;
      }
      const key = `${lr.incidentDate}|${lr.monthlyLateOccurrence}`;
      const arr = activeByKey.get(key) ?? [];
      arr.push(lr);
      activeByKey.set(key, arr);
    }

    for (const [key, arr] of activeByKey) {
      if (arr.length > 1) {
        totalDuplicateLetters += arr.length - 1;
        const types = new Set(arr.map((l) => l.type));
        const kind =
          types.size > 1
            ? 'INVALID_SEQUENCE_MULTIPLE_TYPES_SAME_INCIDENT'
            : arr.some((l) => l.type === 'FINE')
              ? 'DUPLICATE_FINE_FINANCIAL_RISK'
              : 'DUPLICATE_LETTER';
        duplicateFlags.push({
          employeeId,
          employeeCode: emp.employeeCode,
          employeeName: emp.fullName,
          branch: branchName,
          kind,
          detail: `${key} -> ${arr.map((l) => `${l.type}(${l.id})`).join(', ')}`,
        });
        branchImpact.set(branchName, (branchImpact.get(branchName) ?? 0) + 1);
        for (const l of arr) {
          letterTypeImpact.set(l.type, (letterTypeImpact.get(l.type) ?? 0) + 1);
        }
        const occNum = Number(key.split('|')[1]);
        occurrenceImpact.set(occNum, (occurrenceImpact.get(occNum) ?? 0) + 1);
      }
    }

    // ── Sequence verification against independently recomputed expectation ──
    for (const [dateStr, expectedOccurrence] of expectedByDate) {
      const expectedType = expectedLetterTypeForOccurrence(expectedOccurrence);
      const matching = letterReports.filter((l) => l.incidentDate === dateStr && !l.reversed);
      if (matching.length === 0) {
        sequenceFlags.push({
          employeeId,
          employeeCode: emp.employeeCode,
          employeeName: emp.fullName,
          branch: branchName,
          kind: 'MISSING_LETTER',
          detail: `Incident ${dateStr} recomputed as occurrence ${expectedOccurrence} (expected ${expectedType}) but no active letter found for it.`,
        });
        continue;
      }
      for (const lr of matching) {
        if (lr.monthlyLateOccurrence !== expectedOccurrence) {
          sequenceFlags.push({
            employeeId,
            employeeCode: emp.employeeCode,
            employeeName: emp.fullName,
            branch: branchName,
            kind: 'OCCURRENCE_MISMATCH',
            detail: `Incident ${dateStr}: letter ${lr.id} carries occurrence ${lr.monthlyLateOccurrence}, recomputed expected ${expectedOccurrence}.`,
          });
        }
        if (lr.type !== expectedType) {
          sequenceFlags.push({
            employeeId,
            employeeCode: emp.employeeCode,
            employeeName: emp.fullName,
            branch: branchName,
            kind: 'WRONG_LETTER_TYPE',
            detail: `Incident ${dateStr}: letter ${lr.id} is ${lr.type}, expected ${expectedType} for occurrence ${expectedOccurrence}.`,
          });
          if (lr.type === 'WARNING') totalInvalidWarnings++;
          if (lr.type === 'FINE') totalInvalidFines++;
          if (lr.type === 'SUSPENSION') totalInvalidSuspensions++;
        }
      }
    }

    // ── Payroll deduction cross-check ──────────────────────────────────
    const empDeductions = payrollEntries
      .filter((pe) => pe.stipendRecord.employeeId === employeeId)
      .flatMap((pe) => pe.deductions.map((d) => ({ ...d, payrollStatus: pe.status })));

    const occurrencesReached = [...expectedByDate.values()];
    const expectedDeductionOccurrences = occurrencesReached.filter((o) => o % 3 === 0 && o !== 9);

    if (empDeductions.length > expectedDeductionOccurrences.length) {
      const excess = empDeductions.length - expectedDeductionOccurrences.length;
      totalQuestionableDeductionCount += excess;
      const extraAmount = empDeductions
        .slice(expectedDeductionOccurrences.length)
        .reduce((sum, d) => sum + Number(d.amount), 0);
      totalQuestionableDeductionAmount += extraAmount;
      deductionFlags.push({
        employeeId,
        employeeCode: emp.employeeCode,
        employeeName: emp.fullName,
        branch: branchName,
        kind: 'EXCESS_LATE_DEDUCTIONS',
        detail: `${empDeductions.length} LATE_ARRIVAL deduction(s) this month; expected at most ${expectedDeductionOccurrences.length} (occurrences reaching 3/6: ${expectedDeductionOccurrences.join(',') || 'none'}). Deductions: ${empDeductions.map((d) => `${d.id}(${d.amount}, ${d.description ?? ''}, entry=${d.payrollStatus})`).join(' | ')}`,
      });
    }
    // Deduction present for occurrence 1 or 2 specifically (should never happen).
    if (expectedDeductionOccurrences.length === 0 && empDeductions.length > 0) {
      deductionFlags.push({
        employeeId,
        employeeCode: emp.employeeCode,
        employeeName: emp.fullName,
        branch: branchName,
        kind: 'DEDUCTION_BEFORE_OCCURRENCE_3',
        detail: `${empDeductions.length} LATE_ARRIVAL deduction(s) exist but this employee has not yet reached occurrence 3 this month (max occurrence: ${Math.max(...occurrencesReached, 0)}).`,
      });
    }

    // ── Section 10: duty-snapshot basis check ──────────────────────────
    for (const inc of incidents) {
      if (!inc.dutyStartTimeSnapshot || !inc.dutyEndTimeSnapshot) {
        dutySnapshotFlags.push({
          employeeId,
          employeeCode: emp.employeeCode,
          employeeName: emp.fullName,
          branch: branchName,
          kind: 'NO_DUTY_SNAPSHOT_LEGACY_ROW',
          detail: `AttendanceLog ${inc.attendanceLogId} (${inc.date}, lateMinutes=${inc.lateMinutes}) has no duty snapshot stored — its LATE/HALF_DAY basis cannot be independently confirmed against the duty that applied that day; it was evaluated using a current-duty fallback at write time. Needs manual cross-check against Employee.dutyStartTime history (none exists) if this employee's duty changed since ${inc.date}.`,
        });
      }
    }

    perEmployeeReport[employeeId] = {
      employeeId,
      employeeCode: emp.employeeCode,
      employeeName: emp.fullName,
      branch: branchName,
      trueLateIncidentCount: incidents.length,
      incidents,
      letters: letterReports,
    };
  }

  const employeesAffectedByDuplicates = new Set(
    duplicateFlags
      .filter((f) => f.kind === 'DUPLICATE_LETTER' || f.kind === 'DUPLICATE_FINE_FINANCIAL_RISK' || f.kind === 'INVALID_SEQUENCE_MULTIPLE_TYPES_SAME_INCIDENT')
      .map((f) => f.employeeId),
  ).size;

  // Single top-level object, printed with exactly one console.log — stdout
  // carries nothing else, so `node audit.js > audit-report.json` is valid,
  // directly parseable JSON with no interleaved text.
  const fullReport = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    auditPeriod: { month: 8, year: 2026 },
    summary: {
      totalEmployeesAudited: employeeIds.length,
      employeesWithLateLetters: new Set(letters.map((l) => l.employeeId)).size,
      employeesAffectedByDuplicates,
      totalDuplicateLetters,
      totalInvalidWarnings,
      totalInvalidFines,
      totalInvalidSuspensions,
      totalQuestionableDeductionCount,
      totalQuestionableDeductionAmount,
      branchImpact: Object.fromEntries(branchImpact),
      letterTypeImpact: Object.fromEntries(letterTypeImpact),
      occurrenceImpact: Object.fromEntries(occurrenceImpact),
      unlinkedLettersNeedingManualReview: duplicateFlags.filter((f) => f.kind === 'UNLINKED_LETTER_NEEDS_MANUAL_REVIEW').length,
      legacyRowsWithoutDutySnapshot: dutySnapshotFlags.length,
    },
    perEmployee: perEmployeeReport,
    duplicateFlags,
    sequenceFlags,
    deductionFlags,
    dutySnapshotFlags,
  };

  console.log(JSON.stringify(fullReport, null, 2));
  console.error('=== DONE (read-only — no data was modified) ===');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
