import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer';

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
  const executablePath = resolveChromePath();

  const browser = await puppeteer.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'load', timeout: 20000 });
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
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
