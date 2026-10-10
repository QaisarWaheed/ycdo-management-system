import {
  LetterStatus,
  LetterType,
  Prisma,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import {
  DEFAULT_SENDER_TITLE,
  buildLetterRef,
  defaultSubjectFor,
  parseViolationLines,
  templateCodeForLetterType,
} from './letter-templates.helper';
import { formatIssueDatePkt, pktYear } from './selection-letter.helper';

type Db = Prisma.TransactionClient | PrismaClient;

async function nextLetterNo(db: Db): Promise<string> {
  const rows = await db.$queryRaw<{ nextval: bigint }[]>`
    SELECT nextval('letter_no_seq') AS nextval
  `;
  const next = rows[0]?.nextval;
  if (next == null) {
    throw new Error('Failed to allocate letter number');
  }
  return `${next}/YCDO/${pktYear()}`;
}

async function loadEmployee(db: Db, employeeId: string) {
  return db.employee.findUnique({
    where: { id: employeeId },
    include: {
      currentBranch: { select: { name: true } },
      currentDepartment: { select: { name: true } },
      user: { select: { role: true } },
    },
  });
}

/**
 * Create an auto-generated discipline letter as DRAFT with Urdu PDF.
 * Does not notify the employee or send WhatsApp — HR proofreads in Draft,
 * then Send publishes to the portal and WhatsApp.
 * Safe to call from discipline transactions; keeps content + fileUrl together.
 */
export async function issueAutoTemplatedLetter(
  db: Db,
  input: {
    employeeId: string;
    letterType: LetterType;
    extraFields: Record<string, unknown>;
    requiresAcknowledgement?: boolean;
    replyDeadline?: Date | null;
    notificationMessage: string;
    notificationType: string;
  },
): Promise<void> {
  if (input.letterType === LetterType.SUSPENSION) {
    throw new Error(
      'Automatic SENT suspension letters are not allowed. Use the approved suspension Issue flow.',
    );
  }

  const employee = await loadEmployee(db, input.employeeId);
  if (!employee) return;

  const code = templateCodeForLetterType(input.letterType);
  const template = await db.letterTemplate.findFirst({
    where: { code, active: true },
  });

  const letterNo = await nextLetterNo(db);
  const issueDate = formatIssueDatePkt();

  const violations = parseViolationLines(
    input.extraFields.violations ?? input.extraFields.warningReason,
  );

  const variables: Record<string, unknown> = {
    ...input.extraFields,
    violations,
    issueDate,
    senderTitle:
      String(input.extraFields.senderTitle ?? '').trim() ||
      DEFAULT_SENDER_TITLE,
    subject:
      String(input.extraFields.subject ?? '').trim() ||
      defaultSubjectFor(input.letterType),
    employeeName: employee.fullName,
    employeeCode: employee.employeeCode,
    designation: employee.currentDesignation ?? '',
    department: employee.currentDepartment?.name ?? '',
    role: employee.user?.role ?? '',
    branch: employee.currentBranch?.name ?? '',
    cnic: employee.cnic ?? '',
    letterNo,
    letterRef: buildLetterRef(
      input.letterType,
      letterNo,
      template?.letterCode,
    ),
  };

  // No PDF here: this runs inside attendance / scheduler transactions (5 s
  // limit) and Chromium alone took 6–9 s, expiring them (P2028) so the whole
  // attendance save failed. The PDF is built from these stored variables the
  // first time the draft is downloaded or sent (LettersService.getPdf).
  const fileUrl: string | null = null;

  await db.letter.create({
    data: {
      employeeId: input.employeeId,
      letterType: input.letterType,
      status: LetterStatus.DRAFT,
      content: input.extraFields as Prisma.InputJsonValue,
      letterNo,
      variables: variables as Prisma.InputJsonValue,
      templateVersion: template?.version ?? null,
      fileUrl,
      // Acknowledgement + reply window start only when HR Send publishes.
      requiresAcknowledgement: false,
      replyDeadline: undefined,
    },
  });

  const hrManagers = await db.user.findMany({
    where: { role: UserRole.HR_MANAGER, isActive: true },
  });
  const letterLabel = input.letterType.replace(/_/g, ' ');
  const hrMessage =
    input.notificationMessage ||
    `Draft ${letterLabel} letter (${letterNo}) is ready for proofread and send.`;
  for (const hr of hrManagers) {
    if (!hr.employeeId) continue;
    await db.notification.create({
      data: {
        employeeId: hr.employeeId,
        type: input.notificationType || 'DRAFT_LETTER_READY',
        message: `${employee.fullName}: ${hrMessage}`,
      },
    });
  }
}
