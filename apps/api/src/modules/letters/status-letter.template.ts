import { EmployeeStatus } from '@prisma/client';
const LETTER_STATUSES: Partial<Record<EmployeeStatus, {name: string; subject: string}>> = {
  ON_REST: {name: 'Rest Letter', subject: 'آرام / ریسٹ کا نوٹس'},
  RESIGNED: {name: 'Resignation Letter', subject: 'استعفیٰ کی اطلاع'},
  TERMINATED: {name: 'Termination Status Letter', subject: 'ختم ملازمت کی اطلاع'},
  DISMISSED: {name: 'Dismissal Status Letter', subject: 'برطرفی کی اطلاع'},
  SUSPENDED: {name: 'Suspension Status Letter', subject: 'معطلی کی اطلاع'},
};
export function statusLetterTemplate(status: EmployeeStatus) {
  const meta = LETTER_STATUSES[status];
  if (!meta) return null;
  return {
    code: `STATUS_${status}`, name: meta.name, subjectUr: meta.subject,
    primaryLanguage: 'ur', enTitle: meta.name.toUpperCase(), letterCode: 'STS', isCustom: true,
    requiredVars: ['statusReason', 'statusEffectiveDate'],
    fieldsSchema: [
      {key: 'statusReason', label: 'Reason / Details', type: 'textarea', required: true},
      {key: 'statusEffectiveDate', label: 'Effective Date', type: 'date', required: true},
    ],
    bodyHtml: `<!DOCTYPE html><html lang="ur" dir="rtl"><head><meta charset="utf-8"><style>{{{letterStyles}}}</style></head>
      <body>{{> ycdoLetterHeader}}<div class="body"><p>آپ کی ملازمت کی موجودہ حیثیت: {{staffStatusLabel}}۔</p>
      <p>نافذ ہونے کی تاریخ: <span dir="ltr">{{statusEffectiveDate}}</span></p>
      <p style="white-space:pre-wrap">{{statusReason}}</p></div>{{> ycdoLetterFooter}}</body></html>`,
  };
}
