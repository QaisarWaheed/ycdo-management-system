/* eslint-disable no-console */
/**
 * READ-ONLY — Phase C (trace Letter 3124 / id 15bea6eb-3909-430a-b1a0-
 * d69ae833f3f8) + Phase E data-gathering (exact generatedAt timestamps for
 * the 3 confirmed-duplicate employees, needed to apply "earliest createdAt
 * wins" — Letter has no separate createdAt field; generatedAt IS the
 * creation timestamp, default now()).
 *
 * Zero writes. Only reads Letter, Employee, AttendanceLog,
 * AllegationAcknowledgement rows.
 *
 * Run:
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/phase-c-e-trace-letters.ts > phase-c-e-report.json
 */

import { AttendanceLogType, AttendanceStatus, LetterType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TARGET_LETTER_ID = '15bea6eb-3909-430a-b1a0-d69ae833f3f8';
const CONFIRMED_DUPLICATE_EMPLOYEE_CODES = [
  'YCDO-2026-0383', // Dr Iram
  'YCDO-2026-0381', // Miss Faiza
  'YCDO-2026-0482', // Shazia
];

const MONTH_START = new Date(Date.UTC(2026, 7, 1, 0, 0, 0, 0));
const MONTH_END = new Date(Date.UTC(2026, 7, 31, 23, 59, 59, 999));

async function traceLetter(letterId: string) {
  const letter = await prisma.letter.findUnique({
    where: { id: letterId },
    include: {
      employee: {
        select: { id: true, employeeCode: true, fullName: true },
      },
      acknowledgement: true,
      whatsappSend: true,
      replies: true,
    },
  });

  if (!letter) {
    return { letterId, found: false };
  }

  const vars = (letter.variables ?? {}) as Record<string, unknown>;
  const hasLateOccurrence = vars.monthlyLateOccurrence != null;
  const hasMissingCheckoutOccurrence =
    vars.monthlyMissingCheckoutOccurrence != null;
  const hasIncidentDate = vars.incidentDate != null;

  // Independent recomputation of this employee's true August late incidents,
  // identical definition to the main audit (LATE, or lateness-driven
  // HALF_DAY excluding short-leave-noted rows).
  const trueLateIncidents = await prisma.attendanceLog.findMany({
    where: {
      employeeId: letter.employeeId,
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
    select: { id: true, date: true, status: true, checkIn: true, lateMinutes: true, note: true },
    orderBy: { date: 'asc' },
  });

  // Independent recomputation of this employee's true August missing-checkout
  // incidents — same category discipline.helper.ts's own applyMissingCheckoutDiscipline counts.
  const trueMissingCheckoutIncidents = await prisma.attendanceLog.findMany({
    where: {
      employeeId: letter.employeeId,
      type: AttendanceLogType.REGULAR,
      date: { gte: MONTH_START, lte: MONTH_END },
      checkIn: { not: null },
      checkOut: null,
    },
    select: { id: true, date: true, checkIn: true },
    orderBy: { date: 'asc' },
  });

  let classification:
    | 'KEEP'
    | 'WRONG_SEQUENCE'
    | 'DUPLICATE'
    | 'OTHER_DISCIPLINE'
    | 'NEEDS_MANUAL_REVIEW';
  let classificationReason: string;

  if (hasMissingCheckoutOccurrence && !hasLateOccurrence) {
    classification = 'OTHER_DISCIPLINE';
    classificationReason = `variables.monthlyMissingCheckoutOccurrence=${vars.monthlyMissingCheckoutOccurrence} is present and monthlyLateOccurrence is absent — this letter belongs to the Missing-Checkout discipline cycle (applyMissingCheckoutDiscipline), not the Late-arrival cycle, even though both cycles can issue a WARNING-type letter. This employee has ${trueMissingCheckoutIncidents.length} true missing-checkout incident(s) this month, independent of their ${trueLateIncidents.length} true late incident(s).`;
  } else if (hasLateOccurrence && hasIncidentDate) {
    const matchesTrueIncident = trueLateIncidents.some(
      (l) => l.date.toISOString().slice(0, 10) === vars.incidentDate,
    );
    if (!matchesTrueIncident) {
      classification = 'WRONG_SEQUENCE';
      classificationReason = `Letter claims incidentDate=${String(vars.incidentDate)} but no AttendanceLog row with that date is currently LATE/lateness-HALF_DAY for this employee — either the date was later corrected (Short Leave, etc.) without this letter being reversed, or the letter was generated incorrectly.`;
    } else if (trueLateIncidents.length === 1 && vars.monthlyLateOccurrence !== 1) {
      classification = 'WRONG_SEQUENCE';
      classificationReason = `Employee has only ${trueLateIncidents.length} true late incident this month, but this letter carries monthlyLateOccurrence=${String(vars.monthlyLateOccurrence)} (expected 1). Occurrence recomputation mismatch.`;
    } else {
      classification = 'KEEP';
      classificationReason = `Late-cycle letter with a structured incidentDate that matches a true LATE/lateness-HALF_DAY AttendanceLog row, and occurrence is consistent with the ${trueLateIncidents.length} true incident(s) this month.`;
    }
  } else {
    classification = 'NEEDS_MANUAL_REVIEW';
    classificationReason =
      'No structured monthlyLateOccurrence/monthlyMissingCheckoutOccurrence/incidentDate found in variables — legacy/unstructured letter metadata, predates structured linking. Cannot be automatically classified against attendance; requires manual inspection of `content`.';
  }

  return {
    letterId,
    found: true,
    letterNo: letter.letterNo,
    letterType: letter.letterType,
    generatedAt: letter.generatedAt.toISOString(),
    printedAt: letter.printedAt ? letter.printedAt.toISOString() : null,
    templateCode: letter.templateCode,
    templateVersion: letter.templateVersion,
    requiresAcknowledgement: letter.requiresAcknowledgement,
    acknowledged: !!letter.acknowledgement,
    isReplied: letter.isReplied,
    whatsappSharedAt: letter.whatsappSharedAt
      ? letter.whatsappSharedAt.toISOString()
      : null,
    employee: letter.employee,
    variables: letter.variables,
    content: letter.content,
    trueAugustLateIncidentCount: trueLateIncidents.length,
    trueAugustLateIncidents: trueLateIncidents.map((l) => ({
      attendanceLogId: l.id,
      date: l.date.toISOString().slice(0, 10),
      status: l.status,
      checkIn: l.checkIn ? l.checkIn.toISOString() : null,
      lateMinutes: l.lateMinutes,
      note: l.note,
    })),
    trueAugustMissingCheckoutIncidentCount: trueMissingCheckoutIncidents.length,
    trueAugustMissingCheckoutIncidents: trueMissingCheckoutIncidents.map((l) => ({
      attendanceLogId: l.id,
      date: l.date.toISOString().slice(0, 10),
      checkIn: l.checkIn ? l.checkIn.toISOString() : null,
    })),
    classification,
    classificationReason,
  };
}

async function gatherPhaseEData(employeeCode: string) {
  const employee = await prisma.employee.findUnique({
    where: { employeeCode },
    select: { id: true, employeeCode: true, fullName: true },
  });
  if (!employee) {
    return { employeeCode, found: false };
  }

  const letters = await prisma.letter.findMany({
    where: {
      employeeId: employee.id,
      letterType: { in: [LetterType.ADVICE, LetterType.WARNING, LetterType.FINE, LetterType.SUSPENSION] },
      generatedAt: { gte: MONTH_START, lte: MONTH_END },
    },
    select: {
      id: true,
      letterNo: true,
      letterType: true,
      generatedAt: true,
      variables: true,
      acknowledgement: { select: { id: true } },
    },
    orderBy: [{ generatedAt: 'asc' }, { id: 'asc' }], // deterministic: generatedAt primary, id tie-break — NEVER referenceNumber
  });

  const trueLateIncidents = await prisma.attendanceLog.findMany({
    where: {
      employeeId: employee.id,
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
    select: { id: true, date: true, checkIn: true, lateMinutes: true },
    orderBy: { date: 'asc' },
  });

  // Group by (incidentDate|monthlyLateOccurrence) key exactly like the main
  // audit's duplicate detector, then apply "earliest generatedAt wins,
  // deterministic id tie-break" to name KEEP vs VOID explicitly.
  const groups = new Map<
    string,
    { id: string; letterNo: string | null; letterType: string; generatedAt: string; acknowledged: boolean }[]
  >();
  for (const l of letters) {
    const vars = (l.variables ?? {}) as { incidentDate?: string; monthlyLateOccurrence?: number };
    const key = `${vars.incidentDate ?? 'UNLINKED'}|${vars.monthlyLateOccurrence ?? 'UNLINKED'}`;
    const arr = groups.get(key) ?? [];
    arr.push({
      id: l.id,
      letterNo: l.letterNo,
      letterType: l.letterType,
      generatedAt: l.generatedAt.toISOString(),
      acknowledged: !!l.acknowledgement,
    });
    groups.set(key, arr);
  }

  const cleanupPlan = [...groups.entries()]
    .filter(([key, arr]) => key !== 'UNLINKED|UNLINKED' && arr.length > 1)
    .map(([key, arr]) => {
      // Already sorted generatedAt asc, id asc from the query itself.
      const [keep, ...voidList] = arr;
      return {
        key,
        keep,
        void: voidList,
      };
    });

  return {
    employeeCode,
    found: true,
    employeeId: employee.id,
    employeeName: employee.fullName,
    trueAugustLateIncidentCount: trueLateIncidents.length,
    trueAugustLateIncidents: trueLateIncidents.map((l) => ({
      attendanceLogId: l.id,
      date: l.date.toISOString().slice(0, 10),
      checkIn: l.checkIn ? l.checkIn.toISOString() : null,
      lateMinutes: l.lateMinutes,
    })),
    allAugustLateLetters: letters.map((l) => {
      const vars = (l.variables ?? {}) as Record<string, unknown>;
      return {
        id: l.id,
        letterNo: l.letterNo,
        letterType: l.letterType,
        generatedAt: l.generatedAt.toISOString(),
        incidentDate: vars.incidentDate ?? null,
        monthlyLateOccurrence: vars.monthlyLateOccurrence ?? null,
        monthlyMissingCheckoutOccurrence: vars.monthlyMissingCheckoutOccurrence ?? null,
        reversedDueToShortLeave: vars.reversedDueToShortLeave ?? false,
        acknowledged: !!l.acknowledgement,
      };
    }),
    cleanupPlan,
  };
}

async function main() {
  console.error('=== READ-ONLY: Phase C letter trace + Phase E timestamp gathering ===');

  const letterTrace = await traceLetter(TARGET_LETTER_ID);

  const phaseEData = [];
  for (const code of CONFIRMED_DUPLICATE_EMPLOYEE_CODES) {
    phaseEData.push(await gatherPhaseEData(code));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    phaseC_letterTrace: letterTrace,
    phaseE_confirmedDuplicateEmployees: phaseEData,
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
