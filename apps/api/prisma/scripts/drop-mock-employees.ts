/**
 * One-off: delete seeded mock employees + their portal users.
 * Keeps system logins (admin, IT, HR, branch accounts, etc.).
 *
 * Run: npx ts-node prisma/scripts/drop-mock-employees.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** CNICs from prisma/seed.ts seedEmployees + mockEmployees */
const MOCK_CNICS = [
  '36302-1234567-1', // Ahmed Khan
  '36302-7654321-2', // Sara Ali
  '36302-1111111-1', // Muhammad Usman
  '36302-2222222-2', // Ayesha Malik
  '36302-3333333-3', // Hassan Raza
  '36302-4444444-4', // Fatima Zahra
  '36302-5555555-5', // Bilal Ahmed
  '36302-6666666-6', // Zainab Hussain
  '36302-7777777-7', // Omar Farooq
  '36302-8888888-8', // Sana Tariq
  '36302-9999999-9', // Tariq Mehmood
  '36302-0000001-0', // Nadia Iqbal
];

const MOCK_EMAILS = [
  'ahmed.khan@ycdo.org',
  'sara.ali@ycdo.org',
  'muhammad.usman@ycdo.org',
  'ayesha.malik@ycdo.org',
  'hassan.raza@ycdo.org',
  'fatima.zahra@ycdo.org',
  'bilal.ahmed@ycdo.org',
  'zainab.hussain@ycdo.org',
  'omar.farooq@ycdo.org',
  'sana.tariq@ycdo.org',
  'tariq.mehmood@ycdo.org',
  'nadia.iqbal@ycdo.org',
];

