jest.mock('puppeteer', () => ({ default: { launch: jest.fn() } }));

import { buildPdfFooterTemplate } from './pdf.helper';
import { COMPUTER_GENERATED_NOTICE } from './letter-templates.helper';

describe('buildPdfFooterTemplate', () => {
  it('keeps the plain notice footer for ordinary letters', () => {
    const footer = buildPdfFooterTemplate();
    expect(footer).toContain(COMPUTER_GENERATED_NOTICE);
    expect(footer).not.toContain('Employee Signature');
    expect(footer).not.toContain('pageNumber');
  });

  it('prints an employee signature line and page numbers on appointment letters', () => {
    const footer = buildPdfFooterTemplate({
      employeeSignature: { name: 'Ali <Khan>', letterNo: '9/YCDO/2026' },
    });
    expect(footer).toContain('Employee Signature:');
    expect(footer).toContain('Name: Ali &lt;Khan&gt;');
    expect(footer).toContain('Letter No.: 9/YCDO/2026');
    expect(footer).toContain('<span class="pageNumber"></span>');
    expect(footer).toContain('<span class="totalPages"></span>');
    // The "does not require any signatures" notice would contradict the line.
    expect(footer).not.toContain(COMPUTER_GENERATED_NOTICE);
  });

  it('uses Urdu right-to-left labels on Urdu appointment letters', () => {
    const footer = buildPdfFooterTemplate({
      employeeSignature: { name: 'محمد', letterNo: '1/YCDO/2026', urdu: true },
    });
    expect(footer).toContain('dir="rtl"');
    expect(footer).toContain('دستخط ملازم:');
    expect(footer).toContain('نام: محمد');
    expect(footer).toContain('لیٹر نمبر:');
    expect(footer).toContain('صفحہ <span class="pageNumber"></span> از');
    expect(footer).not.toContain('Employee Signature');
  });
});
