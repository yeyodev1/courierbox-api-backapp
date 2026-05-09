import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { closeBrowser } from "./services/scraper/browser.js";
import { logger } from "./utils/logger.js";

const app = buildApp();

const server = app.listen(env.PORT, () => {
  logger.info(`[server] listening on :${env.PORT}`, { env: env.NODE_ENV });
});

async function shutdown(signal: string) {
  logger.info(`[server] received ${signal}, shutting down`);
  server.close(() => logger.info("[server] http closed"));
  await closeBrowser();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
