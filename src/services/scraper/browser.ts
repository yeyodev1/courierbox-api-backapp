import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { logger } from "../../utils/logger.js";

const isServerless =
  !!process.env.VERCEL ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.AWS_EXECUTION_ENV ||
  !!process.env.NETLIFY;

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

async function launchLocal(): Promise<Browser> {
  // Dev: usar el chromium que trae playwright (devDependency)
  const execPath = process.env.CHROME_PATH;
  if (execPath) {
    return chromium.launch({ headless: true, executablePath: execPath });
  }
  // Sin CHROME_PATH: dejar que playwright-core encuentre uno bundled vía playwright (devDep)
  // Para que esto funcione localmente: `pnpm playwright:install` antes de `pnpm dev`.
  return chromium.launch({ headless: true });
}

async function launchServerless(): Promise<Browser> {
  // Lambda/Vercel: usar @sparticuz/chromium (binario tipo "lite" optimizado para serverless)
  const sparticuz = (await import("@sparticuz/chromium")).default as unknown as {
    args: string[];
    executablePath: () => Promise<string>;
    setHeadlessMode?: (v: boolean) => void;
  };
  if (typeof sparticuz.setHeadlessMode === "function") {
    sparticuz.setHeadlessMode(true);
  }
  return chromium.launch({
    args: [
      ...sparticuz.args,
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-gpu",
      "--single-process",
    ],
    executablePath: await sparticuz.executablePath(),
    headless: true,
  });
}

async function launch(): Promise<Browser> {
  logger.info("[browser] launching", { mode: isServerless ? "serverless" : "local" });
  return isServerless ? launchServerless() : launchLocal();
}

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  if (launching) return launching;
  launching = launch()
    .then((b) => {
      browser = b;
      b.on("disconnected", () => {
        logger.warn("[browser] disconnected");
        browser = null;
      });
      return b;
    })
    .finally(() => {
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
    if (isServerless) {
      // Cerrar browser al final de cada invocación serverless: la lambda muere igual.
      await closeBrowser();
    }
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
