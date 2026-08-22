/**
 * Recomputes every PENDING payroll entry for a month via createOrGetEntry,
 * which automatically repairs missing/incorrect LATE discipline before
 * syncing deductions (see PayrollService + repairLateDisciplineForPayrollMonth).
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/repair-late-discipline-all.ts [year] [month]
 */
import { PayrollStatus, PrismaClient } from '@prisma/client';
import { PayrollService } from '../src/modules/payroll/payroll.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccessScopeService } from '../src/modules/permissions/access-scope.service';

const prisma = new PrismaClient();
const year = Number(process.argv[2] ?? 2026);
const month = Number(process.argv[3] ?? 8);

async function main() {
  const payrollService = new PayrollService(
    prisma as unknown as PrismaService,
    {} as unknown as AccessScopeService,
  );

  const pendingEntries = await prisma.payrollEntry.findMany({
    where: { month, year, status: PayrollStatus.PENDING },
    include: {
      stipendRecord: {
        select: {
          employeeId: true,
          employee: { select: { employeeCode: true, fullName: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(
    `Recomputing ${pendingEntries.length} PENDING payroll entries — ${year}-${String(month).padStart(2, '0')} (late discipline auto-repair included)\n`,
  );

  let recomputed = 0;
  let failed = 0;

  for (const entry of pendingEntries) {
    const employeeId = entry.stipendRecord.employeeId;
    const label = `${entry.stipendRecord.employee.employeeCode} ${entry.stipendRecord.employee.fullName}`;

    try {
      await payrollService.createOrGetEntry({ employeeId, month, year });
      recomputed += 1;
      if (recomputed % 25 === 0) {
        console.log(`… ${recomputed}/${pendingEntries.length} done`);
      }
    } catch (err) {
      failed += 1;
      console.error(`${label}: FAILED — ${(err as Error).message}`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Employees processed: ${pendingEntries.length}`);
  console.log(`Payroll entries recomputed: ${recomputed}`);
  console.log(`Failures: ${failed}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
