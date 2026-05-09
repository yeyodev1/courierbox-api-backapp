import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { ScraperError } from "../services/scraper/courierbox.scraper.js";
import { logger } from "../utils/logger.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
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
  logger.error("[error] unhandled", { err: err instanceof Error ? err.stack : String(err) });
  res.status(500).json({ error: "internal_error" });
};
