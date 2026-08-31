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

export async function generatePdf(htmlContent: string): Promise<Buffer> {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await openLetterHtml(page, htmlContent);
    // Hide the in-body disclaimer — the same text is rendered by Puppeteer's
    // footer template below so it never appears twice in the PDF.
    await page.addStyleTag({
      content: `.computer-generated-notice { display: none !important; }`,
    });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-size:10px;text-align:center;color:#333;font-family:Segoe UI,Arial,sans-serif;padding:0 16px 4px;">${COMPUTER_GENERATED_NOTICE}</div>`,
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

/** A4 JPEG of the letter for WhatsApp. Notice stays visible in the image. */
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
      content: 'html, body { background: #fff !important; }',
    });
    const jpeg = await page.screenshot({
      type: 'jpeg',
      quality: 82,
      fullPage: true,
    });
    return Buffer.from(jpeg);
  } finally {
    await browser.close();
  }
}

/** Fallback when only a stored PDF exists (WhatsApp resend). */
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
    const jpeg = await page.screenshot({
      type: 'jpeg',
      quality: 82,
      fullPage: true,
    });
    return Buffer.from(jpeg);
  } finally {
    await browser.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
