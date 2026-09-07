/**
 * `src/config/env.ts` valida el entorno al importarse y lanza si falta algo.
 * Cualquier spec que alcance ese módulo por una cadena de imports —
 * upload.service, config/contact, el middleware de errores — moría antes de
 * correr un solo test. Estos valores son de mentira a propósito: sólo existen
 * para que el módulo cargue; los tests que tocan servicios externos los mockean.
 */
const valoresDePrueba: Record<string, string> = {
  COURIER_USER: "test-user",
  COURIER_PASS: "test-pass",
  DB_URI: "mongodb://localhost:27017/courierbox-test",
  JWT_SECRET: "test-secret",
  ADMIN_EMAIL: "admin@test.local",
  ADMIN_PASSWORD: "test-password",
  PAYPHONE_STORE_ID: "test-store",
  PAYPHONE_TOKEN: "test-token",
};

for (const [clave, valor] of Object.entries(valoresDePrueba)) {
  if (!process.env[clave]) process.env[clave] = valor;
}
