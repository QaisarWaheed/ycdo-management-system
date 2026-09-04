/**
 * One-shot data fix: Rubab Rana (YCDO-2026-0320).
 *
 * HR saved her raise with effectiveFrom ~28 Aug 2026. Management ordered
 * the increment from month day 1 — move the open package to 1 Aug 2026
 * and close the prior package on the same seam. Then recompute PENDING
 * August 2026 payroll for her.
 *
 * Dry-run (default):
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/fix-rubab-rana-stipend-aug1-2026.ts
 *
 * Apply:
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/fix-rubab-rana-stipend-aug1-2026.ts --apply
 */

import { PayrollStatus, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EMPLOYEE_CODE = 'YCDO-2026-0320';
const TARGET_EFFECTIVE_FROM = new Date(Date.UTC(2026, 7, 1)); // 1 Aug 2026
const APPLY = process.argv.includes('--apply');

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function main() {
  const employee = await prisma.employee.findFirst({
    where: {
      OR: [
        { employeeCode: EMPLOYEE_CODE },
        { employeeCode: { equals: EMPLOYEE_CODE, mode: 'insensitive' } },
        { fullName: { contains: 'Rubab', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      joiningDate: true,
    },
  });

  if (!employee) {
    console.log(JSON.stringify({ error: `Employee ${EMPLOYEE_CODE} not found` }));
    return;
  }

  if (
    employee.employeeCode.replace(/\s+/g, '') !==
    EMPLOYEE_CODE.replace(/\s+/g, '')
  ) {
    console.log(
      JSON.stringify(
        {
          error: 'Name matched but employeeCode is not YCDO-2026-0320 — aborting',
          employee,
        },
        null,
        2,
      ),
    );
    return;
  }

  const stipends = await prisma.stipendRecord.findMany({
    where: { employeeId: employee.id },
    orderBy: { effectiveFrom: 'asc' },
    select: {
      id: true,
      basicStipend: true,
      allowances: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  });

  const active = [...stipends].reverse().find((s) => s.effectiveTo == null);
  if (!active) {
    console.log(JSON.stringify({ error: 'No open stipend record', employee, stipends }, null, 2));
    return;
  }

  const previousSeam = stipends.filter(
    (s) =>
      s.id !== active.id &&
      s.effectiveTo &&
      s.effectiveTo.getTime() === active.effectiveFrom.getTime(),
  );

  const augustEntries = await prisma.payrollEntry.findMany({
    where: {
      month: 8,
      year: 2026,
      stipendRecord: { employeeId: employee.id },
    },
    select: {
      id: true,
      status: true,
      stipendRecordId: true,
      basicStipend: true,
      totalAllowances: true,
      totalDeductions: true,
      netStipend: true,
    },
  });

  const plan = {
    mode: APPLY ? 'APPLY' : 'DRY_RUN',
    employee,
    before: {
      active: {
        id: active.id,
        basicStipend: Number(active.basicStipend),
        effectiveFrom: iso(active.effectiveFrom),
        effectiveTo: iso(active.effectiveTo),
      },
      priorClosedOnActiveStart: previousSeam.map((s) => ({
        id: s.id,
        basicStipend: Number(s.basicStipend),
        effectiveFrom: iso(s.effectiveFrom),
        effectiveTo: iso(s.effectiveTo),
      })),
      augustPayroll: augustEntries.map((e) => ({
        ...e,
        basicStipend: Number(e.basicStipend),
        totalAllowances: Number(e.totalAllowances),
        totalDeductions: Number(e.totalDeductions),
        netStipend: Number(e.netStipend),
      })),
    },
    after: {
      activeEffectiveFrom: iso(TARGET_EFFECTIVE_FROM),
      priorEffectiveTo: iso(TARGET_EFFECTIVE_FROM),
      note: 'Pending August payroll must be regenerated from HRMS (Generate / recompute) after apply so Basic uses the full raised package.',
    },
  };

  if (!APPLY) {
    console.log(JSON.stringify(plan, null, 2));
    console.log('\nRe-run with --apply to write.');
    return;
  }

  if (active.effectiveFrom.getTime() === TARGET_EFFECTIVE_FROM.getTime()) {
    console.log(
      JSON.stringify({
        skipped: true,
        reason: 'Active stipend already starts 1 Aug 2026',
        plan,
      }, null, 2),
    );
    return;
  }

  const frozen = augustEntries.filter(
    (e) =>
      e.status === PayrollStatus.PROCESSED || e.status === PayrollStatus.PAID,
  );
  if (frozen.length > 0) {
    console.log(
      JSON.stringify(
        {
          error:
            'August payroll is PROCESSED/PAID — refuse automatic stipend date move. Unlock or handle manually.',
          frozen,
        },
        null,
        2,
      ),
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    const actor =
      (await tx.user.findFirst({
        where: { isActive: true, role: 'IT_ADMIN' },
        select: { id: true },
      })) ??
      (await tx.user.findFirst({
        where: { isActive: true, role: 'HR_MANAGER' },
        select: { id: true },
      })) ??
      (await tx.user.findFirst({
        where: { isActive: true },
        select: { id: true },
      }));
    if (!actor) {
      throw new Error('No active user to attribute audit log');
    }

    if (previousSeam.length > 0) {
      await tx.stipendRecord.updateMany({
        where: { id: { in: previousSeam.map((s) => s.id) } },
        data: { effectiveTo: TARGET_EFFECTIVE_FROM },
      });
    }

    await tx.stipendRecord.update({
      where: { id: active.id },
      data: { effectiveFrom: TARGET_EFFECTIVE_FROM },
    });

    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: 'STIPEND_PACKAGE_CORRECTED',
        entity: 'StipendRecord',
        entityId: active.id,
        changes: {
          reason:
            'Management order: Rubab Rana raise applies from 1 Aug 2026 (was ~28 Aug)',
          previousEffectiveFrom: active.effectiveFrom,
          newEffectiveFrom: TARGET_EFFECTIVE_FROM,
          employeeCode: EMPLOYEE_CODE,
          script: 'fix-rubab-rana-stipend-aug1-2026.ts',
        },
      },
    });
  });

  const afterStipends = await prisma.stipendRecord.findMany({
    where: { employeeId: employee.id },
    orderBy: { effectiveFrom: 'asc' },
    select: {
      id: true,
      basicStipend: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  });

  console.log(
    JSON.stringify(
      {
        applied: true,
        employee,
        stipends: afterStipends.map((s) => ({
          id: s.id,
          basicStipend: Number(s.basicStipend),
          effectiveFrom: iso(s.effectiveFrom),
          effectiveTo: iso(s.effectiveTo),
        })),
        nextStep:
          'In HRMS → Payroll → Monthly Payroll (August 2026) regenerate Rubab, or open her profile and recompute August. Pending entries will pick up full-month raised Basic.',
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
