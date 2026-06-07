/**
 * Playwright wrapper. Note: Playwright cannot run on Vercel's edge/serverless functions
 * by default — use Vercel's Node runtime + browserless.io OR run the agent on a small VPS.
 * For local development this works out of the box.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export async function openBrowser({ headless = true } = {}): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  return {
    browser, context, page,
    close: async () => { await context.close(); await browser.close(); },
  };
}

export async function navigate(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
}

export async function getPageText(page: Page): Promise<string> {
  return await page.evaluate(() => document.body.innerText);
}

export async function clickByText(page: Page, text: string) {
  await page.getByText(text, { exact: false }).first().click();
}

export async function fill(page: Page, selector: string, value: string) {
  await page.fill(selector, value);
}

export async function downloadFile(page: Page, triggerSelector: string, targetDir = 'agent-downloads'): Promise<string> {
  fs.mkdirSync(targetDir, { recursive: true });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click(triggerSelector),
  ]);
  const filename = download.suggestedFilename();
  const dest = path.join(targetDir, filename);
  await download.saveAs(dest);
  return dest;
}
