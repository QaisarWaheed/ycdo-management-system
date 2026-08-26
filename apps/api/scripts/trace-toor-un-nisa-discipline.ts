/**
 * READ-ONLY — trace exactly how Toor Un Nisa (YCDO-2026-0058) ended up with
 * a "Late arrival deduction — monthly occurrence 3" PayrollDeduction
 * (id ae1429a8-c27e-4062-8a6a-0b8c5402b163) while her currently-recomputed
 * true August late incident count is only 2.
 *
 * Zero writes. Only reads Employee, AttendanceLog, LeaveRecord,
 * LeaveApproval, Letter, PayrollDeduction, PayrollEntry, DisciplineEvent,
 * AuditLog.
 *
 * KNOWN DATA LIMITATIONS (reported, not worked around):
 *   - AttendanceLog has createdAt but NO updatedAt column — its own history
 *     of status changes is NOT directly queryable from the row itself.
 *     AuditLog(entity='AttendanceLog') is the only timestamped record of
 *     edits, and only for edits made through updateAttendance
 *     (ATTENDANCE_UPDATED, carries a full previous/updated diff) — markManual
 *     writes ATTENDANCE_MARKED with no diff, and biometric/raw-scan writes
 *     no AuditLog entry at all.
 *   - PayrollDeduction has NO timestamp column at all (no createdAt, no
 *     updatedAt) and discipline.helper.ts never writes an AuditLog entry
 *     when it creates one — so the exact moment the target deduction was
 *     created cannot be read directly. DisciplineEvent.createdAt (same
 *     transaction, always written immediately before the deduction) and
 *     Letter.generatedAt (same transaction) are the closest available
 *     proxies and are reported as such.
 *
 * Run:
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/trace-toor-un-nisa-discipline.ts > toor-un-nisa-trace.json
 */

