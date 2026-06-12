/**
 * Playwright wrapper. Note: Playwright cannot run on Vercel's edge/serverless functions
 * by default — use Vercel's Node runtime + browserless.io OR run the agent on a small VPS.
 * For local development this works out of the box.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const REALISTIC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export async function openBrowser({ headless = true } = {}): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent: REALISTIC_USER_AGENT,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });
  const page = await context.newPage();
  return {
    browser, context, page,
    close: async () => { await context.close(); await browser.close(); },
  };
}

/**
 * Wait for page to reach a stable state (no pending navigations).
 * Catches errors if the page is already stable or navigates unexpectedly.
 */
async function waitForStableState(page: Page, timeoutMs = 10000) {
  try {
    // Wait for any in-flight navigation to settle
    await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 8000) }).catch(() => {});
    // Small buffer for late-firing JS redirects / SPA routers
    await page.waitForTimeout(300);
  } catch {
    // Page may have been destroyed and recreated — that's fine
  }
}

export async function navigate(page: Page, url: string) {
  // Normalize URLs the LLM may emit without a scheme (e.g. "google.com")
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForStableState(page);
}

/**
 * Read page text with retry logic.
 * If the execution context is destroyed (mid-navigation), we wait for the
 * page to stabilize and retry up to 3 times.
 */
export async function getPageText(page: Page): Promise<string> {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await waitForStableState(page);
      return await page.evaluate(() => document.body.innerText);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      const isContextDestroyed =
        msg.includes('Execution context was destroyed') ||
        msg.includes('navigation') ||
        msg.includes('frame was detached');
      if (!isContextDestroyed || attempt === maxRetries - 1) throw e;
      // Back off and retry — the page is mid-navigation
      await page.waitForTimeout(1000 * (attempt + 1));
    }
  }
  // Unreachable, but TypeScript needs it
  return await page.evaluate(() => document.body.innerText);
}

/**
 * Robust click. Tries (in order):
 *  1. role=button name=text
 *  2. role=link name=text
 *  3. visible text match
 *  4. any text match (force-scrolled + force-clicked)
 * Each strategy gets a short timeout so failures fall through quickly.
 */
export async function clickByText(page: Page, text: string) {
  const strategies: Array<() => Promise<void>> = [
    async () => {
      await page.getByRole('button', { name: text, exact: false }).first()
        .click({ timeout: 4000 });
    },
    async () => {
      await page.getByRole('link', { name: text, exact: false }).first()
        .click({ timeout: 4000 });
    },
    async () => {
      // Visible text only — skips off-screen/hidden duplicates.
      const loc = page.getByText(text, { exact: false }).locator('visible=true').first();
      await loc.click({ timeout: 4000 });
    },
    async () => {
      // Last resort: scroll into view + force click on first match.
      const loc = page.getByText(text, { exact: false }).first();
      await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await loc.click({ timeout: 5000, force: true });
    },
  ];
  let lastErr: unknown;
  for (const s of strategies) {
    try { await s(); return; } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Could not click "${text}"`);
}

/**
 * Wrapper around clickByText that detects if the click triggered a navigation
 * and waits for the page to stabilize before returning.
 */
export async function clickByTextSafe(page: Page, text: string) {
  const urlBefore = page.url();
  await clickByText(page, text);
  // Give the page a moment to start any navigation
  await page.waitForTimeout(500);
  // If URL changed or a load event is pending, wait for stability
  if (page.url() !== urlBefore) {
    await waitForStableState(page);
  } else {
    // Even same-page interactions might trigger SPA navigations
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
  }
}

/**
 * Robust fill. Accepts either a CSS/XPath selector OR a human label/placeholder.
 * Tries: raw selector → label → placeholder → role=textbox name.
 */
export async function fill(page: Page, selector: string, value: string) {
  const tries: Array<() => Promise<void>> = [
    () => page.fill(selector, value, { timeout: 4000 }),
    () => page.getByLabel(selector, { exact: false }).first().fill(value, { timeout: 4000 }),
    () => page.getByPlaceholder(selector, { exact: false }).first().fill(value, { timeout: 4000 }),
    () => page.getByRole('textbox', { name: selector }).first().fill(value, { timeout: 4000 }),
    () => page.getByRole('searchbox', { name: selector }).first().fill(value, { timeout: 4000 }),
  ];
  let lastErr: unknown;
  for (const t of tries) {
    try { await t(); return; } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Could not fill "${selector}"`);
}

/**
 * Press a key (commonly "Enter" to submit a form/search box).
 * After pressing, waits for any triggered navigation to stabilize.
 */
export async function pressKey(page: Page, key: string) {
  const urlBefore = page.url();
  await page.keyboard.press(key);
  // Give the browser time to start any navigation triggered by the keypress
  await page.waitForTimeout(500);
  // If Enter triggered a form submission / navigation, wait for it
  if (page.url() !== urlBefore || key === 'Enter') {
    await waitForStableState(page);
  }
}

/** Wait for a selector or text to appear — useful between steps. */
export async function waitFor(page: Page, target: string, timeoutMs = 10000) {
  // If it looks like a CSS selector, use it; otherwise treat as text.
  // Catches tag[attr=...] forms like div[data-test-id='x'], not just #/. prefixes.
  if (/^[#.\[]/.test(target) || target.includes('[') || target.includes('>')) {
    await page.waitForSelector(target, { timeout: timeoutMs });
  } else {
    await page.getByText(target, { exact: false }).first().waitFor({ timeout: timeoutMs });
  }
}

/**
 * Capture a screenshot of the current viewport as a compressed JPEG.
 * Used for visual citations in the Done tab (Feature 15).
 */
export async function screenshot(page: Page): Promise<Buffer> {
  await waitForStableState(page, 5000);
  return await page.screenshot({ type: 'jpeg', quality: 60 });
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
