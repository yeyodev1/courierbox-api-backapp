/**
 * Crea (o reactiva) un usuario a mano:
 *   tsx src/scripts/crear-usuario.ts <email> <password> <nombre...> --rol <rol>
 * Necesita DB_URI en el entorno. Si el correo ya existe, actualiza nombre,
 * rol y contraseña y lo deja activo.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { env } from "../config/env";
import { models } from "../models/index";
import { USER_ROLES, type UserRole } from "../models/user.model";

async function main() {
  const args = process.argv.slice(2);
  const rolIdx = args.indexOf("--rol");
  const rol = (rolIdx >= 0 ? args.splice(rolIdx, 2)[1] : "asesor") as UserRole;
  const [email, password, ...nombre] = args;

  if (!email || !password || !nombre.length) {
    console.error("Uso: tsx src/scripts/crear-usuario.ts <email> <password> <nombre...> --rol <rol>");
    process.exit(1);
  }
  if (!USER_ROLES.includes(rol)) {
    console.error(`Rol inválido. Opciones: ${USER_ROLES.join(", ")}`);
    process.exit(1);
  }

  await mongoose.connect(env.DB_URI);
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await models.users.findOneAndUpdate(
    { email: email.toLowerCase() },
    {
      $set: { passwordHash, name: nombre.join(" "), role: rol, activo: true },
      $inc: { tokenVersion: 1 },
    },
    { upsert: true, new: true }
  );
  console.log(`✓ Usuario listo: ${user.email} · ${user.name} · rol ${user.role}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
