import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8100),
  NODE_ENV: z.preprocess(
    (val) => (typeof val === "string" ? val.trim() : val),
    z.enum(["development", "production", "test"])
  ).default("development"),
  FRONTEND_ORIGIN: z
    .string()
    .default("http://localhost:5173")
    .transform((s) => s.split(",").map((v) => v.trim()).filter(Boolean)),

  COURIER_URL: z
    .string()
    .url()
    .default("https://courierbox.sistemaml.info/index.php?accesscheck=%2Fjc_home.php"),
  COURIER_USER: z.string().min(1, "COURIER_USER is required"),
  COURIER_PASS: z.string().min(1, "COURIER_PASS is required"),
  SCRAPER_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(60),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

  DB_URI: z.string().url("DB_URI must be a valid URL"),
  JWT_SECRET: z.string().min(10, "JWT_SECRET is required"),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(1),
  PAYPHONE_STORE_ID: z.string().min(1),
  PAYPHONE_TOKEN: z.string().min(1),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const errors = parsed.error.flatten().fieldErrors;
  console.error("[env] invalid configuration:", errors);
  // En serverless evitamos process.exit (mata el cold start sin log claro).
  // Lanzamos para que aparezca en los logs de la plataforma.
  throw new Error(
    `Invalid environment configuration: ${JSON.stringify(errors)}`
  );
}

export const env = parsed.data;
export type Env = typeof env;
