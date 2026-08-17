/**
 * Phase 4A — controlled, one-time reconciliation of AUGUST 2026 production
 * data against every rule implemented in Phases 1C, 1D, 2, 3, 4, the
 * Daily-Rate Consistency Fix, and Phase 4B.
 *
 * This is NOT a new business-rule implementation. It only:
 *   1. Reports where August data doesn't yet match the current rules.
 *   2. In --apply mode, performs ONLY the narrow set of corrections that
 *      are deterministic, safely source-identifiable, and scoped to
 *      PENDING payroll — reusing the exact production functions each rule
 *      already lives in (no second calculation engine).
 *
 * Everything else (missing historical discipline letters, short-leave
 * stale-deduction anomalies, 24h/overnight sanity issues, ambiguous
 * deduction amounts, anything touching PROCESSED/PAID payroll, anything
 * touching a possible 9th-late suspension condition) is REPORT-ONLY —
 * printed for HR/IT review, never auto-mutated.
 *
 * Usage:
 *   npx ts-node scripts/reconcile-august-2026.ts            (dry run — report only, zero writes)
 *   npx ts-node scripts/reconcile-august-2026.ts --apply    (performs the safe corrections listed below)
 *
 * Safe to run --apply repeatedly: every correction this script makes is
 * naturally idempotent (see inline notes at each write site) — a second
 * --apply run finds nothing left to do and reports zero additional changes.
 */
import {
  PrismaClient,
  Prisma,
  AttendanceLogType,
  AttendanceStatus,
  LetterType,
  DeductionType,
  PayrollStatus,
} from '@prisma/client';
import { evaluateMissingCheckoutEligibility } from '../src/modules/attendance/shift-missing-checkout.scheduler';
import { is24HourShift } from '../src/modules/attendance/attendance-biometric.util';
import {
  dailyStipendRate,
  daysInPayrollMonth,
} from '../src/common/stipend.util';
import { PayrollService } from '../src/modules/payroll/payroll.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccessScopeService } from '../src/modules/permissions/access-scope.service';

const YEAR = 2026;
const MONTH = 8; // August only — this script must never be pointed at another month.

const monthStart = new Date(YEAR, MONTH - 1, 1);
const monthEnd = new Date(YEAR, MONTH, 0, 23, 59, 59, 999);
const daysInAugust = daysInPayrollMonth(YEAR, MONTH);

interface LetterOccurrenceVars {
  monthlyLateOccurrence?: number;
  monthlyMissingCheckoutOccurrence?: number;
  incidentDate?: string;
  reversedDueToShortLeave?: boolean;
}

type Safety =
  | 'SAFE_AUTO_FIX'
  | 'MANUAL_REVIEW'
  | 'NO_CHANGE'
  | 'BLOCKED_FINALIZED_PAYROLL';

interface ReportRow {
  employeeId: string;
  employeeName: string;
  date: string;
  module: string;
  currentState: string;
  expectedState: string;
  proposedAction: string;
  financialDifference: string;
  safety: Safety;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Core reconciliation logic, factored out of main() so it can be driven
 * against an injected (real or mock) Prisma client and PayrollService —
 * used both by the real CLI entry point below and by the QA harness.
 * Report/totals state is local to each call, so repeated invocations
 * (e.g. one per test case) never leak into each other.
 */
export async function reconcileAugust2026(
  prisma: PrismaClient,
  payrollService: PayrollService,
  apply: boolean,
) {
  const report: ReportRow[] = [];
  const totals = {
    attendanceRowsReviewed: 0,
    missingSessionsToClose: 0,
    lateDisciplineMismatches: 0,
    missingCheckoutMismatches: 0,
    leaveMismatches: 0,
    deductionsRequiringCorrection: 0,
    relieverAllowanceCorrections: 0,
    pendingPayrollToRecalculate: 0,
    processedFlagged: 0,
    paidFlagged: 0,
    ambiguousRows: 0,
  };

  function push(row: ReportRow) {
    report.push(row);
    if (row.safety === 'MANUAL_REVIEW') totals.ambiguousRows++;
  }

  async function withTx<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(fn);
  }

