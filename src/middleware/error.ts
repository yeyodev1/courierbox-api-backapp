import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { ScraperError } from "../services/scraper/courierbox.scraper";
import { logger } from "../utils/logger";

function serializeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.message === "string" && anyErr.message.trim()) return anyErr.message;
    if (typeof anyErr.error === "string" && anyErr.error.trim()) return anyErr.error;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const isDev = process.env.NODE_ENV !== "production";

  if (err instanceof ZodError) {
    return res.status(400).json({ error: "invalid_input", details: err.flatten() });
  }
  if (err instanceof ScraperError) {
    const map: Record<ScraperError["kind"], number> = {
      not_found: 404,
      invalid_credentials: 502,
      timeout: 504,
      scraper_unavailable: 502,
    };
    const status = map[err.kind] ?? 500;
    return res.status(status).json({ error: err.kind, message: err.message });
  }

  const errorMessage = serializeError(err);

  if (isDev) {
    logger.error("[error] unhandled", { err: err instanceof Error ? err.stack : String(err) });
    return res.status(500).json({ error: "internal_error", message: errorMessage, stack: err instanceof Error ? err.stack : undefined });
  }

  logger.error("[error] unhandled", { err: errorMessage, path: req.path });
  res.status(500).json({ error: "internal_error", message: errorMessage });
};