async function removeEmployeeCascade(id: string) {
  await prisma.$transaction(
    async (tx) => {
    const leaveIds = (
      await tx.leaveRecord.findMany({
        where: { employeeId: id },
        select: { id: true },
      })
    ).map((row) => row.id);

    if (leaveIds.length > 0) {
      await tx.leaveApproval.deleteMany({
        where: { leaveId: { in: leaveIds } },
      });
      await tx.relieverRequest.deleteMany({
        where: { leaveRecordId: { in: leaveIds } },
      });
    }

    await tx.relieverRequest.deleteMany({
      where: {
        OR: [{ requestedById: id }, { relieverId: id }],
      },
    });

    await tx.leaveRecord.deleteMany({ where: { employeeId: id } });

    const letterIds = (
      await tx.letter.findMany({
        where: { employeeId: id },
        select: { id: true },
      })
    ).map((row) => row.id);

    if (letterIds.length > 0) {
      await tx.allegationAcknowledgement.deleteMany({
        where: { letterId: { in: letterIds } },
      });
      await tx.letterReply.deleteMany({
        where: { letterId: { in: letterIds } },
      });
      await tx.whatsAppLetterSend.deleteMany({
        where: { letterId: { in: letterIds } },
      });
    }

    await tx.letterReply.deleteMany({ where: { employeeId: id } });
    await tx.allegationAcknowledgement.deleteMany({
      where: { employeeId: id },
    });
    await tx.whatsAppLetterSend.deleteMany({ where: { employeeId: id } });
    await tx.letter.deleteMany({ where: { employeeId: id } });

    const disciplinaryIds = (
      await tx.disciplinaryAction.findMany({
        where: { employeeId: id },
        select: { id: true },
      })
    ).map((row) => row.id);

    if (disciplinaryIds.length > 0) {
      await tx.inquiry.deleteMany({
        where: { disciplinaryActionId: { in: disciplinaryIds } },
      });
    }

    await tx.disciplinaryAction.deleteMany({ where: { employeeId: id } });

    const stipendIds = (
      await tx.stipendRecord.findMany({
        where: { employeeId: id },
        select: { id: true },
      })
    ).map((row) => row.id);

    const payrollIds =
      stipendIds.length > 0
        ? (
            await tx.payrollEntry.findMany({
              where: { stipendRecordId: { in: stipendIds } },
              select: { id: true },
            })
          ).map((row) => row.id)
        : [];

    if (payrollIds.length > 0) {
      await tx.payrollDeduction.deleteMany({
        where: { payrollEntryId: { in: payrollIds } },
      });
      await tx.allowance.deleteMany({
        where: { payrollEntryId: { in: payrollIds } },
      });
      await tx.stipendReceipt.deleteMany({
        where: { payrollEntryId: { in: payrollIds } },
      });
      await tx.payrollEntry.deleteMany({
        where: { id: { in: payrollIds } },
      });
    }

    await tx.stipendReceipt.deleteMany({ where: { employeeId: id } });
    await tx.stipendRecord.deleteMany({ where: { employeeId: id } });
    await tx.portalAttendance.deleteMany({ where: { employeeId: id } });
    await tx.advanceLoanRequest.deleteMany({ where: { employeeId: id } });
    await tx.incentive.deleteMany({ where: { employeeId: id } });
    await tx.relieverSession.deleteMany({ where: { employeeId: id } });
    await tx.notification.deleteMany({ where: { employeeId: id } });
    await tx.attendanceLog.deleteMany({ where: { employeeId: id } });
    await tx.employeeDocument.deleteMany({ where: { employeeId: id } });
    await tx.academicQualification.deleteMany({ where: { employeeId: id } });
    await tx.previousEmployment.deleteMany({ where: { employeeId: id } });
    await tx.branchChangeRequest.deleteMany({ where: { employeeId: id } });
    await tx.employmentHistory.deleteMany({ where: { employeeId: id } });
    await tx.additionalWorkingDay.deleteMany({ where: { employeeId: id } });
    await tx.faceSyncJob.deleteMany({ where: { employeeId: id } });
    await tx.mutualSwap.deleteMany({
      where: {
        OR: [{ coveringEmployeeId: id }, { coveredEmployeeId: id }],
      },
    });
    await tx.employeeOnboardingApproval.deleteMany({
      where: { employeeId: id },
    });

    const user = await tx.user.findUnique({
      where: { employeeId: id },
      select: { id: true },
    });

    if (user) {
      await tx.userAdditionalRole.deleteMany({ where: { userId: user.id } });
      await tx.userManagerScope.deleteMany({ where: { userId: user.id } });
      await tx.userPermission.deleteMany({ where: { userId: user.id } });
      await tx.leaveApproval.deleteMany({ where: { actionBy: user.id } });
      await tx.notificationBroadcast.deleteMany({
        where: { createdById: user.id },
      });
      await tx.incentive.deleteMany({ where: { addedBy: user.id } });
      await tx.auditLog.deleteMany({ where: { userId: user.id } });
      await tx.userPassword.deleteMany({ where: { userId: user.id } });
      await tx.user.delete({ where: { id: user.id } });
    }

    await tx.employee.delete({ where: { id } });
    },
    { timeout: 60_000 },
  );
}

async function main() {
  const employees = await prisma.employee.findMany({
    where: {
      OR: [
        { cnic: { in: MOCK_CNICS } },
        { email: { in: MOCK_EMAILS } },
      ],
    },
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      email: true,
      cnic: true,
    },
  });

  if (employees.length === 0) {
    console.log('No seeded mock employees found. Nothing to delete.');
    return;
  }

  console.log(`Found ${employees.length} mock employee(s) to remove:\n`);
  for (const emp of employees) {
    console.log(
      `  - ${emp.fullName} (${emp.employeeCode}) ${emp.email ?? ''} ${emp.cnic ?? ''}`,
    );
  }

  for (const emp of employees) {
    await removeEmployeeCascade(emp.id);
    console.log(`Deleted: ${emp.fullName} (${emp.employeeCode})`);
  }

  console.log(
    `\nDone. Removed ${employees.length} mock employee(s) and their portal users.`,
  );
  console.log('System logins (admin / IT / HR / branch accounts) were kept.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
