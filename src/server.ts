import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { connectMongo } from "./db/mongo.js";
import { closeBrowser } from "./services/scraper/browser.js";
import { logger } from "./utils/logger.js";

import bcrypt from "bcryptjs";
import { models } from "./models/index.js";

const app = buildApp();

connectMongo(env.MONGO_URI).then(async () => {
  try {
    const adminCount = await models.users.countDocuments();
    if (adminCount === 0) {
      logger.info("[server] Seeding initial admin user...");
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, salt);
      await models.users.create({
        email: env.ADMIN_EMAIL.toLowerCase(),
        passwordHash,
        name: "Admin",
        role: "admin",
      });
      logger.info("[server] Initial admin user created.");
    }
  } catch (err) {
    logger.error("[server] Failed to seed admin", { error: String(err) });
  }
}).catch((err) => {
  logger.error("Failed to connect to mongo", { error: String(err) });
  process.exit(1);
});

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
