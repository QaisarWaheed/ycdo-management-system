import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Financial replacement and competing writers lock the existing employee row first. */
export async function lockPayrollEmployee(tx: Prisma.TransactionClient, employeeId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Employee" WHERE "id" = ${employeeId} FOR UPDATE`;
}

export async function withPayrollEmployeeTransaction<T>(
  prisma: PrismaService,
  employeeId: string | string[],
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        for (const id of [...new Set(Array.isArray(employeeId) ? employeeId : [employeeId])].sort()) await lockPayrollEmployee(tx, id);
        return work(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000, maxWait: 20_000 });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (attempt >= 3 || !['P2034', 'P2002'].includes(code ?? '')) throw error;
    }
  }
}

/** Existing nested service transactions participate in the outer atomic operation. */
export function payrollTransactionClient(tx: Prisma.TransactionClient): PrismaService {
  return new Proxy(tx, {
    get(target, key) {
      if (key === '$transaction') return (work: unknown) =>
        typeof work === 'function' ? work(target) : Promise.all(work as Promise<unknown>[]);
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as PrismaService;
}
