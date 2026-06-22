import { PrismaService } from '../../prisma/prisma.service';

export async function generateEmployeeCode(
  prisma: PrismaService,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `YCDO-${year}-`;

  const lastEmployee = await prisma.employee.findFirst({
    where: {
      employeeCode: { startsWith: prefix },
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });

  let sequence = 1;
  if (lastEmployee) {
    const lastSequence = parseInt(
      lastEmployee.employeeCode.split('-').pop() ?? '0',
      10,
    );
    sequence = lastSequence + 1;
  }

  return `${prefix}${sequence.toString().padStart(4, '0')}`;
}
