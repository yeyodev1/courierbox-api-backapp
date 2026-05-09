import type { RequestHandler } from "express";
import { env } from "../config/env.js";

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

export const rateLimit: RequestHandler = (req, res, next) => {
  const key = (req.ip ?? req.socket.remoteAddress ?? "unknown").toString();
  const now = Date.now();
  const windowMs = env.RATE_LIMIT_WINDOW_MS;
  const max = env.RATE_LIMIT_MAX;

  let b = buckets.get(key);
  if (!b) {
    b = { tokens: max, lastRefill: now };
    buckets.set(key, b);
  } else {
    const elapsed = now - b.lastRefill;
    if (elapsed > 0) {
      const refill = (elapsed / windowMs) * max;
      b.tokens = Math.min(max, b.tokens + refill);
      b.lastRefill = now;
    }
  }

  if (b.tokens < 1) {
    const retryAfter = Math.ceil(((1 - b.tokens) / max) * windowMs / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({ error: "rate_limited", retryAfter });
  }
  b.tokens -= 1;
  next();
};
