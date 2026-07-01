import bcrypt from "bcryptjs";
import { env } from "../config/env";
import { models } from "../models/index";

export async function ensureSuperadminUser() {
  const email = env.SUPERADMIN_EMAIL.toLowerCase();
  const exists = await models.users.findOne({ email }).lean();
  if (exists) return;

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(env.SUPERADMIN_PASSWORD, salt);

  await models.users.create({
    email,
    passwordHash,
    name: "Oscar Ugarte",
    role: "superadmin",
  });
}