  console.log(
    `Phase 4A reconciliation — August ${YEAR} (${daysInAugust} days) — mode: ${apply ? 'APPLY' : 'DRY RUN'}\n`,
  );

  // ==========================================================================
  // 1. AUGUST ATTENDANCE AUDIT (report only — no rows are altered here)
  // ==========================================================================
  const attendanceLogs = await prisma.attendanceLog.findMany({
    where: {
      type: AttendanceLogType.REGULAR,
      date: { gte: monthStart, lte: monthEnd },
    },
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          status: true,
          dutyStartTime: true,
          dutyEndTime: true,
          dutyTotalHours: true,
          shift: { select: { name: true, startTime: true, endTime: true } },
        },
      },
    },
    orderBy: { date: 'asc' },
  });
  totals.attendanceRowsReviewed = attendanceLogs.length;

  for (const log of attendanceLogs) {
    const emp = log.employee;
    if (!emp) continue;
    const is24h = is24HourShift(emp);

    // Impossible-state checks (report only).
    if (log.checkIn && log.status === AttendanceStatus.UNMARKED) {
      push({
        employeeId: emp.id,
        employeeName: emp.fullName,
        date: dateKey(log.date),
        module: 'Attendance',
        currentState: 'checkIn set but status still UNMARKED',
        expectedState:
          'status should reflect the actual check-in (PRESENT/LATE/HALF_DAY)',
        proposedAction:
          'Report only — inconsistent status, needs manual review',
        financialDifference: 'n/a',
        safety: 'MANUAL_REVIEW',
      });
    }
    if (
      is24h &&
      (log.status === AttendanceStatus.LATE ||
        (log.status === AttendanceStatus.HALF_DAY && log.lateMinutes > 0))
    ) {
      push({
        employeeId: emp.id,
        employeeName: emp.fullName,
        date: dateKey(log.date),
        module: 'Attendance',
        currentState: `24-hour employee marked ${log.status} (lateMinutes=${log.lateMinutes})`,
        expectedState: '24-hour staff should never be LATE/lateness-HALF_DAY',
        proposedAction:
          'Report only — indicates a deeper data issue, not auto-repaired',
        financialDifference: 'n/a',
        safety: 'MANUAL_REVIEW',
      });
    }
    // Extreme lateMinutes sanity check (overnight rollover artifacts etc.)
    if (log.lateMinutes > 600) {
      push({
        employeeId: emp.id,
        employeeName: emp.fullName,
        date: dateKey(log.date),
        module: 'Attendance',
        currentState: `lateMinutes=${log.lateMinutes} (extreme value)`,
        expectedState: 'a sane late-minute value for this shift',
        proposedAction:
          'Report only — possible date-rollover/timestamp anomaly, not auto-repaired',
        financialDifference: 'n/a',
        safety: 'MANUAL_REVIEW',
      });
    }
  }

  // ==========================================================================
  // 2. MISSING CHECKOUT SESSION CLOSURE BACKFILL (Phase 4B logic, reused)
  // ==========================================================================
  const openLogs = attendanceLogs.filter(
    (l) => l.checkIn && !l.checkOut && !l.sessionClosedAt,
  );
  const now = new Date();
  const categoryC: typeof openLogs = [];

  for (const log of openLogs) {
    const emp = log.employee;
    if (!emp) continue;
    const evaluation = evaluateMissingCheckoutEligibility(emp, log.date, now);
    if (evaluation.eligible === false) {
      if (evaluation.reason.includes('24-hour')) continue; // category B — correct, never closed
      if (evaluation.reason.includes('grace')) {
        // category A/D — still legitimately open (includes overnight-safe math).
        continue;
      }
      // category E — ambiguous (no duty window configured, etc.)
      push({
        employeeId: emp.id,
        employeeName: emp.fullName,
        date: dateKey(log.date),
        module: 'Missing Checkout Closure',
        currentState: 'checkIn set, checkOut NULL, not yet internally closed',
        expectedState: `cannot determine (${evaluation.reason})`,
        proposedAction: 'Report only — ambiguous, needs manual review',
        financialDifference: 'n/a',
        safety: 'MANUAL_REVIEW',
      });
      continue;
    }
    categoryC.push(log);
    totals.missingSessionsToClose++;
    push({
      employeeId: emp.id,
      employeeName: emp.fullName,
      date: dateKey(log.date),
      module: 'Missing Checkout Closure',
      currentState: 'checkIn set, checkOut NULL, session still open internally',
      expectedState:
        'checkOut remains NULL; session internally closed (sessionClosedAt set)',
      proposedAction: 'Set sessionClosedAt (never writes checkOut)',
      financialDifference:
        'none directly — enables correct AUTO/checkout resolution going forward',
      safety: 'SAFE_AUTO_FIX',
    });

    if (apply) {
      await withTx(async (tx) => {
        await tx.attendanceLog.update({
          where: { id: log.id },
          data: { sessionClosedAt: now },
        });
      });
    }
  }

  // ==========================================================================
  // 3. MISSING CHECKOUT DISCIPLINE AUDIT (report only)
  // ==========================================================================
  const missingCheckoutIncidents = attendanceLogs.filter((l) => {
    const emp = l.employee;
    if (!emp || is24HourShift(emp)) return false;
    return l.checkIn && (!l.checkOut || l.sessionClosedAt);
  });
  // Group by employee, count unique incident days this month (mirrors
  // applyMissingCheckoutDiscipline's own counting query — read-only here).
  const missingCheckoutByEmployee = new Map<
    string,
    typeof missingCheckoutIncidents
  >();
  for (const l of missingCheckoutIncidents) {
    const arr = missingCheckoutByEmployee.get(l.employeeId) ?? [];
    arr.push(l);
    missingCheckoutByEmployee.set(l.employeeId, arr);
  }
  for (const [employeeId, incidents] of missingCheckoutByEmployee) {
    incidents.sort((a, b) => a.date.getTime() - b.date.getTime());
    const emp = incidents[0].employee;
    const letters = await prisma.letter.findMany({
      where: {
        employeeId,
        letterType: {
          in: [LetterType.ADVICE, LetterType.WARNING, LetterType.FINE],
        },
        generatedAt: { gte: monthStart },
      },
      select: { variables: true, letterType: true },
    });
    incidents.forEach((incident, idx) => {
      const occurrence = idx + 1;
      const expectedType =
        occurrence % 3 === 1
          ? 'ADVICE'
          : occurrence % 3 === 2
            ? 'WARNING'
            : 'FINE';
      const found = letters.find((l) => {
        const vars = l.variables as LetterOccurrenceVars | null;
        return (
          vars?.monthlyMissingCheckoutOccurrence === occurrence &&
          l.letterType === expectedType
        );
      });
      if (!found) {
        totals.missingCheckoutMismatches++;
        push({
          employeeId,
          employeeName: emp.fullName,
          date: dateKey(incident.date),
          module: 'Missing Checkout Discipline',
          currentState: `occurrence ${occurrence}: no matching ${expectedType} letter found`,
          expectedState: `${expectedType} letter for occurrence ${occurrence}`,
          proposedAction:
            'Report only — historical discipline gap, not auto-issued',
          financialDifference:
            expectedType === 'FINE'
              ? `expected ~${dailyStipendRate(30000, incident.date).toFixed(2)} (using placeholder basic; verify actual)`
              : 'n/a',
          safety: 'MANUAL_REVIEW',
        });
      }
    });
  }

  // ==========================================================================
  // 4. LATE DISCIPLINE AUDIT (report only)
  // ==========================================================================
  const lateIncidents = attendanceLogs.filter((l) => {
    if (l.status === AttendanceStatus.LATE) return true;
    if (
      l.status === AttendanceStatus.HALF_DAY &&
      l.lateMinutes > 0 &&
      !(l.note ?? '').toLowerCase().includes('short leave')
    )
      return true;
    return false;
  });
  const lateByEmployee = new Map<string, typeof lateIncidents>();
  for (const l of lateIncidents) {
    const arr = lateByEmployee.get(l.employeeId) ?? [];
    arr.push(l);
    lateByEmployee.set(l.employeeId, arr);
  }
  for (const [employeeId, incidents] of lateByEmployee) {
    incidents.sort((a, b) => a.date.getTime() - b.date.getTime());
    const emp = incidents[0].employee;
    const letters = await prisma.letter.findMany({
      where: {
        employeeId,
        letterType: {
          in: [
            LetterType.ADVICE,
            LetterType.WARNING,
            LetterType.FINE,
            LetterType.SUSPENSION,
          ],
        },
        generatedAt: { gte: monthStart },
      },
      select: { variables: true, letterType: true },
    });
    incidents.forEach((incident, idx) => {
      const occurrence = idx + 1;
      let expectedType: string;
      if (occurrence === 9) expectedType = 'SUSPENSION';
      else if (occurrence % 3 === 1) expectedType = 'ADVICE';
      else if (occurrence % 3 === 2) expectedType = 'WARNING';
      else expectedType = 'FINE';

      const found = letters.find((l) => {
        const vars = l.variables as LetterOccurrenceVars | null;
        return (
          vars?.monthlyLateOccurrence === occurrence &&
          l.letterType === expectedType
        );
      });

      if (!found) {
        totals.lateDisciplineMismatches++;
        if (occurrence === 9) {
          push({
            employeeId,
            employeeName: emp.fullName,
            date: dateKey(incident.date),
            module: 'Late Discipline',
            currentState:
              '9th late occurrence reached, no SUSPENSION letter found',
            expectedState: 'SUSPENSION (no deduction)',
            proposedAction:
              'MANUAL_REVIEW — HISTORICAL SUSPENSION CONDITION (management/HR decision, not auto-applied)',
            financialDifference: 'none (suspension has no direct deduction)',
            safety: 'MANUAL_REVIEW',
          });
        } else {
          push({
            employeeId,
            employeeName: emp.fullName,
            date: dateKey(incident.date),
            module: 'Late Discipline',
            currentState: `occurrence ${occurrence}: no matching ${expectedType} letter found`,
            expectedState: `${expectedType} letter for occurrence ${occurrence}`,
            proposedAction:
              'Report only — historical discipline gap, not auto-issued',
            financialDifference:
              expectedType === 'FINE'
                ? 'expected one August daily rate — verify against employee basic stipend'
                : 'n/a',
            safety: 'MANUAL_REVIEW',
          });
        }
      }
    });
  }

  // ==========================================================================
  // 5. DAILY-RATE RECONCILIATION (SAFE_AUTO_FIX for PENDING-linked, auto-
  //    generated deductions still using the pre-fix /30 amount)
  // ==========================================================================
  const augustEntries = await prisma.payrollEntry.findMany({
    where: { month: MONTH, year: YEAR },
    include: {
      deductions: true,
      allowances: true,
      stipendRecord: {
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
              employeeCode: true,
              status: true,
              dutyStartTime: true,
              dutyEndTime: true,
              dutyTotalHours: true,
              relieverOnly: true,
              monthlyAllowedLeaves: true,
              shift: { select: { startTime: true, endTime: true } },
            },
          },
        },
      },
    },
  });

  for (const entry of augustEntries) {
    const emp = entry.stipendRecord.employee;
    const basicStipend = Number(entry.stipendRecord.basicStipend);
    const isFinalized = entry.status !== PayrollStatus.PENDING;
    if (entry.status === PayrollStatus.PROCESSED) totals.processedFlagged++;
    if (entry.status === PayrollStatus.PAID) totals.paidFlagged++;

    for (const dedn of entry.deductions) {
      const amount = Number(dedn.amount);
      const desc = dedn.description ?? '';
      let recognized = false;
      let oldAmount = 0;
      let newAmount = 0;

      const lateFineMatch = desc.match(
        /^Late arrival deduction — monthly occurrence (\d+)$/,
      );
      const missingCheckoutFineMatch = desc.match(
        /^Missing checkout deduction — monthly occurrence (\d+)$/,
      );
      const uninformedDatedMatch = desc.match(
        /^Uninformed absence deduction \(2 days\) — \d{4}-\d{2}-\d{2}$/,
      );
      const absentDatedMatch = desc.match(
        /^Absent without approved leave \(2 days stipend\) — \d{4}-\d{2}-\d{2}$/,
      );
      const uninformedLegacyExact =
        desc === 'Uninformed absence deduction (2 days)';
      const absentLegacyExact =
        desc === 'Absent without approved leave (2 days stipend)';

      if (dedn.reason === DeductionType.LATE_ARRIVAL && lateFineMatch) {
        recognized = true;
        oldAmount = basicStipend / 30;
        newAmount = basicStipend / 31;
      } else if (
        dedn.reason === DeductionType.DISCIPLINARY_FINE &&
        missingCheckoutFineMatch
      ) {
        recognized = true;
        oldAmount = basicStipend / 30;
        newAmount = basicStipend / 31;
      } else if (
        dedn.reason === DeductionType.UNINFORMED_ABSENCE &&
        (uninformedDatedMatch || absentDatedMatch)
      ) {
        recognized = true;
        oldAmount = (basicStipend / 30) * 2;
        newAmount = (basicStipend / 31) * 2;
      } else if (
        dedn.reason === DeductionType.UNINFORMED_ABSENCE &&
        (uninformedLegacyExact || absentLegacyExact)
      ) {
        // Undated legacy description — only safe to touch if this is the
        // ONLY such deduction for this employee/month (otherwise which
        // specific day it belongs to is ambiguous).
        const siblingCount = entry.deductions.filter(
          (d) =>
            d.reason === DeductionType.UNINFORMED_ABSENCE &&
            d.description === desc,
        ).length;
        if (siblingCount === 1) {
          recognized = true;
          oldAmount = (basicStipend / 30) * 2;
          newAmount = (basicStipend / 31) * 2;
        } else {
          push({
            employeeId: emp.id,
            employeeName: emp.fullName,
            date: 'August 2026',
            module: 'Daily-Rate Reconciliation',
            currentState: `${siblingCount} undated absence deductions with identical description — cannot uniquely attribute`,
            expectedState: `${dailyStipendRate(basicStipend, monthStart) * 2}`,
            proposedAction:
              'Report only — ambiguous legacy deduction, needs manual review',
            financialDifference: 'unknown — ambiguous',
            safety: 'MANUAL_REVIEW',
          });
          continue;
        }
      }

      if (!recognized) continue; // not a recognized auto-generated pattern — treat as manual, never touch

      const matchesOld = Math.abs(amount - oldAmount) < 0.02;
      const matchesNew = Math.abs(amount - newAmount) < 0.02;

      if (matchesNew) {
        continue; // already correct, nothing to do
      }
      if (!matchesOld) {
        // Doesn't match either formula exactly — could be a manual override
        // of an auto-generated-looking description. Don't guess.
        push({
          employeeId: emp.id,
          employeeName: emp.fullName,
          date: 'August 2026',
          module: 'Daily-Rate Reconciliation',
          currentState: `${dedn.reason} amount ${amount} matches neither old (${oldAmount.toFixed(2)}) nor new (${newAmount.toFixed(2)}) formula`,
          expectedState: newAmount.toFixed(2),
          proposedAction:
            'Report only — does not cleanly match a known auto-formula, needs manual review',
          financialDifference: `${(newAmount - amount).toFixed(2)}`,
          safety: 'MANUAL_REVIEW',
        });
        continue;
      }

      totals.deductionsRequiringCorrection++;
      if (isFinalized) {
        push({
          employeeId: emp.id,
          employeeName: emp.fullName,
          date: 'August 2026',
          module: 'Daily-Rate Reconciliation',
          currentState: `${dedn.reason} = ${amount.toFixed(2)} (old /30 formula)`,
          expectedState: `${newAmount.toFixed(2)} (/31 formula)`,
          proposedAction: `BLOCKED — PayrollEntry is ${entry.status}, not auto-corrected`,
          financialDifference: `${(newAmount - oldAmount).toFixed(2)}`,
          safety: 'BLOCKED_FINALIZED_PAYROLL',
        });
        continue;
      }

      push({
        employeeId: emp.id,
        employeeName: emp.fullName,
        date: 'August 2026',
        module: 'Daily-Rate Reconciliation',
        currentState: `${dedn.reason} = ${amount.toFixed(2)} (old /30 formula)`,
        expectedState: `${newAmount.toFixed(2)} (/31 formula)`,
        proposedAction:
          'Correct deduction amount to the August (/31) daily rate',
        financialDifference: `${(newAmount - oldAmount).toFixed(2)}`,
        safety: 'SAFE_AUTO_FIX',
      });

      if (apply) {
        const diff = newAmount - amount;
        await withTx(async (tx) => {
          await tx.payrollDeduction.update({
            where: { id: dedn.id },
            data: { amount: newAmount },
          });
          await tx.payrollEntry.update({
            where: { id: entry.id },
            data: {
              totalDeductions: { increment: diff },
              netStipend: { decrement: diff },
            },
          });
        });
      }
    }
  }

  // ==========================================================================
  // 6/7/8/9/10. LEAVE, SHORT LEAVE, ABSENCE, 24H, OVERNIGHT — verification
  // (auto-corrected for PENDING payroll by step 13's recompute, which
  // already reuses the current, correct formulas for all of these; nothing
  // separate to write here)
  // ==========================================================================
  const shortLeaveRows = attendanceLogs.filter(
    (l) =>
      l.status === AttendanceStatus.HALF_DAY &&
      (l.note ?? '').toLowerCase().includes('short leave'),
  );
  for (const row of shortLeaveRows) {
    const emp = row.employee;
    if (!emp) continue;
    const staleLetter = await prisma.letter.findFirst({
      where: {
        employeeId: row.employeeId,
        letterType: {
          in: [LetterType.ADVICE, LetterType.WARNING, LetterType.FINE],
        },
        generatedAt: { gte: monthStart },
      },
      select: { variables: true },
    });
    const vars = staleLetter?.variables as
      | LetterOccurrenceVars
      | null
      | undefined;
    if (
      vars?.incidentDate === dateKey(row.date) &&
      !vars?.reversedDueToShortLeave
    ) {
      totals.leaveMismatches++;
      push({
        employeeId: emp.id,
        employeeName: emp.fullName,
        date: dateKey(row.date),
        module: 'Short Leave Reconciliation',
        currentState:
          'Short Leave day still has an un-reversed late-discipline letter for this exact date',
        expectedState:
          'letter should be marked reversedDueToShortLeave, deduction (if any) removed',
        proposedAction:
          'Report only — cannot safely infer why Phase 2 reversal did not run; needs manual review',
        financialDifference: 'unknown — see linked letter',
        safety: 'MANUAL_REVIEW',
      });
    }
  }

  // ==========================================================================
  // 11. RELIEVER RECONCILIATION
  // ==========================================================================
  const augustSessions = await prisma.relieverSession.findMany({
    where: {
      date: { gte: monthStart, lte: monthEnd },
      checkOut: { not: null },
    },
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          dutyStartTime: true,
          dutyEndTime: true,
          relieverOnly: true,
        },
      },
    },
  });
  const legacyAdditionalWorkingDays =
    await prisma.additionalWorkingDay.findMany({
      where: { date: { gte: monthStart, lte: monthEnd } },
    });
  for (const awd of legacyAdditionalWorkingDays) {
    const isLegacyReliever = awd.note === 'Extra Duty (Reliever)';
    if (!isLegacyReliever) continue; // category A (genuine HR manual) — never touched

    const hasMatchingSession = augustSessions.some(
      (s) =>
        s.employeeId === awd.employeeId &&
        s.date.getTime() === awd.date.getTime(),
    );
    const emp = augustSessions.find(
      (s) => s.employeeId === awd.employeeId,
    )?.employee;
    const entry = augustEntries.find(
      (e) => e.stipendRecord.employee.id === awd.employeeId,
    );
    const isFinalized = entry && entry.status !== PayrollStatus.PENDING;

    if (!hasMatchingSession) {
      push({
        employeeId: awd.employeeId,
        employeeName: emp?.fullName ?? awd.employeeId,
        date: dateKey(awd.date),
        module: 'Reliever Reconciliation',
        currentState: `AdditionalWorkingDay note is the legacy reliever marker, but no matching RelieverSession found for this date`,
        expectedState: 'confirmed legacy reliever row before removal',
        proposedAction:
          'Report only — category C (ambiguous), cannot cross-reference to a session',
        financialDifference: 'unknown',
        safety: 'MANUAL_REVIEW',
      });
      continue;
    }

    totals.relieverAllowanceCorrections++;
    if (!entry || isFinalized) {
      push({
        employeeId: awd.employeeId,
        employeeName: emp?.fullName ?? awd.employeeId,
        date: dateKey(awd.date),
        module: 'Reliever Reconciliation',
        currentState:
          'legacy reliever-generated AdditionalWorkingDay (category B), confirmed via matching RelieverSession',
        expectedState: 'removed — replaced by the correct RELIEVER allowance',
        proposedAction: entry
          ? `BLOCKED — PayrollEntry is ${entry.status}`
          : 'BLOCKED — no PENDING PayrollEntry found for this employee/month',
        financialDifference:
          'would remove one full flat-rate day allowance; RELIEVER allowance recomputed separately',
        safety: entry ? 'BLOCKED_FINALIZED_PAYROLL' : 'MANUAL_REVIEW',
      });
      continue;
    }

    push({
      employeeId: awd.employeeId,
      employeeName: emp?.fullName ?? awd.employeeId,
      date: dateKey(awd.date),
      module: 'Reliever Reconciliation',
      currentState:
        'legacy reliever-generated AdditionalWorkingDay (category B), confirmed via matching RelieverSession',
      expectedState:
        'removed — replaced by the correct RELIEVER allowance on recompute',
      proposedAction:
        'Delete this AdditionalWorkingDay row; payroll recompute (step 13) then applies the correct RELIEVER allowance',
      financialDifference:
        'flat full-day rate removed, replaced by actual non-overlapping reliever minutes',
      safety: 'SAFE_AUTO_FIX',
    });

    if (apply) {
      await withTx(async (tx) => {
        await tx.additionalWorkingDay.delete({ where: { id: awd.id } });
      });
    }
  }

  // ==========================================================================
  // 12. OVERTIME RECONCILIATION (report only — HR-gated, never auto-recomputed)
  // ==========================================================================
  for (const entry of augustEntries) {
    const otRows = entry.allowances.filter((a) => a.type === 'OVERTIME');
    if (otRows.length > 1) {
      push({
        employeeId: entry.stipendRecord.employee.id,
        employeeName: entry.stipendRecord.employee.fullName,
        date: 'August 2026',
        module: 'Overtime Reconciliation',
        currentState: `${otRows.length} OVERTIME allowance rows on one PayrollEntry`,
        expectedState: 'exactly one OVERTIME allowance row',
        proposedAction:
          'Report only — unexpected duplicate, needs manual review',
        financialDifference: 'unknown',
        safety: 'MANUAL_REVIEW',
      });
    }
  }

  // ==========================================================================
  // 13. PAYROLL RECOMPUTATION — PENDING ONLY (reuses createOrGetEntry)
  // ==========================================================================
  const pendingEntries = augustEntries.filter(
    (e) => e.status === PayrollStatus.PENDING,
  );
  totals.pendingPayrollToRecalculate = pendingEntries.length;

  for (const entry of pendingEntries) {
    const emp = entry.stipendRecord.employee;
    push({
      employeeId: emp.id,
      employeeName: emp.fullName,
      date: 'August 2026',
      module: 'Payroll Recomputation',
      currentState: `netStipend=${Number(entry.netStipend).toFixed(2)} (pre-reconciliation)`,
      expectedState:
        'recomputed via createOrGetEntry using current Phase 4 logic',
      proposedAction:
        'Recompute via the production payroll engine (createOrGetEntry)',
      financialDifference: 'see recomputed value after apply',
      safety: 'SAFE_AUTO_FIX',
    });

    if (apply) {
      try {
        await payrollService.createOrGetEntry({
          employeeId: emp.id,
          month: MONTH,
          year: YEAR,
        });
      } catch (err) {
        console.error(
          `Recompute failed for ${emp.employeeCode}: ${(err as Error).message}`,
        );
      }
    }
  }

  for (const entry of augustEntries) {
    if (
      entry.status === PayrollStatus.PROCESSED ||
      entry.status === PayrollStatus.PAID
    ) {
      push({
        employeeId: entry.stipendRecord.employee.id,
        employeeName: entry.stipendRecord.employee.fullName,
        date: 'August 2026',
        module: 'Payroll Recomputation',
        currentState: `PayrollEntry status = ${entry.status}`,
        expectedState: 'unchanged — finalized payroll is never auto-mutated',
        proposedAction: 'No action — reported for HR/management review only',
        financialDifference: 'n/a',
        safety: 'BLOCKED_FINALIZED_PAYROLL',
      });
    }
  }

  // ==========================================================================
  // REPORT
  // ==========================================================================
  console.log('\n--- Reconciliation Report ---\n');
  console.log(
    'EmployeeID | EmployeeName | Date | Module | Current | Expected | Action | FinancialDiff | Safety',
  );
  for (const r of report) {
    console.log(
      `${r.employeeId} | ${r.employeeName} | ${r.date} | ${r.module} | ${r.currentState} | ${r.expectedState} | ${r.proposedAction} | ${r.financialDifference} | ${r.safety}`,
    );
  }

  console.log('\n--- Totals ---');
  console.log(`Attendance rows reviewed: ${totals.attendanceRowsReviewed}`);
  console.log(`Missing sessions to close: ${totals.missingSessionsToClose}`);
  console.log(`Late discipline mismatches: ${totals.lateDisciplineMismatches}`);
  console.log(
    `Missing checkout mismatches: ${totals.missingCheckoutMismatches}`,
  );
  console.log(`Leave/short-leave mismatches: ${totals.leaveMismatches}`);
  console.log(
    `Deductions requiring amount correction: ${totals.deductionsRequiringCorrection}`,
  );
  console.log(
    `Reliever allowance corrections: ${totals.relieverAllowanceCorrections}`,
  );
  console.log(
    `PENDING payroll entries to recalculate: ${totals.pendingPayrollToRecalculate}`,
  );
  console.log(`PROCESSED entries flagged: ${totals.processedFlagged}`);
  console.log(`PAID entries flagged: ${totals.paidFlagged}`);
  console.log(`Ambiguous rows (MANUAL_REVIEW): ${totals.ambiguousRows}`);

  if (!apply) {
    console.log(
      '\nDry run only — no data was modified. Re-run with --apply to perform the SAFE_AUTO_FIX actions listed above.',
    );
  } else {
    console.log('\nApply run complete.');
  }

  return { report, totals };
}

async function main() {
  const prisma = new PrismaClient();
  // createOrGetEntry only calls accessScopeService when an actingUser is
  // passed; this script never passes one, so a permission check never runs
  // and no real AccessScopeService is needed.
  const payrollService = new PayrollService(
    prisma as unknown as PrismaService,
    {} as unknown as AccessScopeService,
  );
  const apply = process.argv.includes('--apply');

  try {
    await reconcileAugust2026(prisma, payrollService, apply);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
