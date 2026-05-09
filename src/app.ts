import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error.js";
import { healthRouter } from "./routes/health.routes.js";
import { trackingRouter } from "./routes/tracking.routes.js";
// import { connectMongo } from "./db/mongo.js"; // disabled — sin DB por ahora

export function buildApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (env.FRONTEND_ORIGIN.includes(origin)) return cb(null, true);
        if (env.NODE_ENV === "development") return cb(null, true);
        cb(new Error(`origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.use("/health", healthRouter);
  app.use("/api/tracking", trackingRouter);

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  app.use(errorHandler);

  return app;
}
