import { PrismaClient } from '@prisma/client';
import { getDutyWindow } from '../src/common/duty.util';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  console.log(apply ? 'APPLY mode' : 'DRY-RUN (pass --apply to write)');

  const rows = await prisma.attendanceLog.findMany({
    where: {
      checkIn: { not: null },
      checkOut: { not: null },
    },
    include: {
      employee: {
        select: {
          id: true,
          employeeCode: true,
          fullName: true,
          dutyStartTime: true,
          dutyEndTime: true,
        },
      },
    },
  });

  let fixed = 0;
  const flagged: string[] = [];

  for (const row of rows) {
    if (!row.checkIn || !row.checkOut) continue;
    if (row.checkOut.getTime() >= row.checkIn.getTime()) continue;

    const win = getDutyWindow(row.employee);
    const line = `${row.employee.employeeCode} ${row.employee.fullName} | date=${row.date.toISOString().slice(0, 10)} | in=${row.checkIn.toISOString()} | out=${row.checkOut.toISOString()} | duty=${row.employee.dutyStartTime}→${row.employee.dutyEndTime}`;

    if (win?.crossesMidnight) {
      const nextOut = new Date(row.checkOut.getTime() + 24 * 60 * 60 * 1000);
      console.log(`FIX +1d: ${line} → out=${nextOut.toISOString()}`);
      fixed += 1;
      if (apply) {
        await prisma.attendanceLog.update({
          where: { id: row.id },
          data: { checkOut: nextOut },
        });
      }
    } else {
      flagged.push(line);
    }
  }

  console.log(`Fixed (cross-midnight +1 day): ${fixed}`);
  console.log(`Needs manual review: ${flagged.length}`);
  for (const f of flagged.slice(0, 50)) console.log('  ', f);
  if (flagged.length > 50) console.log(`  ... and ${flagged.length - 50} more`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
