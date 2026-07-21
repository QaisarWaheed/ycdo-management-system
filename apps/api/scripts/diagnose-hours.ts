import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const employeeId = process.argv[2];

  if (!employeeId) {
    // Find employees with the most negative total worked minutes
    const logs = await prisma.attendanceLog.findMany({
      where: { checkIn: { not: null }, checkOut: { not: null } },
      select: {
        employeeId: true,
        date: true,
        checkIn: true,
        checkOut: true,
        employee: {
          select: {
            fullName: true,
            employeeCode: true,
            dutyStartTime: true,
            dutyEndTime: true,
          },
        },
      },
    });

    const byEmp = new Map<
      string,
      { name: string; code: string; mins: number; neg: number; duty: string }
    >();

    for (const l of logs) {
      if (!l.checkIn || !l.checkOut) continue;
      const mins = Math.round(
        (l.checkOut.getTime() - l.checkIn.getTime()) / 60000,
      );
      const cur = byEmp.get(l.employeeId) ?? {
        name: l.employee.fullName,
        code: l.employee.employeeCode,
        mins: 0,
        neg: 0,
        duty: `${l.employee.dutyStartTime ?? '—'}→${l.employee.dutyEndTime ?? '—'}`,
      };
      cur.mins += mins;
      if (mins < 0) cur.neg += 1;
      byEmp.set(l.employeeId, cur);
    }

    const worst = [...byEmp.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .filter((e) => e.mins < 0 || e.neg > 0)
      .sort((a, b) => a.mins - b.mins)
      .slice(0, 15);

    console.log('Top negative / anomalous employees:');
    for (const e of worst) {
      console.log(
        `${e.id} | ${e.code} ${e.name} | totalMins=${e.mins} (${(e.mins / 60).toFixed(2)}h) | negRows=${e.neg} | duty=${e.duty}`,
      );
    }

    const formats = await prisma.$queryRaw`
      SELECT DISTINCT "dutyStartTime" FROM "Employee" WHERE "dutyStartTime" IS NOT NULL LIMIT 40
    `;
    console.log('Distinct dutyStartTime sample:', formats);

    const endFormats = await prisma.$queryRaw`
      SELECT DISTINCT "dutyEndTime" FROM "Employee" WHERE "dutyEndTime" IS NOT NULL LIMIT 40
    `;
    console.log('Distinct dutyEndTime sample:', endFormats);

    const shiftFormats = await prisma.$queryRaw`
      SELECT DISTINCT "startTime", "endTime" FROM "Shift" LIMIT 40
    `;
    console.log('Distinct Shift times sample:', shiftFormats);
    return;
  }

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { shift: true },
  });
  console.log('Employee:', emp?.employeeCode, emp?.fullName);
  console.log(
    'Employee duty fields:',
    emp?.dutyStartTime,
    '→',
    emp?.dutyEndTime,
  );
  console.log(
    'Assigned shift times:',
    emp?.shift?.startTime,
    '→',
    emp?.shift?.endTime,
    `(${emp?.shift?.name ?? 'no shift'})`,
  );

  const logs = await prisma.attendanceLog.findMany({
    where: { employeeId },
    orderBy: { date: 'asc' },
  });

  let total = 0;
  let negCount = 0;
  for (const l of logs) {
    const ci = l.checkIn ? new Date(l.checkIn) : null;
    const co = l.checkOut ? new Date(l.checkOut) : null;
    const mins =
      ci && co
        ? Math.round((co.getTime() - ci.getTime()) / 60000)
        : null;
    if (mins != null) total += mins;
    if (mins != null && mins < 0) negCount += 1;
    console.log(
      `${l.date.toISOString().slice(0, 10)} | type=${l.type} | in=${ci?.toISOString() ?? '—'} | out=${co?.toISOString() ?? '—'} | mins=${mins}${mins !== null && mins < 0 ? '  ← NEGATIVE' : ''}`,
    );
  }
  console.log(
    `TOTAL mins=${total} hours=${(total / 60).toFixed(2)} negRows=${negCount}`,
  );

  const formats = await prisma.$queryRaw`
    SELECT DISTINCT "dutyStartTime" FROM "Employee" WHERE "dutyStartTime" IS NOT NULL LIMIT 30
  `;
  console.log('Distinct dutyStartTime formats sample:', formats);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