import {
  AttendanceLogType,
  AttendanceStatus,
  DisciplineCategory,
  PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();

const EMPLOYEE_CODE = 'YCDO-2026-0058';
const TARGET_DEDUCTION_ID = 'ae1429a8-c27e-4062-8a6a-0b8c5402b163';
const TARGET_PAYROLL_ENTRY_ID = '60578153-5688-47d6-8ba2-e21be2f43362';

const MONTH_START = new Date(Date.UTC(2026, 7, 1, 0, 0, 0, 0));
const MONTH_END = new Date(Date.UTC(2026, 7, 31, 23, 59, 59, 999));

/** Mirrors resolveAttendanceDutyTimes (common/duty.util.ts) without importing
 * the compiled app — snapshot wins, current employee duty is the fallback. */
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

/** Mirrors applyLateDiscipline's own "true late" predicate exactly. */
function isTrueLateRow(row: {
  status: string;
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

/** PKT minutes-since-midnight late calc, mirrors calculateLateMinutesFromCheckIn
 * (attendance-late.util.ts) for the recomputed-lateness cross-check. */
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
  const graceMinutes = 15;
  const checkInMin = toPakistanMinutesOfDay(checkIn);
  const dutyStartMin = parseTimeToMinutes(dutyStartTime);
  let diff = checkInMin - (dutyStartMin + graceMinutes);
  if (diff < -12 * 60) diff += 24 * 60; // overnight wrap, same tolerance as the real util
  return Math.max(0, diff);
}

async function main() {
  console.error(`=== READ-ONLY TRACE: ${EMPLOYEE_CODE} discipline history ===`);

  const employee = await prisma.employee.findUnique({
    where: { employeeCode: EMPLOYEE_CODE },
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      dutyStartTime: true,
      dutyEndTime: true,
      shiftId: true,
      shift: { select: { name: true, startTime: true, endTime: true } },
    },
  });

  if (!employee) {
    console.log(
      JSON.stringify({ found: false, employeeCode: EMPLOYEE_CODE }, null, 2),
    );
    return;
  }

  // ── 1. All August AttendanceLog rows (both types, flagged) ──
  const attendanceLogs = await prisma.attendanceLog.findMany({
    where: {
      employeeId: employee.id,
      date: { gte: MONTH_START, lte: MONTH_END },
    },
    orderBy: { date: 'asc' },
  });

  const attendanceLogIds = attendanceLogs.map((l) => l.id);

  const attendanceLogDetails = attendanceLogs.map((log) => {
    const duty = effectiveDuty(log, employee);
    const recomputedLateMinutes = recomputeLateMinutes(
      log.checkIn,
      duty.dutyStartTime,
    );
    return {
      id: log.id,
      date: log.date.toISOString().slice(0, 10),
      type: log.type,
      checkIn: log.checkIn ? log.checkIn.toISOString() : null,
      checkOut: log.checkOut ? log.checkOut.toISOString() : null,
      status: log.status,
      lateMinutes: log.lateMinutes,
      dutyStartTimeSnapshot: log.dutyStartTimeSnapshot,
      dutyEndTimeSnapshot: log.dutyEndTimeSnapshot,
      sessionClosedAt: log.sessionClosedAt
        ? log.sessionClosedAt.toISOString()
        : null,
      note: log.note,
      source: log.source,
      createdAt: log.createdAt.toISOString(),
      recomputed: {
        effectiveDutyStartTime: duty.dutyStartTime,
        effectiveDutyEndTime: duty.dutyEndTime,
        dutySource: duty.source,
        recomputedLateMinutesFromCurrentCheckIn: recomputedLateMinutes,
        matchesStoredLateMinutes: recomputedLateMinutes === log.lateMinutes,
      },
      isTrueLateToday:
        log.type === AttendanceLogType.REGULAR && isTrueLateRow(log),
    };
  });

  const trueAugustLateIncidentCount = attendanceLogDetails.filter(
    (l) => l.isTrueLateToday,
  ).length;

  // ── 2. AuditLog trail for every one of her AttendanceLog rows ──
  const attendanceAuditLogs = attendanceLogIds.length
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

  // ── 3. LeaveRecords overlapping August, with full approval trail ──
  const leaveRecords = await prisma.leaveRecord.findMany({
    where: {
      employeeId: employee.id,
      OR: [
        { startDate: { gte: MONTH_START, lte: MONTH_END } },
        { endDate: { gte: MONTH_START, lte: MONTH_END } },
      ],
    },
    include: { approvals: { orderBy: { actionAt: 'asc' } } },
    orderBy: { startDate: 'asc' },
  });

  // ── 4. All August letters ──
  const letters = await prisma.letter.findMany({
    where: {
      employeeId: employee.id,
      generatedAt: { gte: MONTH_START, lte: MONTH_END },
    },
    select: {
      id: true,
      letterNo: true,
      letterType: true,
      generatedAt: true,
      variables: true,
      acknowledgement: { select: { id: true, acknowledgedAt: true } },
    },
    orderBy: { generatedAt: 'asc' },
  });

  // ── 5. All August PayrollDeductions (via her August PayrollEntry) ──
  const payrollEntry = await prisma.payrollEntry.findUnique({
    where: { id: TARGET_PAYROLL_ENTRY_ID },
    include: { deductions: true },
  });

  const targetDeduction =
    payrollEntry?.deductions.find((d) => d.id === TARGET_DEDUCTION_ID) ?? null;

  // ── 6. DisciplineEvent rows ──
  const disciplineEvents = await prisma.disciplineEvent.findMany({
    where: {
      employeeId: employee.id,
      incidentDate: { gte: MONTH_START, lte: MONTH_END },
    },
    orderBy: { createdAt: 'asc' },
  });

  const lateDisciplineEvents = disciplineEvents.filter(
    (e) => e.category === DisciplineCategory.LATE,
  );
  const occurrence3Event =
    lateDisciplineEvents.find((e) => e.occurrence === 3) ?? null;
  // The other dates whose LATE/lateness-HALF_DAY status was counted at the
  // moment occurrence 3 was claimed are, by construction, whichever earlier
  // DisciplineEvent(LATE) rows exist with occurrence 1 and 2 (the gate
  // claims occurrences in the order incidents are actually processed).
  const occurrence1Event =
    lateDisciplineEvents.find((e) => e.occurrence === 1) ?? null;
  const occurrence2Event =
    lateDisciplineEvents.find((e) => e.occurrence === 2) ?? null;

  function currentStatusForDate(dateIso: string | null) {
    if (!dateIso) return null;
    return (
      attendanceLogDetails.find(
        (l) => l.date === dateIso && l.type === AttendanceLogType.REGULAR,
      ) ?? null
    );
  }

  const occurrence3Analysis = occurrence3Event
    ? {
        disciplineEvent: {
          id: occurrence3Event.id,
          incidentDate: occurrence3Event.incidentDate
            .toISOString()
            .slice(0, 10),
          occurrence: occurrence3Event.occurrence,
          createdAt: occurrence3Event.createdAt.toISOString(),
        },
        occurrence1ContributingDate: occurrence1Event
          ? {
              incidentDate: occurrence1Event.incidentDate
                .toISOString()
                .slice(0, 10),
              disciplineEventCreatedAt:
                occurrence1Event.createdAt.toISOString(),
              currentAttendanceStatus: currentStatusForDate(
                occurrence1Event.incidentDate.toISOString().slice(0, 10),
              ),
            }
          : 'NO DisciplineEvent(LATE, occurrence=1) FOUND — legacy row predating the gate, or already reversed/deleted',
        occurrence2ContributingDate: occurrence2Event
          ? {
              incidentDate: occurrence2Event.incidentDate
                .toISOString()
                .slice(0, 10),
              disciplineEventCreatedAt:
                occurrence2Event.createdAt.toISOString(),
              currentAttendanceStatus: currentStatusForDate(
                occurrence2Event.incidentDate.toISOString().slice(0, 10),
              ),
            }
          : 'NO DisciplineEvent(LATE, occurrence=2) FOUND — legacy row predating the gate, or already reversed/deleted',
      }
    : 'NO DisciplineEvent(LATE, occurrence=3) FOUND — this deduction predates the gate (created before 20260818100000_add_discipline_event was deployed), so no claim row exists for it at all.';

  // ── 7. Chronological timeline (best-effort, gaps reported explicitly) ──
  type TimelineEntry = { at: string; source: string; detail: unknown };
  const timeline: TimelineEntry[] = [];

  for (const log of attendanceLogs) {
    timeline.push({
      at: log.createdAt.toISOString(),
      source: 'AttendanceLog.createdAt (row first created)',
      detail: {
        id: log.id,
        date: log.date.toISOString().slice(0, 10),
        initialStatus: log.status,
      },
    });
  }
  for (const a of attendanceAuditLogs) {
    timeline.push({
      at: a.createdAt.toISOString(),
      source: `AuditLog (${a.action})`,
      detail: {
        attendanceLogId: a.entityId,
        userId: a.userId,
        changes: a.changes,
      },
    });
  }
  for (const lr of leaveRecords) {
    timeline.push({
      at: lr.createdAt.toISOString(),
      source: 'LeaveRecord.createdAt',
      detail: {
        id: lr.id,
        leaveType: lr.leaveType,
        status: lr.status,
        startDate: lr.startDate.toISOString().slice(0, 10),
        endDate: lr.endDate.toISOString().slice(0, 10),
      },
    });
    for (const ap of lr.approvals) {
      timeline.push({
        at: ap.actionAt.toISOString(),
        source: 'LeaveApproval.actionAt',
        detail: {
          leaveId: lr.id,
          stage: ap.stage,
          action: ap.action,
          actionBy: ap.actionBy,
        },
      });
    }
  }
  for (const e of disciplineEvents) {
    timeline.push({
      at: e.createdAt.toISOString(),
      source: 'DisciplineEvent.createdAt',
      detail: {
        id: e.id,
        category: e.category,
        incidentDate: e.incidentDate.toISOString().slice(0, 10),
        occurrence: e.occurrence,
      },
    });
  }
  for (const l of letters) {
    timeline.push({
      at: l.generatedAt.toISOString(),
      source: 'Letter.generatedAt',
      detail: {
        id: l.id,
        letterNo: l.letterNo,
        letterType: l.letterType,
        variables: l.variables,
        acknowledged: !!l.acknowledgement,
      },
    });
  }

  timeline.sort((a, b) => a.at.localeCompare(b.at));

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    employee: {
      id: employee.id,
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      dutyStartTime: employee.dutyStartTime,
      dutyEndTime: employee.dutyEndTime,
      shift: employee.shift,
    },
    trueAugustLateIncidentCount,
    attendanceLogs: attendanceLogDetails,
    attendanceAuditTrail: attendanceAuditLogs.map((a) => ({
      id: a.id,
      action: a.action,
      attendanceLogId: a.entityId,
      userId: a.userId,
      changes: a.changes,
      createdAt: a.createdAt.toISOString(),
    })),
    leaveRecords: leaveRecords.map((lr) => ({
      id: lr.id,
      leaveType: lr.leaveType,
      status: lr.status,
      startDate: lr.startDate.toISOString().slice(0, 10),
      endDate: lr.endDate.toISOString().slice(0, 10),
      createdAt: lr.createdAt.toISOString(),
      approvals: lr.approvals.map((ap) => ({
        stage: ap.stage,
        action: ap.action,
        actionBy: ap.actionBy,
        actionAt: ap.actionAt.toISOString(),
        notes: ap.notes,
      })),
    })),
    letters: letters.map((l) => ({
      id: l.id,
      letterNo: l.letterNo,
      letterType: l.letterType,
      generatedAt: l.generatedAt.toISOString(),
      variables: l.variables,
      acknowledged: !!l.acknowledgement,
      acknowledgedAt: l.acknowledgement?.acknowledgedAt
        ? l.acknowledgement.acknowledgedAt.toISOString()
        : null,
    })),
    payrollEntry: payrollEntry
      ? {
          id: payrollEntry.id,
          status: payrollEntry.status,
          totalDeductions: Number(payrollEntry.totalDeductions),
          netStipend: Number(payrollEntry.netStipend),
          month: payrollEntry.month,
          year: payrollEntry.year,
        }
      : { found: false, id: TARGET_PAYROLL_ENTRY_ID },
    allPayrollDeductionsThisEntry: (payrollEntry?.deductions ?? []).map(
      (d) => ({
        id: d.id,
        amount: Number(d.amount),
        reason: d.reason,
        description: d.description,
        isTargetDeduction: d.id === TARGET_DEDUCTION_ID,
        note: 'PayrollDeduction has no createdAt/updatedAt column — exact creation time not directly queryable; see disciplineEvents/letters for the closest same-transaction timestamp proxy.',
      }),
    ),
    targetDeductionFound: !!targetDeduction,
    targetDeduction: targetDeduction
      ? {
          id: targetDeduction.id,
          amount: Number(targetDeduction.amount),
          reason: targetDeduction.reason,
          description: targetDeduction.description,
        }
      : null,
    disciplineEvents: disciplineEvents.map((e) => ({
      id: e.id,
      category: e.category,
      incidentDate: e.incidentDate.toISOString().slice(0, 10),
      occurrence: e.occurrence,
      createdAt: e.createdAt.toISOString(),
    })),
    occurrence3RootCauseAnalysis: occurrence3Analysis,
    timeline,
    dataLimitations: [
      'AttendanceLog has no updatedAt column — its own edit history is only visible via AuditLog(entity=AttendanceLog), which itself only exists for edits made through updateAttendance (full diff) or markManual (no diff, mark event only); biometric/raw-scan writes and reconcileShortLeaveAttendance leave NO AuditLog entry at all.',
      'PayrollDeduction has no createdAt/updatedAt column at all, and discipline.helper.ts never writes an AuditLog entry when creating or deleting one — the exact creation instant of the target deduction cannot be read directly from the database.',
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
