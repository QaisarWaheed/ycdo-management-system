import {
  LetterStatus,
  LetterType,
} from '@prisma/client';
import { APPOINTMENT_CHAIRMAN_ADMIN_NAME } from './appointment-signatory';
import {
  applyAppointmentDraftWatermark,
  stripAppointmentDraftWatermark,
} from './appointment-watermark';
import {
  DEFAULT_SENDER_TITLE,
  LETTER_TYPE_EN_HEADER,
  buildLetterRef,
  defaultSubjectFor,
  parseAttendanceRows,
  parseViolationLines,
  renderLetterHtml,
  templateCodeForLetterType,
} from './letter-templates.helper';
import {
  formatIssueDatePkt,
  renderHandlebarsTemplate,
  type SelectionLetterVariables,
} from './selection-letter.helper';

const SELECTION_TEMPLATE_CODE = 'SELECTION_LETTER';

type LetterHtmlSource = {
  id: string;
  letterType: LetterType;
  status?: LetterStatus | null;
  templateCode?: string | null;
  letterNo: string | null;
  variables: unknown;
  content: unknown;
};

type LetterTemplateLookup = {
  letterTemplate: {
    findFirst: (args: {
      where: { code: string; active: boolean };
    }) => Promise<{
      bodyHtml: string;
      bodyHtmlEn?: string | null;
      letterCode: string;
    } | null>;
  };
};

/** Rebuild letter HTML from stored variables (WhatsApp JPEG, PDF regenerate). */
export async function rebuildStoredLetterHtml(
  prisma: LetterTemplateLookup,
  letter: LetterHtmlSource,
): Promise<string | null> {
  const storedVars =
    letter.variables &&
    typeof letter.variables === 'object' &&
    !Array.isArray(letter.variables)
      ? (letter.variables as Record<string, unknown>)
      : null;

  const content =
    letter.content &&
    typeof letter.content === 'object' &&
    !Array.isArray(letter.content)
      ? (letter.content as Record<string, unknown>)
      : {};

  const letterNo =
    letter.letterNo ??
    storedVars?.letterNo?.toString() ??
    `REISSUE-${letter.id.slice(0, 8)}`;

  if (letter.letterType === LetterType.APPOINTMENT) {
    const code = String(letter.templateCode ?? SELECTION_TEMPLATE_CODE);
    const template = await prisma.letterTemplate.findFirst({
      where: { code, active: true },
    });
    if (!template || !storedVars) return null;
    const bodyHtml =
      storedVars.appointmentLanguage === 'EN' && template.bodyHtmlEn
        ? template.bodyHtmlEn
        : template.bodyHtml;
    let htmlContent = renderHandlebarsTemplate(bodyHtml, {
      ...storedVars,
      letterNo: String(letterNo),
      chairmanAdminName: APPOINTMENT_CHAIRMAN_ADMIN_NAME,
    } as SelectionLetterVariables);
    if (letter.status !== LetterStatus.SENT) {
      htmlContent = applyAppointmentDraftWatermark(htmlContent);
    } else {
      htmlContent = stripAppointmentDraftWatermark(htmlContent);
    }
    return htmlContent;
  }

  const code = templateCodeForLetterType(letter.letterType);
  const template = await prisma.letterTemplate.findFirst({
    where: { code, active: true },
  });
  if (!template) return null;

  const merged: Record<string, unknown> = {
    ...content,
    ...(storedVars ?? {}),
    letterNo: String(letterNo),
  };

  merged.violations = parseViolationLines(
    merged.violations ?? merged.warningReason,
  );
  merged.attendanceRows = parseAttendanceRows(merged.attendanceRows);

  if (!merged.issueDate) {
    merged.issueDate = formatIssueDatePkt();
  }
  if (!merged.subject) {
    merged.subject = defaultSubjectFor(letter.letterType);
  }
  if (!merged.senderTitle) {
    merged.senderTitle = DEFAULT_SENDER_TITLE;
  }
  merged.letterNo = String(letterNo);
  merged.letterRef = buildLetterRef(
    letter.letterType,
    String(letterNo),
    template.letterCode,
  );
  const enHeader =
    LETTER_TYPE_EN_HEADER[
      letter.letterType as Exclude<LetterType, 'APPOINTMENT'>
    ];
  merged.enTitle = merged.enTitle ?? enHeader.title;
  merged.enPrescribed = merged.enPrescribed ?? enHeader.prescribed;
  merged.enSubtitle = merged.enSubtitle ?? enHeader.subtitle;

  return renderLetterHtml(template.bodyHtml, merged);
}
