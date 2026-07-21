import { PrismaClient } from '@prisma/client';
import { normalizeDutyTimeToHhMm } from '../src/common/duty.util';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function normalizeField(
  label: string,
  value: string | null | undefined,
): Promise<{ next: string | null; changed: boolean; error?: string }> {
  if (value == null || value === '') return { next: null, changed: false };
  try {
    const next = normalizeDutyTimeToHhMm(value);
    return { next, changed: next !== value.trim().substring(0, 5) && next !== value };
  } catch (err) {
    return {
      next: value,
      changed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  console.log(apply ? 'APPLY mode' : 'DRY-RUN (pass --apply to write)');

  const failed: string[] = [];
  let empChanged = 0;
  let shiftChanged = 0;

  const employees = await prisma.employee.findMany({
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      dutyStartTime: true,
      dutyEndTime: true,
    },
  });

  for (const emp of employees) {
    const start = await normalizeField('start', emp.dutyStartTime);
    const end = await normalizeField('end', emp.dutyEndTime);
    if (start.error || end.error) {
      failed.push(
        `Employee ${emp.employeeCode} ${emp.fullName}: start=${emp.dutyStartTime} end=${emp.dutyEndTime} (${start.error ?? end.error})`,
      );
      continue;
    }
    if (!start.changed && !end.changed) continue;
    empChanged += 1;
    console.log(
      `EMP ${emp.employeeCode}: ${emp.dutyStartTime}→${start.next}, ${emp.dutyEndTime}→${end.next}`,
    );
    if (apply) {
      await prisma.employee.update({
        where: { id: emp.id },
        data: {
          dutyStartTime: start.next,
          dutyEndTime: end.next,
        },
      });
    }
  }

  const shifts = await prisma.shift.findMany({
    select: { id: true, name: true, startTime: true, endTime: true },
  });

  for (const shift of shifts) {
    const start = await normalizeField('start', shift.startTime);
    const end = await normalizeField('end', shift.endTime);
    if (start.error || end.error) {
      failed.push(
        `Shift ${shift.name} ${shift.id}: ${shift.startTime}-${shift.endTime} (${start.error ?? end.error})`,
      );
      continue;
    }
    if (!start.changed && !end.changed) continue;
    if (!start.next || !end.next) continue;
    shiftChanged += 1;
    console.log(
      `SHIFT ${shift.name}: ${shift.startTime}→${start.next}, ${shift.endTime}→${end.next}`,
    );
    if (apply) {
      await prisma.shift.update({
        where: { id: shift.id },
        data: { startTime: start.next, endTime: end.next },
      });
    }
  }

  console.log(`Employees to change: ${empChanged}`);
  console.log(`Shifts to change: ${shiftChanged}`);
  if (failed.length) {
    console.log('Failed to parse (manual fix needed):');
    for (const f of failed) console.log('  ', f);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
