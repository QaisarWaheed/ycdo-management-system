/**
 * Recomputes stored late minutes / pre-duty overtime with the corrected
 * check-in rules, and realigns each attendance log's branch with the
 * employee's current posting.
 *
 * Dry-run by default:  npx ts-node scripts/repair-late-and-branch.ts
 * Write changes:       npx ts-node scripts/repair-late-and-branch.ts --apply
 */
import { PrismaClient } from '@prisma/client';
import { assessCheckIn, parseDutyTimeToMinutes } from '../src/common/duty.util';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

const PK_OFFSET_MS = 5 * 60 * 60 * 1000;

function pakistanMinutesOfDay(date: Date): number {
  const pk = new Date(date.getTime() + PK_OFFSET_MS);
  return pk.getUTCHours() * 60 + pk.getUTCMinutes();
}

async function main() {
  console.log(apply ? 'APPLY mode' : 'DRY-RUN (pass --apply to write)');

  const rows = await prisma.attendanceLog.findMany({
    where: { checkIn: { not: null } },
    include: {
      employee: {
        select: {
          employeeCode: true,
          fullName: true,
          dutyStartTime: true,
          dutyEndTime: true,
          currentBranchId: true,
        },
      },
    },
    orderBy: { date: 'desc' },
  });

  let lateFixed = 0;
  let branchFixed = 0;
  let skipped = 0;

  for (const row of rows) {
    const data: { lateMinutes?: number; branchId?: string } = {};

    const dutyStart = row.employee.dutyStartTime?.trim();
    if (row.checkIn && dutyStart) {
      try {
        const { lateMinutes } = assessCheckIn(
          pakistanMinutesOfDay(row.checkIn),
          parseDutyTimeToMinutes(dutyStart),
        );
        if (lateMinutes !== row.lateMinutes) {
          console.log(
            `LATE ${row.employee.employeeCode} ${row.employee.fullName} | ${row.date.toISOString().slice(0, 10)} | duty=${dutyStart} | ${row.lateMinutes} → ${lateMinutes}`,
          );
          data.lateMinutes = lateMinutes;
          lateFixed += 1;
        }
      } catch {
        skipped += 1;
      }
    }

    const employeeBranchId = row.employee.currentBranchId;
    if (employeeBranchId && row.branchId !== employeeBranchId) {
      console.log(
        `BRANCH ${row.employee.employeeCode} ${row.employee.fullName} | ${row.date.toISOString().slice(0, 10)} | ${row.branchId ?? 'null'} → ${employeeBranchId}`,
      );
      data.branchId = employeeBranchId;
      branchFixed += 1;
    }

    if (apply && Object.keys(data).length > 0) {
      await prisma.attendanceLog.update({ where: { id: row.id }, data });
    }
  }

  console.log(
    `\nScanned ${rows.length} logs | late recalculated: ${lateFixed} | branch realigned: ${branchFixed} | unparseable duty times: ${skipped}`,
  );
  if (!apply) console.log('Nothing written. Re-run with --apply to persist.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
