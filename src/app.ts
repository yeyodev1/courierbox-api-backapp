import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import http from "http";

import { env } from "./config/env";
import { errorHandler } from "./middleware/error";
import { requireAuth, requireRole } from "./middleware/auth.middleware";
import { healthRouter } from "./routes/health.routes";
import { trackingRouter } from "./routes/tracking.routes";
import { authRouter } from "./routes/auth.routes";
import { paymentRouter } from "./routes/payment.routes";
import userRouter from "./routes/user.routes";
import { adminRouter } from "./routes/admin.routes";
import { etlRouter } from "./routes/etl.routes";
import { facturacionRouter } from "./routes/facturacion.routes";
import { conciliacionRouter } from "./routes/conciliacion.routes";
import { asesoriaRouter } from "./routes/asesoria.routes";
import costosRouter from "./routes/costos.routes";
import enviosRouter from "./routes/envios.routes";
import { contactosRouter } from "./routes/contactos.routes";
import { proveedoresRouter } from "./routes/proveedores.routes";
import { addProviderType, deleteProviderType, listProviderTypes } from "./controllers/provider-types.controller";
import { gestionCompraRouter } from "./routes/gestion_compra.routes";
import { contactosCbRouter } from "./routes/contactos_cb.routes";
import { cuentasBancariasRouter } from "./routes/cuentas_bancarias.routes";
import cajaRouter from "./routes/caja.routes";
import produccionRouter from "./routes/produccion.routes";
import reportesRouter from "./routes/reportes.routes";

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
  app.use("/api/admin", adminRouter);
  app.use("/api/v1/etl", etlRouter);
  app.use("/api/v1/facturacion", facturacionRouter);
  app.use("/api/v1/conciliacion", conciliacionRouter);
  app.use("/api/v1/asesoria", asesoriaRouter);
  app.use("/api/v1/costos", costosRouter);
  app.use("/api/v1/envios", enviosRouter);
  app.use("/api/v1/caja", cajaRouter);
  app.use("/api/v1/produccion", produccionRouter);
  app.use("/api/v1/reportes", reportesRouter);
  app.use("/api/v1/contactos", contactosRouter);
  app.use("/api/v1/contactos-cb", contactosCbRouter);
  app.use("/api/v1/cuentas-bancarias", cuentasBancariasRouter);
  app.use("/api/v1/gestiones-compra", gestionCompraRouter);
  app.use("/api/v1/proveedores", proveedoresRouter);
  app.get("/api/v1/proveedores/tipos", requireAuth, requireRole(["admin", "gerencia", "superadmin"]), listProviderTypes);
  app.post("/api/v1/proveedores/tipos", requireAuth, requireRole(["admin", "gerencia", "superadmin"]), addProviderType);
  app.delete("/api/v1/proveedores/tipos/:type", requireAuth, requireRole(["admin", "gerencia", "superadmin"]), deleteProviderType);

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  app.use(errorHandler);

  const server = http.createServer(app);

  return { app, server };
}
