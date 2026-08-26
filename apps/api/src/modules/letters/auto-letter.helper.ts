import { LetterStatus, LetterType, Prisma, PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_SENDER_TITLE,
  buildLetterRef,
  defaultSubjectFor,
  parseViolationLines,
  renderLetterHtml,
  sanitizeRefForFilename,
  templateCodeForLetterType,
} from './letter-templates.helper';
import { formatIssueDatePkt, pktYear } from './selection-letter.helper';
import { generatePdf } from './pdf.helper';

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
    },
  });
}

async function persistLocalPdf(
  pdfBuffer: Buffer,
  letterNo: string,
  employeeId: string,
): Promise<string> {
  const fileName = `${sanitizeRefForFilename(letterNo)}.pdf`;
  const dir = path.join(process.cwd(), 'uploads', 'letters', employeeId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), pdfBuffer);
  return `/uploads/letters/${employeeId}/${fileName}`;
}

/**
 * Issue an auto-generated letter (WARNING / SUSPENSION / FINE) with Urdu PDF.
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
    branch: employee.currentBranch?.name ?? '',
    cnic: employee.cnic ?? '',
    letterNo,
    letterRef: buildLetterRef(
      input.letterType,
      letterNo,
      template?.letterCode,
    ),
  };

  let fileUrl: string | null = null;
  if (template) {
    try {
      const html = renderLetterHtml(template.bodyHtml, variables);
      const pdf = await generatePdf(html);
      fileUrl = await persistLocalPdf(pdf, letterNo, input.employeeId);
    } catch (err) {
      // Letter row is still created; HR can reissue PDF if Puppeteer fails.
      console.error('Auto letter PDF generation failed:', err);
    }
  }

  await db.letter.create({
    data: {
      employeeId: input.employeeId,
      letterType: input.letterType,
      status: LetterStatus.SENT,
      content: input.extraFields as Prisma.InputJsonValue,
      letterNo,
      variables: variables as Prisma.InputJsonValue,
      templateVersion: template?.version ?? null,
      fileUrl,
      requiresAcknowledgement: input.requiresAcknowledgement ?? true,
      replyDeadline: input.replyDeadline ?? undefined,
    },
  });

  await db.notification.create({
    data: {
      employeeId: input.employeeId,
      message: input.notificationMessage,
      type: input.notificationType,
    },
  });
}
