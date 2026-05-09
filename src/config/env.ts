import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8100),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  FRONTEND_ORIGIN: z
    .string()
    .default("http://localhost:5173")
    .transform((s) => s.split(",").map((v) => v.trim()).filter(Boolean)),

  COURIER_URL: z.string().url(),
  COURIER_USER: z.string().min(1),
  COURIER_PASS: z.string().min(1),
  SCRAPER_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(60),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

  MONGO_URI: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("[env] invalid configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
