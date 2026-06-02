import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import http from "http";

import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error.js";
import { healthRouter } from "./routes/health.routes.js";
import { trackingRouter } from "./routes/tracking.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { paymentRouter } from "./routes/payment.routes.js";
import userRouter from "./routes/user.routes.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  // Patrones permitidos automáticamente en producción
  const ORIGIN_PATTERNS: RegExp[] = [
    /^https?:\/\/localhost(:\d+)?$/i,
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/i,
    /^https:\/\/([a-z0-9-]+\.)?courierboxlogistics\.com$/i,
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i,
  ];

  app.use(
    cors({
      origin: (origin, cb) => {
        // Same-origin / curl / server-to-server
        if (!origin) return cb(null, true);
        if (env.FRONTEND_ORIGIN.includes(origin)) return cb(null, true);
        if (ORIGIN_PATTERNS.some((re) => re.test(origin))) return cb(null, true);
        if (env.NODE_ENV === "development") return cb(null, true);
        // Devolvemos `false` (no error) para que express-cors no rompa con 500.
        // El browser bloqueará igual por falta de header.
        return cb(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.get("/", (_req, res) =>
    res.status(200).json({
      message: "📦 Courierbox API is alive 🚀✨",
      status: "ok",
      docs: "/health",
    })
  );

  app.use("/health", healthRouter);
  app.use("/api/tracking", trackingRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/payments", paymentRouter);
  app.use("/api/users", userRouter);

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  app.use(errorHandler);

  const server = http.createServer(app);

  return { app, server };
}
