import { chromium, type Browser, type BrowserContext } from "playwright";
import { logger } from "../../utils/logger.js";

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

async function launch(): Promise<Browser> {
  logger.info("[browser] launching chromium");
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
}

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  if (launching) return launching;
  launching = launch().then((b) => {
    browser = b;
    b.on("disconnected", () => {
      logger.warn("[browser] disconnected");
      browser = null;
    });
    return b;
  }).finally(() => {
    launching = null;
  });
  return launching;
}

export async function withContext<T>(fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  const b = await getBrowser();
  const ctx = await b.newContext({
    viewport: { width: 1366, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
  try {
    return await fn(ctx);
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
