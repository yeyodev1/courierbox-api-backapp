import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8101),
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
  SUPERADMIN_EMAIL: z.string().email().default("ougarte@courierboxlogistics.com"),
  SUPERADMIN_PASSWORD: z.string().min(1).default("123456789"),
  PAYPHONE_STORE_ID: z.string().min(1),
  PAYPHONE_TOKEN: z.string().min(1),
  // Courier Box no longer runs a CRM. The GHL metrics screen and its API client
  // were removed; this stays optional only for the legacy outbound webhooks
  // below, which no-op when their URLs are unset.
  GHL_ACCESS_TOKEN: z.string().default(""),

  // --- CourierBridge Hub ---
  GHL_WEBHOOK_INVOICE_URL: z.string().default(""),
  GHL_WEBHOOK_COMPRA_URL: z.string().default(""),
  // Courier Box's own WhatsApp line. There is no CRM or WhatsApp API here: the
  // backend composes the message and builds a wa.me link to this number.
  COURIER_WHATSAPP_NUMBER: z.string().default("13478248937"),
  CONTIFICO_API_URL: z.string().default("https://api.contifico.com/v1"),
  CONTIFICO_API_KEY: z.string().default(""),
  CONTIFICO_TOKEN: z.string().default(""),
  CONTIFICO_PUNTO_EMISION: z.string().default("001"),
  CONTIFICO_ESTABLECIMIENTO: z.string().default("001"),
  STORAGE_BASE_URL: z.string().default("/uploads"),

  // --- Cloudinary ---
  CLOUDINARY_CLOUD_NAME: z.string().default(""),
  CLOUDINARY_API_KEY: z.string().default(""),
  CLOUDINARY_API_SECRET: z.string().default(""),

  // --- Resend Email ---
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().email().default("courierboxlogistics@bakano.ec"),
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
