import bcrypt from "bcryptjs";
import { env } from "../config/env";
import { models } from "../models/index";
import { logger } from "../utils/logger";

/**
 * Guarantees the account named by SUPERADMIN_EMAIL can actually reach the
 * private suite.
 *
 * The previous version only checked that *a* user with that email existed and
 * returned. When the address had already been created with another role
 * (it was sitting on `asesor` in production), the role was never corrected —
 * so the whole /superadmin section had zero users who could open it.
 */
export async function ensureSuperadminUser() {
  const email = env.SUPERADMIN_EMAIL.toLowerCase();
  const existing = await models.users.findOne({ email });

  if (!existing) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(env.SUPERADMIN_PASSWORD, salt);
    await models.users.create({
      email,
      passwordHash,
      name: "Oscar Ugarte",
      role: "superadmin",
    });
    logger.info("[bootstrap] superadmin creado", { email });
    return;
  }

  // Only the role and the active flag are reconciled. The password is left
  // alone so a rotated one is never silently reset back to the env default.
  const fixes: string[] = [];
  if (existing.role !== "superadmin") {
    fixes.push(`role ${existing.role} -> superadmin`);
    existing.role = "superadmin";
  }
  if (existing.activo === false) {
    fixes.push("activo false -> true");
    existing.activo = true;
  }

  if (fixes.length > 0) {
    await existing.save();
    logger.warn("[bootstrap] superadmin corregido", { email, fixes });
  }
}
