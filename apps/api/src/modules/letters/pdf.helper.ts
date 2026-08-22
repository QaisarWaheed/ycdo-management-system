import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer';
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

export async function generatePdf(htmlContent: string): Promise<Buffer> {
  const html = appendComputerGeneratedNotice(htmlContent);
  const executablePath = resolveChromePath();

  const browser = await puppeteer.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
    // Hide the in-body disclaimer — the same text is rendered by Puppeteer's
    // footer template below so it never appears twice in the PDF.
    // Do NOT override @page margins here; the HTML's own @page rule already
    // defines size + margins and Puppeteer's `margin` option below adds the
    // footer reservation on top. Zeroing @page margin here wiped the page-size
    // declaration and caused the PDF to open with no visible borders at 100%.
    await page.addStyleTag({
      content: `.computer-generated-notice { display: none !important; }`,
    });
    // Allow webfonts (Urdu) a moment to paint when network is available.
    await page
      .evaluate(async () => {
        if (document.fonts?.ready) {
          await document.fonts.ready;
        }
      })
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 300));
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-size:10px;text-align:center;color:#333;font-family:Segoe UI,Arial,sans-serif;padding:0 16px 4px;">${COMPUTER_GENERATED_NOTICE}</div>`,
      // Match the @page rule in urdu-letter-styles.ts: 14mm sides, 16mm bottom
      // (footer lives in this bottom space), 14mm top.
      margin: {
        top: '14mm',
        right: '14mm',
        bottom: '16mm',
        left: '14mm',
      },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
