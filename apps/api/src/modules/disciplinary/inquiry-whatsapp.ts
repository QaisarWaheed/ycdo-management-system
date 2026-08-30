import { InquiryFinding, InquiryFinalAction } from '@prisma/client';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { normalizePakistanPhone } from '../whatsapp/phone.util';

const RLI = '\u2067';
const PDI = '\u2069';

function hrmsLoginUrl() {
  return `${(
    process.env.HRMS_PUBLIC_URL ||
    process.env.PUBLIC_HRMS_URL ||
    'https://hrms-web.ycdo.org.pk'
  ).replace(/\/$/, '')}/login`;
}

function personLine(name?: string | null, code?: string | null) {
  return [name, code].filter(Boolean).join(' / ') || '—';
}

export async function notifyInquiryApproverWhatsApp(
  whatsapp: WhatsAppService,
  input: {
    phone?: string | null;
    approverName?: string | null;
    employeeName: string;
    employeeCode?: string | null;
    kind: 'open' | 'close';
    reason?: string | null;
  },
) {
  const loginUrl = hrmsLoginUrl();
  const employee = personLine(input.employeeName, input.employeeCode);
  const greeting = input.approverName ? ` ${input.approverName}` : '';
  const subject =
    input.kind === 'open'
      ? 'ایک نئی انکوائری کھولنے کی درخواست آپ کی منظوری کی منتظر ہے۔'
      : 'انکوائری کا نتیجہ آپ کی حتمی منظوری کی منتظر ہے۔';
  const body = [
    `${RLI}السلام علیکم${greeting}،`,
    subject,
    `ملازم: ${employee}`,
    input.reason ? `وجہ: ${input.reason}` : null,
    `براہ کرم HRMS میں Approve / Reject کریں:`,
    loginUrl,
    PDI,
  ]
    .filter(Boolean)
    .join('\n');

  return whatsapp.sendPlainText({
    phone: input.phone,
    body,
    context: `inquiry-${input.kind}-approver`,
  });
}

export async function notifyInquiryOfficerAssignedWhatsApp(
  whatsapp: WhatsAppService,
  input: {
    phone?: string | null;
    officerName?: string | null;
    employeeName: string;
    employeeCode?: string | null;
    startDate: string;
    endDate: string;
    reason?: string | null;
  },
) {
  const employee = personLine(input.employeeName, input.employeeCode);
  const greeting = input.officerName ? ` ${input.officerName}` : '';
  const body = [
    `${RLI}السلام علیکم${greeting}،`,
    'آپ کو اس انکوائری کا انکوائری آفیسر مقرر کیا گیا ہے۔',
    `ملازم: ${employee}`,
    input.reason ? `وجہ: ${input.reason}` : null,
    `آغاز: ${input.startDate}`,
    `اختتام: ${input.endDate}`,
    'انکوائری جسمانی / آف لائن مکمل کریں۔ حتمی ریکارڈ HRMS میں HR درج کرے گی۔',
    PDI,
  ]
    .filter(Boolean)
    .join('\n');

  return whatsapp.sendPlainText({
    phone: input.phone,
    body,
    context: 'inquiry-officer-assigned',
  });
}

export async function notifyInquiryOfficerResultWhatsApp(
  whatsapp: WhatsAppService,
  input: {
    phone?: string | null;
    officerName?: string | null;
    employeeName: string;
    employeeCode?: string | null;
    finding?: InquiryFinding | null;
    finalAction?: InquiryFinalAction | null;
    recommendation?: string | null;
    notes?: string | null;
  },
) {
  const employee = personLine(input.employeeName, input.employeeCode);
  const greeting = input.officerName ? ` ${input.officerName}` : '';
  const finding =
    input.finding === 'NOT_GUILTY'
      ? 'غیر مجرم'
      : input.finding === 'GUILTY'
        ? 'مجرم'
        : '—';
  const action = input.finalAction
    ? input.finalAction.replace(/_/g, ' ')
    : input.finding === 'NOT_GUILTY'
      ? 'بحالی / ڈیوٹی جاری'
      : '—';
  const body = [
    `${RLI}السلام علیکم${greeting}،`,
    'یہ انکوائری آپ کو تفویض کی گئی تھی۔',
    `ملازم: ${employee}`,
    `HR نے درج ذیل نتیجہ ریکارڈ کیا ہے:`,
    `تحقیق / Finding: ${finding}`,
    `تجویز کردہ کارروائی: ${action}`,
    input.recommendation ? `سفارش: ${input.recommendation}` : null,
    input.notes ? `نوٹس: ${input.notes}` : null,
    'اگر نتیجہ درست ہے تو کوئی کارروائی درکار نہیں۔',
    'اگر ریکارڈ شدہ نتیجہ آپ کے فیصلے سے مختلف ہے تو فوری HR سے رابطہ کر کے تصحیح کروائیں۔',
    PDI,
  ]
    .filter(Boolean)
    .join('\n');

  return whatsapp.sendPlainText({
    phone: input.phone,
    body,
    context: 'inquiry-officer-result',
  });
}

export function officerPhoneFromUser(user?: {
  employee?: { phone?: string | null } | null;
} | null) {
  return normalizePakistanPhone(user?.employee?.phone);
}
