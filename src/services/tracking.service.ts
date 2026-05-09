import { env } from "../config/env.js";
import { obtenerEstadoGuia, ScraperError } from "./scraper/courierbox.scraper.js";
import type { TrackingResult } from "../types/tracking.js";
import { logger } from "../utils/logger.js";

interface CacheEntry {
  data: TrackingResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<TrackingResult>>();

export async function getTracking(codigoRaw: string): Promise<TrackingResult> {
  const codigo = codigoRaw.trim().toUpperCase();
  const now = Date.now();

  const hit = cache.get(codigo);
  if (hit && hit.expiresAt > now) {
    logger.debug("[tracking] cache hit", { codigo });
    return hit.data;
  }

  const flying = inflight.get(codigo);
  if (flying) {
    logger.debug("[tracking] dedup join", { codigo });
    return flying;
  }

  const p = (async () => {
    try {
      const data = await obtenerEstadoGuia(codigo);
      const ttl = env.CACHE_TTL_SECONDS * 1000;
      if (ttl > 0) cache.set(codigo, { data, expiresAt: Date.now() + ttl });
      return data;
    } finally {
      inflight.delete(codigo);
    }
  })();
  inflight.set(codigo, p);
  return p;
}

export { ScraperError };
