import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  COMPUTER_GENERATED_NOTICE,
  appendComputerGeneratedNotice,
} from './letter-templates.helper';

function resolveChromePath(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const candidates: string[] = [];

  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(
        process.env.LOCALAPPDATA ?? '',
        'Google',
        'Chrome',
        'Application',
        'chrome.exe',
      ),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    );
  } else {
    candidates.push(
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
    );
  }

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

async function launchBrowser(): Promise<Browser> {
  const executablePath = resolveChromePath();
  return puppeteer.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

async function waitForFonts(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    })
    .catch(() => undefined);
  await new Promise((r) => setTimeout(r, 300));
}

async function openLetterHtml(page: Page, htmlContent: string): Promise<void> {
  const html = appendComputerGeneratedNotice(htmlContent);
  await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
  await waitForFonts(page);
}

export type PdfOptions = {
  /**
   * Appointment letters: every page carries a line for the employee to sign,
   * plus page numbering, so no page can be swapped out after signing.
   */
  employeeSignature?: {
    name: string;
    letterNo?: string | null;
    /** Urdu letters get Urdu, right-to-left footer labels. */
    urdu?: boolean;
  };
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Appointment-letter print fixes:
 * - "Name ___ Volunteer Signature ___" stays on one line (English).
 * - Section headings (e.g. قبولیت / Acceptance) never sit alone at a page end,
 *   and each signature block stays whole (tighter spacing keeps 3 pages).
 * - Urdu letter: signing line above the Chairman Admin block, as in English.
 */
export const APPOINTMENT_PDF_CSS = `.siglines { display: flex !important; align-items: flex-end; gap: 6pt; }
.siglines .sigline { flex: 1; min-width: 0 !important; }
h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
.acceptance, .signblock { break-inside: avoid; page-break-inside: avoid; }
.acceptance { margin-top: 18pt !important; }
.signblock { margin-top: 26pt !important; }
html[lang="ur"] .page > p[style*="margin-top:28pt"]::before {
  content: ""; display: block; width: 160pt; border-top: 1px solid #000; margin-bottom: 6pt;
}`;

const FOOTER_STYLE =
  'width:100%;font-size:10px;color:#333;font-family:Segoe UI,Arial,sans-serif;padding:0 16px 4px;';

/** Puppeteer footer; pageNumber/totalPages spans are filled in by Chrome. */
export function buildPdfFooterTemplate(options: PdfOptions = {}): string {
  const sig = options.employeeSignature;
  if (!sig) {
    return `<div style="${FOOTER_STYLE}"><div style="text-align:center;">${COMPUTER_GENERATED_NOTICE}</div></div>`;
  }

  if (sig.urdu) {
    const urduLetterNo = sig.letterNo
      ? `<span>لیٹر نمبر: <span dir="ltr">${escapeHtml(sig.letterNo)}</span></span>`
      : '';
    return `<div dir="rtl" style="${FOOTER_STYLE}font-family:'Noto Nastaliq Urdu','Jameel Noori Nastaleeq','Noto Naskh Arabic','Segoe UI',Arial,sans-serif;font-size:11px;">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;">
    <span>دستخط ملازم: <span style="display:inline-block;width:150px;border-bottom:1px solid #333;"></span></span>
    <span>نام: ${escapeHtml(sig.name)}</span>
    ${urduLetterNo}
    <span>صفحہ <span class="pageNumber"></span> از <span class="totalPages"></span></span>
  </div>
</div>`;
  }

  const letterNo = sig.letterNo
    ? `<span>Letter No.: ${escapeHtml(sig.letterNo)}</span>`
    : '';
  return `<div style="${FOOTER_STYLE}">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;">
    <span>Employee Signature: <span style="display:inline-block;width:150px;border-bottom:1px solid #333;"></span></span>
    <span>Name: ${escapeHtml(sig.name)}</span>
    ${letterNo}
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>
</div>`;
}

export async function generatePdf(
  htmlContent: string,
  options: PdfOptions = {},
): Promise<Buffer> {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await openLetterHtml(page, htmlContent);
    // Hide the in-body disclaimer — the same text is rendered by Puppeteer's
    // footer template below so it never appears twice in the PDF.
    await page.addStyleTag({
      content: `.computer-generated-notice { display: none !important; }`,
    });
    let pdfOptions = options;
    if (options.employeeSignature) {
      // Appointment letters. Applied here (not in the .hbs) because production
      // keeps its own stored copy of the template body.
      await page.addStyleTag({ content: APPOINTMENT_PDF_CSS });
      const urdu = await page.evaluate(
        () => document.documentElement.lang === 'ur',
      );
      pdfOptions = {
        employeeSignature: { ...options.employeeSignature, urdu },
      };
    }
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: buildPdfFooterTemplate(pdfOptions),
      margin: {
        top: '14mm',
        right: '14mm',
        // Taller footer when the employee signature line is printed.
        bottom: options.employeeSignature ? '22mm' : '16mm',
        left: '14mm',
      },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export async function generateJpeg(htmlContent: string): Promise<Buffer> {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 2,
    });
    await page.emulateMediaType('print');
    await openLetterHtml(page, htmlContent);
    await page.addStyleTag({
      content: `
        html, body { background: #fff !important; }
        body {
          padding: 14mm !important;
          box-sizing: border-box !important;
        }
      `,
    });
    // First A4 page only — never Chrome chrome / full-page scroll.
    const jpeg = await page.screenshot({
      type: 'jpeg',
      quality: 85,
      clip: { x: 0, y: 0, width: 794, height: 1123 },
    });
    return Buffer.from(jpeg);
  } finally {
    await browser.close();
  }
}

const PDF_VIEWER_HIDE_CHROME = `
  #sidenav-container, #toolbarContainer, #toolbar, #sidebarContainer,
  #secondaryToolbar, #titlebar, viewer-pdf-toolbar, cr-toolbar {
    display: none !important;
  }
  html, body { background: #fff !important; margin: 0 !important; overflow: hidden !important; }
`;

/** Last resort when HTML cannot be rebuilt. Never screenshot the PDF viewer UI. */
export async function generateJpegFromPdf(pdfBuffer: Buffer): Promise<Buffer> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'letter-jpg-'));
  const pdfPath = path.join(tmpDir, 'letter.pdf');
  fs.writeFileSync(pdfPath, pdfBuffer);
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 2,
    });
    await page.goto(pathToFileURL(pdfPath).href, {
      waitUntil: 'networkidle0',
      timeout: 20000,
    });
    await page.addStyleTag({ content: PDF_VIEWER_HIDE_CHROME });
    await new Promise((r) => setTimeout(r, 400));
    const target =
      (await page.$('.page canvas')) ??
      (await page.$('#viewer .page')) ??
      (await page.$('embed'));
    const jpeg = target
      ? await target.screenshot({ type: 'jpeg', quality: 85 })
      : await page.screenshot({
          type: 'jpeg',
          quality: 85,
          clip: { x: 0, y: 0, width: 794, height: 1123 },
        });
    return Buffer.from(jpeg);
  } finally {
    await browser.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
