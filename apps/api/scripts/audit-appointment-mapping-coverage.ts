/**
 * Read-only Appointment mapping coverage vs intended catalog.
 * Usage (from apps/api):
 *   npx ts-node -r tsconfig-paths/register scripts/audit-appointment-mapping-coverage.ts
 */
import { PrismaClient } from '@prisma/client';
import { reportAppointmentMappingCoverage } from '../prisma/seeds/appointment-mappings.seed';

async function main() {
  const prisma = new PrismaClient();
  try {
    const report = await reportAppointmentMappingCoverage(prisma);
    console.log(report.text);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
