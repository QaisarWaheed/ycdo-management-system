/**
 * Smoke-render every letter .hbs template to PDF for visual spot-check.
 * Usage (from apps/api): npx ts-node -r tsconfig-paths/register scripts/smoke-letter-templates.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  defaultSubjectFor,
  renderLetterHtml,
} from '../src/modules/letters/letter-templates.helper';
import { generatePdf } from '../src/modules/letters/pdf.helper';
import { LetterType } from '@prisma/client';

const OUT_DIR = path.join(process.cwd(), 'uploads', 'letter-smoke');
const TPL_DIR = path.join(
  process.cwd(),
  'prisma',
  'seeds',
  'templates',
  'letters',
);

const SAMPLE: Record<string, unknown> = {
  letterNo: '9999/YCDO/2026',
  issueDate: '05/08/2026',
  senderTitle: 'کوآرڈینیٹر پروجیکٹس',
  employeeName: 'مسٹر ٹیسٹ ایمپلائی',
  designation: 'ایڈمن آفیسر',
  department: 'ایڈمن',
  branch: 'YCDO ہسپتال قاسم پور برانچ ملتان پاکستان',
  cnic: '36302-1234567-1',
  employeeCode: 'EMP-TEST',
  joiningDate: '01/01/2024',
  violations: [
    'بغیر اطلاع غیر حاضری مورخہ 01 اگست 2026',
    'ڈیوٹی پر لیٹ آمد',
  ],
  fineReason:
    'مورخہ 01 اگست 2026 کو بغیر پیشگی اطلاع یا اجازت غیر حاضر رہے جو SOP کی سنگین خلاف ورزی ہے۔',
  fineAmount: 'دو یوم تنخواہ',
  deductionMonth: 'اگست 2026',
  attendanceRows: [
    { date: '01/08/2026', inTime: '08:37:42 AM', outTime: '05:06:53 PM' },
    { date: '02/08/2026', inTime: '09:30:00 AM', outTime: '03:29:54 PM' },
  ],
  adviceReason: 'آج ڈیوٹی پر مقررہ وقت کے بعد پہنچے جو SOP کی خلاف ورزی ہے۔',
  adviceDetails: 'آئندہ وقت کی پابندی لازمی ہے۔',
  appreciationReason: 'ادارہ کیلئے مثالی کارکردگی۔',
  achievementDetails: 'ٹیم کی رہنمائی میں نمایاں کاوش۔',
  rewardAmount: '10,000',
  disciplinaryReason:
    'ہیڈ آفس کی ہدایت پر عمل نہ کرنا — میڈیسن آڈٹ سے متعلق واقعہ۔',
  incidentDate: '01/08/2026',
  allegation: 'ادارہ کی SOP کی بار بار خلاف ورزی۔',
  responseDeadline: '08/08/2026',
  issueDescription: 'غیر حاضری اور لیٹ آمد کی وضاحت درکار ہے۔',
  inquiryReason: 'ڈسپلنری معاملے کی تحقیقات۔',
  inquiryDate: '10/08/2026',
  committeeMembers: 'چیئرمین ایڈمن، ایچ آر مینیجر',
  suspensionReason: 'اس ماہ 3 دن بغیر اطلاع غیر حاضری۔',
  suspensionStartDate: '05/08/2026',
  suspensionDuration: 'Pending HR review',
  terminationReason: 'بار بار SOP کی خلاف ورزی۔',
  terminationDate: '05/08/2026',
  settlementDetails: 'حتمی تصفیہ پالیسی کے مطابق۔',
  reinstatementDate: '10/08/2026',
  reinstatedDesignation: 'ایڈمن آفیسر',
  rejoiningDate: '10/08/2026',
  rejoiningDesignation: 'ایڈمن آفیسر',
  lastWorkingDate: '31/07/2026',
  totalExperience: '2 سال',
  jobDescription: 'برانچ ایڈمن امور',
  fromBranch: 'Executive#2',
  toBranch: 'Executive#2',
  effectiveDate: '05/08/2026',
  timing: '09AM to 09PM',
  previousSalary: '16500',
  newSalary: '20000',
  incrementAmount: '3500',
  incrementReason: 'We expect continued effective service.',
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = fs.readdirSync(TPL_DIR).filter((f) => f.endsWith('.hbs'));
  console.log(`Found ${files.length} templates in ${TPL_DIR}`);

  for (const file of files) {
    const code = path.basename(file, '.hbs') as LetterType;
    const bodyHtml = fs.readFileSync(path.join(TPL_DIR, file), 'utf8');
    const html = renderLetterHtml(bodyHtml, {
      ...SAMPLE,
      subject: defaultSubjectFor(code),
    });
    const pdf = await generatePdf(html);
    const out = path.join(OUT_DIR, `${code}.pdf`);
    fs.writeFileSync(out, pdf);
    console.log(`✓ ${code} → ${out} (${pdf.length} bytes)`);
  }

  console.log('Done. Open uploads/letter-smoke/*.pdf to review.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
